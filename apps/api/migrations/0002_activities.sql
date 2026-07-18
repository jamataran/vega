-- 0002_activities — de "buzones" a "actividades de Moodle".
--
-- Cambia el eje del modelo: Vega ya no gestiona buzones abstractos sino
-- actividades reales de Moodle, de dos tipos (entrega y foro), con la nota
-- opcional y un grado de autonomía por actividad. Añade además los ajustes
-- editables desde la aplicación y los ficheros de contexto del profesor.
--
-- Se hace con ALTER y no recreando: es lo que permite que el despliegue
-- GitOps aplique el cambio sobre una base ya existente sin pasos manuales.

-- ── Actividades ─────────────────────────────────────────────────────────────

ALTER TABLE mailboxes RENAME TO activities;

-- Los CHECK creados sin nombre conservan el nombre de la tabla original tras
-- el rename. Los buscamos por columna en vez de fiarlo a un nombre concreto.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'activities' AND con.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE activities DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE activities RENAME COLUMN task_type TO kind;
ALTER TABLE activities RENAME COLUMN lms_ref TO moodle_ref;
ALTER TABLE activities RENAME COLUMN active TO enabled;

-- Todo lo que existía era una entrega con fichero.
UPDATE activities SET kind = 'assignment'
WHERE kind IN ('simulacro_problema', 'simulacro_tema');

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS course_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS graded boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS autonomy text NOT NULL DEFAULT 'review_all';

-- La nota deja de ser obligatoria: un foro normalmente no se puntúa.
ALTER TABLE activities ALTER COLUMN max_score DROP NOT NULL;

-- Las indicaciones del profesor viven ahora en grading_contexts, nivel
-- 'activity'. La 0001 las tenía duplicadas aquí.
ALTER TABLE activities DROP COLUMN IF EXISTS grading_notes;
ALTER TABLE activities DROP COLUMN IF EXISTS connector;

ALTER TABLE activities
  ADD CONSTRAINT activities_kind_check CHECK (kind IN ('assignment', 'forum')),
  ADD CONSTRAINT activities_autonomy_check
    CHECK (autonomy IN ('review_all', 'review_low_confidence', 'autonomous')),
  ADD CONSTRAINT activities_max_score_check CHECK (max_score IS NULL OR max_score > 0),
  -- Si se puntúa, tiene que haber nota máxima. Es la regla que evita
  -- actividades a medio configurar.
  ADD CONSTRAINT activities_graded_needs_max_score
    CHECK (NOT graded OR max_score IS NOT NULL);

-- ── Ficheros de contexto de la actividad ────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id  uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  filename     text NOT NULL,
  mime_type    text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes   integer NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  storage_path text,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_files_activity_idx ON activity_files (activity_id);

-- ── Entregas ────────────────────────────────────────────────────────────────

ALTER TABLE submissions RENAME COLUMN mailbox_id TO activity_id;

-- Un foro no trae fichero: sólo el texto que escribió el alumno.
ALTER TABLE submissions ALTER COLUMN original_filename DROP NOT NULL;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS text_content text;

ALTER INDEX IF EXISTS submissions_mailbox_idx RENAME TO submissions_activity_idx;

-- ── Correcciones ────────────────────────────────────────────────────────────

ALTER TABLE corrections
  -- La corrección redactada en LaTeX pasa a ser salida de primer nivel: es lo
  -- único que produce una actividad no puntuable.
  ADD COLUMN IF NOT EXISTS ai_latex text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS teacher_latex text,
  -- PDF de feedback: original del alumno + páginas de corrección.
  ADD COLUMN IF NOT EXISTS annotated_file_url text,
  ADD COLUMN IF NOT EXISTS published_automatically boolean NOT NULL DEFAULT false;

ALTER TABLE corrections ALTER COLUMN max_score DROP NOT NULL;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'corrections' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%max_score%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE corrections DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE corrections
  ADD CONSTRAINT corrections_max_score_check CHECK (max_score IS NULL OR max_score > 0);

-- ── Contextos de corrección ─────────────────────────────────────────────────

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'grading_contexts' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%level%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE grading_contexts DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- Los dos tipos de simulacro colapsan en un único 'assignment', así que hay que
-- deduplicar ANTES de actualizar: si no, el propio UPDATE viola la unicidad de
-- (level, key). Nos quedamos con la fila más reciente.
DELETE FROM grading_contexts a
USING grading_contexts b
WHERE a.level = 'task_type'
  AND b.level = 'task_type'
  AND (a.updated_at, a.id) < (b.updated_at, b.id);

UPDATE grading_contexts SET level = 'activity_kind', key = 'assignment' WHERE level = 'task_type';
UPDATE grading_contexts SET level = 'activity' WHERE level = 'mailbox';

ALTER TABLE grading_contexts
  ADD CONSTRAINT grading_contexts_level_check
    CHECK (level IN ('global', 'activity_kind', 'activity'));

-- ── Lotes ───────────────────────────────────────────────────────────────────

ALTER TABLE batch_runs
  ADD COLUMN IF NOT EXISTS triggered_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submissions_auto_published integer NOT NULL DEFAULT 0;

-- ── Ajustes editables desde la aplicación ───────────────────────────────────

-- Clave/valor en vez de una fila ancha: los ajustes crecen con el producto y
-- así añadir uno no es una migración. `is_secret` marca lo que la API nunca
-- devuelve (claves de API, tokens, contraseñas SMTP).
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL DEFAULT '',
  is_secret  boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);
