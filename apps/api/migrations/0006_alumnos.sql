-- 0006_alumnos — quién ha entregado, y no sólo un identificador.
--
-- Hasta ahora una entrega llevaba `student_ref` («moodle-4217») y punto.
-- `student_alias` existía desde la 0001 y **no lo rellenaba nadie**: era la
-- pregunta abierta 6 de HU-08. Eso bastaba mientras Vega sólo tenía que
-- distinguir entregas entre sí, y deja de bastar por dos motivos:
--
--  1. El profesor revisa a las once de la noche y necesita saber de quién es lo
--     que está firmando. «alumno-0003» no es un nombre.
--  2. **La corrección depende de la comunidad autónoma.** Una oposición de
--     matemáticas no se corrige igual en dos comunidades: cambian el tribunal y
--     los criterios. Ese dato vive en Moodle como campo personalizado `CCAA` y
--     hasta ahora no llegaba a Vega, así que el modelo corregía sin saberlo.
--
-- Tabla propia y no columnas en `submissions` porque **un alumno entrega muchas
-- veces**: repetir su nombre, su email y sus campos personalizados en cada fila
-- haría que actualizar un dato exigiera recorrer todas sus entregas, y que dos
-- entregas del mismo alumno pudieran discrepar.
--
-- Aditiva e idempotente (ADR 0002).

CREATE TABLE IF NOT EXISTS students (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- La identidad que da el LMS, en el mismo formato que `submissions.student_ref`
  -- («moodle-4217»). Es lo que permite casar una entrega con su alumno sin
  -- depender del nombre, que cambia.
  student_ref       text NOT NULL UNIQUE,
  username          text,
  first_name        text,
  last_name         text,
  full_name         text,
  email             text,
  phone             text,
  -- Identificador del centro. NO es el NIF: ese es un campo personalizado y se
  -- guarda como tal.
  idnumber          text,
  institution       text,
  department        text,
  city              text,
  country           text,
  -- Comunidad autónoma, extraída del campo personalizado `CCAA`. Se guarda
  -- resuelta además de en `custom_fields` porque es el único dato del perfil que
  -- afecta a la corrección, y buscarlo dentro de un jsonb en cada lote sería
  -- caro y frágil. Puede traer **varias** separadas por coma: un opositor se
  -- presenta en más de una comunidad, y así las guarda el sistema del cliente.
  community         text,
  -- Los campos personalizados tal cual llegan del LMS. Qué campos existen es
  -- decisión de cada instalación de Moodle, así que aquí no se interpreta nada:
  -- [{ shortname, name, value }]
  custom_fields     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Cuándo se refrescó por última vez desde el LMS. El perfil se vuelve a leer
  -- en cada ingesta, así que esto dice si el dato es de hoy o de hace un mes.
  synced_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS student_id uuid
  REFERENCES students(id) ON DELETE SET NULL;

-- `SET NULL` y no `CASCADE`: borrar la ficha de un alumno —porque ejerce su
-- derecho de supresión, por ejemplo— **no puede llevarse por delante su entrega
-- ni la corrección que el profesor firmó**. La entrega sobrevive con su
-- `student_ref`, que es un identificador y no un dato personal.

CREATE INDEX IF NOT EXISTS submissions_student_idx ON submissions (student_id);

-- Las entregas que ya existían se enlazan con su alumno en cuanto la ingesta
-- vuelva a pasar por ellas. No se hace aquí un backfill porque no hay de dónde:
-- los perfiles no estaban guardados en ninguna parte.
