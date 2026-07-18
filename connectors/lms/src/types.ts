import { z } from 'zod';
import { ActivityKind, IsoDate } from '@vega/shared';

/**
 * Tipos que cruzan la frontera con el LMS. Deliberadamente pobres: aquí no
 * entra nada del dominio de Vega que el LMS no necesite saber. Un conector
 * mueve ficheros, textos y notas; corregir no es asunto suyo.
 */

/** La actividad vista desde el LMS. */
export const ActivityRef = z.object({
  /** Slug interno de Vega ("tema04"). */
  slug: z.string().min(1),
  /** Identificador de la actividad en el LMS. `null` si el conector no lo necesita. */
  lmsRef: z.string().nullable(),
  /**
   * Entrega o foro. Es lo que decide si el conector tiene que traer un fichero
   * o el texto que el alumno ha escrito.
   */
  kind: ActivityKind.optional(),
});
export type ActivityRef = z.infer<typeof ActivityRef>;

/**
 * Puntero a una entrega concreta. Lo devuelve `listSubmissions` y se le pasa
 * de vuelta al conector en el resto de operaciones: así el conector puede
 * meter ahí lo que necesite (ids de Moodle, rutas…) sin que Vega lo interprete.
 */
export const SubmissionRef = z.object({
  activity: ActivityRef,
  /** Identificador interno del alumno; nunca su nombre real. */
  studentRef: z.string().min(1),
  /** Identificador de la entrega en el sistema de origen. */
  remoteId: z.string().min(1),
});
export type SubmissionRef = z.infer<typeof SubmissionRef>;

export const RemoteSubmission = z.object({
  ref: SubmissionRef,
  /** Nombre del fichero entregado. `null` en actividades sin fichero (foros). */
  filename: z.string().min(1).nullable(),
  submittedAt: IsoDate,
  sizeBytes: z.number().int().min(0),
  /** Tipo MIME declarado por el origen; casi siempre `application/pdf`. */
  mediaType: z.string().min(1),
  /**
   * Lo que el alumno ha escrito cuando no hay fichero: sus mensajes del foro ya
   * concatenados. `null` en las entregas con fichero.
   */
  textContent: z.string().nullable().default(null),
});
export type RemoteSubmission = z.infer<typeof RemoteSubmission>;

/**
 * Bytes de un fichero. `z.custom` en lugar de `z.instanceof` para que el tipo
 * sea el `Uint8Array` de siempre y acepte tanto un `Buffer` de `node:fs` como
 * el resultado de un `arrayBuffer()` de `fetch`.
 */
const Bytes = z.custom<Uint8Array>((value) => value instanceof Uint8Array, {
  message: 'Se esperaba un Uint8Array',
});

export const DownloadedFile = z.object({
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  bytes: Bytes,
});
export type DownloadedFile = z.infer<typeof DownloadedFile>;

/** Un apartado ya validado por el profesor, listo para publicarse. */
export const RemoteGradeItem = z.object({
  label: z.string().min(1),
  points: z.number().min(0),
  maxPoints: z.number().min(0),
  feedback: z.string(),
});
export type RemoteGradeItem = z.infer<typeof RemoteGradeItem>;

export const RemoteGrade = z.object({
  /**
   * Nota validada. `null` en actividades no puntuables: ahí sólo se publica el
   * feedback cualitativo y el LMS no debe recibir ninguna calificación.
   */
  score: z.number().min(0).nullable(),
  maxScore: z.number().positive().nullable(),
  /** Resumen que verá el alumno. */
  summary: z.string(),
  /** Vacío en actividades no puntuables. */
  items: z.array(RemoteGradeItem),
  /** Quién validó, para dejar rastro en el LMS cuando el destino lo admita. */
  validatedBy: z.string().nullable().optional(),
  validatedAt: IsoDate.optional(),
});
export type RemoteGrade = z.infer<typeof RemoteGrade>;

export const FeedbackFile = z.object({
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  content: z.union([Bytes, z.string()]),
});
export type FeedbackFile = z.infer<typeof FeedbackFile>;

/**
 * Configuración del conector. Cada implementación valida con Zod lo que
 * necesita; el registro no interpreta nada para no acoplarse a ninguna.
 */
export type LmsConnectorConfig = Readonly<Record<string, unknown>>;
