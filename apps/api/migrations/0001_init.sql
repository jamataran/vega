-- 0001_init — esquema inicial de Vega.
-- Las migraciones se aplican de forma idempotente al arrancar el contenedor
-- del API, así que todo aquí debe poder ejecutarse sobre una BD vacía.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Usuarios ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('teacher', 'admin')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- ── Buzones ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mailboxes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text NOT NULL UNIQUE,
  name               text NOT NULL,
  task_type          text NOT NULL CHECK (task_type IN ('simulacro_problema', 'simulacro_tema')),
  max_score          numeric(6, 2) NOT NULL CHECK (max_score > 0),
  reference_solution text,
  grading_notes      text,
  points_allocation  jsonb NOT NULL DEFAULT '[]'::jsonb,
  connector          text NOT NULL DEFAULT 'mock',
  lms_ref            text,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ── Entregas ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id        uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  student_ref       text NOT NULL,
  student_alias     text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN (
                      'pending', 'transcribing', 'transcribed', 'grading',
                      'graded', 'validated', 'published', 'error')),
  original_filename text NOT NULL,
  page_count        integer NOT NULL DEFAULT 0,
  error_message     text,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Una misma entrega del LMS no debe importarse dos veces.
  UNIQUE (mailbox_id, student_ref, original_filename)
);

CREATE INDEX IF NOT EXISTS submissions_status_idx ON submissions (status);
CREATE INDEX IF NOT EXISTS submissions_mailbox_idx ON submissions (mailbox_id);
CREATE INDEX IF NOT EXISTS submissions_submitted_at_idx ON submissions (submitted_at DESC);

-- ── Transcripciones ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transcriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  pages         jsonb NOT NULL DEFAULT '[]'::jsonb,
  flags         jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence    numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  model         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Correcciones ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS corrections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       uuid NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  max_score           numeric(6, 2) NOT NULL CHECK (max_score > 0),
  ai_summary          text NOT NULL DEFAULT '',
  teacher_summary     text,
  confidence          numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  model               text NOT NULL,
  input_tokens        integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,
  cached_input_tokens integer NOT NULL DEFAULT 0,
  cost_cents          numeric(10, 4) NOT NULL DEFAULT 0,
  validated_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  validated_at        timestamptz,
  published_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS correction_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_id      uuid NOT NULL REFERENCES corrections(id) ON DELETE CASCADE,
  label              text NOT NULL,
  statement          text NOT NULL DEFAULT '',
  max_points         numeric(6, 2) NOT NULL CHECK (max_points >= 0),
  ai_points          numeric(6, 2) NOT NULL DEFAULT 0 CHECK (ai_points >= 0),
  ai_feedback        text NOT NULL DEFAULT '',
  teacher_points     numeric(6, 2) CHECK (teacher_points >= 0),
  teacher_feedback   text,
  confidence         numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  alternative_method boolean NOT NULL DEFAULT false,
  position           integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS correction_items_correction_idx
  ON correction_items (correction_id, position);

-- ── Contextos de corrección ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS grading_contexts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level      text NOT NULL CHECK (level IN ('global', 'task_type', 'mailbox')),
  key        text NOT NULL,
  content    text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (level, key)
);

-- ── Lotes ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS batch_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  status                text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  submissions_processed integer NOT NULL DEFAULT 0,
  submissions_failed    integer NOT NULL DEFAULT 0,
  input_tokens          integer NOT NULL DEFAULT 0,
  output_tokens         integer NOT NULL DEFAULT 0,
  cached_input_tokens   integer NOT NULL DEFAULT 0,
  cost_cents            numeric(10, 4) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS batch_runs_started_at_idx ON batch_runs (started_at DESC);
