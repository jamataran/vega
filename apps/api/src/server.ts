import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from './auth/plugin.js';
import { startScheduler } from './batch/scheduler.js';
import { createDb } from './db/client.js';
import { registerErrorHandler } from './http/errors.js';
import { activityRoutes } from './routes/activities.js';
import { authRoutes } from './routes/auth.js';
import { batchRoutes, runBatch } from './routes/batch.js';
import { contextRoutes } from './routes/contexts.js';
import { healthRoutes } from './routes/health.js';
import { scanRoutes } from './routes/scans.js';
import { settingsRoutes } from './routes/settings.js';
import { statsRoutes } from './routes/stats.js';
import { submissionRoutes } from './routes/submissions.js';
import { userRoutes } from './routes/users.js';
import type { AppContext } from './context.js';
import { loggerOptions } from './logging.js';
import type { Config } from './config.js';

export interface BuiltServer {
  app: FastifyInstance;
  ctx: AppContext;
}

export async function buildServer(config: Config): Promise<BuiltServer> {
  const { sql, db } = createDb(config.DATABASE_URL);
  const ctx: AppContext = { db, sql, config, startedAt: Date.now() };

  const app = Fastify({
    logger: loggerOptions(config),
    // El proxy inverso es quien termina TLS; necesitamos la IP real en los logs.
    trustProxy: true,
    /**
     * Explícito y no el defecto de Fastify (1 MiB), para que el tope sea una
     * decisión y no un accidente. Los ficheros de contexto suben troceados en
     * trozos de `UPLOAD_CHUNK_BYTES`, así que ninguna petición legítima se
     * acerca a esto; el margen cubre el JSON que envuelve al trozo y el escapado
     * de las contrabarras, que en LaTeX son muchas y se duplican.
     */
    bodyLimit: 2 * 1024 * 1024,
  });

  registerErrorHandler(app);

  // Acciones como publicar o reprocesar no llevan cuerpo, pero muchos clientes
  // mandan `Content-Type: application/json` de todas formas. Sin esto, Fastify
  // responde 400 a un POST perfectamente válido.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body: string, done) => {
      if (body === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  await app.register(cors, {
    origin: config.NODE_ENV === 'development' ? true : config.WEB_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  });

  await registerAuth(app, config);

  // Cada grupo de rutas recibe el contexto explícito en vez de leer un singleton:
  // así los tests pueden montar el servidor contra otra base de datos.
  await healthRoutes(app, ctx);
  await authRoutes(app, ctx);
  await submissionRoutes(app, ctx);
  await activityRoutes(app, ctx);
  await contextRoutes(app, ctx);
  await userRoutes(app, ctx);
  await settingsRoutes(app, ctx);
  await statsRoutes(app, ctx);
  await batchRoutes(app, ctx);
  await scanRoutes(app, ctx);

  // Planificador del proceso de corrección. Corre dentro del propio API porque
  // el despliegue es de una instancia por entorno; el cerrojo de Postgres lo
  // protege igualmente si algún día hay dos réplicas. Se activa y se ajusta
  // desde Ajustes, no desde el entorno.
  const scheduler = startScheduler(
    ctx,
    // El planificador no tiene usuario detrás: `triggeredBy` va a `null`.
    (triggeredBy) => runBatch(ctx, triggeredBy, app.log),
    app.log,
  );

  app.addHook('onClose', async () => {
    scheduler.stop();
    await sql.end();
  });

  return { app, ctx };
}
