-- Planificación por tipo de actividad.
--
-- El planificador deja de ser único y global: entregas y foros llevan cada uno
-- su propia cadencia (`schedule.assignment.*` y `schedule.forum.*` en
-- app_settings; las claves antiguas `schedule.*` quedan como respaldo de
-- lectura y no hace falta migrarlas). Cada proceso registra qué tipos barrió.

ALTER TABLE batch_runs
  ADD COLUMN IF NOT EXISTS kinds text[] NOT NULL DEFAULT '{assignment,forum}';
