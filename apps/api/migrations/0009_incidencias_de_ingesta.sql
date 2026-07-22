-- Por qué falló la ingesta de una actividad, guardado con el proceso.
--
-- `activities_failed` decía cuántas, nunca cuáles ni por qué: el motivo sólo
-- existía en el log del contenedor, así que el profesor veía «no se han podido
-- leer las entregas de 3 actividades» y no tenía forma de averiguar que a su
-- servicio web de Moodle le faltaba una función. Ahora el parte viaja con el
-- proceso y se lee en la propia pantalla.

ALTER TABLE batch_runs
  ADD COLUMN IF NOT EXISTS problems jsonb NOT NULL DEFAULT '[]'::jsonb;
