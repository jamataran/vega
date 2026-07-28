import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AiProvider, VerifyConnectionResult } from '@vega/core';
import type { AppContext } from '../context.js';
import { withAiLedger } from './ledger.js';

const CALL_ID = '11111111-1111-4111-8111-111111111111';

const usage = {
  inputTokens: 12,
  outputTokens: 3,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  costCents: 0.25,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function harness(call: () => Promise<VerifyConnectionResult>) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return { returning: async () => [{ id: CALL_ID }] };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
  };
  const provider = {
    name: 'anthropic',
    verifyConnection: call,
  } as unknown as AiProvider;
  const ctx = { db } as unknown as AppContext;
  const models = {
    reading_a: 'reading',
    reading_b: 'reading',
    grade: 'grading',
    triage: 'triage',
    verify: 'verify',
    forum_answer: 'grading',
    connection_test: 'grading',
  } as const;
  const wrapped = withAiLedger(ctx, provider, { transport: 'sync', models, prompts: {} });
  return { wrapped, inserts, updates };
}

test('el ledger inserta la llamada antes de esperar al proveedor y actualiza la misma fila', async () => {
  const response = deferred<VerifyConnectionResult>();
  const { wrapped, inserts, updates } = harness(() => response.promise);

  const pending = wrapped.verifyConnection();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]?.['operation'], 'connection_test');
  assert.equal(updates.length, 0, 'una llamada abierta todavía no tiene resultado');

  response.resolve({ ok: true, message: 'Conexión correcta.', model: 'grading', usage });
  await pending;

  assert.equal(inserts.length, 1, 'el resultado no debe crear una segunda fila');
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.['parsedOk'], true);
  assert.equal(updates[0]?.['modelReturned'], 'grading');
  assert.equal(updates[0]?.['inputTokens'], usage.inputTokens);
  assert.equal(typeof updates[0]?.['latencyMs'], 'number');
});

test('una llamada tarifada guarda su importe y no queda marcada', async () => {
  const { wrapped, updates } = harness(async () => ({
    ok: true,
    message: 'Conexión correcta.',
    model: 'claude-opus-4-8',
    usage,
  }));

  await wrapped.verifyConnection();

  assert.equal(updates[0]?.['costCents'], String(usage.costCents));
  assert.equal(updates[0]?.['unpriced'], false);
});

/**
 * El desenlace correcto del incidente del 27/07/2026: la respuesta se entrega,
 * los tokens se guardan y el coste se declara desconocido en vez de fingirse
 * cero. Con los tokens en la fila, la llamada se puede volver a tarifar el día
 * que exista la tarifa.
 */
test('una llamada sin tarifa se guarda entera, con coste desconocido', async () => {
  const { wrapped, updates } = harness(async () => ({
    ok: true,
    message: 'Conexión correcta.',
    model: 'claude-zeta-9-20260101',
    usage: { ...usage, costCents: 0, unpriced: true },
  }));

  await wrapped.verifyConnection();

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.['parsedOk'], true, 'la respuesta es válida: sólo falta el precio');
  assert.equal(updates[0]?.['costCents'], null, 'sin tarifa se guarda NULL, nunca 0');
  assert.equal(updates[0]?.['unpriced'], true);
  assert.equal(updates[0]?.['inputTokens'], usage.inputTokens, 'los tokens permiten retarificar');
  assert.equal(updates[0]?.['outputTokens'], usage.outputTokens);
  assert.notEqual(updates[0]?.['responseRaw'], undefined, 'el trabajo pagado no se pierde');
});

test('el ledger conserva en la fila iniciada el error del proveedor', async () => {
  const failure = new Error('fallo controlado');
  const { wrapped, inserts, updates } = harness(async () => Promise.reject(failure));

  await assert.rejects(wrapped.verifyConnection(), failure);

  assert.equal(inserts.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.['parsedOk'], false);
  assert.equal(updates[0]?.['error'], failure.message);
  assert.equal(typeof updates[0]?.['latencyMs'], 'number');
});
