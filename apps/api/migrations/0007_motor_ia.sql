-- 0007_motor_ia — base durable y auditable del motor de IA.
--
-- La migración es aditiva salvo por dos CHECK que se amplían y por la
-- separación de identidad/versiones de grading_contexts. El contenido
-- existente se copia a una v1 antes de retirar las columnas antiguas.

-- ── Entregas y resultados ─────────────────────────────────────────────────

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'submissions'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%status%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE submissions DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE submissions
  ADD CONSTRAINT submissions_status_check CHECK (status IN (
    'pending', 'transcribing', 'transcribed', 'grading', 'graded', 'parked',
    'validated', 'published', 'error'
  )),
  ADD COLUMN IF NOT EXISTS batch_run_id uuid REFERENCES batch_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parked_reason text,
  ADD COLUMN IF NOT EXISTS parked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS triage_label text CHECK (triage_label IS NULL OR triage_label IN (
    'errata', 'administrativa', 'no_es_duda', 'sencilla', 'dificil'
  )),
  ADD COLUMN IF NOT EXISTS triage_confidence numeric(4, 3)
    CHECK (triage_confidence IS NULL OR triage_confidence BETWEEN 0 AND 1);

CREATE INDEX IF NOT EXISTS submissions_batch_run_idx ON submissions (batch_run_id);

ALTER TABLE correction_items
  ADD COLUMN IF NOT EXISTS ai_quote text,
  ADD COLUMN IF NOT EXISTS ai_quote_page integer CHECK (ai_quote_page IS NULL OR ai_quote_page > 0);

ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS verification jsonb,
  ADD COLUMN IF NOT EXISTS teacher_notes text,
  ADD COLUMN IF NOT EXISTS simulated boolean NOT NULL DEFAULT false;

ALTER TABLE transcriptions
  ADD COLUMN IF NOT EXISTS discrepancies jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pass_count integer NOT NULL DEFAULT 1 CHECK (pass_count > 0);

ALTER TABLE activities ADD COLUMN IF NOT EXISTS template_key text;

-- ── Contextos versionados ─────────────────────────────────────────────────

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'grading_contexts'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%level%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE grading_contexts DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE grading_contexts
  ADD CONSTRAINT grading_contexts_level_check
    CHECK (level IN ('global', 'activity_kind', 'template', 'course', 'activity')),
  ADD COLUMN IF NOT EXISTS active_version integer NOT NULL DEFAULT 1
    CHECK (active_version > 0);

CREATE TABLE IF NOT EXISTS grading_context_versions (
  context_id   uuid NOT NULL REFERENCES grading_contexts(id) ON DELETE CASCADE,
  version      integer NOT NULL CHECK (version > 0),
  content      text NOT NULL DEFAULT '',
  content_hash text NOT NULL,
  source       text NOT NULL CHECK (source IN ('seed', 'migration', 'edit', 'restore')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (context_id, version)
);

INSERT INTO grading_context_versions (
  context_id, version, content, content_hash, source, created_at, created_by
)
SELECT
  id,
  1,
  content,
  encode(digest(content, 'sha256'), 'hex'),
  'migration',
  updated_at,
  updated_by
FROM grading_contexts
ON CONFLICT (context_id, version) DO NOTHING;

ALTER TABLE grading_contexts
  DROP COLUMN IF EXISTS content,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS updated_by;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'grading_contexts_active_version_fk'
  ) THEN
    ALTER TABLE grading_contexts
      ADD CONSTRAINT grading_contexts_active_version_fk
      FOREIGN KEY (id, active_version)
      REFERENCES grading_context_versions(context_id, version)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS grading_context_versions_created_idx
  ON grading_context_versions (context_id, created_at DESC);

-- ── Registro versionado de prompts ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prompts (
  key        text NOT NULL,
  version    integer NOT NULL CHECK (version > 0),
  content    text NOT NULL,
  active     boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS prompts_one_active_per_key
  ON prompts (key) WHERE active;

-- ── Lotes del proveedor ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_run_id      uuid NOT NULL REFERENCES batch_runs(id) ON DELETE CASCADE,
  provider_batch_id text,
  phase             text NOT NULL CHECK (phase IN ('reading', 'grading', 'verify')),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'ended', 'failed', 'canceled'
  )),
  request_count     integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz
);

CREATE INDEX IF NOT EXISTS ai_batches_open_idx
  ON ai_batches (status, created_at) WHERE status IN ('pending', 'in_progress');
CREATE UNIQUE INDEX IF NOT EXISTS ai_batches_provider_id_idx
  ON ai_batches (provider_batch_id) WHERE provider_batch_id IS NOT NULL;

-- ── Ledger de llamadas ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_calls (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_run_id          uuid REFERENCES batch_runs(id) ON DELETE SET NULL,
  ai_batch_id           uuid REFERENCES ai_batches(id) ON DELETE SET NULL,
  submission_id         uuid REFERENCES submissions(id) ON DELETE SET NULL,
  operation             text NOT NULL CHECK (operation IN (
    'reading_a', 'reading_b', 'grade', 'triage', 'verify', 'forum_answer',
    'connection_test'
  )),
  transport             text NOT NULL CHECK (transport IN ('batch', 'sync')),
  provider              text NOT NULL,
  model_requested       text NOT NULL,
  model_returned        text,
  prompt_key            text,
  prompt_version        integer,
  context_hash          text,
  context_versions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  request_params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_raw          jsonb,
  parsed_ok             boolean NOT NULL DEFAULT false,
  stop_reason           text,
  error                 text,
  latency_ms            integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  input_tokens          integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens         integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens     integer NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_creation_tokens integer NOT NULL DEFAULT 0 CHECK (cache_creation_tokens >= 0),
  cost_cents            numeric(12, 6),
  unpriced              boolean NOT NULL DEFAULT false,
  simulated             boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (prompt_key IS NULL AND prompt_version IS NULL)
    OR (prompt_key IS NOT NULL AND prompt_version IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ai_calls_submission_idx ON ai_calls (submission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_calls_batch_run_idx ON ai_calls (batch_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_calls_operation_idx ON ai_calls (operation, created_at DESC);

-- Valores iniciales: una instalación ya configurada conserva siempre lo suyo.
INSERT INTO app_settings (key, value) VALUES
  ('anthropic.readingModel', 'claude-opus-4-8'),
  ('anthropic.gradingModel', 'claude-opus-4-8'),
  ('anthropic.verifyModel', 'claude-sonnet-5'),
  ('anthropic.triageModel', 'claude-haiku-4-5'),
  ('ai.transport', 'sync'),
  ('ai.verify', 'true'),
  ('ai.explanations', 'true'),
  ('ai.lowConfidenceThreshold', '0.75'),
  ('ai.pagesPerChunk', '4'),
  ('ai.logRetentionDays', '180')
ON CONFLICT (key) DO NOTHING;
