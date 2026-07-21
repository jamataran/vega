import type { FastifyInstance } from 'fastify';
import {
  type AnthropicConnectionResponse,
  type SettingsResponse,
  UpdateSettingsRequest,
  routes,
} from '@vega/shared';
import { currentUser } from '../auth/plugin.js';
import { aiProviderForInstall } from '../ai/factory.js';
import { getSettings, updateSettings } from '../settings/service.js';
import { parseOrThrow } from '../http/errors.js';
import type { AppContext } from '../context.js';

/**
 * Ajustes del sistema. Sólo administrador.
 *
 * Toda la lógica vive en `settings/service.ts`; aquí sólo se expone. En
 * particular, **los secretos nunca salen por esta ruta**: el servicio devuelve
 * `apiKeyConfigured` / `tokenConfigured` / `passwordConfigured` y jamás el
 * valor. Escribir sí se puede; leer no.
 */
export async function settingsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const adminOnly = app.requireRole('admin');

  app.get(routes.settings, { preHandler: adminOnly }, async (): Promise<SettingsResponse> => {
    return { settings: await getSettings(ctx) };
  });

  app.patch(routes.settings, { preHandler: adminOnly }, async (request): Promise<SettingsResponse> => {
    const body = parseOrThrow(UpdateSettingsRequest, request.body, 'Los ajustes');
    const session = currentUser(request);
    return { settings: await updateSettings(ctx, body, session.sub) };
  });

  /**
   * Prueba la conexión con Anthropic usando el proveedor, el modelo y la clave
   * que hay configurados en Ajustes.
   *
   * Como la prueba del token de Moodle, una clave inválida **no es un error de
   * esta ruta**: es su respuesta. Devuelve 200 con `ok: false` y un mensaje para
   * que el administrador lea por qué falla donde acaba de pegar la clave.
   */
  app.post(
    routes.testAnthropicConnection,
    { preHandler: adminOnly },
    async (): Promise<AnthropicConnectionResponse> => {
      const settings = await getSettings(ctx);
      const provider = settings.anthropic.provider;
      try {
        const ai = await aiProviderForInstall(ctx);
        const result = await ai.verifyConnection();
        return {
          ok: result.ok,
          message: result.message,
          provider,
          model: result.model,
          usage: result.usage,
        };
      } catch (error) {
        // El caso típico: proveedor «anthropic» sin clave configurada. El motor
        // lanza, pero su mensaje nombra variables de entorno; aquí, que se lee
        // desde Ajustes, se traduce a los controles que el administrador tiene
        // delante. Nunca un 500: es una respuesta legítima de esta ruta.
        const message =
          provider === 'anthropic'
            ? 'Aún no hay clave de API de Anthropic. Pégala arriba y pulsa «Guardar Anthropic» antes de probar la conexión.'
            : error instanceof Error
              ? error.message
              : 'No se ha podido probar la conexión.';
        return { ok: false, message, provider, model: null, usage: null };
      }
    },
  );
}
