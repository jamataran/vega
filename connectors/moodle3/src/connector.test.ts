import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moodleRefFor, parseMoodleRef } from './connector.js';

test('moodleRefFor prefija con el módulo de Moodle', () => {
  assert.equal(moodleRefFor('assignment', 42), 'assign-42');
  assert.equal(moodleRefFor('forum', 42), 'forum-42');
});

test('la tarea 5 y el foro 5 no comparten referencia', () => {
  // Es el fallo que motivó el prefijo: sin él ambas valían "5" y la segunda
  // importación desaparecía contra el índice único de `moodle_ref`.
  assert.notEqual(moodleRefFor('assignment', 5), moodleRefFor('forum', 5));
});

test('parseMoodleRef deshace moodleRefFor', () => {
  for (const [kind, id] of [
    ['assignment', 1],
    ['forum', 987_654],
  ] as const) {
    assert.deepEqual(parseMoodleRef(moodleRefFor(kind, id)), { kind, id });
  }
});

test('parseMoodleRef devuelve null en lo que no es una referencia de Moodle', () => {
  for (const ref of [
    'assign-tema04', // referencia del mock: mismo prefijo, id no numérico
    'forum-dudas-analisis',
    '42', // id pelado de antes del prefijo
    'quiz-42', // módulo que Vega todavía no soporta
    'assign-',
    '-42',
    'assign-4.5',
    'assign-42abc',
    '',
  ]) {
    assert.equal(parseMoodleRef(ref), null, `debería ser null: "${ref}"`);
  }
});

test('parseMoodleRef acepta ids con guiones detrás sin confundirse de módulo', () => {
  // El corte es por el PRIMER guion: el resto tiene que ser el id entero.
  assert.equal(parseMoodleRef('assign-42-1'), null);
});
