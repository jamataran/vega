import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from 'postgres';
import { createDb } from './client.js';
import { loadConfig } from '../config.js';
import '../env.js';

/**
 * Aplicador de migraciones SQL planas.
 *
 * Se ejecuta al arrancar el contenedor del API (ver Dockerfile), así que tiene
 * que ser idempotente y seguro ante ejecuciones concurrentes: dos réplicas
 * arrancando a la vez no deben aplicar la misma migración dos veces. De ahí el
 * `pg_advisory_lock`.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Cualquier número constante sirve; sólo tiene que ser el mismo en todas las réplicas. */
const ADVISORY_LOCK_KEY = 0x7645_6741; // "vEgA"

const LEDGER = `
  CREATE TABLE IF NOT EXISTS _vega_migrations (
    name        text PRIMARY KEY,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
  );
`;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

function checksum(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export async function runMigrations(sql: Sql, log = console.log): Promise<MigrationResult> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  const conn = await sql.reserve();
  try {
    await conn.unsafe(`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`).simple();
    await conn.unsafe(LEDGER).simple();

    const rows = await conn<{ name: string; checksum: string }[]>`
      SELECT name, checksum FROM _vega_migrations
    `;
    const known = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const file of files) {
      const content = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const sum = checksum(content);
      const previous = known.get(file);

      if (previous !== undefined) {
        // Una migración ya aplicada que cambia es casi siempre un error humano:
        // avisamos alto y claro, pero no reventamos el arranque en producción.
        if (previous !== sum) {
          log(`⚠  ${file} ya estaba aplicada pero su contenido ha cambiado (${previous} → ${sum}).`);
          log('   Crea una migración nueva en lugar de editar una ya aplicada.');
        }
        skipped.push(file);
        continue;
      }

      log(`→ aplicando ${file}`);
      try {
        await conn.unsafe('BEGIN').simple();
        await conn.unsafe(content).simple();
        await conn`
          INSERT INTO _vega_migrations (name, checksum) VALUES (${file}, ${sum})
        `;
        await conn.unsafe('COMMIT').simple();
        applied.push(file);
      } catch (error) {
        await conn.unsafe('ROLLBACK').simple().catch(() => {});
        throw new Error(`La migración ${file} ha fallado: ${(error as Error).message}`, { cause: error });
      }
    }
  } finally {
    await conn.unsafe(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`).simple().catch(() => {});
    conn.release();
  }

  return { applied, skipped };
}

// Ejecución directa: `pnpm db:migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const { sql } = createDb(config.DATABASE_URL, { max: 1 });
  try {
    const result = await runMigrations(sql);
    if (result.applied.length === 0) {
      console.log(`✔ Base de datos al día (${result.skipped.length} migraciones ya aplicadas).`);
    } else {
      console.log(`✔ ${result.applied.length} migración(es) aplicada(s).`);
    }
  } catch (error) {
    console.error(`✖ ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
