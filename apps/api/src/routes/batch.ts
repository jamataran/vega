import { asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  hasStudentFile,
  routes,
  type AutonomyMode,
  type BatchRun,
  type BatchRunListResponse,
  type TriggerBatchResponse,
  type UsageMetrics,
} from '@vega/shared';
import { createAiProvider, gradeSubmission } from '@vega/core';
import type { AiProvider, PageSource, ResolveContextInput } from '@vega/core';
import { currentUser } from '../auth/plugin.js';
import { schema } from '../db/client.js';
import { toBatchRun } from '../db/mappers.js';
import { readContextLevel } from './contexts.js';
import type { AppContext } from '../context.js';

/**
 * Proceso de corrección por lotes.
 *
 * Lo dispara el planificador (`batch/scheduler.ts`) o el profesor a mano desde
 * Ajustes; por eso la lógica vive en `runBatch`, fuera de la ruta, y ambos
 * llaman a lo mismo.
 *
 * Sólo entran actividades con `enabled = true`, y las entregas se procesan
 * **ordenadas por actividad**: el contexto de corrección es idéntico dentro de
 * una misma actividad, así que procesarlas seguidas es lo que permite que ese
 * prefijo del prompt se sirva desde la caché en vez de pagarlo entero cada vez.
 *
 * La corrección en sí la hace `gradeSubmission` de `@vega/core`: aquí sólo se
 * decide a quién le toca, se persiste el resultado y se aplica la autonomía.
 * El motor es puro y no toca base de datos; esa frontera es lo que permite
 * probarlo sin levantar Postgres.
 */

/** Tope por ejecución: evita que un lote manual se coma la tarde. */
const MAX_PER_RUN = 25;

/** Por debajo de aquí, una corrección no se publica sola. */
const AUTONOMY_CONFIDENCE_THRESHOLD = 0.75;

// ── Rutas ───────────────────────────────────────────────────────────────────

export async function batchRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;

  app.get(
    routes.batchRuns,
    { preHandler: app.authenticate },
    async (): Promise<BatchRunListResponse> => {
      const rows = await db
        .select()
        .from(schema.batchRuns)
        .orderBy(desc(schema.batchRuns.startedAt))
        .limit(20);
      return { items: rows.map(toBatchRun) };
    },
  );

  app.post(
    routes.triggerBatch,
    { preHandler: app.authenticate },
    async (request): Promise<TriggerBatchResponse> => {
      // Queda registrado quién lo fuerza; el planificador deja `null`.
      const session = currentUser(request);
      const result = await runBatch(ctx, session.sub, app.log);
      return { run: result.run, queued: result.queued };
    },
  );
}

// ── Lote reutilizable ───────────────────────────────────────────────────────

export interface RunBatchResult {
  readonly processed: number;
  readonly failed: number;
  readonly autoPublished: number;
  readonly queued: number;
  readonly run: BatchRun;
}

interface Logger {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const SILENT: Logger = { info: () => {}, error: () => {} };

/**
 * Corrige las entregas pendientes de las actividades activas.
 *
 * `triggeredBy` es el usuario que lo fuerza, o `null` si lo lanzó el
 * planificador. La usan tanto la ruta como `startScheduler`.
 */
export async function runBatch(
  ctx: AppContext,
  triggeredBy: string | null,
  log: Logger = SILENT,
): Promise<RunBatchResult> {
  const { db } = ctx;

  // Sólo actividades activas, y agrupadas por actividad para aprovechar la
  // caché del prompt.
  const pending = await db
    .select({ submission: schema.submissions, activity: schema.activities })
    .from(schema.submissions)
    .innerJoin(schema.activities, eq(schema.activities.id, schema.submissions.activityId))
    .where(eq(schema.submissions.status, 'pending'))
    .orderBy(asc(schema.submissions.activityId), asc(schema.submissions.submittedAt))
    .limit(MAX_PER_RUN);

  const enabled = pending.filter((row) => row.activity.enabled);

  const [run] = await db
    .insert(schema.batchRuns)
    .values({ status: 'running', triggeredBy })
    .returning();
  if (!run) throw new Error('No se ha podido registrar el lote.');

  let processed = 0;
  let failed = 0;
  let autoPublished = 0;
  const usage: UsageMetrics = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    costCents: 0,
  };

  // Memoria del contexto ya resuelto por actividad: dentro de un lote no cambia.
  const contextCache = new Map<string, ResolveContextInput>();

  // Un único proveedor para todo el lote: es lo que permite que la caché del
  // prompt de Anthropic sirva de una entrega a la siguiente.
  const provider = createAiProvider({
    provider: ctx.config.AI_PROVIDER,
    ...(ctx.config.ANTHROPIC_API_KEY ? { apiKey: ctx.config.ANTHROPIC_API_KEY } : {}),
    transcriptionModel: ctx.config.AI_MODEL_TRANSCRIPTION,
    gradingModel: ctx.config.AI_MODEL_GRADING,
    mockDelayMs: 0,
  });

  for (const { submission, activity } of enabled) {
    try {
      const outcome = await processOne(ctx, submission, activity, usage, contextCache, provider);
      processed += 1;
      if (outcome.autoPublished) autoPublished += 1;
    } catch (error) {
      failed += 1;
      await db
        .update(schema.submissions)
        .set({
          status: 'error',
          errorMessage: (error as Error).message.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(schema.submissions.id, submission.id));
      log.error({ err: error, submissionId: submission.id }, 'Fallo al corregir una entrega');
    }
  }

  const [finished] = await db
    .update(schema.batchRuns)
    .set({
      status: failed > 0 && processed === 0 ? 'failed' : 'done',
      finishedAt: new Date(),
      submissionsProcessed: processed,
      submissionsFailed: failed,
      submissionsAutoPublished: autoPublished,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      costCents: usage.costCents.toFixed(4),
    })
    .where(eq(schema.batchRuns.id, run.id))
    .returning();

  log.info({ processed, failed, autoPublished }, 'Lote de corrección terminado');

  return {
    processed,
    failed,
    autoPublished,
    queued: enabled.length,
    run: toBatchRun(finished ?? run),
  };
}

// ── Una entrega ─────────────────────────────────────────────────────────────

type SubmissionRow = typeof schema.submissions.$inferSelect;
type ActivityRow = typeof schema.activities.$inferSelect;

async function processOne(
  ctx: AppContext,
  submission: SubmissionRow,
  activity: ActivityRow,
  usageAccumulator: UsageMetrics,
  contextCache: Map<string, ResolveContextInput>,
  provider: AiProvider,
): Promise<{ autoPublished: boolean }> {
  const { db } = ctx;
  const withFile = hasStudentFile(activity.kind);

  await db
    .update(schema.submissions)
    .set({ status: withFile ? 'transcribing' : 'grading', updatedAt: new Date() })
    .where(eq(schema.submissions.id, submission.id));

  // El contexto es idéntico para todas las entregas de una actividad, así que
  // se lee una vez por lote y no una vez por entrega.
  let context = contextCache.get(activity.id);
  if (context === undefined) {
    context = {
      global: await readContextLevel(ctx, 'global', 'global'),
      activityKind: await readContextLevel(ctx, 'activity_kind', activity.kind),
      activity: await readContextLevel(ctx, 'activity', activity.slug),
    };
    contextCache.set(activity.id, context);
  }

  const maxScore = activity.maxScore === null ? null : Number(activity.maxScore);
  if (activity.graded && maxScore === null) {
    throw new Error('La actividad se puntúa pero no tiene nota máxima configurada.');
  }

  // Un foro no trae fichero: se corrige sobre lo que el alumno escribió.
  if (!withFile && (submission.textContent ?? '').trim() === '') {
    throw new Error('La intervención del alumno está vacía: no hay nada que corregir.');
  }

  // El proveedor mock no lee los ficheros, pero sí necesita saber cuántas
  // páginas tiene la entrega para transcribirlas.
  const pages: PageSource[] = withFile
    ? Array.from({ length: Math.max(1, submission.pageCount) }, (_unused, index) => ({
        page: index + 1,
        mediaType: 'application/pdf' as const,
        path: `${submission.originalFilename ?? submission.id}#${index + 1}`,
      }))
    : [];

  const graded = await gradeSubmission({
    provider,
    submissionId: submission.id,
    studentRef: submission.studentRef,
    activityKind: activity.kind,
    pages,
    textContent: submission.textContent,
    context,
    pointsAllocation: activity.pointsAllocation ?? [],
    graded: activity.graded,
    maxScore,
    autonomy: activity.autonomy,
  });

  // Aplanamos el resultado del motor a la forma que persistimos.
  const result = {
    transcription: graded.transcription,
    items: graded.correction.items,
    aiLatex: graded.correction.aiLatex,
    aiSummary: graded.correction.aiSummary,
    confidence: graded.correction.confidence,
    model: graded.correction.model,
    usage: graded.usage,
  };

  const decision = autonomyDecision(
    activity.autonomy,
    result.confidence,
    result.transcription?.flags.length ?? 0,
  );
  const now = new Date();

  await db.transaction(async (tx) => {
    // Reprocesar debe reemplazar lo anterior, no acumular.
    await tx
      .delete(schema.transcriptions)
      .where(eq(schema.transcriptions.submissionId, submission.id));
    await tx.delete(schema.corrections).where(eq(schema.corrections.submissionId, submission.id));

    if (result.transcription) {
      await tx.insert(schema.transcriptions).values({
        submissionId: submission.id,
        // El motor devuelve arrays de sólo lectura; Drizzle los quiere mutables.
        pages: [...result.transcription.pages],
        flags: [...result.transcription.flags],
        confidence: result.transcription.confidence.toFixed(3),
        model: result.transcription.model,
      });
    }

    const [correction] = await tx
      .insert(schema.corrections)
      .values({
        submissionId: submission.id,
        // `null` en actividades no puntuables: no hay nota que enseñar.
        maxScore: activity.graded && maxScore !== null ? String(maxScore) : null,
        aiLatex: result.aiLatex,
        teacherLatex: null,
        aiSummary: result.aiSummary,
        confidence: result.confidence.toFixed(3),
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        costCents: result.usage.costCents.toFixed(4),
        // El PDF se genera al vuelo al descargarlo; en actividades sin fichero
        // el contrato pide `null`.
        annotatedFileUrl: withFile ? routes.feedbackFile(submission.id) : null,
        publishedAutomatically: decision === 'publish',
        publishedAt: decision === 'publish' ? now : null,
      })
      .returning();
    if (!correction) throw new Error('No se ha podido guardar la corrección.');

    // Sin apartados en las actividades no puntuables: no hay puntos que repartir.
    if (result.items.length > 0) {
      await tx.insert(schema.correctionItems).values(
        result.items.map((item) => ({
          correctionId: correction.id,
          label: item.label,
          statement: item.statement,
          maxPoints: String(item.maxPoints),
          aiPoints: String(item.aiPoints),
          aiFeedback: item.aiFeedback,
          confidence: item.confidence.toFixed(3),
          alternativeMethod: item.alternativeMethod,
          position: item.position,
        })),
      );
    }

    await tx
      .update(schema.submissions)
      .set({
        status: decision === 'publish' ? 'published' : 'graded',
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(schema.submissions.id, submission.id));
  });

  usageAccumulator.inputTokens += result.usage.inputTokens;
  usageAccumulator.outputTokens += result.usage.outputTokens;
  usageAccumulator.cachedInputTokens += result.usage.cachedInputTokens;
  usageAccumulator.costCents =
    Math.round((usageAccumulator.costCents + result.usage.costCents) * 10_000) / 10_000;

  return { autoPublished: decision === 'publish' };
}

/**
 * Qué hacer con una corrección recién hecha, según la autonomía de la actividad.
 *
 * `review_low_confidence` es el modo intermedio y el que de verdad importa: se
 * publica sola sólo si la IA va segura **y** el OCR no ha dejado ninguna marca.
 * Una marca de [ILEGIBLE] significa que hay papel que nadie ha leído, y eso no
 * se publica sin profesor por muy alta que sea la confianza.
 */
export function autonomyDecision(
  autonomy: AutonomyMode,
  confidence: number,
  flagCount: number,
): 'publish' | 'review' {
  switch (autonomy) {
    case 'autonomous':
      return 'publish';
    case 'review_low_confidence':
      return confidence > AUTONOMY_CONFIDENCE_THRESHOLD && flagCount === 0 ? 'publish' : 'review';
    case 'review_all':
    default:
      return 'review';
  }
}
