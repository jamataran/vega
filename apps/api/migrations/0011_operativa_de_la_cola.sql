-- ─────────────────────────────────────────────────────────────────────────────
--  La operativa de la cola: trazar, dar por visto y cerrar a mano
--
--  Tres huecos que salieron en las pruebas reales sobre el entorno de test y
--  que comparten una misma causa: el sistema sabía cosas que no enseñaba.
--
--  1. Un proceso decía «5 ingeridas, 1 procesada, 1 fallida» y no había forma
--     de llegar a **cuáles**. `batch_run_id` sólo apunta al proceso que
--     **corrigió** la entrega, y se limpia en cada reproceso; quién la trajo de
--     Moodle no se guardaba en ninguna parte.
--
--  2. Un error se quedaba reclamando atención para siempre. No hay nada entre
--     «ha fallado» y «lo he vuelto a procesar»: mirarlo, entender que era un
--     PDF corrupto del alumno y seguir trabajando no dejaba rastro, así que la
--     pestaña de errores contaba lo mismo al día siguiente.
--
--  3. Una corrección validada que el profesor entrega por su cuenta —la
--     imprime, la manda por correo, la sube él a Moodle— no tenía forma de
--     salir de «Validadas». Se quedaba ahí pidiendo una publicación que ya
--     había ocurrido fuera de Vega.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Qué proceso trajo cada entrega ───────────────────────────────────────
--
-- Se conserva aunque después se reprocese: la pregunta «¿qué entró en el
-- proceso de anoche?» tiene una respuesta que no cambia, a diferencia de
-- `batch_run_id`, que es el proceso que la está corrigiendo ahora.
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS ingested_run_id uuid REFERENCES batch_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS submissions_ingested_run_idx
  ON submissions (ingested_run_id)
  WHERE ingested_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS submissions_batch_run_idx
  ON submissions (batch_run_id)
  WHERE batch_run_id IS NOT NULL;

-- ── 2. Errores vistos ───────────────────────────────────────────────────────
--
-- No cambia el estado —sigue siendo `error`, y sigue sin corrección— sino su
-- capacidad de reclamar: el contador de la pestaña cuenta sólo lo que nadie ha
-- mirado todavía. Se borra en cuanto la entrega vuelve a fallar, para que un
-- fallo nuevo sí vuelva a reclamar.
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS error_seen_at timestamptz;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS error_seen_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- ── 3. Publicación fuera de Vega ────────────────────────────────────────────
--
-- `published_at` deja de significar «esto llegó al alumno **por Moodle**» y
-- pasa a significar «esto ya está entregado». La distinción importa: sin ella,
-- las métricas de publicación contarían como enviadas notas que Vega no ha
-- mandado a ninguna parte, y nadie podría auditar la diferencia después.
ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS published_manually boolean NOT NULL DEFAULT false;
