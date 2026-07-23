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
 * Con qué pareja de funciones contesta el Moodle de laboratorio. El dialecto
 * moderno es el de Moodle 3.7+; el antiguo, el de los sitios que sólo declaran
 * las funciones `…_paginated` y `…_forum_discussion_posts`.
 */
type Dialecto = 'moderno' | 'antiguo';

const CATALOGO: Record<Dialecto, readonly string[]> = {
  moderno: ['mod_forum_get_forum_discussions', 'mod_forum_get_discussion_posts'],
  antiguo: ['mod_forum_get_forum_discussions_paginated', 'mod_forum_get_forum_discussion_posts'],
};

/**
 * El mismo mensaje del fixture, con la forma del exporter de Moodle 3.7+:
 * autor anidado (`author.id`, que puede ser null si el sitio lo oculta),
 * `hasparent`/`parentid` en vez de `parent` y `timecreated` en vez de `created`.
 */
function comoMensajeModerno(post: Record<string, unknown>): Record<string, unknown> {
  const parent = Number(post['parent'] ?? 0);
  return {
    id: post['id'],
    subject: post['subject'],
    message: post['message'],
    author: { id: post['userid'] ?? null },
    discussionid: post['discussion'],
    hasparent: parent !== 0,
    parentid: parent === 0 ? null : parent,
    timecreated: post['created'],
    isdeleted: post['isdeleted'] ?? false,
  };
}

/**
 * Cómo se comporta el Moodle de laboratorio. `catalogo` es lo que el sitio
 * **anuncia** en `core_webservice_get_site_info`; `autorizadas`, lo que de
 * verdad deja llamar. Que puedan diferir no es un capricho del test: es el
 * fallo del piloto, un sitio que anunciaba una función y la rechazaba al
 * llamarla porque el usuario del token no tenía acceso a ese foro.
 */
interface Laboratorio {
  readonly dialecto?: Dialecto;
  readonly catalogo?: readonly string[];
  readonly autorizadas?: readonly string[];
}

/**
 * Moodle de laboratorio: enruta por `wsfunction` igual que el servidor real,
 * que distingue las llamadas por ese parámetro y no por la URL. Sólo contesta
 * a las funciones autorizadas; al resto responde con el `accessexception`
 * que devolvería un Moodle de verdad, para que llamar al dialecto equivocado
 * falle aquí igual de fuerte que en un aula.
 */
function moodleCon(
  paginas: readonly (readonly Debate[])[],
  opciones: Dialecto | Laboratorio = 'moderno',
): {
  connector: Moodle3Connector;
  llamadas: URLSearchParams[];
} {
  const config: Laboratorio = typeof opciones === 'string' ? { dialecto: opciones } : opciones;
  const dialecto = config.dialecto ?? 'moderno';
  const catalogo = config.catalogo ?? CATALOGO[dialecto];
  const llamadas: URLSearchParams[] = [];
  const debates = paginas.flat();
  const permitidas = new Set(config.autorizadas ?? catalogo);

  const fetchImpl: typeof fetch = (_url, init) => {
    const params = new URLSearchParams(String(init?.body));
    llamadas.push(params);

    const wsfunction = params.get('wsfunction') ?? '';
    let payload: unknown;

    if (wsfunction === 'core_webservice_get_site_info') {
      payload = {
        sitename: 'Academia Hipatia',
        username: 'profesora',
        userid: 3,
        functions: catalogo.map((name) => ({ name })),
      };
    } else if (wsfunction.startsWith('mod_forum_') && !permitidas.has(wsfunction)) {
      payload = {
        exception: 'webservice_access_exception',
        errorcode: 'accessexception',
        message: 'Access control exception',
      };
    } else if (
      wsfunction === 'mod_forum_get_forum_discussions' ||
      wsfunction === 'mod_forum_get_forum_discussions_paginated'
    ) {
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
    } else if (wsfunction === 'mod_forum_get_discussion_posts') {
      const discussionid = Number(params.get('discussionid') ?? '0');
      const debate = debates.find((candidato) => candidato.id === discussionid);
      payload = { posts: (debate?.posts ?? []).map(comoMensajeModerno) };
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
    .filter((params) => params.get('wsfunction') === 'mod_forum_get_forum_discussions')
    .map((params) => params.get('page'));
  assert.deepEqual(paginas, ['0', '1']);
});

test('la última página incompleta corta el recorrido', async () => {
  const { connector, llamadas } = moodleCon([[debateSinResponder(1)]]);
  await connector.listSubmissions(FORO);

  const paginas = llamadas.filter(
    (params) => params.get('wsfunction') === 'mod_forum_get_forum_discussions',
  );
  assert.equal(paginas.length, 1);
  assert.equal(paginas[0]?.get('forumid'), '42');
  assert.equal(paginas[0]?.get('perpage'), '50');
  // 4 = por fecha de creación, ascendente: el único orden que no baila entre
  // páginas cuando alguien escribe a mitad del recorrido.
  assert.equal(paginas[0]?.get('sortorder'), '4');
});

// ── Los dos dialectos de Moodle ─────────────────────────────────────────────

test('un catálogo sin las funciones modernas manda al dialecto anterior a 3.7', async () => {
  const { connector, llamadas } = moodleCon(
    [[{ id: 900, posts: [mensaje({ id: 9000, userid: 6, discussion: 900 })] }]],
    'antiguo',
  );

  const entregas = await connector.listSubmissions(FORO);

  assert.equal(entregas.length, 1);
  assert.equal(entregas[0]?.ref.remoteId, '42:900:9000');
  const debates = llamadas.find(
    (params) => params.get('wsfunction') === 'mod_forum_get_forum_discussions_paginated',
  );
  assert.ok(debates !== undefined, 'debe leer los debates con la función antigua');
  assert.equal(debates?.get('sortby'), 'timemodified');
  assert.equal(
    llamadas.find((params) => params.get('wsfunction') === 'mod_forum_get_forum_discussions'),
    undefined,
    'a un Moodle sin la función moderna no hay que llamarla: contesta accessexception',
  );
});

/** Las cuatro funciones de foro anunciadas, que es lo que declaraba el piloto. */
const CATALOGO_COMPLETO = [...CATALOGO.moderno, ...CATALOGO.antiguo];

test('un sitio que anuncia la función moderna de mensajes pero la rechaza cae a la anterior', async () => {
  // El fallo del piloto exacto: el catálogo declaraba todas las mod_forum_get_*
  // y aun así `mod_forum_get_discussion_posts` contestaba accessexception, de
  // modo que el foro entero se caía. Los debates sí se leían: el dialecto no
  // puede decidirse en bloque.
  const { connector, llamadas } = moodleCon(
    [[{ id: 900, posts: [mensaje({ id: 9000, userid: 6, discussion: 900 })] }]],
    {
      catalogo: CATALOGO_COMPLETO,
      autorizadas: ['mod_forum_get_forum_discussions', 'mod_forum_get_forum_discussion_posts'],
    },
  );

  const entregas = await connector.listSubmissions(FORO);

  assert.equal(entregas.length, 1, 'la duda pendiente tiene que llegar igual');
  assert.equal(entregas[0]?.ref.remoteId, '42:900:9000');
  assert.ok(
    llamadas.some((params) => params.get('wsfunction') === 'mod_forum_get_forum_discussions'),
    'los debates se siguen leyendo con la función moderna, que sí está autorizada',
  );
  assert.ok(
    llamadas.some((params) => params.get('wsfunction') === 'mod_forum_get_forum_discussion_posts'),
    'los mensajes tienen que reintentarse con la función anterior a 3.7',
  );
});

test('el dialecto que funciona se memoriza y no se paga un intento fallido por debate', async () => {
  const { connector, llamadas } = moodleCon(
    [[debateSinResponder(1), debateSinResponder(2), debateSinResponder(3)]],
    {
      catalogo: CATALOGO_COMPLETO,
      autorizadas: ['mod_forum_get_forum_discussions', 'mod_forum_get_forum_discussion_posts'],
    },
  );

  const entregas = await connector.listSubmissions(FORO);

  assert.equal(entregas.length, 3);
  const rechazadas = llamadas.filter(
    (params) => params.get('wsfunction') === 'mod_forum_get_discussion_posts',
  );
  assert.equal(
    rechazadas.length,
    1,
    'el intento con la función que no vale se hace una vez, no una por debate',
  );
});

test('si Moodle rechaza las dos funciones de mensajes, el aviso nombra las dos', async () => {
  const { connector } = moodleCon(
    [[{ id: 700, posts: [mensaje({ id: 7000, userid: 4, discussion: 700 })] }]],
    { catalogo: CATALOGO_COMPLETO, autorizadas: ['mod_forum_get_forum_discussions'] },
  );

  // Nombrar sólo una manda a añadirla al servicio, comprobar que sigue fallando
  // y volver a empezar. Con las dos delante, el profesor sabe qué mirar.
  await assert.rejects(connector.listSubmissions(FORO), (error: Error) => {
    assert.match(error.message, /mod_forum_get_discussion_posts/);
    assert.match(error.message, /mod_forum_get_forum_discussion_posts/);
    assert.equal((error as { code?: string }).code, 'LMS_AUTH');
    return true;
  });
});

test('una respuesta borrada no cuenta como respuesta', async () => {
  // Moodle 3.7+ no quita el mensaje borrado de la lista: lo devuelve con
  // `isdeleted` y un texto de relleno. Contarlo dejaría la duda sin atender
  // porque «alguien contestó», cuando esa respuesta ya no existe.
  const { connector } = moodleCon([
    [
      {
        id: 950,
        posts: [
          mensaje({ id: 9500, userid: 7, discussion: 950 }),
          mensaje({ id: 9501, userid: 9, parent: 9500, discussion: 950, isdeleted: true }),
        ],
      },
    ],
  ]);

  const entregas = await connector.listSubmissions(FORO);

  assert.equal(entregas.length, 1, 'la respuesta retirada dejó el debate sin atender');
  assert.equal(entregas[0]?.ref.remoteId, '42:950:9500');
});

test('una respuesta de autor oculto sí cuenta como respuesta', async () => {
  // No se puede saber quién contestó, pero alguien lo hizo: meter a Vega en
  // ese debate duplicaría o contradeciría en público una respuesta ya dada.
  const { connector } = moodleCon([
    [
      {
        id: 960,
        posts: [
          mensaje({ id: 9600, userid: 7, discussion: 960 }),
          mensaje({ id: 9601, userid: null, parent: 9600, discussion: 960 }),
        ],
      },
    ],
  ]);

  const entregas = await connector.listSubmissions(FORO);
  assert.equal(entregas.length, 0);
});

test('una pregunta de autor oculto se deja en paz', async () => {
  // Sin autor legible no hay a quién atribuir la pregunta ni forma de saber si
  // el propio autor se contestó: mejor no meterse.
  const { connector } = moodleCon([
    [{ id: 970, posts: [mensaje({ id: 9700, userid: null, discussion: 970 })] }],
  ]);

  const entregas = await connector.listSubmissions(FORO);
  assert.equal(entregas.length, 0);
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
