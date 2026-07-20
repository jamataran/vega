import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { LmsAuthError, LmsUnavailableError } from '@vega/connector-lms';
import { MoodleClient } from './api.js';

/**
 * Lo que se prueba aquí es la clasificación del fallo, no la red: de ella
 * depende que la pantalla mande al profesor a Ajustes o le ofrezca reintentar,
 * y acertar en esa bifurcación es media HU-19.
 */

const SCHEMA = z.object({ ok: z.boolean() });

/** Cliente con un `fetch` de laboratorio: devuelve siempre lo mismo. */
function clientReturning(response: Response | (() => never)): MoodleClient {
  return new MoodleClient({
    baseUrl: 'https://moodle.ejemplo.es',
    token: 'token-de-prueba',
    fetchImpl: () => (typeof response === 'function' ? response() : Promise.resolve(response)),
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Cuerpo de error de Moodle, que viaja con HTTP 200. */
function moodleError(errorcode: string): Response {
  return jsonResponse({
    exception: 'moodle_exception',
    errorcode,
    message: `Fallo simulado: ${errorcode}`,
  });
}

async function failureOf(client: MoodleClient): Promise<Error> {
  try {
    await client.call('core_webservice_get_site_info', {}, SCHEMA);
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  throw new assert.AssertionError({ message: 'Se esperaba un fallo y la llamada fue bien.' });
}

test('una respuesta válida se devuelve ya parseada', async () => {
  const client = clientReturning(jsonResponse({ ok: true, sobra: 'se descarta' }));
  assert.deepEqual(await client.call('core_webservice_get_site_info', {}, SCHEMA), { ok: true });
});

test('401 y 403 son fallo de credencial', async () => {
  for (const status of [401, 403]) {
    const error = await failureOf(clientReturning(jsonResponse({}, status)));
    assert.ok(error instanceof LmsAuthError, `HTTP ${status} debería ser LmsAuthError`);
    assert.equal(error.code, 'LMS_AUTH');
  }
});

test('el resto de errores HTTP son indisponibilidad, no credencial', async () => {
  for (const status of [400, 404, 429, 500, 502, 503]) {
    const error = await failureOf(clientReturning(jsonResponse({}, status)));
    assert.ok(error instanceof LmsUnavailableError, `HTTP ${status} debería ser reintentable`);
    assert.equal(error.code, 'LMS_UNAVAILABLE');
  }
});

test('los errorcodes de credencial se detectan aunque lleguen con HTTP 200', async () => {
  for (const errorcode of [
    'invalidtoken',
    'accessexception',
    'invalidlogin',
    'requireloginerror',
    'nopermissions',
    'accessdenied',
    // Ningún catálogo cubre lo que inventa cada plugin: la heurística por
    // subcadena es lo que evita mandar a reintentar un token muerto.
    'invalidtokenformat',
    'nopermissiontoviewpage',
    'ACCESSEXCEPTION',
  ]) {
    const error = await failureOf(clientReturning(moodleError(errorcode)));
    assert.ok(error instanceof LmsAuthError, `"${errorcode}" debería ser LmsAuthError`);
  }
});

test('un errorcode que no habla de credenciales deja reintentar', async () => {
  for (const errorcode of ['dmlwriteexception', 'servicenotavailable', 'cannotconnect']) {
    const error = await failureOf(clientReturning(moodleError(errorcode)));
    assert.ok(error instanceof LmsUnavailableError, `"${errorcode}" no debería mandar a Ajustes`);
  }
});

test('el mensaje de un error de Moodle conserva errorcode y wsfunction', async () => {
  const error = await failureOf(clientReturning(moodleError('dmlwriteexception')));
  assert.match(error.message, /dmlwriteexception/);
  assert.match(error.message, /core_webservice_get_site_info/);
});

test('un fallo de red es indisponibilidad y conserva la causa', async () => {
  const cause = new TypeError('fetch failed');
  const error = await failureOf(
    clientReturning(() => {
      throw cause;
    }),
  );
  assert.ok(error instanceof LmsUnavailableError);
  assert.equal(error.cause, cause);
});

test('una respuesta con forma inesperada no se confunde con un token malo', async () => {
  // Otra versión de Moodle o un plugin que altera la salida: reintentar no
  // arregla nada, pero mandar a revisar el token es una pista falsa peor.
  const error = await failureOf(clientReturning(jsonResponse({ vaya: 'otra forma' })));
  assert.ok(error instanceof LmsUnavailableError);
  assert.match(error.message, /core_webservice_get_site_info/);
  assert.match(error.message, /inesperado/i);
});

test('un HTTP 200 que no es JSON se trata como indisponibilidad', async () => {
  const login = new Response('<html><body>Iniciar sesión</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
  const error = await failureOf(clientReturning(login));
  assert.ok(error instanceof LmsUnavailableError);
});

test('la llamada envía token, wsfunction y formato JSON en el cuerpo', async () => {
  const sent: string[] = [];
  const client = new MoodleClient({
    baseUrl: 'https://moodle.ejemplo.es/',
    token: 'token-de-prueba',
    fetchImpl: async (_url, init) => {
      sent.push(String(init?.body));
      return jsonResponse({ ok: true });
    },
  });

  await client.call('mod_assign_get_assignments', { courseids: [7, 9] }, SCHEMA);

  const body = new URLSearchParams(sent[0] ?? '');
  assert.equal(body.get('wstoken'), 'token-de-prueba');
  assert.equal(body.get('wsfunction'), 'mod_assign_get_assignments');
  assert.equal(body.get('moodlewsrestformat'), 'json');
  // Moodle no entiende JSON en el cuerpo: los arrays van indexados.
  assert.equal(body.get('courseids[0]'), '7');
  assert.equal(body.get('courseids[1]'), '9');
  // La barra final de la URL base no debe duplicarse en el endpoint.
  assert.equal(client.endpoint, 'https://moodle.ejemplo.es/webservice/rest/server.php');
});
