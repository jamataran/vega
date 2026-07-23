import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import {
  hasStudentFile,
  routes,
  type ActivityKind,
  type CorrectionResponse,
  QueueQuery,
  ParkSubmissionRequest,
  ReprocessSubmissionRequest,
  type QueueCounts,
  type QueueItem,
  type QueueResponse,
  SaveCorrectionRequest,
  type SubmissionDetail,
  type SubmissionStatus,
} from '@vega/shared';
import { currentUser } from '../auth/plugin.js';
import { schema } from '../db/client.js';
import { toCorrection, toIso, toStudent, toSubmission, toTranscription } from '../db/mappers.js';
import { buildFeedbackPdf, feedbackFilename } from '../feedback/pdf.js';
import { badRequest, conflict, notFound, parseOrThrow, unprocessable } from '../http/errors.js';
import { asHttpError, connectorForUser } from '../lms/factory.js';
import { publishToLms, recordPublication } from '../publish/publish.js';
import { requireActivity } from './activities.js';
import { assertActivityAccess, visibleActivityIds } from '../auth/scope.js';
import { FileStore } from '../storage/files.js';
import type { TokenPayload } from '../auth/plugin.js';
import type { AppContext } from '../context.js';
import { getSettings } from '../settings/service.js';
import { prepareBatchRun, runBatch } from './batch.js';

const REPROCESSABLE_STATUSES = ['graded', 'parked', 'error'] as const;

export function isReprocessableStatus(status: SubmissionStatus): boolean {
  return (REPROCESSABLE_STATUSES as readonly SubmissionStatus[]).includes(status);
}

interface QueueRow {
  id: string;
  activity_id: string;
  student_ref: string;
  student_alias: string | null;
  status: SubmissionStatus;
  batch_run_id: string | null;
  parked_reason: string | null;
  parked_by: string | null;
  triage_label: QueueItem['submission']['triageLabel'];
  triage_confidence: string | null;
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
  verification_issue_count: string | null;
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
      const { ai } = await getSettings(ctx);

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
          COALESCE(jsonb_array_length(c.verification->'issues'), 0) AS verification_issue_count,
          COUNT(*) OVER () AS total_count
        FROM submissions s
        JOIN activities a ON a.id = s.activity_id
        LEFT JOIN corrections c ON c.submission_id = s.id
        LEFT JOIN transcriptions t ON t.submission_id = s.id
        LEFT JOIN LATERAL (
          SELECT
            SUM(COALESCE(ci.teacher_points, ci.ai_points))                       AS score,
            COUNT(*) FILTER (WHERE ci.confidence < ${ai.lowConfidenceThreshold}) AS low_confidence_items
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
            batchRunId: row.batch_run_id,
            parkedReason: row.parked_reason,
            parkedBy: row.parked_by,
            triageLabel: row.triage_label,
            triageConfidence:
              row.triage_confidence === null ? null : Number(row.triage_confidence),
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
          lowConfidence:
            row.c_confidence !== null && Number(row.c_confidence) < ai.lowConfidenceThreshold,
          flagCount: Number(row.flag_count ?? 0),
          lowConfidenceItems: Number(row.low_confidence_items ?? 0),
          verificationIssueCount: Number(row.verification_issue_count ?? 0),
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
      parked: 0,
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

      const [storedOriginal] = await db
        .select({
          storagePath: schema.submissions.storagePath,
          mediaType: schema.submissions.mediaType,
        })
        .from(schema.submissions)
        .where(eq(schema.submissions.id, request.params.id))
        .limit(1);

      const pdf = await buildFeedbackPdf({
        submission: detail.submission,
        activity: detail.activity,
        correction: detail.correction,
        transcription: detail.transcription,
        originalFile: await readStoredOriginal(ctx, storedOriginal),
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
      await db.transaction(async (tx) => {
        // Reclamar el estado dentro de la misma transacción impide que un
        // reproceso o aparcado simultáneo quede sobrescrito por esta validación.
        const [claimed] = await tx
          .update(schema.submissions)
          .set({ status: 'validated', updatedAt: now })
          .where(
            and(
              eq(schema.submissions.id, submissionId),
              eq(schema.submissions.status, 'graded'),
            ),
          )
          .returning({ id: schema.submissions.id });
        if (!claimed) {
          throw conflict('El estado de la entrega ha cambiado; actualiza la página antes de validar.');
        }

        const [validatedCorrection] = await tx
          .update(schema.corrections)
          .set({ validatedBy: session.sub, validatedAt: now })
          .where(
            and(
              eq(schema.corrections.id, correction.id),
              isNull(schema.corrections.publishedAt),
            ),
          )
          .returning({ id: schema.corrections.id });
        if (!validatedCorrection) {
          throw conflict('La corrección ya no está disponible para validar.');
        }
      });

      return loadCorrectionResponse(ctx, submissionId, currentUser(request));
    },
  );

  // ── Publicar en el LMS ────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    routes.publish(':id'),
    { preHandler: app.authenticate },
    async (request): Promise<CorrectionResponse> => {
      const submissionId = request.params.id;
      const user = currentUser(request);

      const [submissionRow] = await db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, submissionId))
        .limit(1);
      if (!submissionRow) throw notFound('No existe esa entrega.');

      // La regla de oro del producto: nada llega al alumno sin validación
      // previa. La excepción son los modos de autonomía, y ésos publican solos
      // desde el lote, no por esta ruta.
      //
      // `error` también entra: una publicación que falló a mitad deja ahí la
      // entrega, y reintentar no debe obligar al profesor a validar otra vez
      // algo que ya validó (HU-17, RN-7).
      if (submissionRow.status !== 'validated' && submissionRow.status !== 'error') {
        throw conflict('Sólo se pueden publicar entregas que el profesor haya validado.');
      }

      const detail = await loadDetail(ctx, submissionId, user);
      const correction = detail.correction;
      if (!correction) throw notFound('Esta entrega todavía no tiene corrección.');
      if (correction.validatedAt === null) {
        throw conflict('Sólo se pueden publicar entregas que el profesor haya validado.');
      }

      const [correctionRow] = await db
        .select()
        .from(schema.corrections)
        .where(eq(schema.corrections.id, correction.id))
        .limit(1);
      if (!correctionRow) throw notFound('Esta entrega todavía no tiene corrección.');

      // El `remoteId` es la identidad de la entrega en el LMS y lo dio la
      // ingesta. Sin él —entregas sembradas, o anteriores a que hubiera
      // ingesta— no hay a qué publicar: decirlo es mejor que fingir un éxito.
      if (submissionRow.remoteId === null) {
        throw conflict(
          'Esta entrega no viene del LMS (no tiene referencia remota), así que no hay dónde ' +
            'publicarla. Ocurre con los datos de ejemplo y con las entregas anteriores a la ingesta.',
        );
      }

      // Se publica con la credencial de quien importó la actividad, que es la
      // misma con la que se ingirió. Publicar con la del profesor que pulsa el
      // botón fallaría en cuanto dos docentes comparten un curso y sólo uno
      // tiene permiso de calificación en Moodle.
      const [activityRow] = await db
        .select({ importedBy: schema.activities.importedBy, moodleRef: schema.activities.moodleRef })
        .from(schema.activities)
        .where(eq(schema.activities.id, submissionRow.activityId))
        .limit(1);

      const connector = await connectorForUser(ctx, activityRow?.importedBy ?? user.sub);

      const ref = {
        activity: {
          slug: detail.activity.slug,
          lmsRef: activityRow?.moodleRef ?? null,
          kind: detail.activity.kind,
        },
        studentRef: detail.submission.studentRef,
        remoteId: submissionRow.remoteId,
      };

      let outcome;
      try {
        outcome = await publishToLms(connector, ref, {
          submission: detail.submission,
          activity: detail.activity,
          correction,
          alreadyPublished: {
            grade: correctionRow.gradePublishedAt !== null,
            file: correctionRow.feedbackFilePublishedAt !== null,
          },
          transcription: detail.transcription,
          originalFile: await readStoredOriginal(ctx, submissionRow),
        });
      } catch (error) {
        // La nota no ha llegado: nada ha cambiado en el LMS. La entrega queda
        // en `error` con el motivo y se puede reintentar sin volver a validar.
        const message = asHttpError(error).message;
        await db
          .update(schema.submissions)
          .set({ status: 'error', errorMessage: message.slice(0, 500), updatedAt: new Date() })
          .where(eq(schema.submissions.id, submissionId));
        throw asHttpError(error);
      }

      await recordPublication(ctx, correctionRow, submissionId, outcome);

      return loadCorrectionResponse(ctx, submissionId, user);
    },
  );

  // ── Reprocesar ────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    routes.reprocess(':id'),
    { preHandler: app.authenticate },
    async (request, reply) => {
      const submissionId = request.params.id;
      const body = parseOrThrow(ReprocessSubmissionRequest, request.body ?? {}, 'El reproceso');
      const user = currentUser(request);
      const [submission] = await db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, submissionId))
        .limit(1);
      if (!submission) throw notFound('No existe esa entrega.');
      await assertActivityAccess(ctx, user, submission.activityId);
      if (!isReprocessableStatus(submission.status)) {
        if (submission.status === 'validated') {
          throw conflict('Una corrección validada queda fijada: sólo se puede publicar.');
        }
        if (submission.status === 'published') {
          throw conflict('Una entrega ya publicada no se puede reprocesar.');
        }
        throw conflict('Esta entrega ya está pendiente o dentro de un proceso de corrección.');
      }

      const [[activity], [correction]] = await Promise.all([
        db
          .select({ kind: schema.activities.kind })
          .from(schema.activities)
          .where(eq(schema.activities.id, submission.activityId))
          .limit(1),
        db
          .select({ validatedAt: schema.corrections.validatedAt })
          .from(schema.corrections)
          .where(eq(schema.corrections.submissionId, submissionId))
          .limit(1),
      ]);
      if (!activity) throw notFound('La actividad de esta entrega ya no existe.');
      if (correction?.validatedAt) {
        throw conflict('Una corrección validada queda fijada: sólo se puede publicar.');
      }

      if (body.scope === 'grade_only' && hasStudentFile(activity.kind)) {
        const [transcription] = await db
          .select({ passCount: schema.transcriptions.passCount })
          .from(schema.transcriptions)
          .where(eq(schema.transcriptions.submissionId, submissionId))
          .limit(1);
        if (!transcription || transcription.passCount < 2) {
          throw conflict(
            'No hay una lectura doble completa que reutilizar. Elige «Lectura y corrección».',
          );
        }
      }

      // Reservar primero el ejecutor garantiza que un 409 por otro lote no
      // deja la entrega en un estado intermedio que nadie vaya a recoger.
      const run = await prepareBatchRun(ctx, user.sub, [activity.kind]);

      // En grade_only conservamos la lectura ya pagada. El lote reconoce el
      // estado grading y reutiliza la transcripción persistida. Se limpia el
      // lote anterior: el nuevo se asigna justo cuando empieza esta entrega.
      let claimed: { id: string } | undefined;
      try {
        [claimed] = await db
          .update(schema.submissions)
          .set({
            status: body.scope === 'grade_only' ? 'grading' : 'pending',
            batchRunId: null,
            errorMessage: null,
            parkedReason: null,
            parkedBy: null,
            triageLabel: null,
            triageConfidence: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.submissions.id, submissionId),
              inArray(schema.submissions.status, [...REPROCESSABLE_STATUSES]),
            ),
          )
          .returning({ id: schema.submissions.id });
      } catch (error) {
        await closeUnusedBatch(ctx, run.id);
        throw error;
      }

      if (!claimed) {
        await closeUnusedBatch(ctx, run.id);
        throw conflict('El estado de la entrega ha cambiado; actualiza la página antes de reprocesar.');
      }

      void runBatch(ctx, user.sub, app.log, {
        preparedRun: run,
        kinds: [activity.kind],
        submissionId,
        ingest: false,
      }).catch((error) => {
        app.log.error(
          { err: error, batchRunId: run.id, submissionId },
          'El reproceso individual en segundo plano ha fallado',
        );
      });

      reply.code(202);
      return { queued: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    routes.park(':id'),
    { preHandler: app.authenticate },
    async (request) => {
      const body = parseOrThrow(ParkSubmissionRequest, request.body, 'El aparcado');
      const [submission] = await db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, request.params.id))
        .limit(1);
      if (!submission) throw notFound('No existe esa entrega.');
      const user = currentUser(request);
      await assertActivityAccess(ctx, user, submission.activityId);
      if (submission.status === 'validated') {
        throw conflict('Una corrección validada queda fijada: sólo se puede publicar.');
      }
      if (submission.status === 'published') {
        throw conflict('Una entrega publicada no se puede aparcar.');
      }
      if (submission.status !== 'graded' && submission.status !== 'error') {
        throw conflict('Sólo se pueden aparcar entregas pendientes de decisión docente.');
      }
      const [parked] = await db
        .update(schema.submissions)
        .set({
          status: 'parked',
          parkedReason: body.reason,
          parkedBy: user.sub,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.submissions.id, submission.id),
            inArray(schema.submissions.status, ['graded', 'error']),
          ),
        )
        .returning({ id: schema.submissions.id });
      if (!parked) {
        throw conflict('El estado de la entrega ha cambiado; actualiza la página antes de aparcar.');
      }
      return { queued: false };
    },
  );

  // ── Descartar lo que propuso la IA ────────────────────────────────────────
  //
  // Distinto de reprocesar, y por eso es otra ruta: reprocesar vuelve a llamar
  // al modelo **ahora** y cuesta dinero en ese momento; descartar sólo tira la
  // propuesta y devuelve la entrega a la cola, para que la recoja el siguiente
  // proceso. Es la salida del profesor que mira una corrección, decide que no
  // vale nada y no quiere ni validarla ni aparcarla.
  app.post<{ Params: { id: string } }>(
    routes.discardCorrection(':id'),
    { preHandler: app.authenticate },
    async (request) => {
      const submissionId = request.params.id;
      const [submission] = await db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, submissionId))
        .limit(1);
      if (!submission) throw notFound('No existe esa entrega.');
      await assertActivityAccess(ctx, currentUser(request), submission.activityId);

      if (submission.status === 'published') {
        throw conflict('Lo que ya vio el alumno no se puede descartar desde aquí.');
      }
      if (submission.status === 'validated') {
        throw conflict('Una corrección validada queda fijada: sólo se puede publicar.');
      }
      if (!isReprocessableStatus(submission.status)) {
        throw conflict('Esta entrega ya está pendiente o dentro de un proceso de corrección.');
      }

      await db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(schema.submissions)
          .set({
            status: 'pending',
            batchRunId: null,
            errorMessage: null,
            parkedReason: null,
            parkedBy: null,
            triageLabel: null,
            triageConfidence: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.submissions.id, submissionId),
              inArray(schema.submissions.status, [...REPROCESSABLE_STATUSES]),
            ),
          )
          .returning({ id: schema.submissions.id });
        if (!claimed) {
          throw conflict('El estado de la entrega ha cambiado; actualiza la página antes de descartar.');
        }

        // Se va todo, también la transcripción: una entrega en `pending` se
        // vuelve a leer de cero, así que conservarla sólo dejaría en la base un
        // resto que nadie va a usar y que enseñaría una lectura vieja al abrir
        // la entrega. Los apartados caen con la corrección (ON DELETE CASCADE).
        await tx.delete(schema.corrections).where(eq(schema.corrections.submissionId, submissionId));
        await tx
          .delete(schema.transcriptions)
          .where(eq(schema.transcriptions.submissionId, submissionId));
      });

      return { queued: true };
    },
  );

  app.get<{ Params: { id: string } }>(
    routes.original(':id'),
    {
      preHandler: app.authenticate,
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const [submission] = await db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, request.params.id))
        .limit(1);
      if (!submission) throw notFound('No existe esa entrega.');
      await assertActivityAccess(ctx, currentUser(request), submission.activityId);
      if (submission.storagePath === null) throw notFound('Esta entrega no tiene un original real almacenado.');
      const store = new FileStore(ctx.config.STORAGE_ROOT);
      const filename = submission.originalFilename ?? 'entrega.pdf';
      reply
        .type(submission.mediaType ?? 'application/pdf')
        .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return reply.send(createReadStream(store.absolutePathOf(submission.storagePath)));
    },
  );
}

async function readStoredOriginal(
  ctx: AppContext,
  source: { readonly storagePath: string | null; readonly mediaType: string | null } | undefined,
): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  if (!source?.storagePath) return null;
  try {
    return {
      bytes: await new FileStore(ctx.config.STORAGE_ROOT).read(source.storagePath),
      mediaType: source.mediaType ?? 'application/octet-stream',
    };
  } catch {
    // El PDF de feedback sigue siendo útil con la transcripción. La descarga
    // del original tiene su propia ruta y allí sí se muestra el fallo de disco.
    return null;
  }
}

// ── Ayudantes ───────────────────────────────────────────────────────────────

async function closeUnusedBatch(ctx: AppContext, runId: string): Promise<void> {
  await ctx.db
    .update(schema.batchRuns)
    .set({ status: 'failed', finishedAt: new Date() })
    .where(and(eq(schema.batchRuns.id, runId), eq(schema.batchRuns.status, 'running')))
    .catch(() => {});
}

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

  // La ficha del alumno la ve el profesor entera: es quien tiene que saber de
  // quién es lo que firma. Al modelo va sólo el recorte de `studentContextFor()`.
  const [student] = submission.studentId
    ? await db
        .select()
        .from(schema.students)
        .where(eq(schema.students.id, submission.studentId))
        .limit(1)
    : [];

  return {
    submission: toSubmission(submission),
    activity,
    student: student ? toStudent(student) : null,
    transcription: transcription ? toTranscription(transcription) : null,
    correction: correctionRow ? toCorrection(correctionRow, items) : null,
    // Una actividad sin fichero del alumno (un foro) no tiene nada que escanear.
    scanUrls: hasStudentFile(activity.kind)
      ? submission.storagePath === null
        ? (transcription?.pages ?? []).map((page) => page.imageUrl)
        : [routes.original(submission.id)]
      : [],
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
  if (submission.status !== 'graded') {
    if (submission.status === 'validated') {
      throw conflict('Una corrección validada queda fijada: sólo se puede publicar.');
    }
    throw conflict('Sólo se puede editar una corrección pendiente de validación.');
  }

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
    const [stillEditable] = await tx
      .update(schema.submissions)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(schema.submissions.id, submissionId),
          eq(schema.submissions.status, 'graded'),
        ),
      )
      .returning({ id: schema.submissions.id });
    if (!stillEditable) {
      throw conflict('El estado de la entrega ha cambiado; actualiza la página antes de guardar.');
    }
  });
}
