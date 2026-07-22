import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { hasStudentFile } from '@vega/shared';
import type { ActivityKind, StudentCustomField } from '@vega/shared';
import type {
  LmsConnector,
  RemoteStudent,
  RemoteSubmission,
  SubmissionRef,
} from '@vega/connector-lms';
import { isLmsError } from '@vega/connector-lms';
import { connectorForUser } from '../lms/factory.js';
import { schema } from '../db/client.js';
import { FileStore } from '../storage/files.js';
import { countPages } from './pages.js';
import type { AppContext } from '../context.js';

/**
 * Ingesta: traer del LMS lo que los alumnos han entregado.
 *
 * Es el punto donde Vega toca el mundo exterior y, por tanto, donde falla lo que
 * no depende de nosotros: el Moodle está caído, el token ha caducado, un alumno
 * ha subido un vídeo. La ingesta tiene que ser **idempotente y aburrida**: poder
 * ejecutarse muchas veces sin duplicar nada y sin romperse por una entrega mala
 * (HU-08).
 *
 * Tres decisiones que conviene tener presentes al leer el código:
 *
 *  1. **La credencial es la de quien importó la actividad** (`activities.imported_by`).
 *     El token de Moodle es de cada profesor (ADR 0010) y el planificador corre
 *     sin nadie en sesión, así que la actividad tiene que llevar consigo con qué
 *     credencial se lee. Una actividad cuyo importador se dio de baja se queda
 *     sin ingesta, y eso se dice en voz alta en vez de fallar en silencio.
 *  2. **Se descarga sólo si el INSERT ha creado fila.** Al revés se bajaría cada
 *     noche el examen entero de todo el mundo para tirarlo acto seguido.
 *  3. **Un fichero ilegible se registra igualmente, en `error`.** Descartarlo lo
 *     haría invisible: el alumno habría entregado y nadie lo sabría (HU-08, RN-8).
 */

export interface IngestReport {
  /** Entregas nuevas creadas. */
  readonly ingested: number;
  /** Actividades cuya ingesta falló entera. */
  readonly activitiesFailed: number;
  /** Actividades consultadas sin incidencias. */
  readonly activitiesVisited: number;
  readonly problems: readonly IngestProblem[];
}

export interface IngestProblem {
  readonly activityId: string;
  readonly slug: string;
  /**
   * `config` no se reintenta: exige que alguien entre en Ajustes. `transient` sí,
   * y por eso se distinguen (ADR 0009). Sin esta separación, un token caducado y
   * un Moodle caído producen el mismo aviso y el profesor no sabe qué hacer.
   */
  readonly kind: 'config' | 'transient';
  readonly message: string;
}

interface Logger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const SILENT: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Recorre las actividades activas y trae sus entregas nuevas.
 *
 * No lanza: un fallo de una actividad no puede impedir la ingesta de las demás
 * (HU-08, RN-5), y menos aún tumbar el lote entero. Todo lo que sale mal vuelve
 * en `problems`.
 *
 * `kinds` acota la pasada a esos tipos de actividad: la pasada frecuente de
 * foros no debe consultar en Moodle todas las entregas cada pocos minutos.
 */
export async function ingestAll(
  ctx: AppContext,
  log: Logger = SILENT,
  kinds: readonly ActivityKind[] = ['assignment', 'forum'],
): Promise<IngestReport> {
  const { db } = ctx;
  const store = new FileStore(ctx.config.STORAGE_ROOT);

  // Sólo lo que está dado de alta contra el LMS y vigilado. Una actividad local
  // (sin `moodle_ref`) no tiene de dónde ingerir.
  const activities = await db
    .select()
    .from(schema.activities)
    .where(
      and(
        eq(schema.activities.enabled, true),
        isNotNull(schema.activities.moodleRef),
        inArray(schema.activities.kind, [...kinds]),
      ),
    );

  let ingested = 0;
  let activitiesFailed = 0;
  let activitiesVisited = 0;
  const problems: IngestProblem[] = [];

  // Un conector por usuario y no por actividad: construirlo lee ajustes y el
  // token de la base de datos, y varias actividades del mismo profesor comparten
  // credencial. Además el conector de Moodle guarda en memoria las URL de
  // descarga que devuelve `listSubmissions()`, así que `download()` **tiene que**
  // hacerse con la misma instancia que listó.
  const connectors = new Map<string, LmsConnector>();

  for (const activity of activities) {
    if (activity.importedBy === null) {
      activitiesFailed += 1;
      problems.push({
        activityId: activity.id,
        slug: activity.slug,
        kind: 'config',
        message:
          `La actividad "${activity.slug}" no tiene ningún profesor asociado, así que Vega no ` +
          'sabe con qué credencial de Moodle leer sus entregas. Vuelve a importarla desde tus cursos.',
      });
      continue;
    }

    let connector = connectors.get(activity.importedBy);
    if (connector === undefined) {
      try {
        connector = await connectorForUser(ctx, activity.importedBy);
        connectors.set(activity.importedBy, connector);
      } catch (error) {
        activitiesFailed += 1;
        problems.push({
          activityId: activity.id,
          slug: activity.slug,
          kind: 'config',
          message: (error as Error).message,
        });
        continue;
      }
    }

    try {
      const created = await ingestActivity(ctx, store, connector, activity, log);
      ingested += created;
      activitiesVisited += 1;
    } catch (error) {
      activitiesFailed += 1;
      problems.push({
        activityId: activity.id,
        slug: activity.slug,
        kind: classify(error),
        message: (error as Error).message,
      });
      log.error({ err: error, slug: activity.slug }, 'Fallo al ingerir una actividad');
    }
  }

  log.info({ ingested, activitiesVisited, activitiesFailed }, 'Ingesta terminada');
  return { ingested, activitiesFailed, activitiesVisited, problems };
}

type ActivityRow = typeof schema.activities.$inferSelect;

/** Entregas nuevas de una sola actividad. Lanza si el LMS falla al listarlas. */
async function ingestActivity(
  ctx: AppContext,
  store: FileStore,
  connector: LmsConnector,
  activity: ActivityRow,
  log: Logger,
): Promise<number> {
  const { db } = ctx;

  const activityRef = {
    slug: activity.slug,
    lmsRef: activity.moodleRef,
    kind: activity.kind,
  };

  const remote = await connector.listSubmissions(activityRef);
  const withFile = hasStudentFile(activity.kind);

  let created = 0;

  for (const item of remote) {
    // Cada entrega va por su cuenta: una mala no puede tirar el resto de la
    // clase. El fallo se guarda en la propia entrega, que es donde el profesor
    // lo va a buscar.
    try {
      // La ficha se refresca **siempre**, aunque la entrega ya existiera: un
      // alumno cambia de comunidad entre convocatorias, y corregir con la de
      // hace un año sería peor que no tenerla.
      const student = await upsertStudent(ctx, item.student);

      const row = await insertOrFind(
        ctx,
        activity,
        item,
        withFile,
        student?.id ?? null,
        student?.fullName ?? null,
      );
      if (row === null) continue;
      if (row.created) created += 1;

      if (!withFile) continue;
      // Una entrega que ya tiene su fichero no se vuelve a bajar: eso es lo que
      // evita descargarse el examen entero de toda la clase en cada pasada.
      // Pero una que quedó **registrada y sin fichero** sí se reintenta, aunque
      // no sea nueva: antes esa entrega se quedaba clavada para siempre, porque
      // sólo se descargaba lo recién insertado y nadie volvía a mirarla.
      if (!needsFile(row)) continue;

      await downloadInto(ctx, store, connector, row.id, item, log);
    } catch (error) {
      log.warn(
        { err: error, slug: activity.slug, remoteId: item.ref.remoteId },
        'Fallo al ingerir una entrega concreta',
      );
    }
  }

  return created;
}

/**
 * Guarda o refresca la ficha del alumno.
 *
 * Se llama en cada ingesta, también para entregas que ya existían: un opositor
 * cambia de comunidad autónoma entre convocatorias, y corregir con la de hace un
 * año sería peor que no tener el dato. El coste es un `UPSERT` por entrega
 * listada, contra una tabla pequeña y por clave única.
 *
 * La **comunidad se resuelve aquí y se guarda en su columna** en vez de dejarla
 * enterrada en el `jsonb`: es el único campo del perfil que afecta a la
 * corrección, y buscarlo dentro del jsonb en cada entrega del lote sería caro y
 * frágil. Qué shortname la contiene es configuración de la instalación, porque
 * el nombre del campo lo elige quien monta el Moodle.
 */
async function upsertStudent(
  ctx: AppContext,
  remote: RemoteStudent | null,
): Promise<{ id: string; fullName: string | null } | null> {
  if (remote === null) return null;

  const customFields: StudentCustomField[] = remote.customFields.map((field) => ({
    shortname: field.shortname,
    name: field.name,
    value: field.value,
  }));

  const community = communityOf(customFields, ctx.config.STUDENT_COMMUNITY_FIELD);
  const fullName =
    remote.fullName?.trim() ||
    [remote.firstName, remote.lastName].filter(Boolean).join(' ').trim() ||
    null;

  const values = {
    studentRef: remote.ref,
    username: remote.username,
    firstName: remote.firstName,
    lastName: remote.lastName,
    fullName,
    email: remote.email,
    phone: remote.phone,
    idnumber: remote.idnumber,
    institution: remote.institution,
    department: remote.department,
    city: remote.city,
    country: remote.country,
    community,
    customFields,
    syncedAt: new Date(),
  };

  const [row] = await ctx.db
    .insert(schema.students)
    .values(values)
    .onConflictDoUpdate({ target: schema.students.studentRef, set: values })
    .returning({ id: schema.students.id, fullName: schema.students.fullName });

  return row ?? null;
}

/**
 * La comunidad autónoma, sacada del campo personalizado que la lleva.
 *
 * Puede traer **varias separadas por coma**: un opositor se presenta en más de
 * una comunidad y todas condicionan el criterio de corrección. No se parte ni se
 * normaliza aquí; se guarda tal cual llegó, porque quien sabe qué significan
 * esos valores es el contexto de corrección que escribe el profesorado.
 */
function communityOf(fields: readonly StudentCustomField[], shortname: string): string | null {
  const wanted = shortname.trim().toUpperCase();
  const found = fields.find((field) => field.shortname.trim().toUpperCase() === wanted);
  const value = found?.value.trim() ?? '';
  return value === '' ? null : value;
}

/**
 * Crea la fila si no existía. Devuelve `null` cuando ya estaba, que es el caso
 * normal a partir de la segunda ejecución.
 *
 * `onConflictDoNothing` sin `target` cubre los **dos** índices únicos: la clave
 * natural de siempre —que protege las entregas con fichero— y la de `remote_id`
 * —que es la que protege los foros, donde `original_filename` es `null` y en
 * PostgreSQL dos `null` no colisionan—.
 */
/** Una entrega ya en base de datos, con lo justo para decidir si le falta fichero. */
export interface IngestedRow {
  readonly id: string;
  /** `true` si la ha creado esta pasada; `false` si ya estaba. */
  readonly created: boolean;
  readonly storagePath: string | null;
  readonly status: string;
}

/**
 * ¿Hay que traerle el fichero a esta entrega?
 *
 * Sólo si no lo tiene y sigue esperando: una entrega **aparcada** la apartó
 * alguien a propósito y no se resucita sola, y una ya corregida o publicada no
 * se toca. `error` sí entra: el fallo pudo ser transitorio —el LMS caído, el
 * disco lleno— y la pasada siguiente es exactamente donde debe reintentarse.
 */
export function needsFile(row: IngestedRow): boolean {
  return row.storagePath === null && (row.status === 'pending' || row.status === 'error');
}

async function insertOrFind(
  ctx: AppContext,
  activity: ActivityRow,
  item: RemoteSubmission,
  withFile: boolean,
  studentId: string | null,
  studentAlias: string | null,
): Promise<IngestedRow | null> {
  const [row] = await ctx.db
    .insert(schema.submissions)
    .values({
      activityId: activity.id,
      studentRef: item.ref.studentRef,
      studentId,
      studentAlias,
      remoteId: item.ref.remoteId,
      status: 'pending',
      originalFilename: withFile ? item.filename : null,
      // En un foro el texto llega en el propio listado y no hay nada que
      // descargar: la entrega nace ya completa.
      textContent: withFile ? null : item.textContent,
      pageCount: 0,
      mediaType: item.mediaType,
      sizeBytes: item.sizeBytes,
      submittedAt: new Date(item.submittedAt),
    })
    .onConflictDoNothing()
    .returning({ id: schema.submissions.id });

  if (row) return { id: row.id, created: true, storagePath: null, status: 'pending' };

  // Ya existía. Se lee para saber si le falta el fichero, que es lo único que
  // esta pasada puede arreglarle.
  const [existing] = await ctx.db
    .select({
      id: schema.submissions.id,
      storagePath: schema.submissions.storagePath,
      status: schema.submissions.status,
    })
    .from(schema.submissions)
    .where(
      item.ref.remoteId === null
        ? and(
            eq(schema.submissions.activityId, activity.id),
            eq(schema.submissions.studentRef, item.ref.studentRef),
          )
        : and(
            eq(schema.submissions.activityId, activity.id),
            eq(schema.submissions.remoteId, item.ref.remoteId),
          ),
    )
    .limit(1);

  return existing === undefined
    ? null
    : {
        id: existing.id,
        created: false,
        storagePath: existing.storagePath,
        status: existing.status,
      };
}

/**
 * Descarga el fichero de una entrega recién creada y lo guarda.
 *
 * Si el fichero no se puede leer, la entrega **no se borra**: se queda en
 * `error` con un mensaje que el profesor entiende. Es la diferencia entre «este
 * alumno no ha entregado» y «este alumno ha entregado algo que no sabemos abrir».
 */
async function downloadInto(
  ctx: AppContext,
  store: FileStore,
  connector: LmsConnector,
  submissionId: string,
  item: RemoteSubmission,
  log: Logger,
): Promise<void> {
  const ref: SubmissionRef = item.ref;

  let bytes: Uint8Array;
  let filename: string;
  let mediaType: string;
  try {
    const file = await connector.download(ref);
    bytes = file.bytes;
    filename = file.filename;
    mediaType = file.mediaType;
  } catch (error) {
    await markError(
      ctx,
      submissionId,
      `No se ha podido descargar el fichero de la entrega: ${(error as Error).message}`,
    );
    log.warn({ err: error, submissionId }, 'Descarga fallida');
    return;
  }

  const counted = await countPages(bytes, mediaType, item.filename ?? filename);

  // Guardar en disco también falla, y de formas que no son culpa del alumno:
  // volumen sin permisos de escritura, disco lleno. Sin este `catch` la
  // excepción subía al bucle de la actividad, que la escribía en el log y
  // seguía — y la entrega se quedaba `pending` sin fichero y sin explicación,
  // esperando una corrección que reventaba después en el motor.
  try {
    const stored = await store.saveSubmissionFile(submissionId, filename, bytes);

    await ctx.db
      .update(schema.submissions)
      .set({
        storagePath: stored.storagePath,
        sizeBytes: stored.sizeBytes,
        mediaType,
        pageCount: counted.pages,
        // Se guarda igualmente el fichero aunque no se pueda contar: es la prueba
        // de lo que el alumno entregó, y el profesor puede querer abrirlo.
        status: counted.failure === null ? 'pending' : 'error',
        errorMessage: counted.message,
        updatedAt: new Date(),
      })
      .where(eq(schema.submissions.id, submissionId));
  } catch (error) {
    await markError(
      ctx,
      submissionId,
      `El fichero se ha descargado pero no se ha podido guardar: ${(error as Error).message}`,
    );
    log.error({ err: error, submissionId }, 'No se ha podido guardar el fichero de una entrega');
  }
}

async function markError(ctx: AppContext, submissionId: string, message: string): Promise<void> {
  await ctx.db
    .update(schema.submissions)
    .set({ status: 'error', errorMessage: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(schema.submissions.id, submissionId));
}

/**
 * Fallo de configuración o fallo transitorio. `LMS_AUTH` es de configuración —el
 * token no vale y reintentar no lo arregla—; el resto se trata como transitorio,
 * que es lo que permite que el lote de mañana lo vuelva a intentar solo.
 */
function classify(error: unknown): 'config' | 'transient' {
  if (isLmsError(error)) return error.code === 'LMS_AUTH' ? 'config' : 'transient';
  return 'transient';
}
