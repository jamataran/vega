import type { FastifyInstance } from 'fastify';
import { type SettingsResponse, UpdateSettingsRequest, routes } from '@vega/shared';
import { currentUser } from '../auth/plugin.js';
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
}
