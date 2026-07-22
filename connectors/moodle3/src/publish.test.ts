import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RemoteGrade, RemoteReply, SubmissionRef } from '@vega/connector-lms';
import { Moodle3Connector } from './connector.js';

/**
 * La escritura en Moodle: lo único que un alumno llega a ver y lo único que no
 * se puede ensayar sin consecuencias. Aquí se prueba con un Moodle de
 * laboratorio **qué se manda y adónde**, porque el fallo que importa no da
 * error: publicar por el camino equivocado escribe algo perfectamente válido en
 * el sitio que no era.
 */

const ENTREGA: SubmissionRef = {
  activity: { slug: 'tema04', lmsRef: 'assign-42', kind: 'assignment' },
  studentRef: 'moodle-17',
  remoteId: '42:17:0',
};

/**
 * Duda de foro. Fíjate en el `remoteId`: `<foro>:<debate>:<mensaje>`. Con el
 * formato de una entrega —`<tarea>:<usuario>:<intento>`— tiene exactamente la
 * misma forma, tres números separados por dos puntos, y ahí estaba el problema.
 */
const DUDA: SubmissionRef = {
  activity: { slug: 'foro-dudas', lmsRef: 'forum-9', kind: 'forum' },
  studentRef: 'moodle-17',
  remoteId: '9:311:4820',
};

const NOTA: RemoteGrade = {
  score: 7,
  maxScore: 10,
  summary: 'Bien planteado.',
  items: [{ label: '1a', points: 3, maxPoints: 4, feedback: 'Correcto' }],
  validatedBy: null,
};

const RESPUESTA: RemoteReply = {
  body: 'La derivada se define como un límite, sí.\n\nPero en el aula conviene otro orden.',
  subject: null,
  validatedBy: null,
};

function moodleCon(functions?: readonly string[]): {
  connector: Moodle3Connector;
  llamadas: URLSearchParams[];
} {
  const llamadas: URLSearchParams[] = [];

  const fetchImpl: typeof fetch = (_url, init) => {
    const params = new URLSearchParams(String(init?.body));
    llamadas.push(params);

    const payload =
      params.get('wsfunction') === 'core_webservice_get_site_info'
        ? {
            sitename: 'Academia Hipatia',
            username: 'profesora',
            userid: 3,
            ...(functions === undefined
              ? {}
              : { functions: functions.map((name) => ({ name, version: '2020061500' })) }),
          }
        : {};

    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return {
    connector: new Moodle3Connector(
      { baseUrl: 'https://moodle.ejemplo.es', token: 'token-de-prueba' },
      fetchImpl,
    ),
    llamadas,
  };
}

function llamadaA(llamadas: readonly URLSearchParams[], wsfunction: string) {
  return llamadas.find((params) => params.get('wsfunction') === wsfunction);
}

// ── Cada cosa por su camino ─────────────────────────────────────────────────

test('una duda de foro no se publica como nota, aunque el identificador cuele', async () => {
  const { connector, llamadas } = moodleCon();

  // Sin este corte, `9:311:4820` se leería como «tarea 9, usuario 311,
  // intento 4820» y Moodle pondría una nota. A un alumno cualquiera, en una
  // actividad cualquiera, sin dar error.
  await assert.rejects(() => connector.publishGrade(DUDA, NOTA), /publishForumReply/);
  assert.equal(
    llamadaA(llamadas, 'mod_assign_save_grade'),
    undefined,
    'no debe haberse llegado a llamar al libro de notas',
  );
});

test('una entrega no se publica como mensaje de foro', async () => {
  const { connector, llamadas } = moodleCon();

  await assert.rejects(() => connector.publishForumReply(ENTREGA, RESPUESTA), /publishGrade/);
  assert.equal(llamadaA(llamadas, 'mod_forum_add_discussion_post'), undefined);
});

test('la respuesta cuelga del mensaje del alumno, no del debate', async () => {
  const { connector, llamadas } = moodleCon();
  await connector.publishForumReply(DUDA, RESPUESTA);

  const llamada = llamadaA(llamadas, 'mod_forum_add_discussion_post');
  // 4820 es el mensaje; 311 es el debate. Colgar del debate dejaría la
  // respuesta suelta al final del hilo en vez de bajo la duda que contesta.
  assert.equal(llamada?.get('postid'), '4820');
});

test('los párrafos del profesor llegan como párrafos', async () => {
  const { connector, llamadas } = moodleCon();
  await connector.publishForumReply(DUDA, RESPUESTA);

  const mensaje = llamadaA(llamadas, 'mod_forum_add_discussion_post')?.get('message') ?? '';
  assert.match(mensaje, /^<p>La derivada.*<\/p><p>Pero en el aula.*<\/p>$/s);
});

test('un identificador de foro mal formado no se publica a ciegas', async () => {
  const { connector } = moodleCon();

  await assert.rejects(
    () => connector.publishForumReply({ ...DUDA, remoteId: '9:311' }, RESPUESTA),
    /mal formado/,
  );
});

// ── La verificación de lo que no se puede ensayar ───────────────────────────

test('las funciones de escritura se comprueban sin llamarlas', async () => {
  const { connector, llamadas } = moodleCon([
    'core_webservice_get_site_info',
    'mod_assign_save_grade',
    'mod_forum_add_discussion_post',
  ]);

  const info = await connector.verifyConnection();
  const escritura = info.checks.filter((check) =>
    ['mod_assign_save_grade', 'mod_forum_add_discussion_post'].includes(check.name),
  );

  assert.equal(escritura.length, 2);
  assert.ok(escritura.every((check) => check.status === 'ok'));
  // Lo esencial: comprobar la conexión no puede calificar a nadie ni escribir
  // en un foro. Si esto se rompe, el botón «Probar conexión» de Ajustes pasa a
  // tener efectos visibles para los alumnos.
  assert.equal(llamadaA(llamadas, 'mod_assign_save_grade'), undefined);
  assert.equal(llamadaA(llamadas, 'mod_forum_add_discussion_post'), undefined);
});

test('la función de escritura que falta se señala por su nombre', async () => {
  const { connector } = moodleCon(['core_webservice_get_site_info', 'mod_assign_save_grade']);

  const info = await connector.verifyConnection();
  const foro = info.checks.find((check) => check.name === 'mod_forum_add_discussion_post');

  assert.equal(foro?.status, 'failed');
  assert.equal(foro?.required, true);
  assert.match(foro?.detail ?? '', /Servicios externos/);
});

test('si el sitio no devuelve el catálogo, la comprobación se declara omitida', async () => {
  // `skipped` y no `failed`: dar por ausente lo que no se ha podido leer
  // mandaría a habilitar funciones que probablemente ya estén puestas.
  const { connector } = moodleCon();

  const info = await connector.verifyConnection();
  const nota = info.checks.find((check) => check.name === 'mod_assign_save_grade');

  assert.equal(nota?.status, 'skipped');
});
