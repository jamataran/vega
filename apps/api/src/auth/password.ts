import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// `promisify` no sabe elegir entre las sobrecargas de `scrypt`, así que le
// indicamos cuál queremos: la que acepta parámetros de coste.
const scryptAsync = promisify<string, Buffer, number, ScryptOptions, Buffer>(scrypt);

/**
 * Hash de contraseñas con scrypt de la librería estándar.
 *
 * Preferimos scrypt a bcrypt/argon2 porque no arrastra dependencias nativas:
 * el monorepo se instala igual en macOS, en Alpine y en CI sin compilar nada.
 * Formato almacenado: `scrypt$N$r$p$<salt-b64>$<hash-b64>`.
 */

const N = 16384; // coste de CPU/memoria
const r = 8;
const p = 1;
const KEY_LENGTH = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(plain.normalize('NFKC'), salt, KEY_LENGTH, { N, r, p })) as Buffer;
  return ['scrypt', N, r, p, salt.toString('base64'), derived.toString('base64')].join('$');
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64 ?? '', 'base64');
  const expected = Buffer.from(hashB64 ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = (await scryptAsync(plain.normalize('NFKC'), salt, expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
  })) as Buffer;

  return timingSafeEqual(derived, expected);
}
