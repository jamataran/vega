import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ActivityKind, DiscoveredActivity } from '@vega/shared';
import { hasStudentFile } from '@vega/shared';
import type { LmsConnector, LmsConnectorFactory } from '@vega/connector-lms';
import type {
  ActivityRef,
  DownloadedFile,
  FeedbackFile,
  LmsConnectorConfig,
  RemoteGrade,
  RemoteSubmission,
  SubmissionRef,
} from '@vega/connector-lms';

/**
 * Conector de sistema de ficheros. Es una implementación real y completa: sirve
 * para academias sin LMS y para desarrollo con exámenes de verdad.
 *
 * Convención de directorios:
 *
 *   <root>/<slug-actividad>/<ref-alumno>/<fichero>.pdf   ← entrega del alumno
 *   <root>/<slug-actividad>/<ref-alumno>/<mensaje>.txt   ← intervención de foro
 *   <root>/<slug-actividad>/<ref-alumno>/nota.json       ← nota publicada
 *   <root>/<slug-actividad>/<ref-alumno>/<feedback>.pdf  ← corrección publicada
 *
 * El nombre de la carpeta del alumno ES su referencia interna: quien monte el
 * directorio decide qué pone ahí, y así Vega nunca ve el nombre real.
 *
 * El tipo de actividad se declara en `<root>/<slug-actividad>/actividad.json`
 * (`{"kind":"forum","name":"…","courseName":"…"}`). Si no está, se deduce de lo
 * que hay dentro: carpetas con PDF o imagen son entregas; con .txt/.md, foros.
 */

export const FilesystemConfig = z.object({
  /** Raíz del árbol de entregas. `LMS_FILESYSTEM_ROOT` en el entorno. */
  root: z.string().min(1),
});
export type FilesystemConfig = z.infer<typeof FilesystemConfig>;

/** Metadatos opcionales de la actividad, para no tener que adivinar el tipo. */
const ActivityMeta = z.object({
  kind: z.enum(['assignment', 'forum']).optional(),
  name: z.string().optional(),
  courseName: z.string().optional(),
});

/** Ficheros de servicio que el conector escribe y que no son entregas. */
const GRADE_FILENAME = 'nota.json';
const PUBLISHED_MARKER = 'publicado.json';
const ACTIVITY_META_FILENAME = 'actividad.json';

const SUBMISSION_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
/** Una intervención de foro es texto plano o markdown. */
const TEXT_EXTENSIONS = ['.txt', '.md'];

export class FilesystemConnector implements LmsConnector {
  readonly name = 'filesystem';

  readonly #root: string;

  constructor(config: FilesystemConfig) {
    this.#root = config.root;
  }

  /**
   * Cada carpeta de primer nivel es una actividad. El recuento de pendientes es
   * el número de alumnos con algo entregado, que es lo que el profesor espera
   * ver antes de dar de alta la actividad en Vega.
   */
  async listActivities(): Promise<DiscoveredActivity[]> {
    const entries = await safeReaddir(this.#root);

    const activities: DiscoveredActivity[] = [];
    for (const slug of entries) {
      const activityDir = join(this.#root, slug);
      const info = await safeStat(activityDir);
      if (info === undefined || !info.isDirectory()) continue;

      const meta = await this.#readActivityMeta(activityDir);
      const kind = meta?.kind ?? (await inferKind(activityDir));
      const pendingCount = await countStudentsWithSubmission(activityDir, kind);

      activities.push({
        moodleRef: slug,
        name: meta?.name ?? slug,
        kind,
        courseName: meta?.courseName ?? '',
        pendingCount,
        // Qué está dado de alta en Vega no lo sabe el conector.
        alreadyImported: false,
      });
    }

    return activities.sort((a, b) => a.moodleRef.localeCompare(b.moodleRef));
  }

  async listSubmissions(activityRef: ActivityRef): Promise<RemoteSubmission[]> {
    const activityDir = join(this.#root, activityRef.slug);
    const studentDirs = await safeReaddir(activityDir);

    const kind =
      activityRef.kind ??
      (await this.#readActivityMeta(activityDir))?.kind ??
      (await inferKind(activityDir));
    const withFile = hasStudentFile(kind);

    const submissions: RemoteSubmission[] = [];
    for (const studentRef of studentDirs) {
      const studentDir = join(activityDir, studentRef);
      const info = await safeStat(studentDir);
      if (info === undefined || !info.isDirectory()) continue;

      const filenames = (await safeReaddir(studentDir)).filter(
        (filename) =>
          !isServiceFile(filename) &&
          (withFile ? isSubmissionFile(filename) : isTextFile(filename)),
      );

      // En un foro, todo lo que ha escrito el alumno es UNA entrega: sus
      // mensajes se concatenan, igual que llegarían de Moodle.
      if (!withFile) {
        if (filenames.length === 0) continue;
        const parts: string[] = [];
        let newest = new Date(0);
        let sizeBytes = 0;
        for (const filename of filenames.sort()) {
          const fileInfo = await safeStat(join(studentDir, filename));
          if (fileInfo === undefined || !fileInfo.isFile()) continue;
          // Se recorta cada mensaje: si no, el salto final de cada fichero se
          // suma al separador y el texto llega con huecos de tres líneas.
          parts.push((await readFile(join(studentDir, filename), 'utf8')).trim());
          sizeBytes += fileInfo.size;
          if (fileInfo.mtime > newest) newest = fileInfo.mtime;
        }
        if (parts.length === 0) continue;

        submissions.push({
          ref: {
            activity: { ...activityRef, kind },
            studentRef,
            remoteId: `${activityRef.slug}/${studentRef}`,
          },
          filename: null,
          submittedAt: newest.toISOString(),
          sizeBytes,
          mediaType: 'text/plain',
          textContent: parts.join('\n\n').trim(),
        });
        continue;
      }

      for (const filename of filenames) {
        const fileInfo = await safeStat(join(studentDir, filename));
        if (fileInfo === undefined || !fileInfo.isFile()) continue;

        submissions.push({
          ref: {
            activity: { ...activityRef, kind },
            studentRef,
            // La ruta relativa es el identificador natural en este conector.
            remoteId: `${activityRef.slug}/${studentRef}/${filename}`,
          },
          filename,
          submittedAt: fileInfo.mtime.toISOString(),
          sizeBytes: fileInfo.size,
          mediaType: mediaTypeFor(filename),
          textContent: null,
        });
      }
    }

    // Orden estable: la cola de revisión no debería bailar entre recargas.
    return submissions.sort((a, b) => a.ref.remoteId.localeCompare(b.ref.remoteId));
  }

  async #readActivityMeta(activityDir: string): Promise<z.infer<typeof ActivityMeta> | undefined> {
    const raw = await readFile(join(activityDir, ACTIVITY_META_FILENAME), 'utf8').catch(
      () => undefined,
    );
    if (raw === undefined) return undefined;
    const parsed = ActivityMeta.safeParse(JSON.parse(raw) as unknown);
    // Un `actividad.json` mal escrito no debe tumbar el listado entero: se
    // ignora y se cae en la deducción por extensiones.
    return parsed.success ? parsed.data : undefined;
  }

  async download(ref: SubmissionRef): Promise<DownloadedFile> {
    if (ref.activity.kind === 'forum') {
      throw new Error(
        `La actividad "${ref.activity.slug}" es un foro y no tiene fichero que descargar: ` +
          'el contenido viaja en textContent de listSubmissions().',
      );
    }
    const path = this.#pathFor(ref);
    const bytes = await readFile(path).catch(() => {
      throw new Error(`No se encuentra la entrega en disco: ${path}`);
    });
    const filename = basenameOf(ref.remoteId);
    return { filename, mediaType: mediaTypeFor(filename), bytes };
  }

  /**
   * La nota se escribe como JSON junto a la entrega. Un fichero, y no un
   * append a un CSV central, para que borrar una carpeta borre también todo lo
   * publicado sobre ese alumno.
   */
  async publishGrade(ref: SubmissionRef, grade: RemoteGrade): Promise<void> {
    const dir = this.#studentDir(ref);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, GRADE_FILENAME), `${JSON.stringify(grade, null, 2)}\n`, 'utf8');
    await writeFile(
      join(dir, PUBLISHED_MARKER),
      `${JSON.stringify({ publishedAt: new Date().toISOString(), remoteId: ref.remoteId }, null, 2)}\n`,
      'utf8',
    );
  }

  async publishFeedbackFile(ref: SubmissionRef, file: FeedbackFile): Promise<void> {
    const dir = this.#studentDir(ref);
    await mkdir(dir, { recursive: true });
    const content = typeof file.content === 'string' ? file.content : Buffer.from(file.content);
    await writeFile(join(dir, safeFilename(file.filename)), content);
  }

  #studentDir(ref: SubmissionRef): string {
    return join(this.#root, ref.activity.slug, ref.studentRef);
  }

  #pathFor(ref: SubmissionRef): string {
    return join(this.#studentDir(ref), basenameOf(ref.remoteId));
  }
}

export const createFilesystemConnector: LmsConnectorFactory = (config: LmsConnectorConfig) =>
  new FilesystemConnector(FilesystemConfig.parse(config));

// ── Utilidades ──────────────────────────────────────────────────────────────

async function safeReaddir(path: string): Promise<string[]> {
  // Una actividad sin carpeta todavía no es un error: simplemente no tiene entregas.
  return readdir(path).catch(() => []);
}

async function safeStat(path: string) {
  return stat(path).catch(() => undefined);
}

function isServiceFile(filename: string): boolean {
  return (
    filename === GRADE_FILENAME ||
    filename === PUBLISHED_MARKER ||
    filename === ACTIVITY_META_FILENAME
  );
}

function isSubmissionFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUBMISSION_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isTextFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Sin `actividad.json` que lo diga, el tipo se deduce de lo que hay dentro: si
 * aparece un PDF o una imagen es una entrega; si sólo hay texto, un foro. Ante
 * la duda (carpeta vacía) se supone entrega, que es el caso mayoritario.
 */
async function inferKind(activityDir: string): Promise<ActivityKind> {
  for (const studentRef of await safeReaddir(activityDir)) {
    const studentDir = join(activityDir, studentRef);
    const info = await safeStat(studentDir);
    if (info === undefined || !info.isDirectory()) continue;

    const filenames = (await safeReaddir(studentDir)).filter(
      (filename) => !isServiceFile(filename),
    );
    if (filenames.some(isSubmissionFile)) return 'assignment';
    if (filenames.some(isTextFile)) return 'forum';
  }
  return 'assignment';
}

/** Alumnos con algo entregado, que es lo que Vega enseña como pendientes. */
async function countStudentsWithSubmission(
  activityDir: string,
  kind: ActivityKind,
): Promise<number> {
  const matches = hasStudentFile(kind) ? isSubmissionFile : isTextFile;

  let count = 0;
  for (const studentRef of await safeReaddir(activityDir)) {
    const studentDir = join(activityDir, studentRef);
    const info = await safeStat(studentDir);
    if (info === undefined || !info.isDirectory()) continue;

    const filenames = (await safeReaddir(studentDir)).filter(
      (filename) => !isServiceFile(filename),
    );
    if (filenames.some(matches)) count += 1;
  }
  return count;
}

function mediaTypeFor(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.md')) return 'text/markdown';
  return 'application/pdf';
}

function basenameOf(remoteId: string): string {
  return remoteId.split('/').pop() ?? remoteId;
}

/** El nombre viene de fuera: que no se pueda escapar de la carpeta del alumno. */
function safeFilename(filename: string): string {
  const base = basenameOf(filename).replace(/\\/g, '/').split('/').pop() ?? 'feedback.pdf';
  return base === '' || base === '.' || base === '..' ? 'feedback.pdf' : base;
}
