import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';

/**
 * Almacén de los ficheros que entregan los alumnos.
 *
 * Es un directorio del sistema de ficheros, no un almacén de objetos. La
 * decisión no es por comodidad: el despliegue objetivo es una academia con un
 * Docker y decenas de entregas por noche, y añadir S3 sería una pieza de
 * infraestructura más que mantener, respaldar y explicar, a cambio de nada que
 * se note. Lo que sí importa es que **toda la aplicación pase por aquí**: el día
 * que el volumen se quede corto, se reescribe este fichero y nadie más se entera.
 *
 * Dos reglas que sostienen eso:
 *
 *  - En la base de datos se guarda una ruta **relativa** (`submissions/<id>/…`).
 *    Guardar la absoluta ataría las filas a la ruta de montaje de hoy: mover el
 *    volumen o cambiar de máquina dejaría inservible la mitad de la tabla.
 *  - Ninguna ruta se construye con datos del LMS sin sanear. El nombre de
 *    fichero lo elige un alumno a través de Moodle, y `../../etc/passwd` es un
 *    nombre de fichero perfectamente válido para Moodle.
 */

export interface StoredFile {
  /** Ruta relativa a la raíz del almacén; es lo que se guarda en la tabla. */
  readonly storagePath: string;
  readonly sizeBytes: number;
  /** SHA-256 del contenido, para detectar una reentrega con el mismo nombre. */
  readonly sha256: string;
}

export class FileStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  /** Ruta absoluta de una ruta guardada. Rechaza cualquier intento de salir. */
  absolutePathOf(storagePath: string): string {
    if (isAbsolute(storagePath)) {
      throw new Error(`Ruta de almacén no válida (es absoluta): "${storagePath}".`);
    }
    const absolute = resolve(this.#root, normalize(storagePath));
    if (absolute !== this.#root && !absolute.startsWith(this.#root + sep)) {
      throw new Error(`Ruta de almacén no válida (se sale del almacén): "${storagePath}".`);
    }
    return absolute;
  }

  /**
   * Guarda el fichero de una entrega. Sobrescribe a propósito: si se vuelve a
   * descargar la misma entrega es porque la anterior no servía, y dejar dos
   * copias con el mismo destino sería peor que pisarla.
   */
  async saveSubmissionFile(
    submissionId: string,
    filename: string,
    bytes: Uint8Array,
  ): Promise<StoredFile> {
    const storagePath = join('submissions', submissionId, safeFilename(filename));
    const absolute = this.absolutePathOf(storagePath);

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);

    return {
      storagePath,
      sizeBytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  read(storagePath: string): Promise<Buffer> {
    return readFile(this.absolutePathOf(storagePath));
  }

  /** Borra lo guardado de una entrega. No falla si no había nada. */
  async removeSubmissionFiles(submissionId: string): Promise<void> {
    const absolute = this.absolutePathOf(join('submissions', submissionId));
    await rm(absolute, { recursive: true, force: true });
  }
}

/**
 * Nombre de fichero seguro a partir de uno cualquiera.
 *
 * Lo elige el alumno al subir su examen a Moodle, así que llega sin ninguna
 * garantía: puede traer barras, `..`, caracteres de control o tener 400
 * caracteres. Se conserva la extensión porque es lo único del nombre original
 * que el resto del sistema usa —decidir si es un PDF o una imagen—, y el resto
 * se reduce a lo que es seguro escribir en un `ext4` y en un `NTFS`.
 */
export function safeFilename(filename: string): string {
  // Sólo la última parte: `../../x.pdf` y `C:\x.pdf` valen como nombre en Moodle.
  const base = filename.split(/[\\/]/).pop() ?? '';

  const cleaned = base
    // Todo lo que no sea letra, dígito, punto, guion o subrayado pasa a guion.
    // Es más agresivo de lo estrictamente necesario —se pierden los acentos—,
    // pero este nombre no lo lee nadie: el que se le enseña al profesor es
    // `submissions.original_filename`, que conserva el original intacto.
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    // Un nombre que empieza por punto se esconde en Unix, y uno que empieza por
    // guion se confunde con una opción en cualquier comando.
    .replace(/^[.-]+/, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 120);

  return cleaned === '' ? 'entrega.bin' : cleaned;
}
