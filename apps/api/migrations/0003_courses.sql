-- 0003_courses — el curso como entidad, y la credencial de Moodle por usuario.
--
-- Tres cosas que H2 necesita y la 0002 no dejaba resueltas:
--
--   1. El **curso** deja de ser texto libre. Es el primer paso del alta de
--      actividades, y sobre una cadena que Moodle puede renombrar en cualquier
--      momento no se puede construir un selector: renombrar partía el grupo en
--      dos y dos cursos homónimos se mezclaban.
--   2. `moodle_ref` gana prefijo de tipo y **índice único**. Los ids de
--      `mod_assign` y `mod_forum` vienen de tablas distintas de Moodle: una
--      tarea con id 5 y un foro con id 5 producían el mismo `moodle_ref` y el
--      mismo `slug`, y la segunda importación se perdía en silencio por el
--      `ON CONFLICT DO NOTHING`. Era pérdida de datos, no una carencia.
--   3. El **token de Moodle pasa a ser de cada usuario**. Decide qué cursos ve
--      la aplicación (`core_enrol_get_users_courses` es del dueño del token),
--      así que compartirlo enseñaría a todo el claustro los cursos de todos.
--
-- Como la 0002: todo con ALTER e idempotente, para que el despliegue GitOps lo
-- aplique sobre una base poblada sin pasos manuales.

-- ── Cursos ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS courses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moodle_course_id text NOT NULL UNIQUE,
  name             text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES courses(id) ON DELETE SET NULL;

-- Quién dio de alta la actividad. Con token por usuario, es la credencial con
-- la que se ingieren sus entregas: sin esto, el lote nocturno no sabría con
-- qué token bajarlas. `SET NULL` al borrar el usuario — la actividad sobrevive
-- a quien la importó, y la ingesta fallará diciendo que falta credencial.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS imported_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS activities_course_idx ON activities (course_id);

-- Rescatamos los cursos que ya existían como texto libre, para no perder el
-- agrupado de lo importado antes de esta migración. El `moodle_course_id` de
-- estos es sintético (`legacy:<nombre>`): no hay forma de recuperar el id real
-- de Moodle desde una cadena, y al re-sincronizar el curso entrará con su id
-- verdadero. Las actividades viejas se quedan en el curso heredado.
INSERT INTO courses (moodle_course_id, name)
SELECT DISTINCT 'legacy:' || course_name, course_name
FROM activities
WHERE course_name <> '' AND course_id IS NULL
ON CONFLICT (moodle_course_id) DO NOTHING;

UPDATE activities a
SET course_id = c.id
FROM courses c
WHERE a.course_id IS NULL AND c.moodle_course_id = 'legacy:' || a.course_name;

-- ── `moodle_ref`: prefijo de tipo y unicidad ────────────────────────────────

-- Un `moodle_ref` puramente numérico viene de un `Moodle3Connector` anterior al
-- prefijo. Lo normalizamos al formato nuevo para que re-sincronizar reconozca
-- la actividad en vez de duplicarla.
UPDATE activities
SET moodle_ref = CASE WHEN kind = 'assignment' THEN 'assign-' ELSE 'forum-' END || moodle_ref
WHERE moodle_ref ~ '^[0-9]+$';

-- Antes del índice único, deshacemos las colisiones que el bug haya podido
-- dejar: se queda la más antigua con su referencia y las demás pasan a ser
-- actividades locales (`moodle_ref` a NULL). No se borra nada — sus entregas y
-- correcciones siguen ahí; simplemente dejan de decir que vienen de Moodle, y
-- el profesor puede volver a importarlas.
UPDATE activities
SET moodle_ref = NULL
WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY moodle_ref ORDER BY created_at, id) AS position
    FROM activities
    WHERE moodle_ref IS NOT NULL
  ) ranked
  WHERE ranked.position > 1
);

-- Parcial: dos actividades locales (`moodle_ref` NULL) no colisionan entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS activities_moodle_ref_key
  ON activities (moodle_ref)
  WHERE moodle_ref IS NOT NULL;

-- ── Contenido de los ficheros de contexto ───────────────────────────────────

-- Hasta ahora `activity_files` guardaba sólo metadatos y `storage_path` se
-- quedaba siempre a NULL: la aplicación ofrecía subir ficheros que no servían
-- para nada. Los de texto (`.tex`, `.md`) se guardan aquí y viajan al modelo
-- con el contexto; el LaTeX del enunciado es texto y no necesita ni disco ni
-- OCR. Un binario sigue pudiendo adjuntarse como referencia, sin contenido.
ALTER TABLE activity_files
  ADD COLUMN IF NOT EXISTS content text;

-- La subida va troceada porque el proxy inverso de delante (Cloudflare) y el
-- `bodyLimit` de Fastify acotan el cuerpo de cada petición. Mientras llegan los
-- trozos la fila existe pero está incompleta: no se lista ni entra en el
-- contexto, para que una subida cortada a medias no acabe en un prompt.
-- Por defecto `true`: lo que ya estaba guardado está entero.
ALTER TABLE activity_files
  ADD COLUMN IF NOT EXISTS upload_complete boolean NOT NULL DEFAULT true;

-- ── Credencial de Moodle por usuario ────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS moodle_token text,
  ADD COLUMN IF NOT EXISTS moodle_token_updated_at timestamptz;

-- El token de instalación deja de existir: era global y ahora es de cada
-- usuario. Se borra en vez de migrarse a alguien, porque no hay forma de saber
-- de quién era y adjudicárselo a un usuario al azar le daría los cursos de otro.
DELETE FROM app_settings WHERE key = 'moodle.token';
