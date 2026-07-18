import { z } from 'zod';
import {
  ActivityKind,
  AutonomyMode,
  ContextLevel,
  ScoreSource,
  SubmissionStatus,
  TranscriptionFlagKind,
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
});
export type User = z.infer<typeof User>;

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
 * Fichero que el profesor adjunta al contexto de una actividad: enunciado,
 * solución de referencia escaneada, criterios del departamento…
 */
export const ActivityFile = z.object({
  id: Id,
  activityId: Id,
  filename: z.string().min(1),
  mimeType: z.string(),
  sizeBytes: z.number().int().min(0),
  /** URL de descarga servida por el API. */
  url: z.string(),
  uploadedAt: IsoDate,
});
export type ActivityFile = z.infer<typeof ActivityFile>;

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
  /** Curso de Moodle al que pertenece, para que el profesor la reconozca. */
  courseName: z.string(),
  /** Identificador de la actividad en Moodle. `null` si es local. */
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
  /** Cuánta autonomía tiene Vega sobre esta actividad. */
  autonomy: AutonomyMode,
  /** Ficheros adjuntos al contexto de la actividad. */
  files: z.array(ActivityFile),
  createdAt: IsoDate,
});
export type Activity = z.infer<typeof Activity>;

// ── Entregas ────────────────────────────────────────────────────────────────

export const Submission = z.object({
  id: Id,
  activityId: Id,
  /**
   * Identificador interno del alumno. Nunca enviamos el nombre real a la API
   * de IA — ver la sección de privacidad del README.
   */
  studentRef: z.string().min(1),
  /** Alias visible sólo para el profesor dentro de Vega. */
  studentAlias: z.string().nullable(),
  status: SubmissionStatus,
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

export const Transcription = z.object({
  id: Id,
  submissionId: Id,
  pages: z.array(TranscriptionPage),
  flags: z.array(TranscriptionFlag),
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
  /** Coste en céntimos de euro, para evitar decimales flotantes en BD. */
  costCents: z.number().min(0),
});
export type UsageMetrics = z.infer<typeof UsageMetrics>;

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
  content: z.string(), // Markdown
  updatedAt: IsoDate,
  updatedBy: Id.nullable(),
});
export type GradingContext = z.infer<typeof GradingContext>;

// ── Ajustes del sistema (sólo administrador) ────────────────────────────────

/**
 * Configuración editable desde la aplicación. Los secretos NUNCA se devuelven:
 * la API expone sólo si están configurados, y se escriben pero no se leen.
 */
export const AppSettings = z.object({
  anthropic: z.object({
    apiKeyConfigured: z.boolean(),
    transcriptionModel: z.string(),
    gradingModel: z.string(),
    maxTokens: z.number().int().positive(),
    /** Proveedor activo: `mock` no consume tokens. */
    provider: z.enum(['mock', 'anthropic']),
  }),
  moodle: z.object({
    baseUrl: z.string(),
    tokenConfigured: z.boolean(),
    connector: z.enum(['mock', 'filesystem', 'moodle3']),
  }),
  smtp: z.object({
    host: z.string(),
    port: z.number().int().min(0),
    user: z.string(),
    passwordConfigured: z.boolean(),
    from: z.string(),
  }),
  schedule: z.object({
    enabled: z.boolean(),
    /** Cada cuántos minutos corre el proceso de corrección. */
    everyMinutes: z.number().int().positive(),
    lastRunAt: IsoDate.nullable(),
    nextRunAt: IsoDate.nullable(),
  }),
  branding: z.object({
    name: z.string(),
  }),
});
export type AppSettings = z.infer<typeof AppSettings>;

// ── Lotes ───────────────────────────────────────────────────────────────────

export const BatchRun = z.object({
  id: Id,
  startedAt: IsoDate,
  finishedAt: IsoDate.nullable(),
  status: z.enum(['running', 'done', 'failed']),
  /** Quién lo lanzó: `null` si fue el planificador. */
  triggeredBy: Id.nullable(),
  submissionsProcessed: z.number().int().min(0),
  submissionsFailed: z.number().int().min(0),
  /** Cuántas se publicaron solas por estar en modo autónomo. */
  submissionsAutoPublished: z.number().int().min(0),
  usage: UsageMetrics,
});
export type BatchRun = z.infer<typeof BatchRun>;
