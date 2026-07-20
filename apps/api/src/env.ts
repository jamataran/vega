import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Carga los ficheros de entorno del monorepo si existen.
 *
 * Importar este módulo tiene efectos secundarios a propósito: se hace al
 * principio de cada punto de entrada (servidor, migraciones, semillas, CLI)
 * para que todos vean las mismas variables. En producción no hay `.env` y las
 * variables llegan del entorno del contenedor, así que la ausencia es normal.
 *
 * Se cargan **todos** los que existan, de menor a mayor precedencia: el último
 * en cargarse pisa a los anteriores. `.env.local` va al final porque es el
 * fichero de credenciales de cada desarrollador —está en `.gitignore` y es
 * donde se pone el Moodle de pruebas— y tiene que poder sobrescribir al `.env`
 * compartido sin editarlo.
 */
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  join(here, '../../../.env'), // raíz del monorepo
  join(here, '../.env'), // apps/api/.env, por si alguien lo prefiere local
  join(here, '../../../.env.local'), // credenciales locales, nunca en git
];

for (const path of candidates) {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}
