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
import { forbidden, notFound, parseOrThrow } from '../http/errors.js';
import { activityScope, assertActivityAccess, seesEverything } from '../auth/scope.js';
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
    async (request): Promise<ContextListResponse> => {
      const session = currentUser(request);
      const rows = await db
        .select()
        .from(schema.gradingContexts)
        .orderBy(asc(schema.gradingContexts.level), asc(schema.gradingContexts.key));

      // Los niveles global y de tipo de actividad son política de departamento
      // y los ve todo el mundo (HU-06, RN-6). El de una actividad concreta, no:
      // es el criterio con el que se corrige a alumnos de un curso, y sigue el
      // mismo alcance que la actividad. Un contexto huérfano —sin actividad que
      // le corresponda— sólo lo ve la administración: no es de nadie.
      if (seesEverything(session)) return { items: rows.map(toGradingContext) };

      const visible = await db
        .select({ slug: schema.activities.slug })
        .from(schema.activities)
        .where(activityScope(session));
      const slugs = new Set(visible.map((row) => row.slug));

      return {
        items: rows
          .filter((row) => row.level !== 'activity' || slugs.has(row.key))
          .map(toGradingContext),
      };
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

      // Editar el contexto de una actividad es decidir con qué criterio se
      // corrige a sus alumnos: exige el mismo permiso que la actividad. Los
      // niveles global y de tipo son política común y no se acotan (HU-06, RN-6).
      if (level === 'activity') {
        const [target] = await db
          .select({ id: schema.activities.id })
          .from(schema.activities)
          .where(eq(schema.activities.slug, key))
          .limit(1);
        // Sin actividad todavía no hay a quién preguntar: el contexto puede
        // existir antes que ella (viene sembrado del repositorio). Se reserva a
        // administración, que es quien prepara el despliegue.
        if (target) {
          await assertActivityAccess(ctx, session, target.id);
        } else if (!seesEverything(session)) {
          throw forbidden('No existe ninguna actividad tuya con ese identificador.');
        }
      }

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
      const activity = await requireActivity(ctx, request.params.activityId, currentUser(request));

      // El contenido de los ficheros de texto se lee aquí y no en `loadActivity`
      // porque sólo hace falta al montar el contexto: arrastrarlo en cada
      // listado de actividades sería mover documentos enteros para nada.
      const fileRows = await ctx.db
        .select({
          filename: schema.activityFiles.filename,
          content: schema.activityFiles.content,
        })
        .from(schema.activityFiles)
        // Igual que el lote: una subida a medias no forma parte del contexto,
        // y esta pantalla tiene que enseñar exactamente lo que se envía.
        .where(
          and(
            eq(schema.activityFiles.activityId, activity.id),
            eq(schema.activityFiles.uploadComplete, true),
          ),
        )
        .orderBy(asc(schema.activityFiles.uploadedAt));

      // Lo que ve el profesor en esta pantalla es literalmente lo que se manda
      // al modelo: misma función que usa el lote.
      return resolveContext({
        global: await readContextLevel(ctx, 'global', 'global'),
        activityKind: await readContextLevel(ctx, 'activity_kind', activity.kind),
        activity: await readContextLevel(ctx, 'activity', activity.slug),
        files: activity.files,
        referenceSolution: activity.referenceSolution,
        graded: activity.graded,
        fileContents: fileRows.filter(
          (row): row is { filename: string; content: string } => row.content !== null,
        ),
      });
    },
  );
}
