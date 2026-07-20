import '../env.js';
import { loadConfig } from '../config.js';
import { createDb } from './client.js';

/**
 * Tira el esquema entero. Sólo para desarrollo: después hay que volver a
 * migrar y sembrar (`pnpm db:migrate && pnpm db:demo`).
 */
const config = loadConfig();

if (config.NODE_ENV === 'production') {
  console.error('✖ `reset` está deshabilitado en producción.');
  process.exit(1);
}

const { sql } = createDb(config.DATABASE_URL, { max: 1 });
try {
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;').simple();
  console.log('✔ Esquema eliminado. Ejecuta `pnpm db:migrate && pnpm db:demo`.');
} finally {
  await sql.end();
}
