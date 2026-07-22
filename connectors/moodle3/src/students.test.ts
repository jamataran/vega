import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityRef } from '@vega/connector-lms';
import { Moodle3Connector } from './connector.js';

/**
 * Lo que se prueba aquí es que traer el perfil del alumno sea barato y
 * prescindible: una sola petición con todos los ids, troceada cuando son
 * muchos, y ningún fallo suyo capaz de dejar sin corregir una entrega que ya
 * estaba lista. Es la parte que más fácil sería estropear sin enterarse, porque
 * un perfil de menos no rompe ninguna pantalla: sólo la deja sin nombres.
 */

const TAREA: ActivityRef = { slug: 'tema04', lmsRef: 'assign-42', kind: 'assignment' };
const FORO: ActivityRef = { slug: 'foro-dudas', lmsRef: 'forum-42', kind: 'forum' };

/** Un usuario de Moodle con los campos que devuelve un perfil completo. */
function usuario(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    username: `alumno${id}`,
    firstname: 'Lucía',
    lastname: 'Serrano Peña',
    fullname: 'Lucía Serrano Peña',
    email: `alumno${id}@ejemplo.invalid`,
    phone1: '+34 600 000 000',
    idnumber: `ALU-${id}`,
    institution: 'Academia Hipatia',
    department: 'Secundaria · Matemáticas',
    city: 'Granada',
    country: 'ES',
    customfields: [
      { type: 'text', shortname: 'CCAA', name: 'Comunidad autónoma', value: 'Andalucía' },
      { type: 'text', shortname: 'PROVINCIA', name: 'Provincia', value: 'Granada' },
    ],
    ...overrides,
  };
}

/** Una entrega de `mod_assign_get_submissions`, con su fichero adjunto. */
function entregaDe(userid: number): Record<string, unknown> {
  return {
    id: userid * 10,
    userid,
    attemptnumber: 0,
    timecreated: 1_700_000_000,
    timemodified: 1_700_000_000,
    status: 'submitted',
    plugins: [
      {
        type: 'file',
        fileareas: [
          {
            area: 'submission_files',
            files: [
              {
                filename: `entrega-${userid}.pdf`,
                fileurl: `https://moodle.ejemplo.es/pluginfile.php/${userid}/entrega.pdf`,
                filesize: 1024,
                mimetype: 'application/pdf',
              },
            ],
          },
        ],
      },
    ],
  };
}

interface MoodleDeLaboratorio {
  readonly connector: Moodle3Connector;
  readonly llamadas: URLSearchParams[];
}

interface Opciones {
  /** Entregas de la tarea, una por alumno. */
  readonly userIds?: readonly number[];
  /** Perfiles que devuelve `core_user_get_users_by_field`, por id. */
  readonly perfiles?: (ids: number[]) => Record<string, unknown>[];
  /** Si la función de perfiles tiene que fallar como lo hace Moodle. */
  readonly perfilesFallan?: boolean;
  /** Mensajes de foro, para el camino del foro. */
  readonly foro?: readonly { readonly discussionId: number; readonly userid: number }[];
}

/**
 * Moodle de laboratorio: enruta por `wsfunction`, igual que el servidor real, y
 * guarda cada petición para poder afirmar cuántas se han hecho y con qué.
 */
function moodleCon(opciones: Opciones): MoodleDeLaboratorio {
  const llamadas: URLSearchParams[] = [];
  const userIds = opciones.userIds ?? [];
  const debates = opciones.foro ?? [];

  const fetchImpl: typeof fetch = (_url, init) => {
    const params = new URLSearchParams(String(init?.body));
    llamadas.push(params);

    const wsfunction = params.get('wsfunction');
    let payload: unknown;

    if (wsfunction === 'mod_assign_get_submissions') {
      payload = {
        assignments: [{ assignmentid: 42, submissions: userIds.map(entregaDe) }],
      };
    } else if (wsfunction === 'mod_forum_get_forum_discussions_paginated') {
      const page = Number(params.get('page') ?? '0');
      payload = {
        discussions:
          page === 0
            ? debates.map((debate) => ({ id: debate.discussionId * 10, discussion: debate.discussionId }))
            : [],
      };
    } else if (wsfunction === 'mod_forum_get_forum_discussion_posts') {
      const discussionid = Number(params.get('discussionid') ?? '0');
      const debate = debates.find((candidato) => candidato.discussionId === discussionid);
      payload = {
        posts:
          debate === undefined
            ? []
            : [
                {
                  id: debate.discussionId * 100,
                  userid: debate.userid,
                  created: 1_700_000_000,
                  parent: 0,
                  subject: 'Duda',
                  message: '<p>¿Por qué?</p>',
                },
              ],
      };
    } else if (wsfunction === 'core_user_get_users_by_field') {
      if (opciones.perfilesFallan === true) {
        // Así rechaza Moodle una función que no está en el servicio web: HTTP
        // 200 y el error en el cuerpo.
        payload = {
          exception: 'webservice_access_exception',
          errorcode: 'accessexception',
          message: 'Access control exception',
        };
      } else {
        const pedidos = [...params.entries()]
          .filter(([clave]) => clave.startsWith('values['))
          .map(([, valor]) => Number(valor));
        payload = (opciones.perfiles ?? ((ids) => ids.map((id) => usuario(id))))(pedidos);
      }
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

/** Las peticiones de perfiles, con los ids que llevaba cada una. */
function idsPedidos(llamadas: readonly URLSearchParams[]): number[][] {
  return llamadas
    .filter((params) => params.get('wsfunction') === 'core_user_get_users_by_field')
    .map((params) =>
      [...params.entries()]
        .filter(([clave]) => clave.startsWith('values['))
        .map(([, valor]) => Number(valor)),
    );
}

test('el perfil se pide una sola vez y con todos los ids de la actividad', async () => {
  // Una petición por alumno convertiría una entrega de treinta en treinta
  // viajes a Moodle sólo para enseñar treinta nombres.
  const { connector, llamadas } = moodleCon({ userIds: [11, 22, 33] });

  const entregas = await connector.listSubmissions(TAREA);

  const peticiones = idsPedidos(llamadas);
  assert.equal(peticiones.length, 1, 'los perfiles tienen que caber en una sola petición');
  assert.deepEqual(peticiones[0], [11, 22, 33]);

  const perfiles = llamadas.filter(
    (params) => params.get('wsfunction') === 'core_user_get_users_by_field',
  );
  assert.equal(perfiles[0]?.get('field'), 'id');

  assert.equal(entregas.length, 3);
  assert.equal(entregas[0]?.student?.ref, 'moodle-11');
  assert.equal(entregas[0]?.student?.fullName, 'Lucía Serrano Peña');
});

test('el perfil se casa con la entrega por el mismo studentRef', async () => {
  const { connector } = moodleCon({ userIds: [7, 8] });

  const entregas = await connector.listSubmissions(TAREA);

  for (const entrega of entregas) {
    assert.equal(
      entrega.student?.ref,
      entrega.ref.studentRef,
      'la clave del perfil tiene que ser exactamente el studentRef de la entrega',
    );
  }
});

test('un alumno con dos entregas se pide una sola vez', async () => {
  // El mismo alumno puede subir varios ficheros; pedir su perfil dos veces no
  // aporta nada y hace la URL más larga.
  const { connector, llamadas } = moodleCon({ userIds: [5, 5, 6] });

  await connector.listSubmissions(TAREA);

  assert.deepEqual(idsPedidos(llamadas), [[5, 6]]);
});

test('con más de cincuenta alumnos los perfiles se piden en lotes', async () => {
  // Moodle serializa los arrays como values[0]=…&values[1]=…: un foro de
  // doscientos participantes en una sola llamada es un cuerpo desmesurado.
  const userIds = Array.from({ length: 120 }, (_unused, indice) => indice + 1);
  const { connector, llamadas } = moodleCon({ userIds });

  const entregas = await connector.listSubmissions(TAREA);

  const peticiones = idsPedidos(llamadas);
  assert.deepEqual(
    peticiones.map((lote) => lote.length),
    [50, 50, 20],
  );
  // Ningún id se pierde ni se repite entre lotes.
  assert.deepEqual(peticiones.flat(), userIds);
  assert.equal(entregas.length, 120);
  assert.equal(entregas.at(-1)?.student?.ref, 'moodle-120');
});

test('si la función de perfiles falla, las entregas siguen llegando sin nombre', async () => {
  // Traer el perfil es un extra: que Moodle no deje leerlos no puede impedir
  // que se corrija lo que ya está entregado.
  const { connector } = moodleCon({ userIds: [11, 22], perfilesFallan: true });

  const entregas = await connector.listSubmissions(TAREA);

  assert.equal(entregas.length, 2);
  assert.equal(entregas[0]?.student, null);
  assert.equal(entregas[1]?.student, null);
  // Y lo que sí importa —qué corregir y de quién— sigue intacto.
  assert.equal(entregas[0]?.ref.studentRef, 'moodle-11');
  assert.equal(entregas[0]?.filename, 'entrega-11.pdf');
});

test('un perfil recortado a sólo el id no rompe nada', async () => {
  // Es lo que devuelve Moodle cuando al token le faltan capacidades: el usuario
  // llega, pero sin campos. No es un error, es una instalación prudente.
  const { connector } = moodleCon({
    userIds: [11],
    perfiles: (ids) => ids.map((id) => ({ id })),
  });

  const [entrega] = await connector.listSubmissions(TAREA);

  assert.equal(entrega?.student?.ref, 'moodle-11');
  assert.equal(entrega?.student?.fullName, null);
  assert.equal(entrega?.student?.email, null);
  assert.deepEqual(entrega?.student?.customFields, []);
});

test('un alumno del que Moodle no devuelve perfil se queda sin él, no sin entrega', async () => {
  const { connector } = moodleCon({
    userIds: [11, 22],
    // Moodle omite del array los ids que no puede resolver.
    perfiles: (ids) => ids.filter((id) => id === 11).map((id) => usuario(id)),
  });

  const entregas = await connector.listSubmissions(TAREA);

  assert.equal(entregas.length, 2);
  assert.equal(entregas[0]?.student?.ref, 'moodle-11');
  assert.equal(entregas[1]?.student, null);
});

test('los campos propios de la instalación llegan tal cual', async () => {
  // El conector no interpreta `customfields`: qué campos existen depende de cada
  // Moodle, y decidir cuáles importan no es asunto suyo. Dos comunidades en un
  // mismo campo es el formato real del cliente, no un dato mal escrito.
  const { connector } = moodleCon({
    userIds: [11],
    perfiles: (ids) =>
      ids.map((id) =>
        usuario(id, {
          customfields: [
            {
              type: 'text',
              shortname: 'CCAA',
              name: 'Comunidad autónoma',
              value: 'Comunidad de Madrid, Castilla-La Mancha',
            },
            { type: 'text', shortname: 'PROVINCIA', value: 'Toledo' },
            { type: 'text', shortname: 'SIN_VALOR', name: 'Campo vacío' },
          ],
        }),
      ),
  });

  const [entrega] = await connector.listSubmissions(TAREA);

  assert.deepEqual(entrega?.student?.customFields, [
    {
      shortname: 'CCAA',
      name: 'Comunidad autónoma',
      value: 'Comunidad de Madrid, Castilla-La Mancha',
    },
    // Sin etiqueta visible: se conserva el campo, con `name` a null.
    { shortname: 'PROVINCIA', name: null, value: 'Toledo' },
    // Un campo sin valor es un campo vacío, no un campo que no existe.
    { shortname: 'SIN_VALOR', name: 'Campo vacío', value: '' },
  ]);
});

test('el foro también trae el perfil, y con una sola petición para todo el foro', async () => {
  const { connector, llamadas } = moodleCon({
    foro: [
      { discussionId: 100, userid: 11 },
      { discussionId: 200, userid: 22 },
      { discussionId: 300, userid: 11 },
    ],
  });

  const entregas = await connector.listSubmissions(FORO);

  assert.equal(entregas.length, 3);
  // Una petición para todo el foro, con los autores deduplicados: dentro del
  // bucle de debates serían tantas peticiones más como debates abiertos.
  assert.deepEqual(idsPedidos(llamadas), [[11, 22]]);
  assert.equal(entregas[0]?.student?.ref, 'moodle-11');
  assert.equal(entregas[2]?.student?.ref, 'moodle-11');
});

test('una actividad sin entregas no pide ningún perfil', async () => {
  const { connector, llamadas } = moodleCon({ userIds: [] });

  assert.deepEqual(await connector.listSubmissions(TAREA), []);
  assert.deepEqual(idsPedidos(llamadas), []);
});

test('verifyConnection comprueba la lectura de perfiles como opcional', async () => {
  // Sin ella Vega funciona: la cola enseña el identificador de Moodle en lugar
  // del nombre. Marcarla obligatoria mandaría a pelearse con los permisos del
  // servicio web para conseguir algo que no bloquea nada.
  const { connector } = moodleCon({});

  const info = await connector.verifyConnection();
  const check = info.checks.find((candidato) => candidato.name === 'core_user_get_users_by_field');

  assert.ok(check !== undefined, 'la comprobación tiene que salir en el parte');
  assert.equal(check.required, false);
  assert.equal(check.label, 'Leer el perfil de los alumnos');
});
