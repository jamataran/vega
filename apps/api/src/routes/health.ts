import type { FastifyInstance } from 'fastify';
import { type HealthResponse, routes } from '@vega/shared';
import type { AppContext } from '../context.js';
import { getSettings } from '../settings/service.js';

export async function healthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Pública a propósito: la usa el proxy inverso y el HEALTHCHECK de Docker.
  // `logLevel: 'warn'` la calla: el proxy sondea cada pocos segundos y si no,
  // en un día son decenas de miles de líneas idénticas empujando fuera del
  // fichero rotado justo lo que se quería leer. Un fallo sí se registra.
  app.get(routes.health, { logLevel: 'warn' }, async (_request, reply): Promise<HealthResponse> => {
    let database: 'up' | 'down' = 'up';
    try {
      await ctx.sql`SELECT 1`;
    } catch {
      database = 'down';
    }

    const settings = database === 'up' ? await getSettings(ctx).catch(() => null) : null;
    const body: HealthResponse = {
      status: database === 'up' ? 'ok' : 'degraded',
      version: ctx.config.version,
      database,
      aiProvider: settings?.anthropic.provider ?? ctx.config.AI_PROVIDER,
      aiTransport: settings?.ai.transport ?? 'sync',
      readingModel: settings?.anthropic.readingModel ?? ctx.config.AI_MODEL_TRANSCRIPTION,
      gradingModel: settings?.anthropic.gradingModel ?? ctx.config.AI_MODEL_GRADING,
      lmsConnector: settings?.moodle.connector ?? ctx.config.LMS_CONNECTOR,
      uptimeSeconds: Math.round((Date.now() - ctx.startedAt) / 1000),
    };

    // 503 cuando la BD no responde, para que el orquestador no mande tráfico.
    void reply.status(database === 'up' ? 200 : 503);
    return body;
  });
}
