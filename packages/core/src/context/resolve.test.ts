import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTEXT_LEVEL_LABEL } from '@vega/shared';
import type { ActivityFile } from '@vega/shared';
import { resolveContext } from './resolve.js';

test('concatena los tres niveles en orden de especificidad', () => {
  const resolved = resolveContext({
    global: 'Reglas de la academia.',
    activityKind: 'Criterios para corregir una entrega.',
    activity: 'Solución de referencia del tema 4.',
  });

  const positions = [
    resolved.merged.indexOf(CONTEXT_LEVEL_LABEL.global),
    resolved.merged.indexOf(CONTEXT_LEVEL_LABEL.activity_kind),
    resolved.merged.indexOf(CONTEXT_LEVEL_LABEL.activity),
  ];
  assert.ok(
    positions.every((position) => position >= 0),
    'faltan cabeceras',
  );
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('devuelve cada nivel por separado, ya recortado', () => {
  const resolved = resolveContext({
    global: '  Reglas.  \n',
    activityKind: null,
    activity: undefined,
  });

  assert.equal(resolved.global, 'Reglas.');
  assert.equal(resolved.activityKind, '');
  assert.equal(resolved.activity, '');
});

test('los niveles vacíos no generan cabecera', () => {
  const resolved = resolveContext({
    global: '',
    activityKind: '   ',
    activity: 'Sólo la actividad.',
  });

  assert.ok(!resolved.merged.includes(CONTEXT_LEVEL_LABEL.global));
  assert.ok(!resolved.merged.includes(CONTEXT_LEVEL_LABEL.activity_kind));
  assert.ok(resolved.merged.includes(CONTEXT_LEVEL_LABEL.activity));
  assert.ok(resolved.merged.includes('Sólo la actividad.'));
});

test('sin ningún nivel el resultado es vacío, no una cabecera suelta', () => {
  assert.equal(resolveContext({}).merged, '');
});

test('los ficheros de contexto viajan con el resultado, y vacío es un caso válido', () => {
  assert.deepEqual(resolveContext({ global: 'Reglas.' }).files, []);

  const file: ActivityFile = {
    id: '11111111-1111-4111-8111-111111111111',
    activityId: '22222222-2222-4222-8222-222222222222',
    filename: 'enunciado.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 12_345,
    url: '/api/activities/22222222-2222-4222-8222-222222222222/files/11111111-1111-4111-8111-111111111111',
    uploadedAt: '2026-01-15T08:00:00.000Z',
  };
  assert.deepEqual(resolveContext({ global: 'Reglas.', files: [file] }).files, [file]);
});
