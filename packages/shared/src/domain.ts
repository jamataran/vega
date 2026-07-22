import { z } from 'zod';
import {
  ActivityKind,
  AiOperation,
  AiTransport,
  AutonomyMode,
  ContextLevel,
  ScoreSource,
  SubmissionStatus,
  TranscriptionFlagKind,
  TriageLabel,
  UserRole,
} from './enums.js';

/** Identificador opaco. Usamos UUID v4 en toda la aplicación. */
export const Id = z.string().uuid();
export type Id = z.infer<typeof Id>;

/** Fechas viajan por la API como ISO 8601 en UTC. */
export const IsoDate = z.string().datetime({ offset: true });
export type IsoDate = z.infer<typeof IsoDate>;

// ── Usuarios ────────────────────────────────────────────────────────────────

export const User = z.object({
  id: Id,
  email: z.string().email(),
  name: z.string().min(1),
  role: UserRole,
  active: z.boolean(),
  createdAt: IsoDate,
  lastLoginAt: IsoDate.nullable(),
  /**
   * Si este usuario tiene guardado su token de Moodle. El token en sí **nunca**
   * sale por la API: cada profesor ve los cursos que ve su token, así que la
   * credencial es suya y no de la instalación.
   */
  moodleTokenConfigured: z.boolean(),
});
export type User = z.infer<typeof User>;

// ── Cursos ──────────────────────────────────────────────────────────────────

/**
 * Curso de Moodle del que cuelgan las actividades.
 *
 * Existe como entidad propia, y no como el texto libre que era `courseName`,
 * porque el curso es el **primer paso** para dar de alta actividades: sin un
 * identificador estable, renombrar un curso en Moodle partiría el grupo en dos
 * y dos cursos homónimos se mezclarían.
 */
export const Course = z.object({
  id: Id,
  /** Identificador del curso en Moodle. Único dentro de la instalación. */
  moodleCourseId: z.string().min(1),
  name: z.string(),
  createdAt: IsoDate,
});
export type Course = z.infer<typeof Course>;

/** Un curso tal y como lo devuelve el LMS, antes de guardarlo. */
export const DiscoveredCourse = z.object({
  moodleCourseId: z.string().min(1),
  name: z.string(),
  /** Nombre corto del curso, cuando el LMS lo distingue del completo. */
  shortName: z.string().default(''),
});
export type DiscoveredCourse = z.infer<typeof DiscoveredCourse>;

// ── Actividades ─────────────────────────────────────────────────────────────

/**
 * Reparto de puntos que el profesor define para una actividad puntuable:
 * cuánto vale cada apartado. La suma debería dar `maxScore`, pero no lo
 * forzamos porque hay enunciados con apartados opcionales.
 */
export const PointsAllocation = z.object({
  label: z.string().min(1), // "1a", "2", "Desarrollo"…
  statement: z.string().default(''),
  maxPoints: z.number().min(0),
});
export type PointsAllocation = z.infer<typeof PointsAllocation>;

/**
 * Fichero que el profesor adjunta al contexto de una actividad: el enunciado en
 * LaTeX, el material sobre el que preguntan los alumnos, los criterios del
 * departamento…
 *
 * Los ficheros **de texto** (`.tex`, `.md`, `.txt`) se guardan con su contenido
 * y pasan a formar parte del contexto que se envía al modelo. El resto se
 * guardan como referencia para el profesor y no llegan al modelo: distinguirlos
 * es lo que evita ofrecer una subida que no sirve para nada.
 */
export const ActivityFile = z.object({
  id: Id,
  activityId: Id,
  filename: z.string().min(1),
  mimeType: z.string(),
  sizeBytes: z.number().int().min(0),
  /** URL de descarga servida por el API. */
  url: z.string(),
  /** `true` si el contenido está guardado y viaja al modelo con el contexto. */
  hasContent: z.boolean(),
  /** `false` mientras la subida troceada sigue en curso. */
  uploadComplete: z.boolean(),
  uploadedAt: IsoDate,
});
export type ActivityFile = z.infer<typeof ActivityFile>;

/**
 * Extensiones cuyo contenido guardamos y enviamos al modelo.
 *
 * LaTeX antes que PDF a propósito: el `.tex` ya es texto, entra literal en el
 * prompt, se cachea con el resto del contexto y no cuesta ni una llamada de
 * visión. Un PDF exigiría transcribirlo en cada corrección.
 */
export const TEXT_FILE_EXTENSIONS = ['.tex', '.md', '.markdown', '.txt'] as const;

/** Si el contenido de este fichero puede guardarse y enviarse al modelo. */
export function isTextFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return TEXT_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Una actividad de Moodle a la que Vega reacciona.
 *
 * Entregas y foros comparten mecanismo; la diferencia es que la entrega trae
 * fichero del alumno (y por tanto pasa por transcripción) y el foro no.
 */
export const Activity = z.object({
  id: Id,
  slug: z.string().min(1),
  name: z.string().min(1),
  kind: ActivityKind,
  /** Curso al que pertenece. `null` en actividades locales o anteriores a la 0003. */
  courseId: Id.nullable(),
  /**
   * Nombre del curso, copiado del curso al que pertenece. Se sirve resuelto
   * para que la lista pueda agrupar sin una segunda consulta.
   */
  courseName: z.string(),
  /**
   * Identificador de la actividad en Moodle, **con prefijo de tipo**
   * (`assign-42`, `forum-42`). El prefijo no es decorativo: los ids de
   * `mod_assign` y `mod_forum` vienen de tablas distintas y sin él una tarea y
   * un foro con el mismo número colisionan. `null` si la actividad es local.
   */
  moodleRef: z.string().nullable(),
  /** Si está desactivada, Vega la ignora en los lotes. */
  enabled: z.boolean(),
  /**
   * Si la actividad se puntúa. Una entrega de examen normalmente sí; un foro
   * normalmente no, y entonces sólo se publica feedback cualitativo.
   */
  graded: z.boolean(),
  /** Nota máxima. `null` cuando `graded` es `false`. */
  maxScore: z.number().positive().nullable(),
  pointsAllocation: z.array(PointsAllocation),
  /** Solución de referencia del profesor, en LaTeX o texto. */
  referenceSolution: z.string().nullable(),
  /** Plantilla de criterios compartida por actividades del mismo formato. */
  templateKey: z.string().nullable(),
  /** Cuánta autonomía tiene Vega sobre esta actividad. */
  autonomy: AutonomyMode,
  /** Ficheros adjuntos al contexto de la actividad. */
  files: z.array(ActivityFile),
  createdAt: IsoDate,
});
export type Activity = z.infer<typeof Activity>;

// ── Entregas ────────────────────────────────────────────────────────────────

// ── Alumno ──────────────────────────────────────────────────────────────────

export const StudentCustomField = z.object({
  /** Clave del campo en el LMS: `CCAA`, `PROVINCIA`, `NIF`… */
  shortname: z.string().min(1),
  /** Etiqueta legible que le puso el administrador del LMS. */
  name: z.string().nullable(),
  value: z.string(),
});
export type StudentCustomField = z.infer<typeof StudentCustomField>;

/**
 * Ficha del alumno, tal y como la ve el LMS.
 *
 * **Ojo con qué se hace con esto.** Que Vega guarde el perfil no significa que
 * el perfil entero viaje al modelo: lo que entra en el prompt lo decide
 * `studentContextFor()`, más abajo, con una lista explícita. La distinción es el
 * núcleo de la protección de datos de este producto y conviene no diluirla:
 * aquí hay nombre, correo, teléfono y —según la instalación— el NIF y la
 * dirección postal de una persona.
 */
export const Student = z.object({
  id: Id,
  /** Identidad en el LMS (`moodle-4217`). Es lo que casa con `Submission.studentRef`. */
  studentRef: z.string().min(1),
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  /** Identificador del centro. No es el NIF: ése es un campo personalizado. */
  idnumber: z.string().nullable(),
  institution: z.string().nullable(),
  department: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  /**
   * Comunidad autónoma. Puede traer **varias separadas por coma**: un opositor
   * se presenta en más de una, y así lo guarda el sistema de origen.
   */
  community: z.string().nullable(),
  customFields: z.array(StudentCustomField),
  syncedAt: IsoDate,
});
export type Student = z.infer<typeof Student>;

/** Nombre con el que enseñar una entrega, sin quedarse nunca en blanco. */
export function studentLabel(
  submission: Pick<Submission, 'studentRef' | 'studentAlias'>,
  student?: Pick<Student, 'fullName' | 'firstName' | 'lastName'> | null,
): string {
  const composed = [student?.firstName, student?.lastName].filter(Boolean).join(' ').trim();
  return student?.fullName?.trim() || composed || submission.studentAlias || submission.studentRef;
}

/**
 * Qué del alumno puede llegar al modelo de IA.
 *
 * **Esta lista es la frontera de protección de datos del producto y se lee
 * entera antes de tocarla.** Vega guarda el perfil completo porque el profesor
 * necesita saber de quién es lo que firma; el modelo recibe sólo lo que puede
 * cambiar la corrección.
 *
 * Qué entra y por qué:
 *
 *  - **El nombre**, para que el feedback pueda dirigirse al alumno. Es una
 *    decisión explícita del cliente, tomada sabiendo que implica mandar un dato
 *    identificativo a un tercero en cada corrección.
 *  - **La comunidad autónoma**, porque una oposición de matemáticas no se
 *    corrige igual en dos comunidades: cambian el tribunal y los criterios. Es
 *    el dato que motivó todo esto.
 *  - **Provincia y población**, por el mismo motivo y con menos peso.
 *
 * Qué **nunca** entra, aunque esté guardado: correo, teléfono, nombre de
 * usuario, identificador del centro, y los campos personalizados de identidad y
 * domicilio (`NIF`, `DNI_VALIDO`, `DIRECCION`, `CODIGO_POSTAL`). No mejoran una
 * corrección de matemáticas en absolutamente nada, y son justo los datos cuyo
 * envío a un tercero habría que justificar ante quien preguntase.
 *
 * La lista de campos personalizados es ampliable por instalación; la de
 * prohibidos **gana siempre**, para que ampliarla por descuido no pueda colar un
 * DNI en un prompt.
 */
export const STUDENT_CUSTOM_FIELDS_FOR_MODEL = ['CCAA', 'PROVINCIA', 'POBLACION'] as const;

/** Campos personalizados que no salen hacia el modelo bajo ningún ajuste. */
export const STUDENT_CUSTOM_FIELDS_NEVER_SENT = [
  'NIF',
  'DNI',
  'DNI_VALIDO',
  'DIRECCION',
  'CODIGO_POSTAL',
  'IBAN',
  'TELEFONO',
] as const;

/** Lo que de verdad viaja al modelo sobre el alumno. */
export interface StudentContext {
  readonly name: string | null;
  readonly community: string | null;
  readonly fields: readonly { readonly label: string; readonly value: string }[];
}

/**
 * Recorta la ficha del alumno a lo que puede entrar en el prompt.
 *
 * Devuelve `null` cuando no queda nada que contar, para que el motor no añada
 * una sección vacía al prompt: un encabezado «Alumno» sin contenido gasta
 * tokens y confunde al modelo.
 *
 * `extraFields` permite a una instalación añadir campos personalizados suyos sin
 * tocar el código; lo prohibido se filtra después, así que ampliarlo no puede
 * abrir la puerta a un dato de identidad.
 */
export function studentContextFor(
  student: Pick<Student, 'fullName' | 'firstName' | 'lastName' | 'community' | 'customFields'> | null,
  extraFields: readonly string[] = [],
): StudentContext | null {
  if (student === null) return null;

  const allowed = new Set(
    [...STUDENT_CUSTOM_FIELDS_FOR_MODEL, ...extraFields].map((key) => key.toUpperCase()),
  );
  const forbidden = new Set(STUDENT_CUSTOM_FIELDS_NEVER_SENT.map((key) => key.toUpperCase()));

  const composed = [student.firstName, student.lastName].filter(Boolean).join(' ').trim();
  const name = (student.fullName?.trim() ?? '') || composed || null;

  const fields = student.customFields
    .filter((field) => {
      const key = field.shortname.toUpperCase();
      return allowed.has(key) && !forbidden.has(key) && field.value.trim() !== '';
    })
    // La comunidad se sirve aparte, en su propio campo: repetirla aquí la
    // duplicaría en el prompt.
    .filter((field) => field.shortname.toUpperCase() !== 'CCAA')
    .map((field) => ({ label: field.name?.trim() || field.shortname, value: field.value.trim() }));

  const community = student.community?.trim() || null;

  if (name === null && community === null && fields.length === 0) return null;
  return { name, community, fields };
}

export const Submission = z.object({
  id: Id,
  activityId: Id,
  /**
   * Identificador interno del alumno en el LMS (`moodle-4217`), nunca su nombre.
   * Sigue siendo la identidad con la que se deduplica y con la que se publica.
   */
  studentRef: z.string().min(1),
  /** Nombre legible, para que el profesor sepa qué está firmando. */
  studentAlias: z.string().nullable(),
  status: SubmissionStatus,
  /** Lote durable que inició el procesamiento actual, si lo hay. */
  batchRunId: Id.nullable(),
  parkedReason: z.string().nullable(),
  parkedBy: Id.nullable(),
  triageLabel: TriageLabel.nullable(),
  triageConfidence: z.number().min(0).max(1).nullable(),
  /** Nombre del fichero entregado. `null` en actividades sin fichero (foros). */
  originalFilename: z.string().nullable(),
  pageCount: z.number().int().min(0),
  /**
   * Contenido textual de la entrega cuando no hay fichero: los mensajes que el
   * alumno ha escrito en el foro, ya concatenados.
   */
  textContent: z.string().nullable(),
  submittedAt: IsoDate,
  updatedAt: IsoDate,
  errorMessage: z.string().nullable(),
});
export type Submission = z.infer<typeof Submission>;

// ── Transcripción ───────────────────────────────────────────────────────────

export const TranscriptionFlag = z.object({
  kind: TranscriptionFlagKind,
  page: z.number().int().positive(),
  excerpt: z.string(),
  note: z.string().default(''),
});
export type TranscriptionFlag = z.infer<typeof TranscriptionFlag>;

export const TranscriptionPage = z.object({
  page: z.number().int().positive(),
  /**
   * Transcripción de la página como **texto con fórmulas delimitadas**, no como
   * un único bloque LaTeX: `$$…$$` para fórmula en bloque, `$…$` para fórmula
   * en línea, y el resto texto corriente. KaTeX no sabe componer documentos de
   * varios párrafos, así que un `\textbf{...}` suelto con líneas en blanco no se
   * renderiza; esta convención es lo que permite intercalar prosa y matemáticas.
   * Las marcas del OCR van fuera de las fórmulas, como `[ILEGIBLE]` / `[DUDA]`.
   */
  latex: z.string(),
  /** URL de la imagen escaneada, para mostrarla junto a la transcripción. */
  imageUrl: z.string(),
});
export type TranscriptionPage = z.infer<typeof TranscriptionPage>;

/** Diferencia material entre las dos lecturas independientes de una página. */
export const TranscriptionDiscrepancy = z.object({
  page: z.number().int().positive(),
  readingA: z.string(),
  readingB: z.string(),
  /** Fragmento que se inserta en la transcripción consolidada. */
  marker: z.string(),
});
export type TranscriptionDiscrepancy = z.infer<typeof TranscriptionDiscrepancy>;

export const Transcription = z.object({
  id: Id,
  submissionId: Id,
  pages: z.array(TranscriptionPage),
  flags: z.array(TranscriptionFlag),
  discrepancies: z.array(TranscriptionDiscrepancy),
  passCount: z.number().int().positive(),
  /** Confianza global del OCR, 0–1. Por debajo de 0.75 la UI lo señala. */
  confidence: z.number().min(0).max(1),
  model: z.string(),
  createdAt: IsoDate,
});
export type Transcription = z.infer<typeof Transcription>;

// ── Corrección ──────────────────────────────────────────────────────────────

/**
 * Un apartado corregido. Guardamos por separado lo que propone la IA y lo que
 * decide el profesor: es lo que permite medir la desviación.
 */
export const CorrectionItem = z.object({
  id: Id,
  correctionId: Id,
  label: z.string().min(1),
  statement: z.string(),
  maxPoints: z.number().min(0),
  aiPoints: z.number().min(0),
  aiFeedback: z.string(),
  /** Cita literal que ancla cualquier descuento en la transcripción. */
  aiQuote: z.string().nullable(),
  aiQuotePage: z.number().int().positive().nullable(),
  /** `null` mientras el profesor no haya tocado el apartado. */
  teacherPoints: z.number().min(0).nullable(),
  teacherFeedback: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  /** Método alternativo válido, distinto al de la solución de referencia. */
  alternativeMethod: z.boolean(),
  position: z.number().int().min(0),
});
export type CorrectionItem = z.infer<typeof CorrectionItem>;

/** Puntos efectivos de un apartado: manda el profesor si se ha pronunciado. */
export function effectivePoints(item: Pick<CorrectionItem, 'aiPoints' | 'teacherPoints'>): number {
  return item.teacherPoints ?? item.aiPoints;
}

/** De dónde viene la puntuación efectiva. */
export function effectiveSource(item: Pick<CorrectionItem, 'teacherPoints'>): ScoreSource {
  return item.teacherPoints === null ? 'ai' : 'teacher';
}

export const UsageMetrics = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cachedInputTokens: z.number().int().min(0),
  cacheCreationTokens: z.number().int().min(0).optional(),
  /** Coste en céntimos de euro, para evitar decimales flotantes en BD. */
  costCents: z.number().min(0),
});
export type UsageMetrics = z.infer<typeof UsageMetrics>;

export const VerificationIssue = z.object({
  kind: z.string().min(1),
  itemLabel: z.string().nullable(),
  detail: z.string().min(1),
  source: z.enum(['mechanical', 'ai']),
});
export type VerificationIssue = z.infer<typeof VerificationIssue>;

export const CorrectionVerification = z.object({
  coherent: z.boolean(),
  confidence: z.number().min(0).max(1).nullable(),
  issues: z.array(VerificationIssue),
  aiEnabled: z.boolean(),
});
export type CorrectionVerification = z.infer<typeof CorrectionVerification>;

export const Correction = z.object({
  id: Id,
  submissionId: Id,
  /** Vacío en actividades no puntuables: entonces sólo cuenta el documento. */
  items: z.array(CorrectionItem),
  /** `null` cuando la actividad no se puntúa. */
  maxScore: z.number().positive().nullable(),
  /**
   * La corrección redactada, en LaTeX, tal y como la propone la IA. Es lo que
   * el profesor edita y lo que se convierte en las páginas de feedback del PDF.
   */
  aiLatex: z.string(),
  /** Versión editada por el profesor. `null` si no la ha tocado. */
  teacherLatex: z.string().nullable(),
  /** Resumen breve para la cabecera de la cola. */
  aiSummary: z.string(),
  teacherSummary: z.string().nullable(),
  /** Notas de apoyo para el profesor; nunca se publican al alumno. */
  teacherNotes: z.string().nullable(),
  verification: CorrectionVerification.nullable(),
  simulated: z.boolean(),
  confidence: z.number().min(0).max(1),
  model: z.string(),
  usage: UsageMetrics,
  /**
   * PDF de feedback: el fichero original del alumno seguido de las páginas de
   * corrección. `null` en actividades sin fichero, o mientras no se ha generado.
   */
  annotatedFileUrl: z.string().nullable(),
  createdAt: IsoDate,
  validatedBy: Id.nullable(),
  validatedAt: IsoDate.nullable(),
  publishedAt: IsoDate.nullable(),
  /** `true` si se publicó sin pasar por el profesor (modo autónomo). */
  publishedAutomatically: z.boolean(),
  /**
   * Qué no salió del todo bien al publicar, en español y para el profesor.
   * Publicar son dos operaciones —nota y fichero de feedback— y hay conectores
   * que no admiten la segunda: eso no es un fallo, pero hay que decirlo en vez
   * de dejar creer que el alumno ha recibido el PDF.
   */
  publishNotice: z.string().nullable(),
});
export type Correction = z.infer<typeof Correction>;

/** El LaTeX que vale: el del profesor si lo ha editado, si no el de la IA. */
export function effectiveLatex(correction: Pick<Correction, 'aiLatex' | 'teacherLatex'>): string {
  return correction.teacherLatex ?? correction.aiLatex;
}

/** Nota total efectiva de una corrección. */
export function totalScore(
  items: readonly Pick<CorrectionItem, 'aiPoints' | 'teacherPoints'>[],
): number {
  const raw = items.reduce((sum, item) => sum + effectivePoints(item), 0);
  return Math.round(raw * 100) / 100;
}

// ── Contextos de corrección ─────────────────────────────────────────────────

export const GradingContext = z.object({
  id: Id,
  level: ContextLevel,
  /**
   * Clave dentro del nivel: `'global'`, el `ActivityKind` para el nivel de tipo
   * de actividad, o el `slug` de la actividad para el nivel más específico.
   */
  key: z.string(),
  activeVersion: z.number().int().positive(),
  contentHash: z.string(),
  source: z.enum(['seed', 'migration', 'edit', 'restore']),
  content: z.string(), // Markdown
  updatedAt: IsoDate,
  updatedBy: Id.nullable(),
});
export type GradingContext = z.infer<typeof GradingContext>;

export const GradingContextVersion = z.object({
  contextId: Id,
  version: z.number().int().positive(),
  content: z.string(),
  contentHash: z.string(),
  source: z.enum(['seed', 'migration', 'edit', 'restore']),
  createdAt: IsoDate,
  createdBy: Id.nullable(),
});
export type GradingContextVersion = z.infer<typeof GradingContextVersion>;

/** Segmento fijado al inicio de una ejecución; el orden respeta la jerarquía. */
export const ContextSegment = z.object({
  level: ContextLevel,
  key: z.string(),
  contextId: Id,
  version: z.number().int().positive(),
  contentHash: z.string(),
  content: z.string(),
});
export type ContextSegment = z.infer<typeof ContextSegment>;

export const Prompt = z.object({
  key: z.string().min(1),
  version: z.number().int().positive(),
  content: z.string(),
  active: z.boolean(),
  updatedBy: Id.nullable(),
  updatedAt: IsoDate,
});
export type Prompt = z.infer<typeof Prompt>;

export const AiCall = z.object({
  id: Id,
  batchRunId: Id.nullable(),
  aiBatchId: Id.nullable(),
  submissionId: Id.nullable(),
  operation: AiOperation,
  transport: AiTransport,
  provider: z.string(),
  modelRequested: z.string(),
  modelReturned: z.string().nullable(),
  promptKey: z.string().nullable(),
  promptVersion: z.number().int().positive().nullable(),
  contextHash: z.string().nullable(),
  contextVersions: z.array(
    z.object({
      level: ContextLevel,
      key: z.string(),
      contextId: Id,
      version: z.number().int().positive(),
      contentHash: z.string(),
    }),
  ),
  requestParams: z.record(z.string(), z.unknown()),
  responseRaw: z.unknown().nullable(),
  parsedOk: z.boolean(),
  stopReason: z.string().nullable(),
  error: z.string().nullable(),
  latencyMs: z.number().int().min(0).nullable(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0),
  cacheCreationTokens: z.number().int().min(0),
  costCents: z.number().min(0).nullable(),
  unpriced: z.boolean(),
  simulated: z.boolean(),
  createdAt: IsoDate,
});
export type AiCall = z.infer<typeof AiCall>;

// ── Ajustes del sistema (sólo administrador) ────────────────────────────────

/** La planificación de un tipo de actividad: si corre sola y cada cuánto. */
export const ScheduleSlot = z.object({
  enabled: z.boolean(),
  /** Cada cuántos minutos corre solo el proceso para este tipo. */
  everyMinutes: z.number().int().positive(),
  lastRunAt: IsoDate.nullable(),
  nextRunAt: IsoDate.nullable(),
});
export type ScheduleSlot = z.infer<typeof ScheduleSlot>;

/**
 * Configuración editable desde la aplicación. Los secretos NUNCA se devuelven:
 * la API expone sólo si están configurados, y se escriben pero no se leen.
 */
export const AppSettings = z.object({
  anthropic: z.object({
    apiKeyConfigured: z.boolean(),
    transcriptionModel: z.string(),
    /** Modelo usado por las dos lecturas; sustituye gradualmente al nombre anterior. */
    readingModel: z.string(),
    gradingModel: z.string(),
    verifyModel: z.string(),
    triageModel: z.string(),
    maxTokens: z.number().int().positive(),
    /** Proveedor activo: `mock` no consume tokens. */
    provider: z.enum(['mock', 'anthropic']),
  }),
  ai: z.object({
    transport: AiTransport,
    verify: z.boolean(),
    explanations: z.boolean(),
    lowConfidenceThreshold: z.number().min(0).max(1),
    pagesPerChunk: z.number().int().positive(),
    logRetentionDays: z.number().int().positive(),
  }),
  /**
   * De la **instalación**, no del profesor: a qué Moodle apunta Vega y con qué
   * conector habla. El token no está aquí — es de cada usuario
   * (`User.moodleTokenConfigured`), porque decide qué cursos ve.
   */
  moodle: z.object({
    baseUrl: z.string(),
    connector: z.enum(['mock', 'filesystem', 'moodle3']),
  }),
  smtp: z.object({
    host: z.string(),
    port: z.number().int().min(0),
    user: z.string(),
    passwordConfigured: z.boolean(),
    from: z.string(),
  }),
  /**
   * Una planificación por tipo de actividad, no una global: una duda de foro
   * no puede esperar al ritmo del lote de entregas, y el lote de entregas no
   * tiene por qué correr cada pocos minutos.
   */
  schedule: z.object({
    assignment: ScheduleSlot,
    forum: ScheduleSlot,
  }),
  branding: z.object({
    name: z.string(),
  }),
});
export type AppSettings = z.infer<typeof AppSettings>;

// ── Lotes ───────────────────────────────────────────────────────────────────

/**
 * Una actividad que no se pudo leer del LMS, con el motivo en cristiano.
 *
 * `config` exige que alguien entre en Ajustes (token caducado, función que
 * falta en el servicio web de Moodle) y no se arregla reintentando; `transient`
 * sí, y por eso se distinguen: sin esa diferencia, un Moodle caído y un token
 * mal puesto dan el mismo aviso y nadie sabe si esperar o actuar.
 */
export const BatchRunProblem = z.object({
  /** Identificador de la actividad en Vega, para poder abrirla. */
  activityId: z.string(),
  /** Su `slug`, que es lo que se reconoce de un vistazo. */
  slug: z.string(),
  kind: z.enum(['config', 'transient']),
  message: z.string(),
});
export type BatchRunProblem = z.infer<typeof BatchRunProblem>;

export const BatchRun = z.object({
  id: Id,
  startedAt: IsoDate,
  finishedAt: IsoDate.nullable(),
  status: z.enum(['running', 'done', 'failed']),
  /** Quién lo lanzó: `null` si fue el planificador. */
  triggeredBy: Id.nullable(),
  /**
   * Qué tipos de actividad barrió este proceso. El planificador corre por tipo
   * (los foros suelen ir más frecuentes que las entregas); un proceso forzado
   * a mano barre siempre los dos.
   */
  kinds: z.array(ActivityKind),
  submissionsProcessed: z.number().int().min(0),
  submissionsFailed: z.number().int().min(0),
  /** Cuántas se publicaron solas por estar en modo autónomo. */
  submissionsAutoPublished: z.number().int().min(0),
  /**
   * Entregas nuevas traídas del LMS en este lote. Distingue «no había nada que
   * corregir» de «no ha entrado nada», que sin este contador son el mismo cero.
   */
  submissionsIngested: z.number().int().min(0),
  /** Actividades cuya ingesta falló entera: LMS caído, token o configuración. */
  activitiesFailed: z.number().int().min(0),
  /**
   * Qué le pasó a cada una de ellas. Sin esto, `activitiesFailed` es un número
   * sin salida: dice que algo falló y obliga a ir al log del servidor para
   * saber si es el token, una función que falta en Moodle o el LMS caído.
   */
  problems: z.array(BatchRunProblem),
  usage: UsageMetrics,
});
export type BatchRun = z.infer<typeof BatchRun>;
