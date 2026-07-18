import './env.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildServer } from './server.js';

/**
 * Punto de entrada del API.
 *
 * Aplica las migraciones antes de escuchar: es lo que permite que el flujo
 * GitOps despliegue sólo imágenes, sin paso manual de migración (ver README).
 */
const config = loadConfig();

const { sql: migrationSql } = createDb(config.DATABASE_URL, { max: 1 });
try {
  const result = await runMigrations(migrationSql, (line) => console.log(line));
  if (result.applied.length > 0) {
    console.log(`✔ ${result.applied.length} migración(es) aplicada(s) al arrancar.`);
  }
} catch (error) {
  console.error(`✖ No se han podido aplicar las migraciones: ${(error as Error).message}`);
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
