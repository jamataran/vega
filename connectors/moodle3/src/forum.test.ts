import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityRef } from '@vega/connector-lms';
import { Moodle3Connector, htmlToPlainText } from './connector.js';

/**
 * Lo que se prueba aquí es la regla de producto del foro: Vega responde sólo a
 * la primera pregunta no respondida de cada debate. Acertar en qué debates se
 * omiten es la diferencia entre ayudar y meterse en una conversación que ya
 * estaba resuelta, así que se prueba con un Moodle de laboratorio en vez de
 * esperar a tener uno de verdad.
 */

const FORO: ActivityRef = { slug: 'foro-dudas', lmsRef: 'forum-42', kind: 'forum' };

interface Debate {
  readonly id: number;
  readonly posts: readonly Record<string, unknown>[];
}

/** Mensaje de foro con los campos que devuelve Moodle, y los valores por defecto que menos ruido meten. */
function mensaje(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    parent: 0,
    created: 1_700_000_000,
    modified: 1_700_000_000,
    subject: 'Duda sobre la derivada',
    message: '<p>¿Por qué el límite tiene que ir antes?</p>',
    ...overrides,
  };
}

/**
 * Moodle de laboratorio: enruta por `wsfunction` igual que el servidor real,
 * que distingue las llamadas por ese parámetro y no por la URL.
 */
function moodleCon(paginas: readonly (readonly Debate[])[]): {
  connector: Moodle3Connector;
  llamadas: URLSearchParams[];
} {
  const llamadas: URLSearchParams[] = [];
  const debates = paginas.flat();

  const fetchImpl: typeof fetch = (_url, init) => {
    const params = new URLSearchParams(String(init?.body));
    llamadas.push(params);

    const wsfunction = params.get('wsfunction');
    let payload: unknown;

    if (wsfunction === 'mod_forum_get_forum_discussions_paginated') {
      const page = Number(params.get('page') ?? '0');
      payload = {
        discussions: (paginas[page] ?? []).map((debate) => ({
          id: debate.id * 10,
          discussion: debate.id,
          name: `Debate ${debate.id}`,
        })),
      };
    } else if (wsfunction === 'mod_forum_get_forum_discussion_posts') {
      const discussionid = Number(params.get('discussionid') ?? '0');
      const debate = debates.find((candidato) => candidato.id === discussionid);
      payload = { posts: debate?.posts ?? [] };
    } else {
      payload = {};
    }

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

/** Un debate con una sola pregunta sin contestar, para rellenar páginas. */
function debateSinResponder(id: number): Debate {
  return { id, posts: [mensaje({ id: id * 1000, userid: id, discussion: id })] };
}

test('un debate ya contestado por un tercero se omite; el que sigue abierto no', async () => {
  const { connector } = moodleCon([
    [
      {
        id: 100,
        posts: [
          mensaje({ id: 1000, userid: 7, discussion: 100 }),
          mensaje({ id: 1001, userid: 9, parent: 1000, discussion: 100, subject: 'Re: Duda' }),
        ],
      },
      { id: 200, posts: [mensaje({ id: 2000, userid: 11, discussion: 200 })] },
    ],
  ]);

  const entregas = await connector.listSubmissions(FORO);

  assert.equal(entregas.length, 1, 'el debate ya respondido no debería producir nada que corregir');
  assert.equal(entregas[0]?.ref.remoteId, '42:200:2000');
  assert.equal(entregas[0]?.ref.studentRef, 'moodle-11');
});

test('que el autor se responda a sí mismo no cuenta como respuesta', async () => {
  // Matizar la propia pregunta es lo contrario de haberla resuelto: el debate
  // sigue esperando a alguien.
  const { connector } = moodleCon([
    [
      {
        id: 300,
        posts: [
          mensaje({ id: 3000, userid: 5, discussion: 300 }),
          mensaje({
            id: 3001,
            userid: 5,
            parent: 3000,
            discussion: 300,
            subject: 'Re: Duda',
            message: '<p>Me explico mejor.</p>',
          }),
        ],
      },
    ],
  ]);

  const entregas = await connector.listSubmissions(FORO);

  assert.equal(entregas.length, 1);
  // La intervención es siempre la del mensaje que abre el debate, no la última.
  assert.equal(entregas[0]?.ref.remoteId, '42:300:3000');
});

test('de un debate sale como mucho una intervención, la del mensaje raíz', async () => {
  // Tres mensajes del mismo autor: sigue siendo una sola pregunta pendiente.
  const { connector } = moodleCon([
    [
      {
        id: 400,
        posts: [
          mensaje({ id: 4001, userid: 8, parent: 4000, discussion: 400 }),
          mensaje({ id: 4000, userid: 8, discussion: 400 }),
          mensaje({ id: 4002, userid: 8, parent: 4001, discussion: 400 }),
        ],
      },
    ],
  ]);

  const entregas = await connector.listSubmissions(FORO);

  assert.equal(entregas.length, 1);
  // El raíz se localiza por `parent`, no por la posición en el array: Moodle no
  // promete ningún orden.
  assert.equal(entregas[0]?.ref.remoteId, '42:400:4000');
});

test('la intervención de un foro no tiene fichero y lleva el texto ya limpio', async () => {
  const { connector } = moodleCon([
    [
      {
        id: 500,
        posts: [
          mensaje({
            id: 5000,
            userid: 3,
            discussion: 500,
            created: 1_700_000_000,
            subject: 'Duda con la regla de la cadena',
            message: '<p>No entiendo el <strong>paso 2</strong>.</p><p>¿Lo repasamos?</p>',
          }),
        ],
      },
    ],
  ]);

  const [entrega] = await connector.listSubmissions(FORO);

  assert.ok(entrega !== undefined);
  assert.equal(entrega.filename, null);
  assert.equal(entrega.mediaType, 'text/plain');
  assert.equal(entrega.submittedAt, new Date(1_700_000_000 * 1000).toISOString());
  assert.equal(
    entrega.textContent,
    'Duda con la regla de la cadena\n\nNo entiendo el paso 2.\n\n¿Lo repasamos?',
  );
  assert.equal(entrega.sizeBytes, new TextEncoder().encode(entrega.textContent ?? '').length);
  assert.equal(entrega.ref.activity, FORO);
});

test('el remoteId no cambia entre ejecuciones', async () => {
  // Si bailara, la misma pregunta se importaría dos veces y el profesor vería
  // duplicados en la cola.
  const debates = [[{ id: 600, posts: [mensaje({ id: 6000, userid: 4, discussion: 600 })] }]];

  const primera = await moodleCon(debates).connector.listSubmissions(FORO);
  const segunda = await moodleCon(debates).connector.listSubmissions(FORO);

  assert.deepEqual(
    primera.map((entrega) => entrega.ref.remoteId),
    segunda.map((entrega) => entrega.ref.remoteId),
  );
  assert.equal(primera[0]?.ref.remoteId, '42:600:6000');
});

test('el studentRef es el id de Moodle, nunca el nombre del alumno', async () => {
  const { connector } = moodleCon([
    [{ id: 700, posts: [mensaje({ id: 7000, userid: 123_456, discussion: 700 })] }],
  ]);

  const [entrega] = await connector.listSubmissions(FORO);
  assert.equal(entrega?.ref.studentRef, 'moodle-123456');
});

test('los debates se recorren hasta agotar las páginas', async () => {
  // Una página completa significa "puede que haya más": hay que pedir la
  // siguiente aunque venga vacía.
  const primera = Array.from({ length: 50 }, (_unused, indice) => debateSinResponder(indice + 1));
  const segunda = [debateSinResponder(51)];

  const { connector, llamadas } = moodleCon([primera, segunda]);
  const entregas = await connector.listSubmissions(FORO);

  assert.equal(entregas.length, 51);

  const paginas = llamadas
    .filter((params) => params.get('wsfunction') === 'mod_forum_get_forum_discussions_paginated')
    .map((params) => params.get('page'));
  assert.deepEqual(paginas, ['0', '1']);
});

test('la última página incompleta corta el recorrido', async () => {
  const { connector, llamadas } = moodleCon([[debateSinResponder(1)]]);
  await connector.listSubmissions(FORO);

  const paginas = llamadas.filter(
    (params) => params.get('wsfunction') === 'mod_forum_get_forum_discussions_paginated',
  );
  assert.equal(paginas.length, 1);
  assert.equal(paginas[0]?.get('forumid'), '42');
  assert.equal(paginas[0]?.get('perpage'), '50');
  assert.equal(paginas[0]?.get('sortby'), 'timemodified');
  assert.equal(paginas[0]?.get('sortdirection'), 'ASC');
});

test('un lmsRef que apunta a una tarea se rechaza con un mensaje que lo explica', async () => {
  const { connector } = moodleCon([[]]);
  await assert.rejects(
    connector.listSubmissions({ slug: 'tema04', lmsRef: 'assign-42', kind: 'forum' }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /tarea de Moodle/);
      assert.match(error.message, /no a un foro/);
      return true;
    },
  );
});

test('un lmsRef vacío se rechaza sin hablar de tareas', async () => {
  const { connector } = moodleCon([[]]);
  await assert.rejects(
    connector.listSubmissions({ slug: 'foro-sin-alta', lmsRef: null, kind: 'forum' }),
    /no tiene asignado un foro de Moodle/,
  );
});

test('el id pelado de antes del prefijo sigue valiendo', async () => {
  const { connector } = moodleCon([
    [{ id: 800, posts: [mensaje({ id: 8000, userid: 2, discussion: 800 })] }],
  ]);

  const [entrega] = await connector.listSubmissions({
    slug: 'foro-antiguo',
    lmsRef: '42',
    kind: 'forum',
  });
  assert.equal(entrega?.ref.remoteId, '42:800:8000');
});

test('descargar un mensaje de foro dice que ahí no hay fichero', async () => {
  const { connector } = moodleCon([[]]);
  await assert.rejects(
    connector.download({ activity: FORO, studentRef: 'moodle-11', remoteId: '42:200:2000' }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /no hay fichero que descargar/);
      assert.match(error.message, /textContent/);
      return true;
    },
  );
});

test('htmlToPlainText quita las etiquetas y respeta los párrafos', () => {
  assert.equal(
    htmlToPlainText('<p>Primero.</p><p>Segundo.</p>'),
    'Primero.\n\nSegundo.',
    'cada párrafo tiene que quedar separado del siguiente',
  );
  assert.equal(htmlToPlainText('Una línea<br>y otra'), 'Una línea\ny otra');
  assert.equal(htmlToPlainText('Una línea<br />y otra'), 'Una línea\ny otra');
  assert.equal(
    htmlToPlainText('<div class="post"><em>Con</em> <strong>formato</strong></div>'),
    'Con formato',
  );
});

test('htmlToPlainText decodifica las entidades habituales', () => {
  assert.equal(
    htmlToPlainText('f&#39;(x) &gt; 0 &amp;&amp; f&#39;&#39;(x) &lt; 0'),
    "f'(x) > 0 && f''(x) < 0",
  );
  assert.equal(htmlToPlainText('Dijo &quot;derivada&quot;'), 'Dijo "derivada"');
  assert.equal(htmlToPlainText('espacio&nbsp;duro'), 'espacio duro');
});

test('htmlToPlainText no convierte una entidad escapada por el alumno', () => {
  // `&amp;lt;` es un `&lt;` escrito literalmente: decodificar `&amp;` primero lo
  // convertiría en un `<` que el alumno no puso.
  assert.equal(htmlToPlainText('<p>&amp;lt;</p>'), '&lt;');
});

test('htmlToPlainText colapsa el espacio en blanco del HTML', () => {
  const html = `
    <p>
      Una   frase    con     sangría
    </p>


    <p>y otra</p>
  `;
  assert.equal(htmlToPlainText(html), 'Una frase con sangría\n\ny otra');
});

test('htmlToPlainText tira el contenido de script y style', () => {
  assert.equal(
    htmlToPlainText('<style>p { color: red }</style><p>Texto</p><script>alert(1)</script>'),
    'Texto',
  );
});

test('htmlToPlainText devuelve cadena vacía cuando no hay texto', () => {
  assert.equal(htmlToPlainText(''), '');
  assert.equal(htmlToPlainText('<p></p>'), '');
});
