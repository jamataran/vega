-- 0005_ingesta_y_publicacion — el conector deja de ser sólo un catálogo.
--
-- Hasta aquí Vega hablaba con Moodle para *descubrir* cursos y actividades, y
-- nada más: las entregas las sembraba `pnpm db:demo` y publicar era escribir
-- una fecha en la base de datos. Esta migración añade lo que falta para que las
-- entregas entren y las notas salgan de verdad.
--
-- Aditiva e idempotente, como manda el ADR 0002: se aplica sobre una base ya
-- poblada sin pasos manuales y sin perder nada.

-- ── 1. Dónde vive el fichero del alumno ─────────────────────────────────────
--
-- Sin esto, `download()` no tenía a dónde escribir y la transcripción no tenía
-- de dónde leer: el lote fabricaba rutas falsas ("examen.pdf#1") que sólo el
-- proveedor de IA simulado toleraba. La ruta es relativa a STORAGE_ROOT, no
-- absoluta, para que mover el volumen o cambiar de máquina no invalide filas.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS media_type text;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS size_bytes integer NOT NULL DEFAULT 0;

-- ── 2. La clave natural no protegía los foros ───────────────────────────────
--
-- `UNIQUE (activity_id, student_ref, original_filename)` se creó cuando toda
-- entrega tenía fichero. En un foro `original_filename` es NULL, y en
-- PostgreSQL dos NULL no colisionan en un índice único: reingerir el mismo foro
-- creaba entregas nuevas del mismo alumno una y otra vez, y con el motor de IA
-- encendido **cada duplicado se pagaría en tokens**.
--
-- Se resuelve con la identidad que el conector ya devuelve —`remoteId`, estable
-- entre ejecuciones— en vez de retorcer la clave anterior. El índice es parcial
-- porque las entregas sembradas y las heredadas no tienen `remote_id` y no
-- deben colisionar entre sí.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS remote_id text;

CREATE UNIQUE INDEX IF NOT EXISTS submissions_remote_key
  ON submissions (activity_id, remote_id)
  WHERE remote_id IS NOT NULL;

-- ── 3. La publicación puede quedarse a medias ───────────────────────────────
--
-- `publishGrade` y `publishFeedbackFile` son dos operaciones de red separadas y
-- la segunda puede fallar con la primera ya hecha: la nota está en Moodle y el
-- alumno la ve, pero el fichero no llegó. Con una sola columna `published_at`
-- no había forma de saber qué se llegó a publicar, así que el reintento habría
-- vuelto a mandar la nota (HU-17, pregunta abierta 2).
--
-- Dos marcas separadas hacen el reintento idempotente: se reenvía sólo lo que
-- falta. `published_at` se mantiene como estaba y sigue significando
-- «publicación completa»; es lo que lee el resto del sistema.
ALTER TABLE corrections ADD COLUMN IF NOT EXISTS grade_published_at timestamptz;
ALTER TABLE corrections ADD COLUMN IF NOT EXISTS feedback_file_published_at timestamptz;

-- Un conector puede no admitir el fichero de feedback (es el caso de Moodle 3
-- con `assignfeedback_file`). Eso no es un fallo: la nota se publica igual y la
-- entrega llega a `published`, pero hay que poder decírselo al profesor sin
-- inventarse el motivo cada vez.
ALTER TABLE corrections ADD COLUMN IF NOT EXISTS publish_notice text;

-- Las correcciones ya publicadas antes de esta migración lo fueron marcando la
-- fecha sin llamar a ningún LMS. Se les da por publicada la nota para que un
-- reintento no intente republicar en Moodle algo que nunca salió de Vega, y se
-- deja constancia de por qué.
UPDATE corrections
   SET grade_published_at = published_at,
       publish_notice = COALESCE(
         publish_notice,
         'Publicada antes de que Vega hablara con el LMS: se marcó en la base de datos y nada llegó a Moodle.'
       )
 WHERE published_at IS NOT NULL
   AND grade_published_at IS NULL;

-- ── 4. La ingesta se mide igual que la corrección ───────────────────────────
--
-- Un lote que no corrige nada porque no ha ingerido nada y uno que no corrige
-- nada porque no había novedades son indistinguibles sin este contador. Al
-- encender el motor de IA, saber si el problema está en la entrada o en el
-- modelo es la primera pregunta que se hace.
ALTER TABLE batch_runs ADD COLUMN IF NOT EXISTS submissions_ingested integer NOT NULL DEFAULT 0;
ALTER TABLE batch_runs ADD COLUMN IF NOT EXISTS activities_failed integer NOT NULL DEFAULT 0;
