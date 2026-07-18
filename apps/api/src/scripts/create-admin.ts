import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { eq } from 'drizzle-orm';
import '../env.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { createDb, schema } from '../db/client.js';

/**
 * Crea el primer usuario administrador de una instalación nueva.
 * Acepta argumentos (`--email`, `--name`, `--password`) o pregunta por consola.
 */

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const config = loadConfig();
const { sql, db } = createDb(config.DATABASE_URL, { max: 1 });

try {
  const rl = createInterface({ input: stdin, output: stdout });

  const email = (argValue('--email') ?? (await rl.question('Correo del administrador: '))).toLowerCase().trim();
  const name = argValue('--name') ?? (await rl.question('Nombre: '));
  const password = argValue('--password') ?? (await rl.question('Contraseña (mínimo 8 caracteres): '));
  rl.close();

  if (!email.includes('@')) throw new Error('El correo no es válido.');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) {
    // Reutilizable para recuperar el acceso si alguien pierde la contraseña.
    await db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(password), role: 'admin', active: true, name })
      .where(eq(schema.users.id, existing.id));
    console.log(`✔ Usuario ${email} actualizado como administrador.`);
  } else {
    await db
      .insert(schema.users)
      .values({ email, name, role: 'admin', passwordHash: await hashPassword(password) });
    console.log(`✔ Administrador ${email} creado.`);
  }
} catch (error) {
  console.error(`✖ ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
