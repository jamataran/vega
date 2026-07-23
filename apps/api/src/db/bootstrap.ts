import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { ActivityKind } from '@vega/shared';
import { hashPassword } from '../auth/password.js';
import { schema } from './client.js';
import type { Database } from './client.js';
import type { Config } from '../config.js';
import { contextContentHash } from '../contexts/service.js';
import { seedPrompts } from '../prompts/service.js';

/**
 * Puesta en marcha de una instalación vacía.
 *
 * Se ejecuta en cada arranque y es **idempotente**: no siembra datos de
 * ejemplo, no pisa nada de lo que haya y no borra nunca. Un despliegue nuevo
 * arranca en blanco —sin cursos, sin actividades y sin entregas— con lo justo
 * para poder entrar y empezar a configurar.
 *
 * Los datos de demostración viven aparte, en `demo.ts`, y sólo se cargan
 * ejecutando `pnpm db:demo` a mano.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * La primera ruta es la copia inmutable que viaja en la imagen. La segunda
 * conserva compatibilidad con ejecuciones desde la raíz del paquete y la
 * tercera con `tsx`, donde `import.meta.url` todavía apunta al árbol fuente.
 */
const DEFAULT_CONTEXT_SEED_ROOTS = [
  join(process.cwd(), 'context-seeds'),
  join(process.cwd(), 'contexts'),
  join(REPO_ROOT, 'contexts'),
] as const;

export interface ContextSeedRow {
  readonly level: 'global' | 'activity_kind' | 'template';
  readonly key: string;
  readonly content: string;
}

async function readContextFile(
  relativePath: string,
  roots: readonly string[],
): Promise<string> {
  for (const root of new Set(roots)) {
    try {
      return await readFile(join(root, relativePath), 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    }
  }

  throw new Error(
    `No se ha encontrado el contexto obligatorio ${relativePath} en: ${roots.join(', ')}. ` +
      'La aplicación no debe arrancar sin los criterios de corrección.',
  );
}

/** Carga todos los contextos mínimos que una instalación nueva necesita. */
export async function loadContextSeedRows(
  roots: readonly string[] = DEFAULT_CONTEXT_SEED_ROOTS,
): Promise<readonly ContextSeedRow[]> {
  const installation = await readContextFile('installation.md', roots);
  const globalRules = await readContextFile('global.md', roots);
  const rows: ContextSeedRow[] = [
    {
      level: 'global',
      key: 'global',
      content: `${installation}\n\n---\n\n${globalRules}`,
    },
  ];

  for (const kind of ActivityKind.options) {
    rows.push({
      level: 'activity_kind',
      key: kind,
      content: await readContextFile(`activity-kinds/${kind}.md`, roots),
    });
  }

  rows.push(
    {
      level: 'template',
      key: 'simulacro-problema',
      content: await readContextFile('activity-kinds/assignment.md', roots),
    },
    {
      level: 'template',
      key: 'simulacro-tema',
      content: await readContextFile('activity-kinds/assignment-tema.md', roots),
    },
  );

  return rows;
}

/**
 * Vuelca los Markdown de `contexts/` que todavía no existan en base de datos.
 *
 * Esto **no es dato de ejemplo**: es la configuración de corrección por
 * defecto, y sin ella el modelo corregiría sin ninguna instrucción. El
 * `ON CONFLICT DO NOTHING` implementa la regla de HU-06: el fichero siembra, la
 * base de datos manda. Lo que el profesorado edite desde la aplicación no se
 * pisa en el siguiente arranque.
 */
async function seedContexts(db: Database, log: (line: string) => void): Promise<void> {
  const rows = await loadContextSeedRows();

  let inserted = 0;
  for (const row of rows) {
    const created = await db.transaction(async (tx) => {
      const [context] = await tx
        .insert(schema.gradingContexts)
        .values({ level: row.level, key: row.key, activeVersion: 1 })
        .onConflictDoNothing({
          target: [schema.gradingContexts.level, schema.gradingContexts.key],
        })
        .returning({ id: schema.gradingContexts.id });
      if (!context) return false;
      await tx.insert(schema.gradingContextVersions).values({
        contextId: context.id,
        version: 1,
        content: row.content,
        contentHash: contextContentHash(row.content),
        source: 'seed',
        createdBy: null,
      });
      return true;
    });
    if (created) inserted += 1;
  }

  if (inserted > 0) {
    log(`→ contextos de corrección sembrados desde contexts/: ${inserted}`);
  }
}

/**
 * Crea el administrador inicial **sólo si no hay ningún usuario**.
 *
 * En cuanto exista uno, esto no vuelve a hacer nada: no recrea al admin
 * borrado ni le devuelve la contraseña a la de fábrica, que sería una puerta
 * trasera permanente disfrazada de comodidad.
 */
async function ensureAdmin(
  db: Database,
  config: Config,
  log: (line: string) => void,
): Promise<void> {
  const [existing] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.users);
  if ((existing?.count ?? 0) > 0) return;

  const email = config.BOOTSTRAP_ADMIN_EMAIL.toLowerCase().trim();
  await db.insert(schema.users).values({
    email,
    name: 'Administración',
    role: 'admin',
    passwordHash: await hashPassword(config.BOOTSTRAP_ADMIN_PASSWORD),
  });

  log(`→ instalación vacía: creado el administrador inicial ${email}`);
  if (config.BOOTSTRAP_ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
    // A la vista y en cada arranque, no una vez y a otra cosa: una contraseña
    // de fábrica en un despliegue accesible desde fuera es una cuenta de
    // administración regalada, y el aviso deja de ser ruido cuando se cambia.
    log(
      '⚠  La contraseña del administrador es la de fábrica. Cámbiala al entrar, ' +
        'o fija BOOTSTRAP_ADMIN_PASSWORD antes del primer arranque.',
    );
  }
}

export const DEFAULT_ADMIN_PASSWORD = 'admin';

export async function bootstrap(
  db: Database,
  config: Config,
  log: (line: string) => void = () => {},
): Promise<void> {
  await seedContexts(db, log);
  await seedPrompts(db, log);
  await ensureAdmin(db, config, log);
}
