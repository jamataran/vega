import type { FastifyBaseLogger } from 'fastify';
import { getSettings, markScheduleRun } from '../settings/service.js';
import type { AppContext } from '../context.js';
import { purgeAiCalls } from '../ai/ledger.js';

/**
 * Planificador de los procesos de corrección.
 *
 * Vive dentro del propio API porque el despliegue es de una sola instancia por
 * entorno. Aun así se protege con `pg_try_advisory_lock`: si algún día hay dos
 * réplicas, sólo una ejecuta el lote y la otra se lo salta sin bloquearse. Es
 * el mismo mecanismo que usan las migraciones al arrancar, así que no añade
 * infraestructura nueva.
 */

/** Distinto al de las migraciones: son cerrojos independientes. */
const SCHEDULER_LOCK_KEY = 0x7645_6742; // "vEgB"

/** Cada cuánto miramos si toca. La frecuencia real la decide el administrador. */
const TICK_MS = 60_000;

export interface Scheduler {
  stop: () => void;
}

export function startScheduler(
  ctx: AppContext,
  runBatch: (triggeredBy: string | null) => Promise<{ processed: number }>,
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

    if (!settings.schedule.enabled) return;

    const due =
      settings.schedule.nextRunAt === null ||
      new Date(settings.schedule.nextRunAt).getTime() <= Date.now();
    if (!due) return;

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
      await markScheduleRun(ctx, startedAt);
      const result = await runBatch(null);
      log.info(
        { processed: result.processed, everyMinutes: settings.schedule.everyMinutes },
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
