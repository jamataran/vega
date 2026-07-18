import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  type Activity,
  type ActivityFileListResponse,
  type ActivityFileResponse,
  type ActivityListResponse,
  type ActivityResponse,
  type DiscoverActivitiesResponse,
  type DiscoveredActivity,
  ImportActivitiesRequest,
  type ImportActivitiesResponse,
  UpdateActivityRequest,
  routes,
} from '@vega/shared';
import { schema } from '../db/client.js';
import { toActivity, toActivityFile } from '../db/mappers.js';
import { notFound, parseOrThrow, unprocessable } from '../http/errors.js';
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

  const files = await ctx.db
    .select()
    .from(schema.activityFiles)
    .where(eq(schema.activityFiles.activityId, id))
    .orderBy(asc(schema.activityFiles.uploadedAt));

  return toActivity(row, files);
}

/** Igual que `loadActivity` pero lanzando 404, que es lo que quieren las rutas. */
export async function requireActivity(ctx: AppContext, id: string): Promise<Activity> {
  const activity = await loadActivity(ctx, id);
  if (!activity) throw notFound('No existe esa actividad.');
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
    .where(inArray(schema.activityFiles.activityId, activityIds))
    .orderBy(asc(schema.activityFiles.uploadedAt));

  for (const row of rows) {
    const list = grouped.get(row.activityId) ?? [];
    list.push(row);
    grouped.set(row.activityId, list);
  }
  return grouped;
}

// ── Descubrimiento en Moodle ────────────────────────────────────────────────

/**
 * Catálogo de actividades "que hay en Moodle".
 *
 * MOCK — pendiente del conector. Esto debería salir de `listActivities()` de
 * `@vega/connector-lms`, que se está añadiendo en paralelo y todavía no existe
 * (el paquete ni siquiera carga: importa `TaskType`, que ya no está en
 * `@vega/shared`). En cuanto exista, sustituir esta constante por la llamada al
 * conector y borrar el resto de este bloque; la forma del `DiscoveredActivity`
 * ya es la definitiva, así que el cambio queda confinado aquí.
 */
const MOODLE_CATALOGUE: readonly Omit<DiscoveredActivity, 'alreadyImported'>[] = [
  {
    moodleRef: 'assign-tema04',
    name: 'Tema 04 · Derivadas y aplicaciones',
    kind: 'assignment',
    courseName: 'Academia Hipatia · Secundaria Matemáticas · Grupo de mañana',
    pendingCount: 6,
  },
  {
    moodleRef: 'assign-problema12',
    name: 'Problema 12 · Integrales definidas y áreas',
    kind: 'assignment',
    courseName: 'Academia Hipatia · Secundaria Matemáticas · Grupo de mañana',
    pendingCount: 4,
  },
  {
    moodleRef: 'assign-tema07',
    name: 'Tema 07 · Límites y continuidad',
    kind: 'assignment',
    courseName: 'Academia Hipatia · Secundaria Matemáticas · Grupo de tarde',
    pendingCount: 5,
  },
  {
    moodleRef: 'forum-didactica',
    name: 'Foro · Didáctica: ¿límite antes que derivada?',
    kind: 'forum',
    courseName: 'Academia Hipatia · Secundaria Matemáticas · Grupo de mañana',
    pendingCount: 3,
  },
  {
    moodleRef: 'forum-dudas-analisis',
    name: 'Foro · Dudas de análisis entre compañeros',
    kind: 'forum',
    courseName: 'Academia Hipatia · Secundaria Matemáticas · Grupo de tarde',
    pendingCount: 4,
  },
  {
    moodleRef: 'assign-simulacro-global',
    name: 'Simulacro global · Convocatoria de junio',
    kind: 'assignment',
    courseName: 'Academia Hipatia · Secundaria Matemáticas · Grupo de tarde',
    pendingCount: 0,
  },
  {
    moodleRef: 'forum-presentacion',
    name: 'Foro · Presentación del curso',
    kind: 'forum',
    courseName: 'Academia Hipatia · Secundaria Matemáticas · Grupo de mañana',
    pendingCount: 0,
  },
];

/** `slug` estable a partir de la referencia de Moodle. */
function slugFromMoodleRef(moodleRef: string): string {
  const cleaned = moodleRef
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? `actividad-${Date.now()}` : cleaned;
}

// ── Subida de ficheros de contexto ──────────────────────────────────────────

/**
 * MOCK — el almacenamiento real está pendiente.
 *
 * No montamos ni disco ni S3: sólo registramos los metadatos en
 * `activity_files` y al descargar servimos un contenido de marcador. Por eso el
 * alta acepta JSON con los metadatos y no `multipart/form-data`; cuando haya
 * almacenamiento de verdad, esta ruta pasará a recibir el fichero y a rellenar
 * `storage_path`, que ya existe en el esquema y hoy se queda a `null`.
 */
const UploadActivityFileRequest = z.object({
  filename: z.string().min(1, 'El fichero necesita un nombre'),
  mimeType: z.string().min(1).default('application/octet-stream'),
  sizeBytes: z.number().int().min(0).default(0),
});

// ── Rutas ───────────────────────────────────────────────────────────────────

export async function activityRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;

  // ── Listado ───────────────────────────────────────────────────────────────
  app.get(
    routes.activities,
    { preHandler: app.authenticate },
    async (): Promise<ActivityListResponse> => {
      const rows = await db.select().from(schema.activities).orderBy(asc(schema.activities.slug));
      const files = await filesByActivity(
        ctx,
        rows.map((row) => row.id),
      );
      return { items: rows.map((row) => toActivity(row, files.get(row.id) ?? [])) };
    },
  );

  // ── Descubrir en Moodle ───────────────────────────────────────────────────
  // Antes que `/:id`: Fastify da prioridad al segmento estático, pero dejarlo
  // aquí arriba evita sorpresas si alguien reordena.
  app.get(
    routes.discoverActivities,
    { preHandler: app.authenticate },
    async (): Promise<DiscoverActivitiesResponse> => {
      const existing = await db
        .select({ moodleRef: schema.activities.moodleRef })
        .from(schema.activities);
      const imported = new Set(
        existing.map((row) => row.moodleRef).filter((ref): ref is string => ref !== null),
      );

      return {
        items: MOODLE_CATALOGUE.map((entry) => ({
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
      const body = parseOrThrow(ImportActivitiesRequest, request.body, 'La selección');
      const wanted = [...new Set(body.moodleRefs)];

      const unknown = wanted.filter(
        (ref) => !MOODLE_CATALOGUE.some((entry) => entry.moodleRef === ref),
      );
      if (unknown.length > 0) {
        throw unprocessable(
          `Estas actividades ya no están en Moodle: ${unknown.join(', ')}.`,
          Object.fromEntries(unknown.map((ref) => [ref, 'No existe en Moodle'])),
        );
      }

      // Idempotente: reimportar una que ya está dada de alta la devuelve tal
      // cual, sin duplicarla ni pisar lo que el profesor haya configurado.
      const already = await db
        .select()
        .from(schema.activities)
        .where(inArray(schema.activities.moodleRef, wanted));
      const byRef = new Map(already.map((row) => [row.moodleRef, row]));

      const toCreate = MOODLE_CATALOGUE.filter(
        (entry) => wanted.includes(entry.moodleRef) && !byRef.has(entry.moodleRef),
      );

      if (toCreate.length > 0) {
        const inserted = await db
          .insert(schema.activities)
          .values(
            toCreate.map((entry) => ({
              slug: slugFromMoodleRef(entry.moodleRef),
              name: entry.name,
              kind: entry.kind,
              courseName: entry.courseName,
              moodleRef: entry.moodleRef,
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
          // Carrera entre dos importaciones simultáneas: el índice único de
          // `slug` decide y la segunda no rompe.
          .onConflictDoNothing({ target: schema.activities.slug })
          .returning();
        for (const row of inserted) byRef.set(row.moodleRef, row);
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
      return { activity: await requireActivity(ctx, request.params.id) };
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

      return { activity: await requireActivity(ctx, request.params.id) };
    },
  );

  // ── Ficheros de contexto ──────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    routes.activityFiles(':id'),
    { preHandler: app.authenticate },
    async (request): Promise<ActivityFileListResponse> => {
      await requireActivity(ctx, request.params.id);
      const rows = await db
        .select()
        .from(schema.activityFiles)
        .where(eq(schema.activityFiles.activityId, request.params.id))
        .orderBy(asc(schema.activityFiles.uploadedAt));
      return { items: rows.map(toActivityFile) };
    },
  );

  app.post<{ Params: { id: string } }>(
    routes.activityFiles(':id'),
    { preHandler: app.authenticate },
    async (request, reply): Promise<ActivityFileResponse> => {
      await requireActivity(ctx, request.params.id);
      const body = parseOrThrow(UploadActivityFileRequest, request.body, 'El fichero');

      const [row] = await db
        .insert(schema.activityFiles)
        .values({
          activityId: request.params.id,
          filename: body.filename,
          mimeType: body.mimeType,
          sizeBytes: body.sizeBytes,
          // MOCK: sin almacenamiento real todavía, no hay ruta que guardar.
          storagePath: null,
        })
        .returning();
      if (!row) throw unprocessable('No se ha podido registrar el fichero.');

      void reply.status(201);
      return { file: toActivityFile(row) };
    },
  );

  // Descarga. MOCK: servimos un marcador con los metadatos reales en vez del
  // contenido, que nunca se llegó a almacenar.
  app.get<{ Params: { id: string; fileId: string } }>(
    routes.activityFile(':id', ':fileId'),
    { preHandler: app.authenticate },
    async (request, reply) => {
      const activity = await requireActivity(ctx, request.params.id);
      const [row] = await db
        .select()
        .from(schema.activityFiles)
        .where(eq(schema.activityFiles.id, request.params.fileId))
        .limit(1);
      if (!row || row.activityId !== activity.id) {
        throw notFound('No existe ese fichero en la actividad.');
      }

      const body = [
        `Fichero de contexto de Vega (marcador)`,
        ``,
        `Actividad : ${activity.name}`,
        `Curso     : ${activity.courseName}`,
        `Fichero   : ${row.filename}`,
        `Tipo      : ${row.mimeType}`,
        `Tamaño    : ${row.sizeBytes} bytes`,
        `Subido    : ${row.uploadedAt.toISOString()}`,
        ``,
        `El almacenamiento real de ficheros está pendiente: Vega guarda hoy sólo`,
        `los metadatos en la tabla activity_files. Este texto es lo que se sirve`,
        `mientras tanto.`,
        ``,
      ].join('\n');

      void reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${row.filename}.txt"`);
      return body;
    },
  );

  app.delete<{ Params: { id: string; fileId: string } }>(
    routes.activityFile(':id', ':fileId'),
    { preHandler: app.authenticate },
    async (request, reply) => {
      const activity = await requireActivity(ctx, request.params.id);
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
