import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDb>['db'];
export type SqlClient = ReturnType<typeof createDb>['sql'];

export function createDb(databaseUrl: string, options: { max?: number } = {}) {
  const sql = postgres(databaseUrl, {
    max: options.max ?? 10,
    // Los scripts (migrar, sembrar) deben terminar solos en vez de quedarse
    // colgados esperando a que el pool caduque.
    idle_timeout: 20,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { sql, db };
}

export { schema };
