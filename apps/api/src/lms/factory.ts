// Importar estos dos paquetes tiene efectos secundarios a propósito: cada uno
// se da de alta en el registro de conectores al cargarse. Sin ellos,
// `createConnector('moodle3')` fallaría con «Registrados: ninguno».
import '@vega/connector-filesystem';
import '@vega/connector-moodle3';

import { eq } from 'drizzle-orm';
import { createConnector, LmsAuthError, LmsUnavailableError } from '@vega/connector-lms';
import type { LmsConnector } from '@vega/connector-lms';
import { schema } from '../db/client.js';
import { HttpError, lmsAuth, lmsUnavailable } from '../http/errors.js';
import type { AppContext } from '../context.js';

/**
 * Construcción del conector con el que Vega habla con el LMS.
 *
 * El reparto de credenciales no es arbitrario: **la URL y el conector son de la
 * instalación** —los pone el administrador en Ajustes— y **el token es de cada
 * usuario**. El motivo está en Moodle, no en Vega:
 * `core_enrol_get_users_courses` devuelve los cursos del dueño del token, así
 * que la credencial es la que decide qué cursos ofrece la aplicación. Con un
 * token compartido, cada profesor vería los cursos de todo el claustro.
 */

export type ConnectorName = 'mock' | 'filesystem' | 'moodle3';

interface LmsSettings {
  readonly connector: ConnectorName;
  readonly baseUrl: string;
}

/** Ajustes de instalación. `app_settings` manda sobre el `.env`, como en el resto. */
async function lmsSettings(ctx: AppContext): Promise<LmsSettings> {
  const rows = await ctx.db.select().from(schema.appSettings);
  const value = (key: string): string => rows.find((row) => row.key === key)?.value ?? '';

  const stored = value('moodle.connector');
  const connector = (stored === '' ? ctx.config.LMS_CONNECTOR : stored) as ConnectorName;
  const baseUrl = value('moodle.baseUrl') || (ctx.config.MOODLE_BASE_URL ?? '');

  return { connector, baseUrl };
}

/** Token de Moodle de un usuario, sin pasar por el mapeador: es un secreto. */
async function moodleTokenOf(ctx: AppContext, userId: string): Promise<string> {
  const [row] = await ctx.db
    .select({ token: schema.users.moodleToken })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row?.token ?? '';
}

/**
 * Conector para actuar **en nombre de un usuario**.
 *
 * Los fallos de configuración salen como `LMS_AUTH` y no como error genérico
 * porque son, con diferencia, el fallo más probable en producción, y el
 * profesor tiene que poder distinguirlos de «Moodle no responde»: uno se
 * arregla en Ajustes y el otro se reintenta.
 */
export async function connectorForUser(ctx: AppContext, userId: string): Promise<LmsConnector> {
  const { connector, baseUrl } = await lmsSettings(ctx);

  // Los conectores de desarrollo no necesitan credenciales de nadie.
  if (connector === 'mock') return createConnector('mock');
  if (connector === 'filesystem') {
    return createConnector('filesystem', { root: ctx.config.LMS_FILESYSTEM_ROOT });
  }

  if (baseUrl === '') {
    throw lmsAuth(
      'Vega no sabe a qué Moodle conectarse. Un administrador tiene que indicar la URL en Ajustes.',
    );
  }

  const token = await moodleTokenOf(ctx, userId);
  if (token === '') {
    throw lmsAuth(
      'No has configurado tu token de Moodle. Añádelo en Ajustes para ver tus cursos.',
    );
  }

  return createConnector('moodle3', { baseUrl, token });
}

/**
 * Traduce un fallo del conector a la respuesta HTTP que le corresponde.
 *
 * Sin esto, cualquier error del conector cae en la rama genérica del manejador
 * global y llega al profesor como un 500 «Ha ocurrido un error inesperado»,
 * perdiendo justo la información que necesita para arreglarlo.
 */
export function asHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof LmsAuthError) return lmsAuth(error.message);
  if (error instanceof LmsUnavailableError) return lmsUnavailable(error.message);
  return lmsUnavailable(
    error instanceof Error ? error.message : 'No se ha podido consultar el LMS.',
  );
}

/** Ejecuta una operación contra el LMS traduciendo sus fallos. */
export async function withLms<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw asHttpError(error);
  }
}
