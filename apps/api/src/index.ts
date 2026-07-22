import './env.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { bootstrap } from './db/bootstrap.js';
import { runMigrations } from './db/migrate.js';
import { recoverInterruptedWork } from './batch/recovery.js';
import { buildServer } from './server.js';

/**
 * Punto de entrada del API.
 *
 * Aplica las migraciones antes de escuchar: es lo que permite que el flujo
 * GitOps despliegue sólo imágenes, sin paso manual de migración (ver README).
 */
const config = loadConfig();

const { sql: migrationSql, db: migrationDb } = createDb(config.DATABASE_URL, { max: 1 });
try {
  const result = await runMigrations(migrationSql, (line) => console.log(line));
  if (result.applied.length > 0) {
    console.log(`✔ ${result.applied.length} migración(es) aplicada(s) al arrancar.`);
  }
  // Tras migrar y antes de escuchar: una instalación vacía necesita contextos
  // de corrección y un administrador con el que entrar. No siembra datos de
  // ejemplo ni pisa nada existente.
  await bootstrap(migrationDb, config, (line) => console.log(line));

  // Un reinicio a mitad de lote dejaba el `batch_runs` en `running` —lo que
  // bloquea el siguiente— y las entregas atrapadas en `transcribing`, que nadie
  // vuelve a recoger. Con el proveedor simulado la ventana era de milisegundos;
  // con llamadas reales es de minutos.
  const recovered = await recoverInterruptedWork({
    db: migrationDb,
    sql: migrationSql,
    config,
    startedAt: Date.now(),
  });
  if (
    recovered.runsClosed > 0 ||
    recovered.submissionsRequeued > 0 ||
    recovered.callsClosed > 0
  ) {
    console.log(
      `↺ Recuperación: ${recovered.runsClosed} proceso(s) cerrado(s) como fallidos y ` +
        `${recovered.submissionsRequeued} entrega(s) devueltas a la cola; ` +
        `${recovered.callsClosed} llamada(s) de IA marcadas como interrumpidas.`,
    );
  }
} catch (error) {
  console.error(`✖ No se ha podido preparar la base de datos: ${(error as Error).message}`);
  process.exit(1);
} finally {
  await migrationSql.end();
}

const { app } = await buildServer(config);

try {
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  app.log.info(
    `Vega API lista · proveedor de IA: ${config.AI_PROVIDER} · conector LMS: ${config.LMS_CONNECTOR}`,
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

// Cierre ordenado: el contenedor recibe SIGTERM al redesplegar.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} recibido, cerrando…`);
    void app.close().then(() => process.exit(0));
  });
}
