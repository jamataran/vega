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
    hasContent: false,
    uploadComplete: true,
    uploadedAt: '2026-01-15T08:00:00.000Z',
  };
  assert.deepEqual(resolveContext({ global: 'Reglas.', files: [file] }).files, [file]);
});

test('la solución de referencia se rotula según se puntúe o no', () => {
  const solution = 'La derivada es $f\'(x) = 2x$.';

  const graded = resolveContext({ referenceSolution: solution, graded: true }).merged;
  assert.ok(graded.includes('## Solución de referencia'));
  assert.ok(graded.includes(solution));

  // En un foro no hay solución que contrastar: es el material sobre el que
  // preguntan. El mismo campo, y el rótulo evita que el modelo lo tome por la
  // respuesta que debe copiar.
  const ungraded = resolveContext({ referenceSolution: solution, graded: false }).merged;
  assert.ok(ungraded.includes('## Material asociado'));
  assert.ok(!ungraded.includes('## Solución de referencia'));
});

test('el contenido de los ficheros de texto entra en el contexto; lo vacío no', () => {
  const merged = resolveContext({
    global: 'Reglas.',
    fileContents: [
      { filename: 'enunciado.tex', content: '\\section{Derivadas}' },
      { filename: 'vacio.tex', content: '   ' },
    ],
  }).merged;

  assert.ok(merged.includes('## Material adjunto · enunciado.tex'));
  assert.ok(merged.includes('\\section{Derivadas}'));
  assert.ok(!merged.includes('vacio.tex'));
});

test('lo más específico va al final, para no acortar el prefijo cacheable', () => {
  const merged = resolveContext({
    global: 'Reglas globales.',
    activity: 'Reglas de la actividad.',
    referenceSolution: 'La solución.',
    fileContents: [{ filename: 'anexo.tex', content: 'Anexo.' }],
  }).merged;

  assert.ok(merged.indexOf('Reglas globales.') < merged.indexOf('Reglas de la actividad.'));
  assert.ok(merged.indexOf('Reglas de la actividad.') < merged.indexOf('La solución.'));
  assert.ok(merged.indexOf('La solución.') < merged.indexOf('Anexo.'));
});
