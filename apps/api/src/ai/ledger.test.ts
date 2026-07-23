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
