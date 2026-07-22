import { and, eq, inArray, isNull } from 'drizzle-orm';
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
 * marcha en este proceso. El despliegue soportado es de una sola instancia: una
 * fila `running` en ese momento pertenece necesariamente al proceso anterior.
 */

export interface RecoveryReport {
  readonly runsClosed: number;
  readonly submissionsRequeued: number;
  readonly callsClosed: number;
}

export async function recoverInterruptedWork(
  ctx: AppContext,
  now: Date = new Date(),
): Promise<RecoveryReport> {
  const { db } = ctx;

  const stuckRuns = await db
    .select({ id: schema.batchRuns.id })
    .from(schema.batchRuns)
    .where(and(eq(schema.batchRuns.status, 'running'), isNull(schema.batchRuns.finishedAt)));

  const toClose = stuckRuns.map((run) => run.id);

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
    .where(inArray(schema.submissions.status, ['transcribing', 'grading']))
    .returning({ id: schema.submissions.id });

  // El ledger inserta la fila antes de salir a la red. Si el proceso cae, esa
  // fila no puede completarse sola y la UI la interpretaría como «En curso»
  // para siempre. Al arrancar no existe todavía ninguna llamada de este proceso.
  const interruptedCalls = await db
    .update(schema.aiCalls)
    .set({
      error: 'La llamada se interrumpió al reiniciar el servicio.',
      stopReason: 'interrupted',
    })
    .where(
      and(
        eq(schema.aiCalls.parsedOk, false),
        isNull(schema.aiCalls.error),
        isNull(schema.aiCalls.latencyMs),
      ),
    )
    .returning({ id: schema.aiCalls.id });

  return {
    runsClosed: toClose.length,
    submissionsRequeued: requeued.length,
    callsClosed: interruptedCalls.length,
  };
}
