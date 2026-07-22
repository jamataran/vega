import { z } from 'zod';
import {
  ActivityKind,
  Id,
  PointsAllocation,
  TranscriptionFlag,
  TranscriptionPage,
  UsageMetrics,
} from '@vega/shared';

/**
 * Contrato con el proveedor de IA. Todo lo que entra y sale está descrito con
 * Zod porque estos objetos cruzan la frontera entre el motor y el mundo
 * exterior (API, CLI, lote nocturno) y conviene validarlos en ambos extremos.
 */

// ── Transcripción ───────────────────────────────────────────────────────────

/** Formatos que sabemos mandar a un modelo de visión. */
export const PageMediaType = z.enum([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);
export type PageMediaType = z.infer<typeof PageMediaType>;

/**
 * Una página del examen escaneado. Aceptamos bytes ya leídos o una ruta en
 * disco: el lote nocturno trabaja con ficheros y la API con buffers en memoria,
 * y no queremos obligar a ninguno de los dos a convertir.
 */
export const PageSource = z
  .object({
    page: z.number().int().positive(),
    mediaType: PageMediaType.optional(),
    bytes: z.instanceof(Uint8Array).optional(),
    path: z.string().min(1).optional(),
  })
  .refine((page) => page.bytes !== undefined || page.path !== undefined, {
    message: 'Cada página necesita bytes o una ruta en disco',
  });
export type PageSource = z.infer<typeof PageSource>;

export const TranscribeInput = z.object({
  /** Semilla del mock y clave de trazabilidad en los logs. */
  submissionId: Id,
  /** Identificador interno del alumno: nunca su nombre real (RGPD). */
  studentRef: z.string().min(1),
  /**
   * Sólo se transcriben las actividades con fichero del alumno. El motor ni
   * siquiera llama aquí cuando `hasStudentFile(activityKind)` es `false`.
   */
  activityKind: ActivityKind,
  pages: z.array(PageSource).min(1),
});
export type TranscribeInput = z.infer<typeof TranscribeInput>;

export const TranscribeResult = z.object({
  pages: z.array(TranscriptionPage),
  flags: z.array(TranscriptionFlag),
  confidence: z.number().min(0).max(1),
  model: z.string().min(1),
  usage: UsageMetrics,
});
export type TranscribeResult = z.infer<typeof TranscribeResult>;

// ── Corrección ──────────────────────────────────────────────────────────────

/** Lo que el corrector necesita saber de la transcripción, sin el ruido. */
export const TranscriptionSummary = z.object({
  pages: z.array(TranscriptionPage),
  flags: z.array(TranscriptionFlag),
  confidence: z.number().min(0).max(1),
});
export type TranscriptionSummary = z.infer<typeof TranscriptionSummary>;

/**
 * Lo que el modelo llega a saber del alumno.
 *
 * Deliberadamente pobre: aquí no cabe la ficha entera, y eso es la garantía, no
 * una limitación. Quien quiera añadir un campo tiene que pasar por
 * `studentContextFor()` de `@vega/shared`, donde está escrito qué se manda y por
 * qué, y donde hay pruebas que fallan si se cuela un dato de identidad.
 */
export const StudentContext = z.object({
  /** Nombre del alumno, para que el feedback pueda dirigirse a él. */
  name: z.string().nullable(),
  /** Comunidad autónoma. Puede traer varias separadas por coma. */
  community: z.string().nullable(),
  /** Otros datos que afectan al criterio: provincia, población… */
  fields: z.array(z.object({ label: z.string(), value: z.string() })),
});
export type StudentContext = z.infer<typeof StudentContext>;

export const GradeInput = z.object({
  submissionId: Id,
  activityKind: ActivityKind,
  /**
   * Transcripción del manuscrito. `null` en actividades sin fichero del alumno
   * (foros): ahí no hay nada que transcribir y se corrige sobre `textContent`.
   */
  transcription: TranscriptionSummary.nullable(),
  /**
   * Lo que el alumno ha escrito cuando no hay fichero: sus mensajes del foro ya
   * concatenados. `null` en actividades con entrega.
   */
  textContent: z.string().nullable(),
  /**
   * Contexto de corrección ya resuelto (global + tipo de actividad +
   * actividad). Llega como un único string para que el proveedor pueda
   * cachearlo entero: es lo que se repite entre todas las entregas de una
   * misma actividad.
   */
  context: z.string(),
  /**
   * Lo que el modelo puede saber del alumno: su nombre, su comunidad autónoma y
   * poco más. **No es la ficha del alumno**, sino el recorte que produce
   * `studentContextFor()` de `@vega/shared`, que deja fuera correo, teléfono,
   * NIF y domicilio.
   *
   * Viaja aparte del `context` y no dentro de él por un motivo de coste, no de
   * orden: el `context` es el prefijo cacheado que comparten todas las entregas
   * de una actividad, y meter ahí un dato que cambia en cada entrega
   * **invalidaría la caché en todas ellas**. El proveedor lo coloca junto al
   * trabajo del alumno, que es lo que ya cambia.
   */
  student: StudentContext.nullable().default(null),
  pointsAllocation: z.array(PointsAllocation),
  /**
   * Si la actividad se puntúa. Con `false` no se esperan apartados ni nota: la
   * corrección es sólo el documento en LaTeX.
   */
  graded: z.boolean(),
  /** Nota máxima. `null` cuando la actividad no se puntúa. */
  maxScore: z.number().positive().nullable(),
});
export type GradeInput = z.infer<typeof GradeInput>;

/**
 * Apartado corregido tal y como lo devuelve la IA: sin normalizar y sin ids.
 * Convertirlo en un `CorrectionItem` persistible es tarea del motor.
 */
export const GradedItem = z.object({
  label: z.string().min(1),
  maxPoints: z.number().min(0),
  aiPoints: z.number().min(0),
  aiFeedback: z.string(),
  confidence: z.number().min(0).max(1),
  /** El alumno resuelve por una vía válida distinta a la solución de referencia. */
  alternativeMethod: z.boolean(),
});
export type GradedItem = z.infer<typeof GradedItem>;

export const GradeResult = z.object({
  /** Vacío cuando la actividad no se puntúa: entonces sólo cuenta `aiLatex`. */
  items: z.array(GradedItem),
  /**
   * La corrección redactada en LaTeX: es la salida de primer nivel, lo que el
   * profesor edita y lo que se convierte en las páginas de feedback del PDF.
   * Siempre viene, se puntúe o no la actividad.
   */
  aiLatex: z.string(),
  aiSummary: z.string(),
  confidence: z.number().min(0).max(1),
  model: z.string().min(1),
  usage: UsageMetrics,
});
export type GradeResult = z.infer<typeof GradeResult>;

// ── Prueba de conexión ──────────────────────────────────────────────────────

/**
 * Resultado de una prueba de conexión con el proveedor. El mock la responde sin
 * red y sin coste; el proveedor real hace una llamada mínima que valida la clave
 * y el modelo. Nunca lanza: un fallo de credencial es una respuesta legítima.
 */
export const VerifyConnectionResult = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** Modelo con el que se ha probado, o `null` si no se llegó a llamar. */
  model: z.string().nullable(),
  /** Consumo de la prueba. `null` cuando no hubo llamada real (mock). */
  usage: UsageMetrics.nullable(),
});
export type VerifyConnectionResult = z.infer<typeof VerifyConnectionResult>;

// ── Proveedor ───────────────────────────────────────────────────────────────

export interface AiProvider {
  /** Identificador corto del proveedor: `"mock"`, `"anthropic"`… */
  readonly name: string;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
  grade(input: GradeInput): Promise<GradeResult>;
  /**
   * Comprueba que el proveedor responde con la configuración actual. Pensada
   * para el botón «Probar conexión» de Ajustes; no corrige nada.
   */
  verifyConnection(): Promise<VerifyConnectionResult>;
}

/** Nombres de proveedor admitidos por `createAiProvider`. */
export const AiProviderName = z.enum(['mock', 'anthropic']);
export type AiProviderName = z.infer<typeof AiProviderName>;
