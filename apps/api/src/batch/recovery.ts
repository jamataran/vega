import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { schema } from '../db/client.js';
import type { AppContext } from '../context.js';

/**
 * Recuperación al arrancar.
 *
 * El proceso de corrección vive dentro del API y no tiene cola durable: si el
 * contenedor se reinicia a mitad de un lote —un despliegue, un OOM, un corte—,
 * lo que estaba a medias se queda a medias **para siempre**. Y no de forma
 * visible: el `batch_runs` se queda en `running`, que además bloquea el
 * siguiente lote; y las entregas se quedan en `transcribing` o `grading`, que
 * no son estados que el lote recoja —sólo toma `pending`— ni estados que la
 * cola enseñe por defecto. Desaparecen.
 *
 * Es HU-09, RN-6, y no estaba implementado. Con el proveedor simulado el daño
 * era invisible porque un lote entero tarda milisegundos; con llamadas reales
 * una entrega tarda minutos y la ventana deja de ser teórica.
 *
 * Se ejecuta antes de escuchar peticiones, cuando todavía no hay ningún lote en
 * marcha en este proceso. Si hubiera dos réplicas, la de al lado podría estar
 * corrigiendo de verdad: por eso se limita a lo que lleva parado un rato y no a
 * todo lo que encuentra.
 */

/** Margen de gracia: por debajo de esto se asume que alguien está trabajando. */
const STALE_AFTER_MS = 30 * 60_000;

export interface RecoveryReport {
  readonly runsClosed: number;
  readonly submissionsRequeued: number;
}

export async function recoverInterruptedWork(
  ctx: AppContext,
  now: Date = new Date(),
): Promise<RecoveryReport> {
  const { db } = ctx;
  const threshold = new Date(now.getTime() - STALE_AFTER_MS);

  const stuckRuns = await db
    .select({ id: schema.batchRuns.id, startedAt: schema.batchRuns.startedAt })
    .from(schema.batchRuns)
    .where(and(eq(schema.batchRuns.status, 'running'), isNull(schema.batchRuns.finishedAt)));

  const toClose = stuckRuns.filter((run) => run.startedAt < threshold).map((run) => run.id);

  if (toClose.length > 0) {
    await db
      .update(schema.batchRuns)
      .set({ status: 'failed', finishedAt: now })
      .where(inArray(schema.batchRuns.id, toClose));
  }

  // Las entregas atrapadas vuelven a `pending`, no a `error`: no ha fallado
  // nada suyo, simplemente nadie terminó de procesarlas. `error` obligaría al
  // profesor a reprocesarlas a mano una a una.
  //
  // Vuelven a transcribirse desde cero, y eso cuesta tokens otra vez. Retomar
  // desde `transcribed` sería más barato pero exige que el lote sepa continuar
  // a mitad de camino, que hoy no sabe: encadena transcripción y corrección en
  // la misma operación. Queda anotado como pregunta abierta de HU-09.
  const requeued = await db
    .update(schema.submissions)
    .set({ status: 'pending', updatedAt: now })
    .where(
      and(
        inArray(schema.submissions.status, ['transcribing', 'grading']),
        // Sólo lo que lleva parado más del margen: una entrega que se está
        // procesando ahora mismo en otra réplica no se toca.
        lt(schema.submissions.updatedAt, threshold),
      ),
    )
    .returning({ id: schema.submissions.id });

  return { runsClosed: toClose.length, submissionsRequeued: requeued.length };
}
