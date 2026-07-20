import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  type Activity,
  type ActivityFileContentResponse,
  type ActivityFileListResponse,
  type ActivityFileResponse,
  type ActivityListResponse,
  type ActivityResponse,
  AppendActivityFileChunkRequest,
  type AppendActivityFileChunkResponse,
  BeginActivityFileUploadRequest,
  DiscoverActivitiesQuery,
  type DiscoverActivitiesResponse,
  type DiscoverCoursesResponse,
  ImportActivitiesRequest,
  type ImportActivitiesResponse,
  MAX_FILE_CONTENT_BYTES,
  UpdateActivityRequest,
  isTextFile,
  routes,
} from '@vega/shared';
import { currentUser } from '../auth/plugin.js';
import {
  activityScope,
  assertActivityAccess,
  recordCourseAccess,
} from '../auth/scope.js';
import { schema } from '../db/client.js';
import { toActivity, toActivityFile } from '../db/mappers.js';
import { conflict, notFound, parseOrThrow, unprocessable } from '../http/errors.js';
import { connectorForUser, withLms } from '../lms/factory.js';
import type { TokenPayload } from '../auth/plugin.js';
import type { AppContext } from '../context.js';

/**
 * Actividades de Moodle a las que Vega reacciona.
 *
 * Sustituye a los antiguos "buzones": el eje del modelo ya no es un contenedor
 * abstracto sino la actividad real del LMS, de dos tipos (entrega y foro).
 */

// ── Carga con ficheros adjuntos ─────────────────────────────────────────────

/** Lee una actividad con sus ficheros de contexto. Reutilizado por otras rutas. */
export async function loadActivity(ctx: AppContext, id: string): Promise<Activity | undefined> {
  const [row] = await ctx.db
    .select()
    .from(schema.activities)
    .where(eq(schema.activities.id, id))
    .limit(1);
  if (!row) return undefined;

  // Una subida a medias no es un fichero todavía: no se enseña ni se envía.
  const files = await ctx.db
    .select()
    .from(schema.activityFiles)
    .where(
      and(
        eq(schema.activityFiles.activityId, id),
        eq(schema.activityFiles.uploadComplete, true),
      ),
    )
    .orderBy(asc(schema.activityFiles.uploadedAt));

  return toActivity(row, files);
}

/**
 * Igual que `loadActivity` pero lanzando 404, y comprobando el permiso.
 *
 * El usuario es obligatorio a propósito: con un parámetro opcional, olvidarlo
 * en una ruta nueva no daría ni un error de tipos y abriría un agujero
 * silencioso por el que un profesor vería el trabajo de otro. Si alguna vez
 * hace falta cargar sin comprobar nada, está `loadActivity`.
 */
export async function requireActivity(
  ctx: AppContext,
  id: string,
  user: TokenPayload,
): Promise<Activity> {
  const activity = await loadActivity(ctx, id);
  if (!activity) throw notFound('No existe esa actividad.');
  await assertActivityAccess(ctx, user, id);
  return activity;
}

/** Agrupa los ficheros de varias actividades en una sola consulta. */
async function filesByActivity(
  ctx: AppContext,
  activityIds: string[],
): Promise<Map<string, (typeof schema.activityFiles.$inferSelect)[]>> {
  const grouped = new Map<string, (typeof schema.activityFiles.$inferSelect)[]>();
  if (activityIds.length === 0) return grouped;

  const rows = await ctx.db
    .select()
    .from(schema.activityFiles)
    .where(
      and(
        inArray(schema.activityFiles.activityId, activityIds),
        eq(schema.activityFiles.uploadComplete, true),
      ),
    )
    .orderBy(asc(schema.activityFiles.uploadedAt));

  for (const row of rows) {
    const list = grouped.get(row.activityId) ?? [];
    list.push(row);
    grouped.set(row.activityId, list);
  }
  return grouped;
}

/**
 * Cuándo se da por muerta una subida sin cerrar. Generoso: una conexión mala
 * puede tardar, y borrar la subida de alguien que sigue en ello es peor que
 * dejar una fila huérfana un rato de más.
 */
const STALE_UPLOAD_MS = 60 * 60 * 1000;

/**
 * `slug` estable a partir de la referencia de Moodle.
 *
 * Es la `key` del contexto de nivel `activity` y el nombre del fichero en
 * `contexts/activities/`, así que una vez creado no cambia nunca (HU-04, RN-1).
 */
function slugFromMoodleRef(moodleRef: string): string {
  const cleaned = moodleRef
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? `actividad-${Date.now()}` : cleaned;
}

/**
 * Da de alta el curso si aún no existe y devuelve su fila.
 *
 * El nombre **sí** se refresca al re-sincronizar, al revés que el de la
 * actividad: el nombre de una actividad puede haberlo ajustado el profesor en
 * Vega y no queremos pisárselo (RN-4), pero el del curso nadie lo edita aquí,
 * así que lo que diga Moodle es lo bueno.
 */
async function upsertCourse(
  ctx: AppContext,
  moodleCourseId: string,
  name: string,
): Promise<typeof schema.courses.$inferSelect> {
  const [row] = await ctx.db
    .insert(schema.courses)
    .values({ moodleCourseId, name })
    .onConflictDoUpdate({
      target: schema.courses.moodleCourseId,
      set: { name, updatedAt: new Date() },
    })
    .returning();

  if (row) return row;

  // `onConflictDoUpdate` siempre devuelve fila; esto sólo cubre el caso
  // imposible para que el tipo no arrastre un `undefined` por toda la ruta.
  const [existing] = await ctx.db
    .select()
    .from(schema.courses)
    .where(eq(schema.courses.moodleCourseId, moodleCourseId))
    .limit(1);
  if (!existing) throw notFound('No se ha podido registrar el curso.');
  return existing;
}

// ── Rutas ───────────────────────────────────────────────────────────────────

export async function activityRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;

  // ── Listado ───────────────────────────────────────────────────────────────
  app.get(
    routes.activities,
    { preHandler: app.authenticate },
    async (request): Promise<ActivityListResponse> => {
      const session = currentUser(request);
      // Un profesor sólo ve lo de sus cursos; la administración, todo.
      const rows = await db
        .select()
        .from(schema.activities)
        .where(activityScope(session))
        .orderBy(asc(schema.activities.slug));
      const files = await filesByActivity(
        ctx,
        rows.map((row) => row.id),
      );
      return { items: rows.map((row) => toActivity(row, files.get(row.id) ?? [])) };
    },
  );

  // ── Cursos del profesor ───────────────────────────────────────────────────
  // Primer paso del alta: el catálogo entero de un Moodle de departamento no
  // cabe en una pantalla, así que se elige curso y luego se ven sus actividades.
  app.get(
    routes.discoverCourses,
    { preHandler: app.authenticate },
    async (request): Promise<DiscoverCoursesResponse> => {
      const session = currentUser(request);
      const connector = await connectorForUser(ctx, session.sub);
      const found = await withLms(() => connector.listCourses());

      // Listar cursos es el único momento en que Moodle nos dice la verdad
      // sobre a qué alcanza este profesor, así que es donde se registra. Sin
      // esto, un compañero que importara antes que él le dejaría fuera de su
      // propia asignatura.
      const rows = await Promise.all(
        found.map((course) => upsertCourse(ctx, course.moodleCourseId, course.name)),
      );
      await recordCourseAccess(
        ctx,
        session.sub,
        rows.map((row) => row.id),
      );

      return { items: found };
    },
  );

  // ── Descubrir en Moodle ───────────────────────────────────────────────────
  // Antes que `/:id`: Fastify da prioridad al segmento estático, pero dejarlo
  // aquí arriba evita sorpresas si alguien reordena.
  app.get(
    routes.discoverActivities,
    { preHandler: app.authenticate },
    async (request): Promise<DiscoverActivitiesResponse> => {
      const session = currentUser(request);
      const query = parseOrThrow(DiscoverActivitiesQuery, request.query, 'El curso');

      const connector = await connectorForUser(ctx, session.sub);
      const found = await withLms(() => connector.listActivities(query.moodleCourseId));

      // `alreadyImported` lo decide Vega, no el conector: el conector no sabe
      // qué hay dado de alta y lo devuelve siempre a `false`.
      const existing = await db
        .select({ moodleRef: schema.activities.moodleRef })
        .from(schema.activities);
      const imported = new Set(
        existing.map((row) => row.moodleRef).filter((ref): ref is string => ref !== null),
      );

      return {
        items: found.map((entry) => ({
          ...entry,
          alreadyImported: imported.has(entry.moodleRef),
        })),
      };
    },
  );

  // ── Importar las seleccionadas ────────────────────────────────────────────
  app.post(
    routes.importActivities,
    { preHandler: app.authenticate },
    async (request): Promise<ImportActivitiesResponse> => {
      const session = currentUser(request);
      const body = parseOrThrow(ImportActivitiesRequest, request.body, 'La selección');
      const wanted = [...new Set(body.moodleRefs)];

      // Volvemos a preguntar a Moodle en vez de fiarnos de lo que el cliente
      // tenía en pantalla: entre listar y confirmar, una actividad puede
      // haberse borrado, y crearla en Vega dejaría una actividad que no ingiere
      // nada y falla cada noche sin explicar por qué.
      const connector = await connectorForUser(ctx, session.sub);
      const available = await withLms(() => connector.listActivities(body.moodleCourseId));
      const byMoodleRef = new Map(available.map((entry) => [entry.moodleRef, entry]));

      const unknown = wanted.filter((ref) => !byMoodleRef.has(ref));
      if (unknown.length > 0) {
        throw unprocessable(
          `Estas actividades ya no están en Moodle: ${unknown.join(', ')}.`,
          Object.fromEntries(unknown.map((ref) => [ref, 'No existe en Moodle'])),
        );
      }

      const courseName = available[0]?.courseName ?? '';
      const course = await upsertCourse(ctx, body.moodleCourseId, courseName);

      // Idempotente: reimportar una que ya está dada de alta la devuelve tal
      // cual, sin duplicarla ni pisar lo que el profesor haya configurado.
      const already = await db
        .select()
        .from(schema.activities)
        .where(inArray(schema.activities.moodleRef, wanted));
      const byRef = new Map(already.map((row) => [row.moodleRef, row]));

      const toCreate = wanted
        .filter((ref) => !byRef.has(ref))
        .map((ref) => byMoodleRef.get(ref))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);

      if (toCreate.length > 0) {
        const inserted = await db
          .insert(schema.activities)
          .values(
            toCreate.map((entry) => ({
              slug: slugFromMoodleRef(entry.moodleRef),
              name: entry.name,
              kind: entry.kind,
              courseId: course.id,
              courseName: course.name,
              moodleRef: entry.moodleRef,
              // Su token es el que se usará para ingerir las entregas.
              importedBy: session.sub,
              enabled: true,
              // Un foro no se puntúa por defecto; una entrega sí. El profesor
              // lo cambia luego desde la ficha de la actividad.
              graded: entry.kind === 'assignment',
              maxScore: entry.kind === 'assignment' ? '10' : null,
              // Nadie estrena una actividad en modo autónomo: la confianza se
              // gana actividad a actividad.
              autonomy: 'review_all' as const,
            })),
          )
          // Carrera entre dos importaciones simultáneas: los índices únicos de
          // `slug` y `moodle_ref` deciden y la segunda no rompe.
          .onConflictDoNothing()
          .returning();
        for (const row of inserted) byRef.set(row.moodleRef, row);

        // Lo que el `ON CONFLICT` haya saltado por la carrera lo releemos, para
        // que la respuesta incluya siempre todo lo pedido (RN-3).
        const missing = wanted.filter((ref) => !byRef.has(ref));
        if (missing.length > 0) {
          const raced = await db
            .select()
            .from(schema.activities)
            .where(inArray(schema.activities.moodleRef, missing));
          for (const row of raced) byRef.set(row.moodleRef, row);
        }
      }

      const rows = wanted
        .map((ref) => byRef.get(ref))
        .filter((row): row is NonNullable<typeof row> => row !== undefined);
      const files = await filesByActivity(
        ctx,
        rows.map((row) => row.id),
      );

      return { items: rows.map((row) => toActivity(row, files.get(row.id) ?? [])) };
    },
  );

  // ── Detalle ───────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    routes.activity(':id'),
    { preHandler: app.authenticate },
    async (request): Promise<ActivityResponse> => {
      return { activity: await requireActivity(ctx, request.params.id, currentUser(request)) };
    },
  );

  // ── Edición ───────────────────────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>(
    routes.activity(':id'),
    { preHandler: app.authenticate },
    async (request): Promise<ActivityResponse> => {
      const body = parseOrThrow(UpdateActivityRequest, request.body, 'La actividad');

      const [current] = await db
        .select()
        .from(schema.activities)
        .where(eq(schema.activities.id, request.params.id))
        .limit(1);
      if (!current) throw notFound('No existe esa actividad.');

      const graded = body.graded ?? current.graded;
      const maxScore =
        body.maxScore !== undefined
          ? body.maxScore
          : current.maxScore === null
            ? null
            : Number(current.maxScore);

      // La misma regla que el CHECK `activities_graded_needs_max_score`, pero
      // comprobada aquí para devolver un 422 explicable en vez de dejar que
      // reviente la restricción con un error de Postgres en crudo.
      if (graded && maxScore === null) {
        throw unprocessable('Una actividad puntuable necesita nota máxima.', {
          maxScore: 'Indica la nota máxima o marca la actividad como no puntuable.',
        });
      }

      // Invariante del dominio: si no se puntúa, no hay nota máxima que valga.
      const effectiveMaxScore = graded ? maxScore : null;

      const patch = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.graded !== undefined ? { graded } : {}),
        ...(body.graded !== undefined || body.maxScore !== undefined
          ? { maxScore: effectiveMaxScore === null ? null : String(effectiveMaxScore) }
          : {}),
        ...(body.pointsAllocation !== undefined ? { pointsAllocation: body.pointsAllocation } : {}),
        ...(body.referenceSolution !== undefined
          ? { referenceSolution: body.referenceSolution }
          : {}),
        ...(body.autonomy !== undefined ? { autonomy: body.autonomy } : {}),
      };

      if (Object.keys(patch).length > 0) {
        await db
          .update(schema.activities)
          .set(patch)
          .where(eq(schema.activities.id, request.params.id));
      }

      return { activity: await requireActivity(ctx, request.params.id, currentUser(request)) };
    },
  );

  // ── Ficheros de contexto ──────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    routes.activityFiles(':id'),
    { preHandler: app.authenticate },
    async (request): Promise<ActivityFileListResponse> => {
      await requireActivity(ctx, request.params.id, currentUser(request));
      const rows = await db
        .select()
        .from(schema.activityFiles)
        .where(
          and(
            eq(schema.activityFiles.activityId, request.params.id),
            eq(schema.activityFiles.uploadComplete, true),
          ),
        )
        .orderBy(asc(schema.activityFiles.uploadedAt));
      return { items: rows.map(toActivityFile) };
    },
  );

  app.post<{ Params: { id: string } }>(
    routes.activityFiles(':id'),
    { preHandler: app.authenticate },
    async (request, reply): Promise<ActivityFileResponse> => {
      await requireActivity(ctx, request.params.id, currentUser(request));
      const body = parseOrThrow(BeginActivityFileUploadRequest, request.body, 'El fichero');

      // Sólo guardamos el contenido de lo que sabemos leer. Un binario se
      // adjunta como referencia para el profesor, pero decir que "va al modelo"
      // sería mentira: la UI se apoya en `hasContent` para no prometerlo.
      const withContent = body.hasContent && isTextFile(body.filename);

      // Una subida que se cortó a medias deja una fila incompleta que nadie va
      // a terminar. Se barren aquí, que es cuando sabemos que hay alguien
      // trabajando en esta actividad, en vez de montar una tarea periódica.
      await db
        .delete(schema.activityFiles)
        .where(
          and(
            eq(schema.activityFiles.activityId, request.params.id),
            eq(schema.activityFiles.uploadComplete, false),
            lt(schema.activityFiles.uploadedAt, new Date(Date.now() - STALE_UPLOAD_MS)),
          ),
        );

      const [row] = await db
        .insert(schema.activityFiles)
        .values({
          activityId: request.params.id,
          filename: body.filename,
          mimeType: body.mimeType,
          // Arranca a cero: el tamaño real lo mide el servidor conforme llegan
          // los trozos, no se acepta el que anuncie el cliente.
          sizeBytes: 0,
          content: withContent ? '' : null,
          // Un binario no tiene trozos que esperar: nace cerrado.
          uploadComplete: !withContent,
          // El almacenamiento de binarios sigue pendiente; los de texto no lo
          // necesitan, viven en la columna `content`.
          storagePath: null,
        })
        .returning();
      if (!row) throw unprocessable('No se ha podido registrar el fichero.');

      void reply.status(201);
      return { file: toActivityFile(row) };
    },
  );

  /**
   * Un trozo de la subida.
   *
   * Se concatena en la propia fila en vez de acumularse en memoria del proceso:
   * el API puede tener más de una réplica y el planificador ya asume que puede
   * haberlas, así que guardar el estado en el proceso haría que una subida
   * fallara según a qué réplica cayera cada trozo.
   */
  app.put<{ Params: { id: string; fileId: string } }>(
    routes.activityFileChunk(':id', ':fileId'),
    { preHandler: app.authenticate },
    async (request): Promise<AppendActivityFileChunkResponse> => {
      const activity = await requireActivity(ctx, request.params.id, currentUser(request));
      const body = parseOrThrow(AppendActivityFileChunkRequest, request.body, 'El trozo');

      const [row] = await db
        .select()
        .from(schema.activityFiles)
        .where(eq(schema.activityFiles.id, request.params.fileId))
        .limit(1);
      if (!row || row.activityId !== activity.id) {
        throw notFound('No existe ese fichero en la actividad.');
      }
      if (row.uploadComplete) {
        throw conflict('Esa subida ya está cerrada.');
      }

      const current = row.content ?? '';
      const next = current + body.content;
      const size = Buffer.byteLength(next, 'utf8');
      if (size > MAX_FILE_CONTENT_BYTES) {
        // Se borra en vez de dejarla a medias: nadie va a reanudar una subida
        // que no cabe, y la fila muerta sólo confundiría.
        await db.delete(schema.activityFiles).where(eq(schema.activityFiles.id, row.id));
        throw unprocessable('El fichero es demasiado grande.', {
          content: `El máximo son ${Math.floor(MAX_FILE_CONTENT_BYTES / (1024 * 1024))} MB.`,
        });
      }

      await db
        .update(schema.activityFiles)
        .set({ content: next, sizeBytes: size })
        .where(eq(schema.activityFiles.id, row.id));

      return { receivedBytes: size };
    },
  );

  /** Cierra la subida. Hasta aquí el fichero no se lista ni entra en el contexto. */
  app.post<{ Params: { id: string; fileId: string } }>(
    routes.activityFileComplete(':id', ':fileId'),
    { preHandler: app.authenticate },
    async (request): Promise<ActivityFileResponse> => {
      const activity = await requireActivity(ctx, request.params.id, currentUser(request));
      const [row] = await db
        .select()
        .from(schema.activityFiles)
        .where(eq(schema.activityFiles.id, request.params.fileId))
        .limit(1);
      if (!row || row.activityId !== activity.id) {
        throw notFound('No existe ese fichero en la actividad.');
      }

      if ((row.content ?? '').trim() === '') {
        await db.delete(schema.activityFiles).where(eq(schema.activityFiles.id, row.id));
        throw unprocessable('El fichero está vacío.', {
          content: 'No se ha recibido contenido.',
        });
      }

      const [updated] = await db
        .update(schema.activityFiles)
        .set({ uploadComplete: true })
        .where(eq(schema.activityFiles.id, row.id))
        .returning();
      if (!updated) throw unprocessable('No se ha podido cerrar la subida.');

      return { file: toActivityFile(updated) };
    },
  );

  /** Contenido en crudo, para verlo o editarlo sin descargarlo. */
  app.get<{ Params: { id: string; fileId: string } }>(
    routes.activityFileContent(':id', ':fileId'),
    { preHandler: app.authenticate },
    async (request): Promise<ActivityFileContentResponse> => {
      const activity = await requireActivity(ctx, request.params.id, currentUser(request));
      const [row] = await db
        .select()
        .from(schema.activityFiles)
        .where(eq(schema.activityFiles.id, request.params.fileId))
        .limit(1);
      if (!row || row.activityId !== activity.id) {
        throw notFound('No existe ese fichero en la actividad.');
      }
      return { file: toActivityFile(row), content: row.content };
    },
  );

  app.get<{ Params: { id: string; fileId: string } }>(
    routes.activityFile(':id', ':fileId'),
    { preHandler: app.authenticate },
    async (request, reply) => {
      const activity = await requireActivity(ctx, request.params.id, currentUser(request));
      const [row] = await db
        .select()
        .from(schema.activityFiles)
        .where(eq(schema.activityFiles.id, request.params.fileId))
        .limit(1);
      if (!row || row.activityId !== activity.id) {
        throw notFound('No existe ese fichero en la actividad.');
      }

      // Un fichero de texto se devuelve tal cual se subió. Uno binario nunca se
      // llegó a almacenar, y en vez de fingir una descarga lo decimos.
      const body =
        row.content ??
        [
          `Vega no guardó el contenido de este fichero.`,
          ``,
          `Actividad : ${activity.name}`,
          `Curso     : ${activity.courseName}`,
          `Fichero   : ${row.filename}`,
          `Tipo      : ${row.mimeType}`,
          `Subido    : ${row.uploadedAt.toISOString()}`,
          ``,
          `Sólo se almacena el contenido de los ficheros de texto (.tex, .md,`,
          `.txt), que son los que viajan al modelo con el contexto de la`,
          `actividad. Vuelve a subirlo en uno de esos formatos si quieres que`,
          `Vega lo tenga en cuenta al corregir.`,
          ``,
        ].join('\n');

      void reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${row.filename}"`);
      return body;
    },
  );

  app.delete<{ Params: { id: string; fileId: string } }>(
    routes.activityFile(':id', ':fileId'),
    { preHandler: app.authenticate },
    async (request, reply) => {
      const activity = await requireActivity(ctx, request.params.id, currentUser(request));
      const [row] = await db
        .select()
        .from(schema.activityFiles)
        .where(eq(schema.activityFiles.id, request.params.fileId))
        .limit(1);
      if (!row || row.activityId !== activity.id) {
        throw notFound('No existe ese fichero en la actividad.');
      }

      await db.delete(schema.activityFiles).where(eq(schema.activityFiles.id, row.id));
      void reply.status(204);
      return null;
    },
  );
}
