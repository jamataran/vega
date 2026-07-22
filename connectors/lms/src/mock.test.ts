import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockLmsConnector } from './mock.js';
import type { ActivityRef } from './types.js';

/**
 * El mock es la maqueta con la que se diseñan y se revisan las pantallas sin un
 * Moodle delante, así que su única obligación es no cambiar: si el perfil de un
 * alumno bailara entre recargas, ni una captura de pantalla de ayer valdría hoy
 * ni una prueba podría afirmar nada sobre lo que se ve.
 */

const TAREA: ActivityRef = { slug: 'tema04', lmsRef: 'assign-42', kind: 'assignment' };
const FORO: ActivityRef = { slug: 'foro-didactica', lmsRef: 'forum-7', kind: 'forum' };

test('el mock devuelve siempre el mismo perfil para el mismo alumno', async () => {
  const primera = await new MockLmsConnector().listSubmissions(TAREA);
  const segunda = await new MockLmsConnector().listSubmissions(TAREA);

  assert.deepEqual(
    primera.map((entrega) => entrega.student),
    segunda.map((entrega) => entrega.student),
  );

  const alumno = primera[0]?.student;
  assert.equal(alumno?.ref, 'alumno-0001');
  assert.equal(alumno?.fullName, 'Lucía Serrano Peña');
  assert.equal(alumno?.email, 'lucia.serrano@ejemplo.invalid');
});

test('el perfil no depende de la actividad, sólo del alumno', async () => {
  // El mismo `alumno-0001` es la misma persona en la tarea y en el foro.
  const tarea = await new MockLmsConnector().listSubmissions(TAREA);
  const foro = await new MockLmsConnector().listSubmissions(FORO);

  assert.deepEqual(tarea[0]?.student, foro[0]?.student);
});

test('el perfil se casa con la entrega por el mismo studentRef', async () => {
  const entregas = await new MockLmsConnector({ submissionsPerActivity: 5 }).listSubmissions(TAREA);

  for (const entrega of entregas) {
    assert.equal(entrega.student?.ref, entrega.ref.studentRef);
  }
});

test('los campos propios del cliente llegan tal cual, con dos comunidades en uno', async () => {
  // El sistema del cliente guarda varias comunidades en un solo campo separadas
  // por ", ". No es un dato mal escrito: es el formato, y la interfaz tiene que
  // poder enseñarlo sin partirse.
  const entregas = await new MockLmsConnector({ submissionsPerActivity: 5 }).listSubmissions(TAREA);

  const comunidades = entregas.map(
    (entrega) =>
      entrega.student?.customFields.find((campo) => campo.shortname === 'CCAA')?.value ?? '',
  );
  assert.ok(
    comunidades.some((valor) => valor.includes(', ')),
    'algún alumno tiene que traer dos comunidades separadas por ", "',
  );

  for (const entrega of entregas) {
    const nombres = entrega.student?.customFields.map((campo) => campo.shortname) ?? [];
    assert.deepEqual(nombres, ['CCAA', 'PROVINCIA', 'NIF']);
  }
});

test('el NIF simulado es imposible: está para comprobar que no sale de aquí', async () => {
  // Vive en `customFields` porque el conector transporta lo que hay sin
  // interpretarlo; quien monte el prompt es quien tiene que dejarlo fuera, y
  // este valor existe para poder afirmarlo en una prueba.
  const [entrega] = await new MockLmsConnector().listSubmissions(TAREA);

  const nif = entrega?.student?.customFields.find((campo) => campo.shortname === 'NIF');
  assert.equal(nif?.value, '00000001X');
});

test('un perfil incompleto también está representado', async () => {
  // Que a un alumno le falte el teléfono es lo normal en un Moodle real: la
  // maqueta lo incluye para que la pantalla se diseñe con ese hueco a la vista.
  const entregas = await new MockLmsConnector({ submissionsPerActivity: 5 }).listSubmissions(TAREA);

  assert.ok(
    entregas.some((entrega) => entrega.student?.phone === null),
    'algún alumno tiene que venir sin teléfono',
  );
});

// ── Publicar por el camino correcto ─────────────────────────────────────────

/**
 * El mock rechaza los cruces igual que el conector real. Es donde se prueba el
 * circuito completo sin Moodle delante: si aquí una respuesta de foro se dejara
 * publicar como nota, el error sólo aparecería en producción y en forma de
 * calificación puesta a quien no era.
 */
test('el mock no deja publicar una respuesta de foro como nota', async () => {
  const conector = new MockLmsConnector();
  const [duda] = await conector.listSubmissions(FORO);

  await assert.rejects(
    () => conector.publishGrade(duda!.ref, { score: null, maxScore: null, summary: '', items: [] }),
    /publishForumReply/,
  );
  assert.equal(conector.publishedGrades.length, 0);
});

test('el mock no deja responder en el foro a una entrega', async () => {
  const conector = new MockLmsConnector();
  const [entrega] = await conector.listSubmissions(TAREA);

  await assert.rejects(
    () => conector.publishForumReply(entrega!.ref, { body: 'Hola', subject: null }),
    /publishGrade/,
  );
  assert.equal(conector.publishedReplies.length, 0);
});

test('una respuesta validada queda registrada y se puede leer', async () => {
  const conector = new MockLmsConnector();
  const [duda] = await conector.listSubmissions(FORO);

  await conector.publishForumReply(duda!.ref, { body: 'Buena observación.', subject: null });

  assert.equal(conector.publishedReplies.length, 1);
  assert.equal(conector.publishedReplies[0]?.reply.body, 'Buena observación.');
});
