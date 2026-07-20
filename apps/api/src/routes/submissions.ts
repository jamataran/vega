import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  hasStudentFile,
  routes,
  type ActivityKind,
  type CorrectionResponse,
  QueueQuery,
  type QueueCounts,
  type QueueItem,
  type QueueResponse,
  SaveCorrectionRequest,
  type SubmissionDetail,
  type SubmissionStatus,
} from '@vega/shared';
import { currentUser } from '../auth/plugin.js';
import { schema } from '../db/client.js';
import { toCorrection, toIso, toSubmission, toTranscription } from '../db/mappers.js';
import { buildFeedbackPdf, feedbackFilename } from '../feedback/pdf.js';
import { badRequest, conflict, notFound, parseOrThrow, unprocessable } from '../http/errors.js';
import { requireActivity } from './activities.js';
import { visibleActivityIds } from '../auth/scope.js';
import type { TokenPayload } from '../auth/plugin.js';
import type { AppContext } from '../context.js';

/** URLs de las páginas escaneadas. Con el conector mock son SVG generados al vuelo. */
function scanUrls(submissionId: string, pageCount: number): string[] {
  return Array.from({ length: pageCount }, (_, i) => `/api/scans/${submissionId}/${i + 1}.svg`);
}

/** Por debajo de este umbral, la UI señala la corrección como poco fiable. */
const LOW_CONFIDENCE = 0.75;

interface QueueRow {
  id: string;
  activity_id: string;
  student_ref: string;
  student_alias: string | null;
  status: SubmissionStatus;
  original_filename: string | null;
  page_count: number;
  text_content: string | null;
  error_message: string | null;
  submitted_at: Date | string;
  updated_at: Date | string;
  a_slug: string;
  a_name: string;
  a_kind: ActivityKind;
  a_course_name: string;
  a_graded: boolean;
  a_max_score: string | null;
  c_confidence: string | null;
  score: string | null;
  low_confidence_items: string | null;
  flag_count: string | null;
  total_count: string;
}

export async function submissionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, sql } = ctx;

  // ── Cola de revisión ──────────────────────────────────────────────────────
  app.get(
    routes.queue,
    { preHandler: app.authenticate },
    async (request): Promise<QueueResponse> => {
      const query = parseOrThrow(QueueQuery, request.query, 'Los filtros de la cola');
      const offset = (query.page - 1) * query.pageSize;

      // Un profesor sólo ve las entregas de sus cursos. No es sólo un permiso:
      // son trabajos de alumnos concretos y enseñárselos a otro docente es un
      // asunto de protección de datos.
      const visible = await visibleActivityIds(ctx, currentUser(request));

      // Lista blanca: el orden viene de la query, así que nunca se interpola texto libre.
      const orderColumn = {
        submittedAt: sql`s.submitted_at`,
        confidence: sql`c.confidence`,
        score: sql`agg.score`,
      }[query.sort];
      const direction = query.order === 'asc' ? sql`ASC NULLS LAST` : sql`DESC NULLS LAST`;

      const rows = await sql<QueueRow[]>`
        SELECT
          s.*,
          a.slug          AS a_slug,
          a.name          AS a_name,
          a.kind          AS a_kind,
          a.course_name   AS a_course_name,
          a.graded        AS a_graded,
          a.max_score     AS a_max_score,
          c.confidence    AS c_confidence,
          agg.score,
          agg.low_confidence_items,
          COALESCE(jsonb_array_length(t.flags), 0) AS flag_count,
          COUNT(*) OVER () AS total_count
        FROM submissions s
        JOIN activities a ON a.id = s.activity_id
        LEFT JOIN corrections c ON c.submission_id = s.id
        LEFT JOIN transcriptions t ON t.submission_id = s.id
        LEFT JOIN LATERAL (
          SELECT
            SUM(COALESCE(ci.teacher_points, ci.ai_points))                       AS score,
            COUNT(*) FILTER (WHERE ci.confidence < ${LOW_CONFIDENCE})            AS low_confidence_items
          FROM correction_items ci
          WHERE ci.correction_id = c.id
        ) agg ON true
        WHERE TRUE
          ${visible === null ? sql`` : sql`AND s.activity_id = ANY(${visible}::uuid[])`}
          ${query.status ? sql`AND s.status = ${query.status}` : sql``}
          ${query.activityId ? sql`AND s.activity_id = ${query.activityId}` : sql``}
          ${query.kind ? sql`AND a.kind = ${query.kind}` : sql``}
          ${
            query.q
              ? sql`AND (s.student_alias ILIKE ${`%${query.q}%`} OR s.student_ref ILIKE ${`%${query.q}%`})`
              : sql``
          }
        ORDER BY ${orderColumn} ${direction}, s.id
        LIMIT ${query.pageSize} OFFSET ${offset}
      `;

      const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;

      const items: QueueItem[] = rows.map((row) => {
        const maxScore = row.a_max_score === null ? null : Number(row.a_max_score);
        // En una actividad no puntuable no hay nota que enseñar, aunque la
        // consulta agregue cero apartados.
        const score =
          !row.a_graded || row.score === null ? null : Math.round(Number(row.score) * 100) / 100;

        return {
          submission: {
            id: row.id,
            activityId: row.activity_id,
            studentRef: row.student_ref,
            studentAlias: row.student_alias,
            status: row.status,
            originalFilename: row.original_filename,
            pageCount: row.page_count,
            textContent: row.text_content,
            submittedAt: toIso(row.submitted_at),
            updatedAt: toIso(row.updated_at),
            errorMessage: row.error_message,
          },
          activity: {
            id: row.activity_id,
            slug: row.a_slug,
            name: row.a_name,
            kind: row.a_kind,
            courseName: row.a_course_name,
            graded: row.a_graded,
            maxScore,
          },
          score,
          maxScore,
          confidence: row.c_confidence === null ? null : Number(row.c_confidence),
          flagCount: Number(row.flag_count ?? 0),
          lowConfidenceItems: Number(row.low_confidence_items ?? 0),
        };
      });

      return {
        items,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
      };
    },
  );

  // ── Recuento por estado, para las pestañas ────────────────────────────────
  app.get(
    routes.queueCounts,
    { preHandler: app.authenticate },
    async (request): Promise<QueueCounts> => {
      const visible = await visibleActivityIds(ctx, currentUser(request));
      const rows = await sql<{ status: SubmissionStatus; count: string }[]>`
        SELECT status, COUNT(*) AS count
        FROM submissions
        WHERE TRUE
          ${visible === null ? sql`` : sql`AND activity_id = ANY(${visible}::uuid[])`}
        GROUP BY status
      `;
    // Devolvemos siempre todas las claves para que el front no tenga que
    // distinguir entre "cero" y "no vino".
    const counts = {
      pending: 0,
      transcribing: 0,
      transcribed: 0,
      grading: 0,
      graded: 0,
      validated: 0,
      published: 0,
      error: 0,
    } satisfies QueueCounts;
      for (const row of rows) counts[row.status] = Number(row.count);
      return counts;
    },
  );

  // ── Detalle ───────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    routes.submission(':id'),
    { preHandler: app.authenticate },
    async (request): Promise<SubmissionDetail> => {
      return loadDetail(ctx, request.params.id, currentUser(request));
    },
  );

  // ── PDF de feedback ───────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    routes.feedbackFile(':id'),
    { preHandler: app.authenticate },
    async (request, reply) => {
      const detail = await loadDetail(ctx, request.params.id, currentUser(request));
      if (!detail.correction) {
        throw conflict('Esta entrega todavía no tiene corrección que descargar.');
      }

      const pdf = await buildFeedbackPdf({
        submission: detail.submission,
        activity: detail.activity,
        correction: detail.correction,
        transcription: detail.transcription,
      });

      const filename = feedbackFilename({
        activity: detail.activity,
        submission: detail.submission,
      });

      void reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Content-Length', String(pdf.byteLength));
      return Buffer.from(pdf);
    },
  );

  // ── Guardar borrador de corrección ────────────────────────────────────────
  app.patch<{ Params: { id: string } }>(
    routes.saveCorrection(':id'),
    { preHandler: app.authenticate },
    async (request): Promise<CorrectionResponse> => {
      const body = parseOrThrow(SaveCorrectionRequest, request.body, 'La corrección');
      await applyTeacherEdits(ctx, request.params.id, body);
      return loadCorrectionResponse(ctx, request.params.id, currentUser(request));
    },
  );

  // ── Validar ───────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    routes.validate(':id'),
    { preHandler: app.authenticate },
    async (request): Promise<CorrectionResponse> => {
      const body = parseOrThrow(SaveCorrectionRequest, request.body, 'La corrección');
      const session = currentUser(request);
      const submissionId = request.params.id;

      await applyTeacherEdits(ctx, submissionId, body);

      const [correction] = await db
        .select()
        .from(schema.corrections)
        .where(eq(schema.corrections.submissionId, submissionId))
        .limit(1);
      if (!correction) throw notFound('Esta entrega todavía no tiene corrección.');
      if (correction.publishedAt) {
        throw conflict('La corrección ya está publicada; no se puede modificar.');
      }

      const now = new Date();
      await db
        .update(schema.corrections)
        .set({ validatedBy: session.sub, validatedAt: now })
        .where(eq(schema.corrections.id, correction.id));
      await db
        .update(schema.submissions)
        .set({ status: 'validated', updatedAt: now })
        .where(eq(schema.submissions.id, submissionId));

      return loadCorrectionResponse(ctx, submissionId, currentUser(request));
    },
  );

  // ── Publicar en Moodle ────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    routes.publish(':id'),
    { preHandler: app.authenticate },
    async (request): Promise<CorrectionResponse> => {
      const submissionId = request.params.id;

      const [submission] = await db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, submissionId))
        .limit(1);
      if (!submission) throw notFound('No existe esa entrega.');

      // La regla de oro del producto: nada llega al alumno sin validación
      // previa. La excepción son los modos de autonomía, y ésos publican solos
      // desde el lote, no por esta ruta.
      if (submission.status !== 'validated') {
        throw conflict('Sólo se pueden publicar entregas que el profesor haya validado.');
      }

      const now = new Date();
      // TODO(vega): aquí irá la llamada real al conector LMS (publishGrade +
      // publishFeedbackFile). Con LMS_CONNECTOR=mock nos limitamos a marcarla.
      await db
        .update(schema.corrections)
        .set({ publishedAt: now, publishedAutomatically: false })
        .where(eq(schema.corrections.submissionId, submissionId));
      await db
        .update(schema.submissions)
        .set({ status: 'published', updatedAt: now })
        .where(eq(schema.submissions.id, submissionId));

      return loadCorrectionResponse(ctx, submissionId, currentUser(request));
    },
  );

  // ── Reprocesar ────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    routes.reprocess(':id'),
    { preHandler: app.authenticate },
    async (request) => {
      const submissionId = request.params.id;
      const [submission] = await db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, submissionId))
        .limit(1);
      if (!submission) throw notFound('No existe esa entrega.');
      if (submission.status === 'published') {
        throw conflict('Una entrega ya publicada no se puede reprocesar.');
      }

      // Volver a 'pending' basta: el siguiente lote la recogerá.
      await db
        .update(schema.submissions)
        .set({ status: 'pending', errorMessage: null, updatedAt: new Date() })
        .where(eq(schema.submissions.id, submissionId));

      return { queued: true };
    },
  );
}

// ── Ayudantes ───────────────────────────────────────────────────────────────

async function loadDetail(
  ctx: AppContext,
  submissionId: string,
  user: TokenPayload,
): Promise<SubmissionDetail> {
  const { db } = ctx;

  const [submission] = await db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.id, submissionId))
    .limit(1);
  if (!submission) throw notFound('No existe esa entrega.');

  const activity = await requireActivity(ctx, submission.activityId, user);

  const [transcription] = await db
    .select()
    .from(schema.transcriptions)
    .where(eq(schema.transcriptions.submissionId, submissionId))
    .limit(1);

  const [correctionRow] = await db
    .select()
    .from(schema.corrections)
    .where(eq(schema.corrections.submissionId, submissionId))
    .limit(1);

  const items = correctionRow
    ? await db
        .select()
        .from(schema.correctionItems)
        .where(eq(schema.correctionItems.correctionId, correctionRow.id))
        .orderBy(asc(schema.correctionItems.position))
    : [];

  return {
    submission: toSubmission(submission),
    activity,
    transcription: transcription ? toTranscription(transcription) : null,
    correction: correctionRow ? toCorrection(correctionRow, items) : null,
    // Una actividad sin fichero del alumno (un foro) no tiene nada que escanear.
    scanUrls: hasStudentFile(activity.kind) ? scanUrls(submission.id, submission.pageCount) : [],
  };
}

async function loadCorrectionResponse(
  ctx: AppContext,
  submissionId: string,
  user: TokenPayload,
): Promise<CorrectionResponse> {
  const detail = await loadDetail(ctx, submissionId, user);
  if (!detail.correction) throw notFound('Esta entrega todavía no tiene corrección.');
  return { correction: detail.correction, submission: detail.submission };
}

/**
 * Vuelca las ediciones del profesor sobre la corrección.
 *
 * Todo en una transacción: si un apartado se sale de rango, no queremos dejar
 * la corrección medio guardada.
 */
async function applyTeacherEdits(
  ctx: AppContext,
  submissionId: string,
  body: SaveCorrectionRequest,
): Promise<void> {
  const { db } = ctx;

  const [submission] = await db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.id, submissionId))
    .limit(1);
  if (!submission) throw notFound('No existe esa entrega.');

  const [activity] = await db
    .select()
    .from(schema.activities)
    .where(eq(schema.activities.id, submission.activityId))
    .limit(1);
  if (!activity) throw notFound('La actividad de esta entrega ya no existe.');

  const [correction] = await db
    .select()
    .from(schema.corrections)
    .where(eq(schema.corrections.submissionId, submissionId))
    .limit(1);
  if (!correction) throw notFound('Esta entrega todavía no tiene corrección.');
  if (correction.publishedAt) {
    throw conflict('La corrección ya está publicada; no se puede modificar.');
  }

  // En una actividad no puntuable no hay apartados ni nota: sólo el documento
  // de corrección. Si llegan puntos, es un error del cliente y conviene decirlo.
  if (!activity.graded && body.items.length > 0) {
    throw unprocessable('Esta actividad no se puntúa: no admite reparto de puntos.', {
      items: 'La actividad no es puntuable',
    });
  }

  const ids = body.items.map((item) => item.id);
  const existing = ids.length
    ? await db
        .select()
        .from(schema.correctionItems)
        .where(
          and(
            eq(schema.correctionItems.correctionId, correction.id),
            inArray(schema.correctionItems.id, ids),
          ),
        )
    : [];
  const byId = new Map(existing.map((item) => [item.id, item]));

  // Validamos todo antes de escribir nada. Sólo aplica a lo puntuable.
  for (const patch of body.items) {
    const item = byId.get(patch.id);
    if (!item) throw badRequest(`El apartado ${patch.id} no pertenece a esta corrección.`);
    if (patch.teacherPoints !== null && patch.teacherPoints > Number(item.maxPoints)) {
      throw badRequest(`El apartado "${item.label}" admite como máximo ${item.maxPoints} puntos.`, {
        [patch.id]: `Máximo ${item.maxPoints}`,
      });
    }
  }

  await db.transaction(async (tx) => {
    for (const patch of body.items) {
      await tx
        .update(schema.correctionItems)
        .set({
          teacherPoints: patch.teacherPoints === null ? null : String(patch.teacherPoints),
          teacherFeedback: patch.teacherFeedback,
        })
        .where(eq(schema.correctionItems.id, patch.id));
    }
    await tx
      .update(schema.corrections)
      .set({
        teacherSummary: body.teacherSummary,
        // El LaTeX que edita el profesor manda sobre el de la IA; `null` deja
        // el original (ver `effectiveLatex`).
        teacherLatex: body.teacherLatex,
      })
      .where(eq(schema.corrections.id, correction.id));
    await tx
      .update(schema.submissions)
      .set({ updatedAt: new Date() })
      .where(eq(schema.submissions.id, submissionId));
  });
}
