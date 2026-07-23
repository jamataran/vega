-- ─────────────────────────────────────────────────────────────────────────────
--  Parar un proceso de corrección a mano
--
--  Hasta ahora un lote sólo podía terminar (`done`) o romperse (`failed`), así
--  que quien lo paraba tenía que registrarse como un fallo. Es una mentira con
--  consecuencias: en el panel de procesos no hay forma de distinguir «Moodle nos
--  dejó tirados» de «lo paré yo porque estaba corrigiendo entregas de hace
--  meses», y son dos cosas que exigen reacciones opuestas.
--
--  `cancelled` es la decisión de una persona y se cuenta como tal.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE batch_runs DROP CONSTRAINT IF EXISTS batch_runs_status_check;

ALTER TABLE batch_runs
  ADD CONSTRAINT batch_runs_status_check
  CHECK (status IN ('running', 'done', 'failed', 'cancelled'));

-- El motivo por el que se cerró, cuando hay uno que contar. Se lee junto a
-- `problems`: aquello son incidencias de la ingesta y esto es lo que le pasó al
-- proceso entero.
ALTER TABLE batch_runs
  ADD COLUMN IF NOT EXISTS closed_reason text;
