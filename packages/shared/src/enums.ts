import { z } from 'zod';

/** Roles de usuario. El profesor corrige; el administrador además configura el sistema. */
export const UserRole = z.enum(['teacher', 'admin']);
export type UserRole = z.infer<typeof UserRole>;

/**
 * Tipos de actividad de Moodle soportados. El mecanismo es el mismo en ambos;
 * la diferencia está en que una entrega trae fichero del alumno y un foro no.
 */
export const ActivityKind = z.enum(['assignment', 'forum']);
export type ActivityKind = z.infer<typeof ActivityKind>;

/**
 * Ciclo de vida de una entrega. El orden importa: la UI lo usa para ordenar
 * la cola y para decidir qué acciones ofrece.
 */
export const SubmissionStatus = z.enum([
  'pending', // descargada de Moodle, aún sin procesar
  'transcribing', // OCR en curso (sólo actividades con fichero)
  'transcribed', // hay transcripción, falta corregir
  'grading', // corrección IA en curso
  'graded', // la IA propone corrección — esperando al profesor
  'parked', // apartada por triaje o por el profesor; sigue visible en la cola
  'validated', // el profesor ha validado; pendiente de publicar
  'published', // feedback (y nota, si la hay) ya en Moodle
  'error', // algo falló; requiere intervención
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;

/** Estados en los que la entrega espera acción del profesor. */
export const REVIEWABLE_STATUSES: SubmissionStatus[] = ['graded', 'parked', 'validated', 'error'];

/** Umbral compartido; el ajuste `ai.lowConfidenceThreshold` puede sustituirlo en ejecución. */
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

/**
 * Los tres niveles de contexto de corrección, de más general a más específico.
 * El nivel intermedio es el tipo de actividad: lo que vale para toda entrega
 * no vale para un foro.
 */
export const ContextLevel = z.enum(['global', 'activity_kind', 'template', 'course', 'activity']);
export type ContextLevel = z.infer<typeof ContextLevel>;

/** Marcas que el OCR deja sobre fragmentos problemáticos del manuscrito. */
export const TranscriptionFlagKind = z.enum(['ILEGIBLE', 'DUDA', 'DISCREPANCIA']);
export type TranscriptionFlagKind = z.infer<typeof TranscriptionFlagKind>;

/** Etiqueta del triaje ciego de mensajes de foro. */
export const TriageLabel = z.enum([
  'errata',
  'administrativa',
  'no_es_duda',
  'sencilla',
  'dificil',
]);
export type TriageLabel = z.infer<typeof TriageLabel>;

/** Operaciones que pueden dejar una entrada en el ledger de IA. */
export const AiOperation = z.enum([
  'reading_a',
  'reading_b',
  'grade',
  'triage',
  'verify',
  'forum_answer',
  'connection_test',
]);
export type AiOperation = z.infer<typeof AiOperation>;

export const AiTransport = z.enum(['batch', 'sync']);
export type AiTransport = z.infer<typeof AiTransport>;

/** Origen de la puntuación de un apartado, para medir la desviación IA vs profesor. */
export const ScoreSource = z.enum(['ai', 'teacher']);
export type ScoreSource = z.infer<typeof ScoreSource>;

/**
 * Grado de autonomía con el que trabaja Vega sobre una actividad.
 *
 * El objetivo del producto es llegar a `autonomous`: cuando el contexto está
 * suficientemente afinado, nadie valida. Se decide por actividad porque la
 * confianza se gana actividad a actividad, no de golpe.
 */
export const AutonomyMode = z.enum([
  'review_all', // el profesor valida todo (por defecto)
  'review_low_confidence', // sólo se le pasan las dudosas; el resto se publica solo
  'autonomous', // se publica todo sin intervención
]);
export type AutonomyMode = z.infer<typeof AutonomyMode>;

/** Etiquetas legibles en español, para no repetirlas por toda la UI. */
export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: 'Pendiente',
  transcribing: 'Transcribiendo',
  transcribed: 'Transcrita',
  grading: 'Corrigiendo',
  graded: 'Por revisar',
  parked: 'Aparcada',
  validated: 'Validada',
  published: 'Publicada',
  error: 'Error',
};

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  assignment: 'Entrega',
  forum: 'Foro',
};

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  teacher: 'Profesor',
  admin: 'Administrador',
};

export const CONTEXT_LEVEL_LABEL: Record<ContextLevel, string> = {
  global: 'Contexto global',
  activity_kind: 'Tipo de actividad',
  template: 'Plantilla',
  course: 'Curso',
  activity: 'Actividad',
};

export const AI_OPERATION_LABEL: Record<AiOperation, string> = {
  reading_a: 'Lectura A',
  reading_b: 'Lectura B',
  grade: 'Corrección',
  triage: 'Triaje',
  verify: 'Verificación',
  forum_answer: 'Respuesta de foro',
  connection_test: 'Prueba de conexión',
};

export const AUTONOMY_MODE_LABEL: Record<AutonomyMode, string> = {
  review_all: 'Reviso todas',
  review_low_confidence: 'Sólo las dudosas',
  autonomous: 'Sin revisión',
};

export const AUTONOMY_MODE_HELP: Record<AutonomyMode, string> = {
  review_all: 'Nada llega al alumno sin que lo valides.',
  review_low_confidence:
    'Las correcciones seguras se publican solas; las dudosas te esperan en la cola.',
  autonomous: 'Vega publica sin intervención. Actívalo sólo con el contexto ya afinado.',
};

/** Sólo las actividades con fichero del alumno pasan por transcripción. */
export function hasStudentFile(kind: ActivityKind): boolean {
  return kind === 'assignment';
}
