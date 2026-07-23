import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  TriggerBatchRequest,
  hasStudentFile,
  routes,
  studentContextFor,
  type ActivityKind,
  type AutonomyMode,
  type BatchRun,
  type BatchRunListResponse,
  type BatchRunProblem,
  type TriggerBatchResponse,
  type UsageMetrics,
} from '@vega/shared';
import { gradeSubmission, sumUsage } from '@vega/core';
import type { AiProvider, PageSource, ResolveContextInput, StudentContext } from '@vega/core';
import { currentUser } from '../auth/plugin.js';
import { aiProviderForInstall } from '../ai/factory.js';
import { withAiLedger } from '../ai/ledger.js';
import { schema } from '../db/client.js';
import { toActivity, toBatchRun, toCorrection, toSubmission, toTranscription } from '../db/mappers.js';
import { conflict, notFound, parseOrThrow } from '../http/errors.js';
import { ingestAll, ingestCutoff, type IngestReport } from '../ingest/run.js';
import { connectorForUser } from '../lms/factory.js';
import { publishToLms, recordPublication } from '../publish/publish.js';
import { FileStore } from '../storage/files.js';
import { getSettings } from '../settings/service.js';
import { readActiveContext } from '../contexts/service.js';
import type { AppContext } from '../context.js';
import { PDFDocument } from 'pdf-lib';
import { listActivePrompts } from '../prompts/service.js';

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

/** Ningún proceso puede monopolizar el ejecutor más de doce horas. */
export const BATCH_MAX_RUNTIME_MS = 12 * 60 * 60_000;

/** Serializa el SELECT+INSERT que reserva el único ejecutor de la instalación. */
const BATCH_RUN_LOCK_KEY = 0x7645_6743; // "vEgC"

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

  // Lanzar el proceso a mano es de administrador (HU-09, RN-7): consume dinero
  // real en cuanto el proveedor de IA deje de ser el simulado, y hasta ahora
  // podía dispararlo cualquier usuario autenticado.
  app.post(
    routes.triggerBatch,
    { preHandler: app.requireRole('admin') },
    async (request, reply): Promise<TriggerBatchResponse> => {
      // Queda registrado quién lo fuerza; el planificador deja `null`.
      const session = currentUser(request);
      const body = parseOrThrow(TriggerBatchRequest, request.body ?? {}, 'El disparo del proceso');
      const kinds = body.kinds ?? ALL_KINDS;
      const run = await prepareBatchRun(ctx, session.sub, kinds);
      void runBatch(ctx, session.sub, app.log, {
        preparedRun: run,
        kinds,
        ingest: true,
      }).catch((error) => {
        app.log.error({ err: error, batchRunId: run.id }, 'El lote en segundo plano ha fallado');
      });
      reply.code(202);
      return { run: toBatchRun(run) };
    },
  );

  // Parar es tan sensible como lanzar: interrumpe trabajo que se está pagando.
  app.post<{ Params: { id: string } }>(
    routes.cancelBatchRun(':id'),
    { preHandler: app.requireRole('admin') },
    async (request): Promise<TriggerBatchResponse> => {
      const session = currentUser(request);
      const runId = request.params.id;

      const [run] = await db
        .select()
        .from(schema.batchRuns)
        .where(eq(schema.batchRuns.id, runId))
        .limit(1);
      if (!run) throw notFound('No existe ese proceso.');
      if (run.status !== 'running') {
        throw conflict('Ese proceso ya había terminado.');
      }

      const [user] = await db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, session.sub))
        .limit(1);

      const cancelled = await cancelBatchRun(
        ctx,
        runId,
        session.sub,
        `Parado desde la aplicación por ${user?.name ?? 'un administrador'}.`,
      );
      if (!cancelled) throw conflict('Ese proceso ya había terminado.');

      app.log.info({ batchRunId: runId, cancelledBy: session.sub }, 'Proceso parado a mano');

      const [closed] = await db
        .select()
        .from(schema.batchRuns)
        .where(eq(schema.batchRuns.id, runId))
        .limit(1);
      return { run: toBatchRun(closed ?? run) };
    },
  );
}

// ── Lote reutilizable ───────────────────────────────────────────────────────

export interface RunBatchResult {
  readonly processed: number;
  readonly failed: number;
  readonly autoPublished: number;
  readonly ingested: number;
  readonly queued: number;
  readonly run: BatchRun;
}

export interface RunBatchOptions {
  readonly preparedRun?: typeof schema.batchRuns.$inferSelect;
  readonly kinds?: readonly ActivityKind[];
  /** Si existe, procesa exclusivamente esta entrega. */
  readonly submissionId?: string;
  /** El reproceso individual no vuelve a consultar Moodle. */
  readonly ingest?: boolean;
  /** Inyectable para probar el deadline sin esperar doce horas. */
  readonly maxRuntimeMs?: number;
}

export class BatchDeadlineError extends Error {
  constructor() {
    super('El proceso ha alcanzado el límite de 12 horas y se ha detenido.');
    this.name = 'BatchDeadlineError';
  }
}

export class BatchCancelledError extends Error {
  constructor(readonly cancelledBy: string | null) {
    super('Alguien ha parado el proceso desde la aplicación.');
    this.name = 'BatchCancelledError';
  }
}

/**
 * Procesos vivos **en esta instancia**, para poder pararlos.
 *
 * En memoria y no en base de datos porque lo que hay que cortar es un
 * `AbortController` de este proceso de Node: una bandera en una tabla no
 * interrumpe una petición HTTP en vuelo hacia Anthropic. La consecuencia es
 * que un lote huérfano —de una instancia que se murió— no tiene aquí su
 * controlador; `cancelBatchRun` lo detecta y cierra la fila igual, que es lo
 * que desatasca el cerrojo y permite lanzar el siguiente.
 */
const LIVE_RUNS = new Map<string, AbortController>();

/**
 * Para un proceso en marcha. Devuelve `false` si ese proceso ya no estaba
 * corriendo, para que la interfaz pueda decirlo en vez de fingir que lo paró.
 */
export async function cancelBatchRun(
  ctx: AppContext,
  runId: string,
  cancelledBy: string | null,
  reason: string,
): Promise<boolean> {
  // Primero la fila: es lo único que ven las demás instancias y el panel. Se
  // exige `running` para que parar dos veces no reescriba el desenlace de un
  // proceso que ya había terminado solo entre medias.
  const [closed] = await ctx.db
    .update(schema.batchRuns)
    .set({
      status: 'cancelled',
      finishedAt: new Date(),
      closedReason: reason.slice(0, 500),
    })
    .where(and(eq(schema.batchRuns.id, runId), eq(schema.batchRuns.status, 'running')))
    .returning({ id: schema.batchRuns.id });
  if (!closed) return false;

  // Y después el trabajo en vuelo. `runBatch` verá la señal, devolverá a la
  // cola lo que estuviera a medias y no volverá a tocar la fila, porque todas
  // sus escrituras exigen que siga en `running`.
  LIVE_RUNS.get(runId)?.abort(new BatchCancelledError(cancelledBy));
  return true;
}

interface Logger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const SILENT: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** Todos los tipos: lo que barre un proceso forzado a mano. */
const ALL_KINDS: readonly ActivityKind[] = ['assignment', 'forum'];

/**
 * Cuántas incidencias de ingesta se guardan con el proceso.
 *
 * Con veinte se ve el patrón —que suele ser el mismo fallo repetido— sin que
 * un LMS caído convierta la fila del proceso en un volcado de log.
 */
const MAX_STORED_PROBLEMS = 20;

function storedProblems(ingest: IngestReport): BatchRunProblem[] {
  return ingest.problems.slice(0, MAX_STORED_PROBLEMS).map((problem) => ({
    activityId: problem.activityId,
    slug: problem.slug,
    kind: problem.kind,
    message: problem.message.slice(0, 500),
  }));
}

/**
 * Corrige las entregas pendientes de las actividades activas.
 *
 * `triggeredBy` es el usuario que lo fuerza, o `null` si lo lanzó el
 * planificador. La usan tanto la ruta como `startScheduler`.
 *
 * `kinds` acota el barrido a esos tipos de actividad: el planificador corre
 * por tipo (foros más frecuentes que entregas) y no tiene sentido que la
 * pasada rápida de foros ingiera y recorra también todas las entregas.
 */
export async function runBatch(
  ctx: AppContext,
  triggeredBy: string | null,
  log: Logger = SILENT,
  options: RunBatchOptions = {},
): Promise<RunBatchResult> {
  const { db } = ctx;
  const kinds = options.kinds ?? ALL_KINDS;
  const maxRuntimeMs = options.maxRuntimeMs ?? BATCH_MAX_RUNTIME_MS;
  if (!Number.isFinite(maxRuntimeMs) || maxRuntimeMs <= 0) {
    throw new RangeError('El límite de ejecución del proceso debe ser mayor que cero.');
  }

  // Un solo lote a la vez (HU-09, RN-3). Sin esto, dos disparos seguidos —o el
  // planificador y una persona a la vez— corrigen las mismas entregas dos veces
  // y **pagan el doble**. Se comprueba antes de crear la fila para que el
  // conflicto no deje un `batch_runs` fantasma.
  const run = options.preparedRun ?? await prepareBatchRun(ctx, triggeredBy, kinds);
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new BatchDeadlineError()), maxRuntimeMs);
  deadline.unref?.();
  LIVE_RUNS.set(run.id, controller);

  // A partir de aquí la fila existe y está en `running`. Todo lo que pueda
  // lanzar va dentro del `try` de abajo, porque un lote que muere sin cerrarla
  // bloquearía todos los siguientes contra el cerrojo de arriba hasta que la
  // recuperación del siguiente arranque lo desatasque.
  let ingest: IngestReport = {
    ingested: 0,
    activitiesFailed: 0,
    activitiesVisited: 0,
    skippedTooOld: 0,
    problems: [],
  };
  let processed = 0;
  let failed = 0;
  let autoPublished = 0;
  let queued = 0;
  const usage: UsageMetrics = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    costCents: 0,
  };

  try {
    log.info({ batchRunId: run.id, kinds }, 'Lote de corrección iniciado');

    // ── Ingesta ─────────────────────────────────────────────────────────────
    //
    // Primero se trae lo nuevo del LMS y sólo después se corrige, de modo que
    // una entrega que llegó hace un minuto se corrija esta misma noche y no la
    // siguiente. Que la ingesta falle no cancela la corrección: lo que ya
    // estaba en `pending` se corrige igual aunque Moodle no responda.
    if (options.ingest ?? options.submissionId === undefined) {
      try {
        log.info({ batchRunId: run.id, kinds }, 'Ingesta iniciada');
        ingest = await ingestAll(ctx, log, kinds, controller.signal);
        for (const problem of ingest.problems) {
          log.warn({ slug: problem.slug, kind: problem.kind }, problem.message);
        }
      } catch (error) {
        // Que la ingesta falle no cancela la corrección… salvo que lo que haya
        // fallado sea que alguien ha parado el proceso. Tragarse eso aquí es lo
        // que hacía que «Parar» cerrara la fila y el trabajo siguiera corriendo.
        if (controller.signal.aborted) throw error;
        log.error({ err: error }, 'La ingesta ha fallado entera; se corrige lo que ya había');
      }
    }
    controller.signal.throwIfAborted();
    await updateRunProgress(ctx, run.id, { processed, failed, autoPublished, ingest, usage });

    // La antigüedad máxima también tiene que alcanzar a lo que ya está en la
    // cola: filtrarla sólo en la ingesta dejaría corrigiéndose para siempre el
    // historial que entró antes de configurarla, que es justo lo que se quería
    // evitar. Un reproceso dirigido no pasa por aquí: si alguien pide a mano
    // que se corrija una entrega vieja, se corrige.
    if (options.submissionId === undefined) {
      const parkedByAge = await parkSubmissionsTooOld(ctx, kinds);
      if (parkedByAge > 0) {
        log.info(
          { batchRunId: run.id, parkedByAge },
          'Entregas aparcadas por superar la antigüedad máxima',
        );
      }
    }

    // Sólo actividades activas de los tipos que barre este proceso, y
    // agrupadas por actividad para aprovechar la caché del prompt.
    //
    // El filtro de `enabled` va en la consulta, no después: aplicado sobre el
    // resultado ya recortado a MAX_PER_RUN, las entregas de una actividad
    // desactivada acaparaban el lote y un proceso con trabajo real pendiente
    // podía terminar sin procesar nada.
    const enabled = await db
      .select({ submission: schema.submissions, activity: schema.activities })
      .from(schema.submissions)
      .innerJoin(schema.activities, eq(schema.activities.id, schema.submissions.activityId))
      .where(
        and(
          inArray(schema.submissions.status, ['pending', 'grading']),
          inArray(schema.activities.kind, [...kinds]),
          options.submissionId
            ? eq(schema.submissions.id, options.submissionId)
            : eq(schema.activities.enabled, true),
        ),
      )
      .orderBy(asc(schema.submissions.activityId), asc(schema.submissions.submittedAt))
      .limit(MAX_PER_RUN);
    queued = enabled.length;
    controller.signal.throwIfAborted();

    // Memoria del contexto ya resuelto por actividad: dentro de un lote no cambia.
    const contextCache = new Map<string, ResolveContextInput>();

    // Un único proveedor para todo el lote: es lo que permite que la caché del
    // prompt de Anthropic sirva de una entrega a la siguiente. Se construye desde
    // `app_settings` (con el `.env` de respaldo), así que respeta el proveedor, los
    // modelos y la clave que el administrador configura en la web.
    const baseProvider = await aiProviderForInstall(ctx);
    const settings = await getSettings(ctx);
    const prompts = await listActivePrompts(ctx);
    const provider = withAiLedger(ctx, baseProvider, {
      batchRunId: run.id,
      // Este ejecutor usa Messages síncrono. No etiquetamos ni descontamos como
      // batch hasta que la orquestación durable por fases esté conectada.
      transport: 'sync',
      models: {
        reading_a: settings.anthropic.readingModel,
        reading_b: settings.anthropic.readingModel,
        grade: settings.anthropic.gradingModel,
        triage: settings.anthropic.triageModel,
        verify: settings.anthropic.verifyModel,
        forum_answer: settings.anthropic.gradingModel,
        connection_test: settings.anthropic.gradingModel,
      },
      prompts: Object.fromEntries(prompts.map((prompt) => [prompt.key, prompt.version])),
    });

    for (const { submission, activity } of enabled) {
      controller.signal.throwIfAborted();
      try {
        log.info(
          { batchRunId: run.id, submissionId: submission.id, activityId: activity.id, kind: activity.kind },
          'Corrección de entrega iniciada',
        );
        const outcome = await processOne(
          ctx,
          submission,
          activity,
          usage,
          contextCache,
          provider,
          settings.ai.pagesPerChunk,
          run.id,
          controller.signal,
          triggeredBy,
        );
        processed += 1;
        if (outcome.autoPublished) autoPublished += 1;
        await updateRunProgress(ctx, run.id, { processed, failed, autoPublished, ingest, usage });
        log.info(
          { batchRunId: run.id, submissionId: submission.id, activityId: activity.id },
          'Corrección de entrega terminada',
        );
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        await db
          .update(schema.submissions)
          .set({
            status: 'error',
            errorMessage: message.slice(0, 500),
            updatedAt: new Date(),
          })
          .where(eq(schema.submissions.id, submission.id));
        await updateRunProgress(ctx, run.id, { processed, failed, autoPublished, ingest, usage });
        log.error({ err: error, submissionId: submission.id }, 'Fallo al corregir una entrega');
        if (isFatalProviderError(error)) {
          log.error(
            { err: error, batchRunId: run.id, submissionId: submission.id },
            'Fallo global del proveedor; se detiene el lote para no repetir llamadas inútiles',
          );
          // Una lectura doble puede tener otra petición gemela aún abierta.
          // Cortarla evita consumir más tiempo/crédito después del fallo global.
          controller.abort(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }
      }
    }
    controller.signal.throwIfAborted();

    const [finished] = await db
      .update(schema.batchRuns)
      .set({
        status: failed > 0 && processed === 0 ? 'failed' : 'done',
        finishedAt: new Date(),
        submissionsProcessed: processed,
        submissionsFailed: failed,
        submissionsAutoPublished: autoPublished,
        submissionsIngested: ingest.ingested,
        activitiesFailed: ingest.activitiesFailed,
        problems: storedProblems(ingest),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        costCents: usage.costCents.toFixed(4),
      })
      .where(and(eq(schema.batchRuns.id, run.id), eq(schema.batchRuns.status, 'running')))
      .returning();

    log.info(
      { processed, failed, autoPublished, ingested: ingest.ingested },
      'Lote de corrección terminado',
    );

    return {
      processed,
      failed,
      autoPublished,
      ingested: ingest.ingested,
      queued,
      run: toBatchRun(finished ?? run),
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    // Caducar y que alguien lo pare son el mismo desenlace desde la entrega:
    // nadie ha dictaminado nada sobre su contenido, así que vuelve a la cola.
    const reason = controller.signal.reason;
    const interrupted =
      reason instanceof BatchDeadlineError || reason instanceof BatchCancelledError;
    if (interrupted) {
      // La llamada al proveedor recibe esta misma señal y se aborta de forma
      // cooperativa. La entrega que estaba a medias vuelve a la cola: no ha
      // fallado por su contenido y no debe exigir una intervención manual.
      await db
        .update(schema.submissions)
        .set({ status: 'pending', errorMessage: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.submissions.batchRunId, run.id),
            inArray(schema.submissions.status, ['transcribing', 'grading']),
          ),
        )
        .catch(() => {});
      await db
        .update(schema.aiCalls)
        .set({
          error: failure.message.slice(0, 500),
          stopReason: reason instanceof BatchCancelledError ? 'batch_cancelled' : 'batch_timeout',
        })
        .where(
          and(
            eq(schema.aiCalls.batchRunId, run.id),
            eq(schema.aiCalls.parsedOk, false),
            isNull(schema.aiCalls.error),
            isNull(schema.aiCalls.latencyMs),
          ),
        )
        .catch(() => {});
    } else if (options.submissionId) {
      // Si un reproceso dirigido falla antes de llegar a `processOne` (por
      // ejemplo, configuración inválida del proveedor), no puede quedarse en
      // `pending/grading` sin ningún trabajador que vaya a recogerlo.
      await db
        .update(schema.submissions)
        .set({
          status: 'error',
          batchRunId: run.id,
          errorMessage: failure.message.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.submissions.id, options.submissionId),
            inArray(schema.submissions.status, ['pending', 'transcribing', 'grading']),
          ),
        )
        .catch(() => {});
    }

    // El lote se ha caído entero. Cerrar la fila es lo que permite que el
    // siguiente pueda arrancar; el error se propaga para que quien lo lanzó lo
    // vea, en vez de recibir un «terminado» que no ocurrió.
    //
    // Una parada a mano ya cerró la fila como `cancelled` antes de mandar la
    // señal: el `where` de abajo exige `running` y por eso no la pisa.
    await db
      .update(schema.batchRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        closedReason: failure.message.slice(0, 500),
        submissionsIngested: ingest.ingested,
        activitiesFailed: ingest.activitiesFailed,
        problems: storedProblems(ingest),
        submissionsProcessed: processed,
        submissionsFailed: failed,
        submissionsAutoPublished: autoPublished,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        costCents: usage.costCents.toFixed(4),
      })
      .where(and(eq(schema.batchRuns.id, run.id), eq(schema.batchRuns.status, 'running')))
      .catch(() => {});
    throw error;
  } finally {
    clearTimeout(deadline);
    LIVE_RUNS.delete(run.id);
  }
}

export async function prepareBatchRun(
  ctx: AppContext,
  triggeredBy: string | null,
  kinds: readonly ActivityKind[] = ALL_KINDS,
) {
  return ctx.db.transaction(async (tx) => {
    // El cerrojo transaccional convierte la comprobación y el alta en una sola
    // reserva lógica. Dos peticiones simultáneas ya no pueden ver ambas «cero».
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BATCH_RUN_LOCK_KEY})`);
    const [alreadyRunning] = await tx
      .select({ id: schema.batchRuns.id })
      .from(schema.batchRuns)
      .where(eq(schema.batchRuns.status, 'running'))
      .limit(1);
    if (alreadyRunning) {
      throw conflict('Ya hay un proceso de corrección en marcha. Espera a que termine.');
    }
    const [run] = await tx
      .insert(schema.batchRuns)
      .values({ status: 'running', triggeredBy, kinds: [...kinds] })
      .returning();
    if (!run) throw new Error('No se ha podido registrar el lote.');
    return run;
  });
}

/**
 * Aparca —no borra— lo que ya estaba en la cola y supera la antigüedad máxima.
 *
 * Aparcar y no descartar es deliberado: la entrega existe, el alumno la hizo, y
 * dejarla visible con su motivo permite que el profesor la recupere con un
 * reproceso si resulta que sí la quería. Descartarla en silencio sería perder
 * trabajo de un alumno sin decírselo a nadie.
 *
 * Sólo alcanza a `pending`: algo que ya está transcribiéndose o corrigiéndose
 * tiene una llamada de IA pagada en vuelo, y cortarla aquí no ahorra nada.
 */
async function parkSubmissionsTooOld(
  ctx: AppContext,
  kinds: readonly ActivityKind[],
): Promise<number> {
  const { maxAgeDays } = (await getSettings(ctx)).ingest;
  const cutoff = ingestCutoff(maxAgeDays);
  if (cutoff === null) return 0;

  const stale = await ctx.db
    .select({ id: schema.submissions.id })
    .from(schema.submissions)
    .innerJoin(schema.activities, eq(schema.activities.id, schema.submissions.activityId))
    .where(
      and(
        eq(schema.submissions.status, 'pending'),
        inArray(schema.activities.kind, [...kinds]),
        lt(schema.submissions.submittedAt, cutoff),
      ),
    );
  if (stale.length === 0) return 0;

  const parked = await ctx.db
    .update(schema.submissions)
    .set({
      status: 'parked',
      parkedReason:
        `Entregada antes del límite de antigüedad configurado (${maxAgeDays} ` +
        `${maxAgeDays === 1 ? 'día' : 'días'}). Vuelve a procesarla si quieres corregirla igualmente.`,
      parkedBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(
          schema.submissions.id,
          stale.map((row) => row.id),
        ),
        // Se relee el estado: entre el SELECT y el UPDATE alguien ha podido
        // reprocesar una de ellas a mano, y ese gesto manda sobre el límite.
        eq(schema.submissions.status, 'pending'),
      ),
    )
    .returning({ id: schema.submissions.id });

  return parked.length;
}

interface RunProgress {
  readonly processed: number;
  readonly failed: number;
  readonly autoPublished: number;
  readonly ingest: IngestReport;
  readonly usage: UsageMetrics;
}

/**
 * Persiste cada avance para que «Proceso en marcha» muestre trabajo real y un
 * reinicio no borre de la vista todo lo que ya terminó.
 */
async function updateRunProgress(
  ctx: AppContext,
  runId: string,
  progress: RunProgress,
): Promise<void> {
  await ctx.db
    .update(schema.batchRuns)
    .set({
      submissionsProcessed: progress.processed,
      submissionsFailed: progress.failed,
      submissionsAutoPublished: progress.autoPublished,
      submissionsIngested: progress.ingest.ingested,
      activitiesFailed: progress.ingest.activitiesFailed,
      problems: storedProblems(progress.ingest),
      inputTokens: progress.usage.inputTokens,
      outputTokens: progress.usage.outputTokens,
      cachedInputTokens: progress.usage.cachedInputTokens,
      costCents: progress.usage.costCents.toFixed(4),
    })
    .where(and(eq(schema.batchRuns.id, runId), eq(schema.batchRuns.status, 'running')));
}

/**
 * Distingue un fallo de una entrega de un fallo de cuenta/proveedor. Seguir
 * recorriendo alumnos después de un 401 o de quedarse sin crédito sólo genera
 * más ruido, latencia y filas de error idénticas.
 */
export function isFatalProviderError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    status?: unknown;
    message?: unknown;
    code?: unknown;
    type?: unknown;
    error?: { message?: unknown; code?: unknown; type?: unknown };
  };
  const status = typeof candidate.status === 'number' ? candidate.status : null;
  if (status !== null && [401, 402, 403].includes(status)) return true;

  const details = [
    candidate.message,
    candidate.code,
    candidate.type,
    candidate.error?.message,
    candidate.error?.code,
    candidate.error?.type,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  return [
    'credit balance is too low',
    'insufficient credit',
    'insufficient balance',
    'insufficient_quota',
    'authentication_error',
    'invalid x-api-key',
    'invalid api key',
    'account is disabled',
    'account has been disabled',
    'account is suspended',
  ].some((fragment) => details.includes(fragment));
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
  pagesPerChunk: number,
  batchRunId: string,
  signal: AbortSignal,
  fallbackPublisherId: string | null,
): Promise<{ autoPublished: boolean }> {
  const { db } = ctx;
  const withFile = hasStudentFile(activity.kind);
  signal.throwIfAborted();

  await db
    .update(schema.submissions)
    .set({
      status: withFile && submission.status !== 'grading' ? 'transcribing' : 'grading',
      batchRunId,
      updatedAt: new Date(),
    })
    .where(eq(schema.submissions.id, submission.id));

  // El contexto es idéntico para todas las entregas de una actividad, así que
  // se lee una vez por lote y no una vez por entrega.
  let context = contextCache.get(activity.id);
  if (context === undefined) {
    // Sólo lo subido del todo: una subida a medias metida en el prompt haría
    // corregir contra medio enunciado sin que nadie se enterase.
    const fileRows = await db
      .select({
        filename: schema.activityFiles.filename,
        content: schema.activityFiles.content,
      })
      .from(schema.activityFiles)
      .where(
        and(
          eq(schema.activityFiles.activityId, activity.id),
          eq(schema.activityFiles.uploadComplete, true),
        ),
      )
      .orderBy(asc(schema.activityFiles.uploadedAt));

    const activeContexts = await Promise.all([
      readActiveContext(ctx, 'global', 'global'),
      readActiveContext(ctx, 'activity_kind', activity.kind),
      activity.templateKey ? readActiveContext(ctx, 'template', activity.templateKey) : Promise.resolve(null),
      activity.courseId ? readActiveContext(ctx, 'course', activity.courseId) : Promise.resolve(null),
      readActiveContext(ctx, 'activity', activity.slug),
    ]);
    const [globalContext, kindContext, templateContext, courseContext, activityContext] = activeContexts;
    context = {
      global: globalContext?.content,
      activityKind: kindContext?.content,
      template: templateContext?.content,
      course: courseContext?.content,
      activity: activityContext?.content,
      segments: activeContexts
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .map((item) => ({
          level: item.level,
          key: item.key,
          contextId: item.id,
          version: item.activeVersion,
          contentHash: item.contentHash,
          content: item.content,
        })),
      // Hasta ahora la solución de referencia y los ficheros se guardaban, se
      // enseñaban en «contexto efectivo»… y no llegaban al modelo: la pantalla
      // prometía más de lo que el lote hacía. Con esto, lo que el profesor ve
      // ahí es de verdad lo que se envía.
      referenceSolution: activity.referenceSolution,
      graded: activity.graded,
      fileContents: fileRows.filter(
        (row): row is { filename: string; content: string } => row.content !== null,
      ),
    };
    contextCache.set(activity.id, context);
  }
  signal.throwIfAborted();

  const maxScore = activity.maxScore === null ? null : Number(activity.maxScore);
  if (activity.graded && maxScore === null) {
    throw new Error('La actividad se puntúa pero no tiene nota máxima configurada.');
  }

  // Un foro no trae fichero: se corrige sobre lo que el alumno escribió.
  if (!withFile && (submission.textContent ?? '').trim() === '') {
    throw new Error('La intervención del alumno está vacía: no hay nada que corregir.');
  }

  const pages: PageSource[] = withFile
    ? await pagesOf(ctx, submission, pagesPerChunk, provider.name === 'mock')
    : [];
  const [persistedTranscription] = submission.status === 'grading'
    ? await db
        .select()
        .from(schema.transcriptions)
        .where(eq(schema.transcriptions.submissionId, submission.id))
        .limit(1)
    : [];

  // Lo que el modelo va a saber del alumno, ya recortado: nombre y comunidad
  // autónoma, nunca su correo, su teléfono ni su NIF. El recorte lo hace
  // `studentContextFor()` en `@vega/shared`, en un solo sitio y con pruebas que
  // fallan si un dato de identidad se cuela.
  const student = await studentContextOf(ctx, submission.studentId);

  let triageUsage: UsageMetrics | null = null;
  let forumRoute: 'standard' | 'expert' | undefined;
  if (activity.kind === 'forum') {
    const triage = await provider.triage({
      submissionId: submission.id,
      message: submission.textContent ?? '',
      thread: [],
    }, { signal });
    triageUsage = triage.usage;
    await db
      .update(schema.submissions)
      .set({ triageLabel: triage.label, triageConfidence: triage.confidence.toFixed(3) })
      .where(eq(schema.submissions.id, submission.id));
    if (['errata', 'administrativa', 'no_es_duda'].includes(triage.label) && triage.confidence >= 0.9) {
      await db
        .update(schema.submissions)
        .set({
          status: 'parked',
          parkedReason: `Triaje automático: ${triage.reason}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.submissions.id, submission.id));
      addUsage(usageAccumulator, triage.usage);
      return { autoPublished: false };
    }
    forumRoute = triage.label === 'dificil' || triage.confidence < 0.7 ? 'expert' : 'standard';
  }

  const settings = await getSettings(ctx);
  const gradeInput = {
    provider,
    submissionId: submission.id,
    studentRef: submission.studentRef,
    student,
    activityKind: activity.kind,
    pages,
    existingTranscription: persistedTranscription
      ? {
          pages: persistedTranscription.pages,
          flags: persistedTranscription.flags,
          discrepancies: persistedTranscription.discrepancies,
          passCount: persistedTranscription.passCount,
          confidence: Number(persistedTranscription.confidence),
          model: persistedTranscription.model,
        }
      : null,
    textContent: submission.textContent,
    context,
    pointsAllocation: activity.pointsAllocation ?? [],
    graded: activity.graded,
    maxScore,
    templateKey: activity.templateKey,
    autonomy: activity.autonomy,
    verifyWithAi: forumRoute === 'standard' ? false : settings.ai.verify,
    lowConfidenceThreshold: settings.ai.lowConfidenceThreshold,
    explanations: settings.ai.explanations,
    forumRoute,
    signal,
  } as const;
  let graded = await gradeSubmission(gradeInput);
  let discardedUsage: UsageMetrics | null = null;
  if (graded.correction.noEsDuda) {
    await db
      .update(schema.submissions)
      .set({ status: 'parked', parkedReason: 'La respuesta con contexto confirma que no es una duda.', updatedAt: new Date() })
      .where(eq(schema.submissions.id, submission.id));
    addUsage(usageAccumulator, triageUsage ? sumUsage(triageUsage, graded.usage) : graded.usage);
    return { autoPublished: false };
  }
  if (forumRoute === 'standard' && graded.correction.escalate) {
    discardedUsage = graded.usage;
    graded = await gradeSubmission({ ...gradeInput, forumRoute: 'expert', verifyWithAi: settings.ai.verify });
  }
  signal.throwIfAborted();

  // Aplanamos el resultado del motor a la forma que persistimos.
  const result = {
    transcription: graded.transcription,
    items: graded.correction.items,
    aiLatex: graded.correction.aiLatex,
    aiSummary: graded.correction.aiSummary,
    teacherNotes: graded.correction.teacherNotes,
    confidence: graded.correction.confidence,
    model: graded.correction.model,
    usage: [triageUsage, discardedUsage].filter((value): value is UsageMetrics => value !== null)
      .reduce((total, value) => sumUsage(total, value), graded.usage),
    verification: graded.correction.verification,
  };

  const now = new Date();

  const publication = autonomyDecision(
    activity.autonomy,
    result.confidence,
    result.transcription?.flags.length ?? 0,
  );

  signal.throwIfAborted();
  const persisted = await db.transaction(async (tx) => {
    // Reprocesar debe reemplazar lo anterior, no acumular.
    await tx
      .delete(schema.transcriptions)
      .where(eq(schema.transcriptions.submissionId, submission.id));
    await tx.delete(schema.corrections).where(eq(schema.corrections.submissionId, submission.id));

    const [transcriptionRow] = result.transcription
      ? await tx.insert(schema.transcriptions).values({
        submissionId: submission.id,
        // El motor devuelve arrays de sólo lectura; Drizzle los quiere mutables.
        pages: [...result.transcription.pages],
        flags: [...result.transcription.flags],
        discrepancies: [...result.transcription.discrepancies],
        passCount: result.transcription.passCount,
        confidence: result.transcription.confidence.toFixed(3),
        model: result.transcription.model,
      }).returning()
      : [];

    const [correction] = await tx
      .insert(schema.corrections)
      .values({
        submissionId: submission.id,
        // `null` en actividades no puntuables: no hay nota que enseñar.
        maxScore: activity.graded && maxScore !== null ? String(maxScore) : null,
        aiLatex: result.aiLatex,
        teacherLatex: null,
        aiSummary: result.aiSummary,
        teacherNotes: result.teacherNotes,
        confidence: result.confidence.toFixed(3),
        model: result.model,
        verification: result.verification,
        simulated: provider.name === 'mock',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        costCents: result.usage.costCents.toFixed(4),
        // El PDF se genera al vuelo al descargarlo; en actividades sin fichero
        // el contrato pide `null`.
        annotatedFileUrl: withFile ? routes.feedbackFile(submission.id) : null,
        publishedAutomatically: false,
        publishedAt: null,
      })
      .returning();
    if (!correction) throw new Error('No se ha podido guardar la corrección.');

    // Sin apartados en las actividades no puntuables: no hay puntos que repartir.
    const itemRows = result.items.length > 0
      ? await tx.insert(schema.correctionItems).values(
        result.items.map((item) => ({
          correctionId: correction.id,
          label: item.label,
          statement: item.statement,
          maxPoints: String(item.maxPoints),
          aiPoints: String(item.aiPoints),
          aiFeedback: item.aiFeedback,
          aiQuote: item.aiQuote,
          aiQuotePage: item.aiQuotePage,
          confidence: item.confidence.toFixed(3),
          alternativeMethod: item.alternativeMethod,
          position: item.position,
        })),
      ).returning()
      : [];

    await tx
      .update(schema.submissions)
      .set({
        // La vía autónoma no finge una validación. Conserva el estado de
        // trabajo hasta que Moodle confirme la publicación real.
        status: publication === 'publish' ? 'grading' : 'graded',
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(schema.submissions.id, submission.id));

    return { correction, itemRows, transcriptionRow };
  });

  addUsage(usageAccumulator, result.usage);

  if (publication === 'review') return { autoPublished: false };

  signal.throwIfAborted();
  if (submission.remoteId === null) {
    throw new Error('La entrega no tiene referencia remota y no se puede publicar automáticamente.');
  }
  const connector = await connectorForUser(
    ctx,
    activity.importedBy ?? fallbackPublisherId ?? '',
  );
  const originalFile = submission.storagePath === null
    ? null
    : await new FileStore(ctx.config.STORAGE_ROOT)
        .read(submission.storagePath)
        .then((bytes) => ({
          bytes,
          mediaType: submission.mediaType ?? 'application/octet-stream',
        }))
        .catch(() => null);
  const outcome = await publishToLms(
    connector,
    {
      activity: {
        slug: activity.slug,
        lmsRef: activity.moodleRef,
        kind: activity.kind,
      },
      studentRef: submission.studentRef,
      remoteId: submission.remoteId,
    },
    {
      submission: toSubmission(submission),
      activity: toActivity(activity),
      correction: toCorrection(persisted.correction, persisted.itemRows),
      alreadyPublished: { grade: false, file: false },
      transcription: persisted.transcriptionRow ? toTranscription(persisted.transcriptionRow) : null,
      originalFile,
    },
  );
  await recordPublication(ctx, persisted.correction, submission.id, outcome, true);

  return { autoPublished: true };
}

function addUsage(target: UsageMetrics, value: UsageMetrics): void {
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.cacheCreationTokens = (target.cacheCreationTokens ?? 0) + (value.cacheCreationTokens ?? 0);
  target.costCents = Math.round((target.costCents + value.costCents) * 10_000) / 10_000;
}

/**
 * El recorte del perfil del alumno que puede entrar en el prompt.
 *
 * Se lee por entrega y no se memoriza por actividad como el contexto: cada
 * entrega es de un alumno distinto, así que no hay nada que compartir entre
 * ellas. Y por eso mismo **no viaja dentro del contexto**, que es el prefijo
 * cacheado de la actividad: meter ahí un dato que cambia en cada entrega
 * invalidaría la caché en todas.
 */
async function studentContextOf(
  ctx: AppContext,
  studentId: string | null,
): Promise<StudentContext | null> {
  if (studentId === null) return null;

  const [row] = await ctx.db
    .select()
    .from(schema.students)
    .where(eq(schema.students.id, studentId))
    .limit(1);
  if (!row) return null;

  const context = studentContextFor(row);
  if (context === null) return null;

  // `@vega/shared` devuelve arrays de sólo lectura —lo que impide que nadie le
  // añada un campo por el camino— y el esquema Zod del motor los quiere
  // mutables. Se copian aquí, en la frontera, y no se relaja el tipo de origen.
  return { name: context.name, community: context.community, fields: [...context.fields] };
}

/**
 * De dónde saca el motor lo que el alumno entregó.
 *
 * Hasta la ingesta, aquí se fabricaban rutas falsas (`examen.pdf#1`) que sólo el
 * proveedor simulado toleraba: el real habría hecho `readFile` sobre ellas y
 * habría reventado. Con el fichero descargado y guardado, se pasa la ruta buena.
 *
 * **Un PDF viaja como un solo documento, no como N páginas.** La API de visión
 * recibe el PDF entero y lo pagina ella; partirlo exigiría rasterizar, que es
 * justo la dependencia nativa que el proyecto evita (ADR 0001). `page_count`
 * sigue siendo metadato: sirve para la interfaz, para el coste y para detectar
 * una entrega desproporcionada, no para trocear la petición.
 *
 * Consecuencia que hay que tener presente al encender el motor: con un fichero
 * real el proveedor simulado recibe **una** página y devuelve una transcripción
 * de una página, aunque el PDF tenga cuatro. No es un fallo de la ingesta; es
 * que el troceado por página es una decisión del motor y aún no está tomada.
 */
export async function pagesOf(
  ctx: AppContext,
  submission: SubmissionRow,
  pagesPerChunk = 4,
  allowSynthetic = false,
): Promise<PageSource[]> {
  if (submission.storagePath !== null) {
    const store = new FileStore(ctx.config.STORAGE_ROOT);
    const mediaType = pageMediaType(submission.mediaType);
    const path = store.absolutePathOf(submission.storagePath);
    if (mediaType !== 'application/pdf') return [{ page: 1, pageNumbers: [1], mediaType, path }];
    return splitPdfIntoPageSources(await store.read(submission.storagePath), pagesPerChunk);
  }

  // Entregas sembradas por `pnpm db:demo`: no hay fichero en ninguna parte y la
  // ruta es sólo un identificador con el que el mock siembra su generador. Con
  // un proveedor real esto no llega a ejecutarse, porque una entrega sin fichero
  // descargado no debería salir de la ingesta.
  if (!allowSynthetic) {
    throw new Error('La entrega no tiene un fichero real almacenado; se rechaza para el proveedor activo.');
  }
  return Array.from({ length: Math.max(1, submission.pageCount) }, (_unused, index) => ({
    page: index + 1,
    mediaType: 'application/pdf' as const,
    path: `${submission.originalFilename ?? submission.id}#${index + 1}`,
  }));
}

/** Parte un PDF sin rasterizar y conserva un manifiesto exacto de páginas. */
export async function splitPdfIntoPageSources(
  bytes: Uint8Array,
  pagesPerChunk = 4,
): Promise<PageSource[]> {
  if (!Number.isInteger(pagesPerChunk) || pagesPerChunk <= 0) {
    throw new Error('ai.pagesPerChunk debe ser un entero positivo.');
  }
  const source = await PDFDocument.load(bytes);
  const total = source.getPageCount();
  if (total === 0) throw new Error('El PDF no contiene páginas.');
  const chunks: PageSource[] = [];
  for (let start = 0; start < total; start += pagesPerChunk) {
    const pageNumbers = Array.from(
      { length: Math.min(pagesPerChunk, total - start) },
      (_unused, offset) => start + offset + 1,
    );
    const chunk = await PDFDocument.create();
    const copied = await chunk.copyPages(source, pageNumbers.map((page) => page - 1));
    for (const page of copied) chunk.addPage(page);
    chunks.push({
      page: pageNumbers[0]!,
      pageNumbers,
      mediaType: 'application/pdf',
      bytes: new Uint8Array(await chunk.save()),
    });
  }
  const assembled = chunks.flatMap((chunk) => chunk.pageNumbers ?? []);
  const expected = Array.from({ length: total }, (_unused, index) => index + 1);
  if (assembled.length !== expected.length || assembled.some((page, index) => page !== expected[index])) {
    throw new Error('El manifiesto del PDF contiene páginas ausentes o duplicadas.');
  }
  return chunks;
}

/** El motor sólo admite los tipos que la API de visión sabe leer. */
function pageMediaType(mediaType: string | null): 'application/pdf' | 'image/jpeg' | 'image/png' {
  switch (mediaType) {
    case 'image/jpeg':
      return 'image/jpeg';
    case 'image/png':
      return 'image/png';
    default:
      return 'application/pdf';
  }
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
