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
import { forbidden, notFound, parseOrThrow } from '../http/errors.js';
import {
  activityScope,
  assertActivityAccess,
  assertCourseAccess,
  seesEverything,
} from '../auth/scope.js';
import { requireActivity } from './activities.js';
import type { AppContext } from '../context.js';
import {
  listActiveContexts,
  readActiveContext,
  readContextLevel,
  saveContextVersion,
} from '../contexts/service.js';

export { readContextLevel } from '../contexts/service.js';

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

// ── Rutas ───────────────────────────────────────────────────────────────────

export async function contextRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;

  app.get(
    routes.contexts,
    { preHandler: app.authenticate },
    async (request): Promise<ContextListResponse> => {
      const session = currentUser(request);
      const rows = await listActiveContexts(ctx);

      // Los niveles global y de tipo de actividad son política de departamento
      // y los ve todo el mundo (HU-06, RN-6). El de una actividad concreta, no:
      // es el criterio con el que se corrige a alumnos de un curso, y sigue el
      // mismo alcance que la actividad. Un contexto huérfano —sin actividad que
      // le corresponda— sólo lo ve la administración: no es de nadie.
      if (seesEverything(session)) return { items: rows };

      const visible = await db
        .select({ slug: schema.activities.slug })
        .from(schema.activities)
        .where(activityScope(session));
      const slugs = new Set(visible.map((row) => row.slug));
      const visibleCourses = await db
        .select({ id: schema.courseTeachers.courseId })
        .from(schema.courseTeachers)
        .where(eq(schema.courseTeachers.userId, session.sub));
      const courseIds = new Set(visibleCourses.map((row) => row.id));

      return {
        items: rows
          .filter(
            (row) =>
              (row.level !== 'activity' || slugs.has(row.key)) &&
              (row.level !== 'course' || courseIds.has(row.key)),
          ),
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

      if ((level === 'global' || level === 'activity_kind') && !seesEverything(session)) {
        throw forbidden('Sólo la administración puede editar este nivel de contexto.');
      }

      if (level === 'course') {
        await assertCourseAccess(ctx, session, key);
      }

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

      const context = await saveContextVersion(ctx, {
        level,
        key,
        content: body.content,
        expectedVersion: body.expectedVersion,
        userId: session.sub,
      });
      return { context };
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

      const contexts = await Promise.all([
        readActiveContext(ctx, 'global', 'global'),
        readActiveContext(ctx, 'activity_kind', activity.kind),
        activity.templateKey
          ? readActiveContext(ctx, 'template', activity.templateKey)
          : Promise.resolve(null),
        activity.courseId
          ? readActiveContext(ctx, 'course', activity.courseId)
          : Promise.resolve(null),
        readActiveContext(ctx, 'activity', activity.slug),
      ]);
      const [global, activityKind, template, course, activityContext] = contexts;
      const segments = contexts
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .map((item) => ({
          level: item.level,
          key: item.key,
          contextId: item.id,
          version: item.activeVersion,
          contentHash: item.contentHash,
          content: item.content,
        }));

      return resolveContext({
        global: global?.content,
        activityKind: activityKind?.content,
        template: template?.content,
        course: course?.content,
        activity: activityContext?.content,
        segments,
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
