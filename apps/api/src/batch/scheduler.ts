import type { FastifyBaseLogger } from 'fastify';
import type { ActivityKind } from '@vega/shared';
import { getSettings, markScheduleRun } from '../settings/service.js';
import type { AppContext } from '../context.js';
import { purgeAiCalls } from '../ai/ledger.js';
import { recoverInterruptedWork } from './recovery.js';

/**
 * Planificador de los procesos de corrección.
 *
 * Vive dentro del propio API porque el despliegue es de una sola instancia por
 * entorno. Aun así se protege con `pg_try_advisory_lock`: si algún día hay dos
 * réplicas, sólo una ejecuta el lote y la otra se lo salta sin bloquearse. Es
 * el mismo mecanismo que usan las migraciones al arrancar, así que no añade
 * infraestructura nueva.
 *
 * La planificación es **por tipo de actividad**: los foros suelen ir con una
 * cadencia corta (una duda no espera a la noche) y las entregas, más caras,
 * espaciadas. Si a un tick le tocan los dos tipos, corre un único proceso que
 * barre ambos en vez de dos procesos que se pisarían el cerrojo.
 */

/** Distinto al de las migraciones: son cerrojos independientes. */
const SCHEDULER_LOCK_KEY = 0x7645_6742; // "vEgB"

/** Cada cuánto miramos si toca. La frecuencia real la decide el administrador. */
const TICK_MS = 60_000;

export interface Scheduler {
  stop: () => void;
}

const KINDS: readonly ActivityKind[] = ['assignment', 'forum'];

/**
 * Cierra lo que quedó a medias y devuelve `false` si algo ha fallado, para que
 * el tick no siga adelante sobre un estado que no ha podido sanear.
 */
async function recoverStale(ctx: AppContext, log: FastifyBaseLogger): Promise<boolean> {
  try {
    const recovered = await recoverInterruptedWork(ctx);
    if (recovered.runsClosed > 0 || recovered.submissionsRequeued > 0) {
      log.warn(
        recovered,
        'Recuperado trabajo interrumpido: procesos cerrados y entregas devueltas a la cola',
      );
    }
    return true;
  } catch (error) {
    log.error({ err: error }, 'No se ha podido recuperar el trabajo interrumpido');
    return false;
  }
}

export function startScheduler(
  ctx: AppContext,
  runBatch: (kinds: readonly ActivityKind[]) => Promise<{ processed: number }>,
  log: FastifyBaseLogger,
): Scheduler {
  let running = false;
  let lastPurgeAt = 0;

  const tick = async (): Promise<void> => {
    // Una ejecución larga no debe solaparse con la siguiente.
    if (running) return;

    let settings;
    try {
      settings = await getSettings(ctx);
    } catch (error) {
      log.error({ err: error }, 'El planificador no ha podido leer los ajustes');
      return;
    }

    if (Date.now() - lastPurgeAt >= 86_400_000) {
      lastPurgeAt = Date.now();
      void purgeAiCalls(ctx, settings.ai.logRetentionDays).catch((error) =>
        log.error({ err: error }, 'No se ha podido purgar el registro de IA'),
      );
    }

    // Desatascar lo que quedó a medias también aquí, y no sólo al arrancar.
    //
    // La recuperación deja un margen de gracia antes de tocar nada, para no
    // pisar a una réplica que esté trabajando de verdad. Si el contenedor
    // vuelve antes de que ese margen pase —lo normal en un redespliegue— el
    // arranque no encuentra nada que cerrar y el proceso interrumpido se queda
    // en `running` **para siempre**, bloqueando todos los siguientes con un
    // «ya hay un proceso en marcha» que no hay forma de quitar sin reiniciar.
    if (!(await recoverStale(ctx, log))) return;

    const due = KINDS.filter((kind) => {
      const slot = settings.schedule[kind];
      if (!slot.enabled) return false;
      return slot.nextRunAt === null || new Date(slot.nextRunAt).getTime() <= Date.now();
    });
    if (due.length === 0) return;

    // Sólo una instancia corre el lote. `try` y no `lock` para no dejar la otra
    // esperando: si no le toca, se va y ya lo intentará en el siguiente tick.
    const [acquired] = await ctx.sql<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(${SCHEDULER_LOCK_KEY}) AS locked
    `;
    if (!acquired?.locked) return;

    running = true;
    try {
      const startedAt = new Date();
      // Se marca antes de empezar: si el lote falla, no queremos que el
      // siguiente tick lo reintente inmediatamente en bucle.
      for (const kind of due) {
        await markScheduleRun(ctx, kind, startedAt);
      }
      const result = await runBatch(due);
      log.info(
        { processed: result.processed, kinds: due },
        'Proceso de corrección ejecutado por el planificador',
      );
    } catch (error) {
      log.error({ err: error }, 'El proceso de corrección planificado ha fallado');
    } finally {
      running = false;
      await ctx.sql`SELECT pg_advisory_unlock(${SCHEDULER_LOCK_KEY})`.catch(() => {});
    }
  };

  const timer = setInterval(() => void tick(), TICK_MS);
  // No debe impedir que el proceso termine al recibir SIGTERM.
  timer.unref();

  return { stop: () => clearInterval(timer) };
}
