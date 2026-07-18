import type { Database, SqlClient } from './db/client.js';
import type { Config } from './config.js';

/** Dependencias que comparten todas las rutas. Se pasan explícitas, sin singletons. */
export interface AppContext {
  db: Database;
  sql: SqlClient;
  config: Config;
  startedAt: number;
}
