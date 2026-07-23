import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppContext } from '../context.js';
import { schema } from '../db/client.js';
import { recoverInterruptedWork } from './recovery.js';

test('al arrancar cierra procesos y llamadas huérfanas y devuelve entregas a la cola', async () => {
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: async () => [{ id: 'run-1' }, { id: 'run-2' }],
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table, values });
          if (table === schema.batchRuns) return Promise.resolve();
          return {
            returning: async () =>
              table === schema.submissions
                ? [{ id: 'submission-1' }, { id: 'submission-2' }, { id: 'submission-3' }]
                : [{ id: 'call-1' }, { id: 'call-2' }, { id: 'call-3' }, { id: 'call-4' }],
          };
        },
      }),
    }),
  };
  const now = new Date('2026-07-22T20:00:00.000Z');

  const report = await recoverInterruptedWork({ db } as unknown as AppContext, now);

  assert.deepEqual(report, { runsClosed: 2, submissionsRequeued: 3, callsClosed: 4 });
  assert.deepEqual(updates.map(({ table }) => table), [
    schema.batchRuns,
    schema.submissions,
    schema.aiCalls,
  ]);
  assert.deepEqual(updates[0]?.values, { status: 'failed', finishedAt: now });
  assert.deepEqual(updates[1]?.values, { status: 'pending', updatedAt: now });
  assert.equal(updates[2]?.values['stopReason'], 'interrupted');
  assert.match(String(updates[2]?.values['error']), /reiniciar/);
});
