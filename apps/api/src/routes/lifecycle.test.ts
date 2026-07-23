import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATCH_MAX_RUNTIME_MS, autonomyDecision, isFatalProviderError } from './batch.js';
import { isReprocessableStatus } from './submissions.js';
import { ingestCutoff } from '../ingest/run.js';

test('el proceso tiene un límite global de doce horas', () => {
  assert.equal(BATCH_MAX_RUNTIME_MS, 12 * 60 * 60_000);
});

test('un saldo insuficiente detiene el lote aunque Anthropic responda 400', () => {
  const error = Object.assign(
    new Error('Your credit balance is too low to access the Anthropic API.'),
    { status: 400 },
  );
  assert.equal(isFatalProviderError(error), true);
});

test('autenticación es global pero un fallo de contenido pertenece a una entrega', () => {
  assert.equal(isFatalProviderError(Object.assign(new Error('Unauthorized'), { status: 401 })), true);
  assert.equal(
    isFatalProviderError(Object.assign(new Error('El PDF está dañado'), { status: 400 })),
    false,
  );
});

test('sólo se reprocesan resultados todavía no validados', () => {
  assert.equal(isReprocessableStatus('graded'), true);
  assert.equal(isReprocessableStatus('parked'), true);
  assert.equal(isReprocessableStatus('error'), true);
  assert.equal(isReprocessableStatus('pending'), false);
  assert.equal(isReprocessableStatus('grading'), false);
  assert.equal(isReprocessableStatus('validated'), false);
  assert.equal(isReprocessableStatus('published'), false);
});

test('la autonomía publica sin fingir una validación docente', () => {
  assert.equal(autonomyDecision('review_all', 0.99, 0), 'review');
  assert.equal(autonomyDecision('review_low_confidence', 0.75, 0), 'review');
  assert.equal(autonomyDecision('review_low_confidence', 0.91, 1), 'review');
  assert.equal(autonomyDecision('review_low_confidence', 0.91, 0), 'publish');
  assert.equal(autonomyDecision('autonomous', 0.2, 8), 'publish');
});

test('la antigüedad máxima sólo corta cuando está configurada', () => {
  // Cero es «sin límite», no «no corrijas nada»: una instalación nueva no debe
  // descartar en silencio entregas que su profesorado sí quiere corregir.
  const now = new Date('2026-07-23T00:00:00.000Z');
  assert.equal(ingestCutoff(0, now), null);
  assert.equal(ingestCutoff(-5, now), null);
  assert.equal(ingestCutoff(Number.NaN, now), null);

  const cutoff = ingestCutoff(30, now);
  assert.ok(cutoff !== null);
  assert.equal(cutoff.toISOString(), '2026-06-23T00:00:00.000Z');
  // Una entrega justo en el borde se conserva: el corte es «anterior a», no
  // «anterior o igual», y en la frontera es mejor corregir de más.
  assert.ok(new Date('2026-06-23T00:00:00.000Z') >= cutoff);
  assert.ok(new Date('2026-06-22T23:59:59.000Z') < cutoff);
});
