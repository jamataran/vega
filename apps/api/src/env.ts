import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Carga el `.env` de la raíz del monorepo si existe.
 *
 * Importar este módulo tiene efectos secundarios a propósito: se hace al
 * principio de cada punto de entrada (servidor, migraciones, semillas, CLI)
 * para que todos vean las mismas variables. En producción no hay `.env` y las
 * variables llegan del entorno del contenedor, así que la ausencia es normal.
 */
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  join(here, '../../../.env'), // raíz del monorepo
  join(here, '../.env'), // apps/api/.env, por si alguien lo prefiere local
];

for (const path of candidates) {
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}
