import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  ContextLevel,
  type ContextListResponse,
  type ContextResponse,
  type ResolvedContextResponse,
  UpdateContextRequest,
  routes,
} from '@vega/shared';
import { resolveContext } from '@vega/core';
import { currentUser } from '../auth/plugin.js';
import { schema } from '../db/client.js';
import { toGradingContext } from '../db/mappers.js';
import { notFound, parseOrThrow } from '../http/errors.js';
import { requireActivity } from './activities.js';
import type { AppContext } from '../context.js';

/**
 * Contextos de corrección a tres niveles: global → tipo de actividad →
 * actividad.
 *
 * El orden no es estético, es el de especificidad, y además es el que aprovecha
 * la caché del prompt: lo que menos cambia va primero, de modo que el prefijo
 * compartido por todas las entregas de una misma actividad sea lo más largo
 * posible.
 *
 * La combinación vive en `@vega/core` (`resolveContext`), no aquí: es
 * exactamente el mismo texto que el motor manda al modelo, así que lo que ve el
 * profesor en la pantalla de contexto es literalmente lo que se envía. Tenerlo
 * en un solo sitio es lo que evita que las dos cosas se separen con el tiempo.
 */

/** Lee el contenido de un nivel de contexto; cadena vacía si no está definido. */
export async function readContextLevel(
  ctx: AppContext,
  level: ContextLevel,
  key: string,
): Promise<string> {
  const [row] = await ctx.db
    .select()
    .from(schema.gradingContexts)
    .where(and(eq(schema.gradingContexts.level, level), eq(schema.gradingContexts.key, key)))
    .limit(1);
  return row?.content ?? '';
}

// ── Rutas ───────────────────────────────────────────────────────────────────

export async function contextRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;

  app.get(
    routes.contexts,
    { preHandler: app.authenticate },
    async (): Promise<ContextListResponse> => {
      const rows = await db
        .select()
        .from(schema.gradingContexts)
        .orderBy(asc(schema.gradingContexts.level), asc(schema.gradingContexts.key));
      return { items: rows.map(toGradingContext) };
    },
  );

  app.put<{ Params: { level: string; key: string } }>(
    // Literal en vez de `routes.context(...)`: el helper está tipado con
    // `ContextLevel` y aquí el nivel es un comodín de Fastify.
    '/api/contexts/:level/:key',
    { preHandler: app.authenticate },
    async (request): Promise<ContextResponse> => {
      const level = parseOrThrow(ContextLevel, request.params.level, 'El nivel de contexto');
      const body = parseOrThrow(UpdateContextRequest, request.body, 'El contexto');
      const session = currentUser(request);
      const key = request.params.key;

      // Upsert: los contextos se crean solos la primera vez que se editan.
      const [row] = await db
        .insert(schema.gradingContexts)
        .values({ level, key, content: body.content, updatedBy: session.sub })
        .onConflictDoUpdate({
          target: [schema.gradingContexts.level, schema.gradingContexts.key],
          set: { content: body.content, updatedBy: session.sub, updatedAt: new Date() },
        })
        .returning();

      if (!row) throw notFound('No se ha podido guardar el contexto.');
      return { context: toGradingContext(row) };
    },
  );

  app.get<{ Params: { activityId: string } }>(
    routes.resolvedContext(':activityId'),
    { preHandler: app.authenticate },
    async (request): Promise<ResolvedContextResponse> => {
      const activity = await requireActivity(ctx, request.params.activityId);

      // Lo que ve el profesor en esta pantalla es literalmente lo que se manda
      // al modelo: misma función que usa el lote.
      return resolveContext({
        global: await readContextLevel(ctx, 'global', 'global'),
        activityKind: await readContextLevel(ctx, 'activity_kind', activity.kind),
        activity: await readContextLevel(ctx, 'activity', activity.slug),
        files: activity.files,
      });
    },
  );
}
