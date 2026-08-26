import { stat } from 'node:fs/promises';
import { AUTONOMY_MODE_LABEL, hasStudentFile, LOW_CONFIDENCE_THRESHOLD } from '@vega/shared';
import type {
  ActivityKind,
  AutonomyMode,
  PointsAllocation,
  ResolvedContextResponse,
  TranscriptionFlag,
  TranscriptionPage,
  UsageMetrics,
  CorrectionVerification,
} from '@vega/shared';
import { resolveContext } from '../context/resolve.js';
import type { ResolveContextInput } from '../context/resolve.js';
import type {
  AiProvider,
  GradedItem,
  PageSource,
  StudentContext,
  TranscribeInput,
  TranscribeResult,
} from '../ai/provider.js';
import {
  consolidateTranscriptions,
  normalizeCanonical,
  partialReadingPages,
  sumUsage,
} from './verification.js';

/**
 * Motor de corrección: transcribir → resolver contexto → corregir → devolver un
 * resultado listo para persistir.
 *
 * Es una función pura sobre sus argumentos: recibe el proveedor por parámetro y
 * no toca ni base de datos ni red. Todo lo que hay aquí es lógica de negocio y
 * por eso vive en un sitio único: la normalización de puntos, el cálculo de la
 * confianza global y la detección de lo que hay que enseñarle al profesor.
 */

// ── Reglas de negocio ───────────────────────────────────────────────────────

/** Los profesores puntúan en cuartos de punto; la IA se ajusta a eso. */
export const POINT_STEP = 0.25;

/** Por debajo de aquí, la UI señala el apartado. Coincide con `Transcription.confidence`. */
export { LOW_CONFIDENCE_THRESHOLD } from '@vega/shared';

/** Peso de la transcripción en la confianza global. */
const TRANSCRIPTION_WEIGHT = 0.4;

// ── Tipos ───────────────────────────────────────────────────────────────────

export type ReviewReason =
  /** La IA no las tiene todas consigo en ese apartado. */
  | 'low_confidence'
  /** Método válido distinto al de la solución de referencia: hay que ratificarlo. */
  | 'alternative_method'
  /** El OCR dejó marcas en la página de ese apartado. */
  | 'transcription_flag'
  /** La IA no devolvió el apartado: se puntúa a cero y lo decide el profesor. */
  | 'missing_item'
  /** El reparto de puntos de la actividad no suma la nota máxima. */
  | 'allocation_mismatch'
  /** Se han descontado puntos sin una cita comprobable. */
  | 'missing_quote'
  /** La cita no aparece en la página indicada de la lectura consolidada. */
  | 'fabricated_quote'
  /** El texto anuncia un descuento que no cuadra con los puntos. */
  | 'score_feedback_mismatch'
  /** El segundo modelo detecta una incoherencia que debe mirar el profesor. */
  | 'ai_verification'
  /**
   * Alguna página sólo la ha transcrito una de las dos lecturas, incluso tras
   * releerla. La transcripción sirve, pero esas páginas no tienen contraste.
   */
  | 'lectura_parcial'
  /**
   * El modo de autonomía dejaría publicar esto sin que lo viera nadie, pero la
   * confianza global no da para tanto. Es el aviso que evita que el modo
   * autónomo publique justo lo que no debía.
   */
  | 'autonomy_below_threshold'
  /**
   * El original no cabía en la petición y la corrección se ha hecho sólo sobre
   * la transcripción. No es un fallo: es que el corrector no ha visto el
   * escaneo, y eso el profesor tiene que saberlo antes de firmar.
   */
  | 'original_omitido';

export interface ReviewFlag {
  /** Apartado afectado, o `null` si el aviso es de la entrega entera. */
  readonly label: string | null;
  readonly reason: ReviewReason;
  /** Explicación en español, lista para pintar en la cola de revisión. */
  readonly detail: string;
}

/** Apartado ya normalizado: le faltan sólo los ids para ser un `CorrectionItem`. */
export interface NormalizedItem {
  readonly label: string;
  readonly statement: string;
  readonly maxPoints: number;
  readonly aiPoints: number;
  readonly aiFeedback: string;
  readonly aiQuote: string | null;
  readonly aiQuotePage: number | null;
  readonly confidence: number;
  readonly alternativeMethod: boolean;
  readonly position: number;
}

export interface GradeSubmissionInput {
  readonly provider: AiProvider;
  /** Cancela todas las llamadas de esta entrega cuando el lote caduca. */
  readonly signal?: AbortSignal;
  readonly submissionId: string;
  readonly studentRef: string;
  readonly activityKind: ActivityKind;
  /** Páginas escaneadas. Se ignoran si la actividad no trae fichero del alumno. */
  readonly pages: readonly PageSource[];
  /** Lectura ya pagada para un reproceso `grade_only`. */
  readonly existingTranscription?: {
    readonly pages: readonly TranscriptionPage[];
    readonly flags: readonly TranscriptionFlag[];
    readonly discrepancies: readonly import('@vega/shared').TranscriptionDiscrepancy[];
    readonly passCount: number;
    readonly confidence: number;
    readonly model: string;
  } | null;
  /** Texto de la entrega cuando no hay fichero (mensajes del foro). */
  readonly textContent?: string | null;
  readonly context: ResolveContextInput;
  /**
   * Lo que el modelo puede saber del alumno, ya recortado por
   * `studentContextFor()` de `@vega/shared`. **No es la ficha del alumno**: el
   * motor nunca ve el correo, el teléfono ni el NIF, para que no pueda mandarlos
   * ni por descuido. Va aparte del contexto porque cambia en cada entrega y el
   * contexto es el prefijo cacheado.
   */
  readonly student?: StudentContext | null;
  readonly pointsAllocation: readonly PointsAllocation[];
  /** Si la actividad se puntúa. Con `false` no hay apartados ni nota. */
  readonly graded: boolean;
  /** Nota máxima. `null` cuando la actividad no se puntúa. */
  readonly maxScore: number | null;
  /** Plantilla de la actividad: decide el prompt de corrección (problema/tema). */
  readonly templateKey?: string | null;
  /** Cuánta autonomía tiene Vega sobre la actividad. Por defecto, revisarlo todo. */
  readonly autonomy?: AutonomyMode;
  /** Apaga sólo la llamada con tokens; la verificación mecánica siempre corre. */
  readonly verifyWithAi?: boolean;
  /** Umbral operativo; el valor compartido se usa sólo como reserva. */
  readonly lowConfidenceThreshold?: number;
  readonly forumRoute?: 'standard' | 'expert';
  readonly explanations?: boolean;
}

export interface GradeSubmissionResult {
  /** `null` en actividades sin fichero del alumno: no se transcribe nada. */
  readonly transcription: {
    readonly pages: readonly TranscriptionPage[];
    readonly flags: readonly TranscriptionFlag[];
    readonly discrepancies: readonly import('@vega/shared').TranscriptionDiscrepancy[];
    readonly passCount: 2;
    readonly confidence: number;
    readonly model: string;
  } | null;
  readonly correction: {
    /** Vacío en actividades no puntuables. */
    readonly items: readonly NormalizedItem[];
    /** La corrección redactada en LaTeX. Siempre viene, se puntúe o no. */
    readonly aiLatex: string;
    readonly aiSummary: string;
    readonly teacherNotes: string | null;
    readonly confidence: number;
    readonly model: string;
    readonly maxScore: number | null;
    readonly verification: CorrectionVerification;
    readonly escalate: boolean;
    readonly noEsDuda: boolean;
  };
  /**
   * Nota propuesta, ya normalizada y acotada a la nota máxima. `null` cuando la
   * actividad no se puntúa: ahí la corrección es sólo el documento.
   */
  readonly score: number | null;
  readonly resolvedContext: ResolvedContextResponse;
  /** Suma de la transcripción (si la hubo) y la corrección. */
  readonly usage: UsageMetrics;
  readonly review: readonly ReviewFlag[];
}

// ── Orquestación ────────────────────────────────────────────────────────────

export async function gradeSubmission(input: GradeSubmissionInput): Promise<GradeSubmissionResult> {
  // Sólo las actividades con fichero del alumno pasan por OCR. En un foro no
  // hay nada que transcribir: se corrige directamente sobre el texto.
  const transcriptionInput = {
        submissionId: input.submissionId,
        studentRef: input.studentRef,
        activityKind: input.activityKind,
        pages: [...input.pages],
      };
  let transcription: ReturnType<typeof consolidateTranscriptions> | null = null;
  if (input.existingTranscription) {
    if (input.existingTranscription.passCount !== 2) {
      throw new Error('La lectura persistida no contiene las dos pasadas requeridas.');
    }
    transcription = {
      pages: [...input.existingTranscription.pages],
      flags: [...input.existingTranscription.flags],
      discrepancies: [...input.existingTranscription.discrepancies],
      passCount: 2,
      confidence: input.existingTranscription.confidence,
      model: input.existingTranscription.model,
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0, costCents: 0 },
    };
  } else if (hasStudentFile(input.activityKind)) {
    const [readingA, readingB] = await Promise.all([
      readWithRetry(input.provider, transcriptionInput, 'a', input.pages, input.signal),
      readWithRetry(input.provider, transcriptionInput, 'b', input.pages, input.signal),
    ]);
    assertReadable(readingA, readingB, input.pages);
    transcription = consolidateTranscriptions(readingA, readingB);
  }

  const resolvedContext = resolveContext(input.context);

  /**
   * ¿Cabe el original en la petición de corrección?
   *
   * La transcripción se puede repartir en varias peticiones porque cada una lee
   * un tramo; la corrección no, porque necesita el examen entero delante a la
   * vez. Cuando ni siquiera normalizado cabe, se manda sin él en vez de
   * estrellarse contra el `413` después de haber pagado las dos lecturas.
   */
  const omittedOriginal = await measureOmittedOriginal(input.pages);

  const graded = await input.provider.grade({
    submissionId: input.submissionId,
    activityKind: input.activityKind,
    student: input.student ?? null,
    transcription:
      transcription === null
        ? null
        : {
            pages: transcription.pages,
            flags: transcription.flags,
            discrepancies: transcription.discrepancies,
            passCount: transcription.passCount,
            confidence: transcription.confidence,
          },
    // El original **entero** viaja con la corrección, y ahí no hay troceado que
    // valga: o cabe en una petición o no va. Si no cabe, se corrige sobre la
    // transcripción y se dice, que es una degradación explícita del principio
    // de que «el original manda» y no un silencio.
    document: omittedOriginal === null ? [...input.pages] : [],
    ...(omittedOriginal === null ? {} : { documentOmitted: omittedOriginal }),
    textContent: input.textContent ?? null,
    context: resolvedContext.segments,
    material: renderActivityMaterial(input.context),
    pointsAllocation: [...input.pointsAllocation],
    graded: input.graded,
    maxScore: input.maxScore,
    templateKey: input.templateKey ?? null,
    route: input.forumRoute,
    explanations: input.explanations ?? true,
  }, { signal: input.signal });

  const flags = transcription?.flags ?? [];

  // Actividad no puntuable: ni apartados ni nota. Todo el valor está en el
  // documento de corrección, así que no se normaliza nada que no exista.
  const aligned = input.graded
    ? alignItems(graded.items, input.pointsAllocation, input.maxScore ?? 0)
    : { items: [] as readonly NormalizedItem[], missingLabels: [] as readonly string[] };

  const mechanical = verifyMechanically(aligned.items, transcription?.pages ?? []);
  const items = mechanical.items;
  const missingLabels = aligned.missingLabels;
  const aiVerification = input.verifyWithAi === false
    ? null
    : await input.provider.verify({
        submissionId: input.submissionId,
        transcription: transcription === null
          ? null
          : {
              pages: [...transcription.pages],
              flags: [...transcription.flags],
              discrepancies: [...transcription.discrepancies],
              passCount: transcription.passCount,
              confidence: transcription.confidence,
            },
        items: items.map((item) => ({
          label: item.label,
          maxPoints: item.maxPoints,
          aiPoints: item.aiPoints,
          aiFeedback: item.aiFeedback,
          aiQuote: item.aiQuote,
          aiQuotePage: item.aiQuotePage,
          confidence: item.confidence,
          alternativeMethod: item.alternativeMethod,
        })),
        aiSummary: graded.aiSummary,
        aiLatex: graded.aiLatex,
      }, { signal: input.signal });
  // Una lectura parcial se avisa por aquí y no sólo en `review`: lo que se
  // persiste y se enseña en la ficha son los avisos de verificación, y una
  // página sin contraste es una razón para que el profesor abra el original.
  const readingReview = reviewPartialReading(partialReadingPages(flags));
  const mechanicalReview = [
    ...mechanical.review,
    ...readingReview,
    ...reviewOmittedOriginal(omittedOriginal),
  ];
  const verification: CorrectionVerification = {
    coherent: mechanicalReview.length === 0 && (aiVerification?.coherent ?? true),
    confidence: aiVerification?.confidence ?? null,
    aiEnabled: input.verifyWithAi !== false,
    issues: [
      ...mechanicalReview.map((issue) => ({
        kind: issue.reason,
        itemLabel: issue.label,
        detail: issue.detail,
        source: 'mechanical' as const,
      })),
      ...(aiVerification?.issues ?? []).map((issue) => ({ ...issue, source: 'ai' as const })),
    ],
  };

  const score =
    input.graded && input.maxScore !== null
      ? clamp(round2(items.reduce((sum, item) => sum + item.aiPoints, 0)), 0, input.maxScore)
      : null;

  const confidence = overallConfidence(
    transcription?.confidence ?? null,
    items,
    flags.length,
    graded.confidence,
  );

  const review = [
    ...mechanicalReview,
    ...(aiVerification?.issues ?? []).map((issue): ReviewFlag => ({
      label: issue.itemLabel,
      reason: 'ai_verification',
      detail: issue.detail,
    })),
    ...detectReviewFlags({
    items,
    missingLabels,
    flags,
    pointsAllocation: input.pointsAllocation,
    graded: input.graded,
    maxScore: input.maxScore,
    autonomy: input.autonomy ?? 'review_all',
    confidence,
    lowConfidenceThreshold: input.lowConfidenceThreshold,
    }),
  ];

  return {
    transcription:
      transcription === null
        ? null
        : {
            pages: transcription.pages,
            flags: transcription.flags,
            discrepancies: transcription.discrepancies,
            passCount: transcription.passCount,
            confidence: transcription.confidence,
            model: transcription.model,
          },
    correction: {
      items,
      aiLatex: graded.aiLatex,
      aiSummary: graded.aiSummary,
      teacherNotes: graded.teacherNotes ?? null,
      confidence,
      model: graded.model,
      maxScore: input.graded ? input.maxScore : null,
      verification,
      // Escalar y «no es una duda» son decisiones de foro. Una entrega con
      // fichero nunca las lleva, diga lo que diga el proveedor: aparcar un
      // simulacro porque «no es una duda» es tirar una corrección pagada.
      escalate: input.activityKind === 'forum' && (graded.escalate ?? false),
      noEsDuda: input.activityKind === 'forum' && (graded.noEsDuda ?? false),
    },
    score,
    resolvedContext,
    usage: aiVerification === null
      ? transcription === null ? graded.usage : sumUsage(transcription.usage, graded.usage)
      : sumUsage(
          transcription === null ? graded.usage : sumUsage(transcription.usage, graded.usage),
          aiVerification.usage,
        ),
    review,
  };
}

// ── Lectura con reintento dirigido ──────────────────────────────────────────

/** Qué le falta o le sobra a una lectura respecto al manifiesto del original. */
export interface PageAssessment {
  /** La lectura ya limpia: sin duplicados vacíos ni páginas que no existen. */
  readonly reading: TranscribeResult;
  /** Páginas del original que no han llegado. */
  readonly missing: readonly number[];
  /** Páginas que llegaron más de una vez con contenido distinto: no se sabe cuál vale. */
  readonly duplicated: readonly number[];
  /** Páginas que el modelo numeró fuera del original. Se descartan. */
  readonly unexpected: readonly number[];
  /** Las que hay que volver a pedir: `missing` ∪ `duplicated`, ordenadas. */
  readonly toReread: readonly number[];
}

/** Los números de página del original que cubren estos bloques, en orden. */
function pagesOf(sources: readonly PageSource[]): number[] {
  return sources.flatMap((source) => source.pageNumbers ?? [source.page]);
}

/**
 * Sólo se comprueba el ensamblado cuando los bloques traen manifiesto
 * (`pageNumbers`): es la ingesta real. Las páginas sintéticas del mock de demo
 * no lo llevan y no hay nada contra lo que comparar.
 */
function manifested(sources: readonly PageSource[]): boolean {
  return sources.some((source) => source.pageNumbers !== undefined);
}

/**
 * Compara una lectura con el manifiesto del original y la deja limpia.
 *
 * No lanza: lo que falta se vuelve a pedir (`readWithRetry`) y sólo se rinde
 * cuando **las dos** lecturas se quedan sin una página (`assertReadable`).
 * Antes cualquier hueco tiraba la entrega entera, incluida la otra lectura,
 * completa y ya pagada.
 *
 * Limpieza: una página repetida con `latex` vacío es ruido del modelo (se ha
 * visto `{page: 1, latex: ""}` detrás de la página 1 buena) y se descarta sin
 * más; repetida con contenido es una página que no sabemos leer y se relee.
 * Una página numerada fuera del original se descarta: si de verdad era una de
 * las que faltan, la relectura la trae con su número.
 */
export function assessPageAssembly(
  reading: TranscribeResult,
  sources: readonly PageSource[],
): PageAssessment {
  if (!manifested(sources)) {
    return { reading, missing: [], duplicated: [], unexpected: [], toReread: [] };
  }
  const expected = pagesOf(sources);
  const expectedSet = new Set(expected);

  const byPage = new Map<number, TranscriptionPage[]>();
  const unexpected = new Set<number>();
  for (const page of reading.pages) {
    if (!expectedSet.has(page.page)) {
      unexpected.add(page.page);
      continue;
    }
    byPage.set(page.page, [...(byPage.get(page.page) ?? []), page]);
  }

  const duplicated: number[] = [];
  const pages: TranscriptionPage[] = [];
  for (const pageNumber of expected) {
    const entries = byPage.get(pageNumber);
    if (entries === undefined) continue;
    const withContent = entries.filter((entry) => entry.latex.trim() !== '');
    // Una página en blanco es legítima (el prompt pide `latex` vacío y no
    // omitirla): se conserva la primera entrada aunque no tenga texto.
    const kept = withContent[0] ?? entries[0];
    if (kept === undefined) continue;
    if (withContent.length > 1) duplicated.push(pageNumber);
    pages.push(kept);
  }

  const missing = expected.filter((pageNumber) => !byPage.has(pageNumber));
  const toReread = [...new Set([...missing, ...duplicated])].sort((a, b) => a - b);

  return {
    reading: {
      ...reading,
      pages,
      flags: reading.flags.filter((flag) => expectedSet.has(flag.page)),
    },
    missing,
    duplicated,
    unexpected: [...unexpected].sort((a, b) => a - b),
    toReread,
  };
}

/** Los bloques del original que contienen alguna de estas páginas. */
function chunksCovering(sources: readonly PageSource[], pages: readonly number[]): PageSource[] {
  const wanted = new Set(pages);
  return sources.filter((source) =>
    (source.pageNumbers ?? [source.page]).some((pageNumber) => wanted.has(pageNumber)),
  );
}

/**
 * Sustituye en la primera lectura las páginas que se pidieron de nuevo por lo
 * que trae la relectura. Lo que la relectura devuelva de páginas que no se le
 * pidieron —un bloque trae cuatro aunque sólo faltara una— se ignora: esas ya
 * estaban bien. Las marcas siguen a sus páginas y el consumo se suma, que es
 * lo que se ha pagado.
 */
function mergeReadings(
  first: TranscribeResult,
  retry: TranscribeResult,
  reread: readonly number[],
): TranscribeResult {
  const wanted = new Set(reread);
  const replacements = retry.pages.filter((page) => wanted.has(page.page));
  return {
    pages: [...first.pages.filter((page) => !wanted.has(page.page)), ...replacements].sort(
      (a, b) => a.page - b.page,
    ),
    flags: [
      ...first.flags.filter((flag) => !wanted.has(flag.page)),
      ...retry.flags.filter((flag) => wanted.has(flag.page)),
    ],
    confidence: Math.min(first.confidence, retry.confidence),
    model: first.model,
    usage: sumUsage(first.usage, retry.usage),
  };
}

/**
 * Presupuesto en bruto de una petición al modelo.
 *
 * La API admite 32 MB por petición contando todo el payload, y base64 añade un
 * tercio: 20 MiB en bruto son ~26,7 MiB codificados, y encima viajan el prompt,
 * el contexto de la actividad y los materiales adjuntos. El margen es
 * deliberadamente ancho porque el límite no se puede consultar y pasarse cuesta
 * una petición perdida.
 */
export const REQUEST_RAW_BUDGET = 20 * 1024 * 1024;

/**
 * Peticiones simultáneas por lectura.
 *
 * **Dos, no cuatro, y el motivo es la memoria del contenedor.** Las dos
 * lecturas ya corren en paralelo, así que este número se multiplica por dos: con
 * cuatro habría ocho cuerpos de petición vivos a la vez, cada uno con su base64
 * —un tercio más que el original— dentro de un contenedor de 1 GB cuyo
 * dimensionado está justificado por escrito sobre la premisa de que «el pico no
 * son veinticinco entregas sino una». Un OOM no falla limpiamente: mata el
 * proceso a mitad del lote y deja entregas atascadas hasta el siguiente
 * arranque.
 *
 * Con el original normalizado casi siempre hay un solo grupo y este tope no
 * llega a notarse. Sin tope, una entrega de trescientas páginas dispararía
 * trescientas peticiones a la vez y el `429` costaría más que la espera.
 */
const MAX_CONCURRENT_REQUESTS = 2;

/**
 * Tamaño en bruto de un bloque, esté en memoria o en disco.
 *
 * Lo que no se puede medir cuenta **cero**, no infinito. Es deliberado: el
 * presupuesto sólo puede actuar sobre evidencia, y tratar lo desconocido como
 * enorme trocearía al máximo —una petición por bloque— justo cuando no hay
 * ningún motivo para creer que hace falta. Eso multiplica peticiones y coste
 * para protegerse de un problema que quizá no existe. Las rutas que no se pueden
 * medir son las del proveedor simulado, donde no hay nada que proteger.
 */
async function sourceBytes(source: PageSource): Promise<number> {
  if (source.bytes !== undefined) return source.bytes.byteLength;
  if (source.path === undefined) return 0;
  try {
    return (await stat(source.path)).size;
  } catch {
    return 0;
  }
}

/**
 * Agrupa bloques consecutivos en peticiones que quepan en el presupuesto.
 *
 * **Consecutivos y en orden**: el prompt le dice al modelo qué páginas lleva
 * cada petición, y mezclar bloques salteados haría que numerase mal. Un bloque
 * que por sí solo se pasa del presupuesto va en su propia petición: aquí ya no
 * se puede partir más —eso es trabajo del troceado del PDF— y mandarlo solo, y
 * que falle con un mensaje claro, es mejor que arrastrar a otros con él.
 */
export async function planTranscriptionRequests(
  sources: readonly PageSource[],
  budget = REQUEST_RAW_BUDGET,
): Promise<PageSource[][]> {
  if (sources.length === 0) return [];
  const tamanos = await Promise.all(sources.map(sourceBytes));

  const grupos: PageSource[][] = [];
  let actual: PageSource[] = [];
  let acumulado = 0;

  for (const [indice, source] of sources.entries()) {
    const bytes = tamanos[indice] ?? 0;
    if (actual.length > 0 && acumulado + bytes > budget) {
      grupos.push(actual);
      actual = [];
      acumulado = 0;
    }
    actual.push(source);
    acumulado += bytes;
  }
  if (actual.length > 0) grupos.push(actual);
  return grupos;
}

/**
 * Cuánto pesa el original y si hay que dejarlo fuera de la corrección.
 *
 * Devuelve `null` cuando cabe, que es el caso normal: con el original
 * normalizado, catorce folios fotografiados pasan de 94 MB a unos 13. Sólo
 * cuando no hay poppler, o el PDF no se ha podido rasterizar, se llega a
 * omitirlo.
 */
async function measureOmittedOriginal(
  pages: readonly PageSource[],
): Promise<{ bytes: number; pages: number } | null> {
  if (pages.length === 0) return null;
  const tamanos = await Promise.all(pages.map(sourceBytes));
  const total = tamanos.reduce((suma, bytes) => suma + bytes, 0);
  if (total <= REQUEST_RAW_BUDGET) return null;
  return { bytes: total, pages: pagesOf(pages).length };
}

/** Ejecuta las tareas con un tope de concurrencia, conservando el orden. */
async function runLimited<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length) as T[];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]!();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Une las lecturas parciales de una misma pasada en una sola.
 *
 * Cada petición ha leído un tramo distinto del mismo examen, así que las
 * páginas se concatenan y se ordenan; la confianza es la **mínima**, no la
 * media, porque una petición que ha leído mal arrastra a toda la lectura y
 * promediarla la escondería.
 */
/**
 * Lo que devuelve un grupo que ha fallado: nada leído y confianza cero.
 *
 * El `usage` va a cero porque la petición no llegó a completarse, y el modelo
 * vacío es la marca de «esto no respondió»: `joinReadings` toma el de un grupo
 * que sí lo hizo.
 */
const FAILED_GROUP: TranscribeResult = {
  pages: [],
  flags: [],
  confidence: 0,
  model: '',
  usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0, costCents: 0 },
};

function joinReadings(parts: readonly TranscribeResult[]): TranscribeResult {
  // Si **ningún** grupo respondió, no hay lectura parcial que salvar y el error
  // sí tiene que subir: `assertReadable` no puede decidir sobre la nada, y
  // seguir devolvería una transcripción vacía como si fuera buena.
  const modelo = parts.find((part) => part.model !== '')?.model;
  if (modelo === undefined) {
    throw new Error(
      'Ninguna de las peticiones de esta lectura ha respondido; no hay transcripción que unir.',
    );
  }
  return {
    pages: parts.flatMap((part) => part.pages).sort((a, b) => a.page - b.page),
    flags: parts.flatMap((part) => part.flags),
    // La **mínima**, no la media: un grupo que ha leído mal arrastra a toda la
    // lectura y promediarlo lo escondería. Los grupos que fallaron no cuentan:
    // su ausencia ya la recoge `assessPageAssembly` como páginas que faltan.
    confidence: Math.min(...parts.filter((part) => part.model !== '').map((part) => part.confidence)),
    model: modelo,
    usage: parts.map((part) => part.usage).reduce(sumUsage, FAILED_GROUP.usage),
  };
}

/**
 * Una lectura completa, con **un** reintento dirigido si la primera pasada no
 * trajo todas las páginas.
 *
 * El reintento sólo lleva los bloques que contienen las páginas que faltan y
 * le dice al modelo que es una relectura y de qué examen: pedir «el examen
 * completo» sobre dos páginas hacía que las numerase desde 1. Cuesta una
 * petición con el mismo prefijo cacheado; dejar morir la entrega costaba las
 * dos lecturas enteras. Si tras el reintento sigue faltando algo, se devuelve
 * lo que hay: es `assertReadable` quien decide, con las dos lecturas delante.
 */
export async function readWithRetry(
  provider: AiProvider,
  base: Omit<TranscribeInput, 'pages' | 'reading' | 'manifest'>,
  reading: 'a' | 'b',
  sources: readonly PageSource[],
  signal: AbortSignal | undefined,
): Promise<TranscribeResult> {
  const withManifest = manifested(sources);
  const totalPages = pagesOf(sources).length;

  // Un original que no cabe en una petición se reparte en varias, y la lectura
  // es la unión. Con el original normalizado esto casi siempre da un solo
  // grupo; existe para el día en que no haya poppler o llegue un PDF de
  // trescientas páginas.
  const grupos = await planTranscriptionRequests(sources);
  const first =
    grupos.length === 1
      ? await provider.transcribe(
          {
            ...base,
            reading,
            pages: [...sources],
            ...(withManifest ? { manifest: { totalPages } } : {}),
          },
          { signal },
        )
      : joinReadings(
          await runLimited(
            grupos.map((grupo) => async () => {
              signal?.throwIfAborted();
              try {
                return await provider.transcribe(
                  { ...base, reading, pages: grupo, manifest: { totalPages } },
                  { signal },
                );
              } catch (error) {
                // Un grupo que falla **no tira los que ya se han pagado**. Se
                // devuelve vacío: `assessPageAssembly` verá esas páginas como
                // ausentes, el reintento dirigido las volverá a pedir y, si
                // tampoco llegan, decidirá `assertReadable` con las dos lecturas
                // delante, que es exactamente para lo que existe. Propagar la
                // excepción descartaría los grupos correctos de esta lectura y
                // los de la otra.
                if (signal?.aborted === true) throw error;
                return FAILED_GROUP;
              }
            }),
            MAX_CONCURRENT_REQUESTS,
          ),
        );

  const assessed = assessPageAssembly(first, sources);
  if (assessed.toReread.length === 0) return assessed.reading;

  signal?.throwIfAborted();
  const chunks = chunksCovering(sources, assessed.toReread);
  const retry = await provider.transcribe(
    {
      ...base,
      reading,
      pages: chunks,
      manifest: { totalPages, retryOf: [...assessed.toReread] },
    },
    { signal },
  );
  const merged = mergeReadings(assessed.reading, assessPageAssembly(retry, chunks).reading, assessed.toReread);
  return assessPageAssembly(merged, sources).reading;
}

/**
 * La única situación en la que se rinde: una página que **ninguna** de las
 * dos lecturas ha traído, después de releer. Con una sola lectura completa la
 * entrega sigue —con aviso— porque corregir sobre una transcripción buena sin
 * contraste es mejor que no corregir; sin ninguna, se estaría corrigiendo a
 * ciegas y eso es peor que fallar.
 */
function assertReadable(
  readingA: TranscribeResult,
  readingB: TranscribeResult,
  sources: readonly PageSource[],
): void {
  if (!manifested(sources)) return;
  const inA = new Set(readingA.pages.map((page) => page.page));
  const inB = new Set(readingB.pages.map((page) => page.page));
  const missing = pagesOf(sources).filter((pageNumber) => !inA.has(pageNumber) && !inB.has(pageNumber));
  if (missing.length === 0) return;
  // Delante va lo que le importa a quien lo lee en la cola: qué ha pasado con
  // SU entrega y que no se ha corregido media a ciegas.
  throw new Error(
    `La lectura del examen no cuadra con el original: tras reintentar la lectura, ninguna de las ` +
      `dos pasadas ha transcrito ${missing.length === 1 ? 'la página' : 'las páginas'} ${missing.join(', ')}. ` +
      'La entrega no se corrige para no calificar media a ciegas; vuelve a procesarla.',
  );
}

/** El aviso de revisión de una lectura parcial, o nada si no la hubo. */
function reviewPartialReading(pages: readonly number[]): ReviewFlag[] {
  if (pages.length === 0) return [];
  const listed = pages.join(', ');
  return [
    {
      label: null,
      reason: 'lectura_parcial',
      detail:
        pages.length === 1
          ? `Las dos lecturas no coinciden en la página ${listed}: sólo una la ha transcrito, incluso ` +
            'tras releerla. Revísala con el original delante.'
          : `Las dos lecturas no coinciden en las páginas ${listed}: sólo una las ha transcrito, incluso ` +
            'tras releerlas. Revísalas con el original delante.',
    },
  ];
}

/**
 * El aviso de que el corrector no ha visto el original.
 *
 * Va con cifras a propósito: «94 MB en 14 páginas» le dice al profesor por qué
 * ha pasado y qué mirar, mientras que «el original no cabía» no le dice nada.
 */
function reviewOmittedOriginal(omitted: { bytes: number; pages: number } | null): ReviewFlag[] {
  if (omitted === null) return [];
  const mb = Math.round(omitted.bytes / (1024 * 1024));
  return [
    {
      label: null,
      reason: 'original_omitido',
      detail:
        `El corrector no ha visto el original (${mb} MB en ${omitted.pages} ` +
        `${omitted.pages === 1 ? 'página' : 'páginas'}): la corrección se apoya sólo en la ` +
        'transcripción. Revísala con el escaneo delante.',
    },
  ];
}

function renderActivityMaterial(context: ResolveContextInput): string {
  const parts: string[] = [];
  const reference = context.referenceSolution?.trim();
  if (reference) {
    parts.push(`## ${context.graded === false ? 'Material asociado' : 'Solución de referencia'}\n\n${reference}`);
  }
  for (const file of context.fileContents ?? []) {
    if (file.content.trim() !== '') parts.push(`## Material adjunto · ${file.filename}\n\n${file.content.trim()}`);
  }
  return parts.join('\n\n');
}

// ── Normalización de puntos ─────────────────────────────────────────────────

/**
 * Ajusta la puntuación que propone la IA a algo que un profesor pondría:
 * dentro de [0, maxPoints] y en cuartos de punto. Se acota ANTES de redondear
 * para que un 2,49 sobre 2,5 no acabe en 2,5 por arriba del máximo.
 */
export function normalizePoints(raw: number, maxPoints: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const bounded = Math.min(raw, maxPoints);
  const stepped = Math.round(bounded / POINT_STEP) * POINT_STEP;
  return round2(clamp(stepped, 0, maxPoints));
}

export interface AlignedItems {
  readonly items: readonly NormalizedItem[];
  /** Apartados del reparto que la IA no devolvió. */
  readonly missingLabels: readonly string[];
}

/**
 * Empareja lo que devuelve la IA con el reparto de puntos del profesor. Manda
 * el reparto: la IA puede inventarse apartados o saltarse alguno, pero la nota
 * máxima de cada uno la decide la actividad.
 */
export function alignItems(
  gradedItems: readonly GradedItem[],
  allocation: readonly PointsAllocation[],
  maxScore: number,
): AlignedItems {
  if (allocation.length === 0) {
    // Moodle no siempre trae un reparto. En ese caso usamos el que propone el
    // modelo, pero lo normalizamos a la nota máxima de la actividad: aceptar
    // un `maxPoints: 10` por cada apartado produciría el engañoso «2,5 / 10»
    // repetido en toda la corrección.
    const maxima = normalizeInferredMaxima(gradedItems, maxScore);
    const proposedTotal = gradedItems.reduce(
      (sum, item) => sum + (Number.isFinite(item.maxPoints) && item.maxPoints > 0 ? item.maxPoints : 0),
      0,
    );
    const items = gradedItems.map((item, position) => {
      const max = maxima[position] ?? 0;
      const scaledPoints = proposedTotal > 0 && item.maxPoints > 0
        ? item.aiPoints * (max / item.maxPoints)
        : item.aiPoints;
      return {
        label: item.label,
        statement: '',
        maxPoints: max,
        aiPoints: normalizePoints(scaledPoints, max),
        aiFeedback: item.aiFeedback,
        aiQuote: item.aiQuote ?? null,
        aiQuotePage: item.aiQuotePage ?? null,
        confidence: clamp(item.confidence, 0, 1),
        alternativeMethod: item.alternativeMethod,
        position,
      };
    });
    return { items, missingLabels: [] };
  }

  const byLabel = new Map(gradedItems.map((item) => [normalizeLabel(item.label), item]));
  const missingLabels: string[] = [];

  const items = allocation.map((entry, position) => {
    const match = byLabel.get(normalizeLabel(entry.label));
    if (match === undefined) {
      missingLabels.push(entry.label);
      return {
        label: entry.label,
        statement: entry.statement,
        maxPoints: entry.maxPoints,
        aiPoints: 0,
        aiFeedback:
          'La IA no ha devuelto corrección para este apartado. Se puntúa a cero a la espera de que lo revise el profesor.',
        aiQuote: null,
        aiQuotePage: null,
        confidence: 0,
        alternativeMethod: false,
        position,
      };
    }
    return {
      label: entry.label,
      statement: entry.statement,
      maxPoints: entry.maxPoints,
      aiPoints: normalizePoints(match.aiPoints, entry.maxPoints),
      aiFeedback: match.aiFeedback,
      aiQuote: match.aiQuote ?? null,
      aiQuotePage: match.aiQuotePage ?? null,
      confidence: clamp(match.confidence, 0, 1),
      alternativeMethod: match.alternativeMethod,
      position,
    };
  });

  return { items, missingLabels };
}

/**
 * Convierte los máximos inferidos en centésimas cuya suma es exactamente la
 * nota máxima. El reparto proporcional conserva la intención del modelo y el
 * ajuste por restos evita errores de coma flotante visibles en la interfaz.
 */
function normalizeInferredMaxima(
  items: readonly GradedItem[],
  maxScore: number,
): readonly number[] {
  if (items.length === 0) return [];
  const targetUnits = Math.max(0, Math.round(maxScore * 100));
  if (targetUnits === 0) return items.map(() => 0);

  const proposed = items.map((item) =>
    Number.isFinite(item.maxPoints) && item.maxPoints > 0 ? item.maxPoints : 0,
  );
  const proposedTotal = proposed.reduce((sum, value) => sum + value, 0);
  const weights = proposedTotal > 0
    ? proposed.map((value) => value / proposedTotal)
    : items.map(() => 1 / items.length);
  const exactUnits = weights.map((weight) => weight * targetUnits);
  const units = exactUnits.map(Math.floor);
  let remaining = targetUnits - units.reduce((sum, value) => sum + value, 0);
  const byRemainder = exactUnits
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let position = 0; position < remaining; position += 1) {
    const entry = byRemainder[position % byRemainder.length];
    if (entry !== undefined) units[entry.index] = (units[entry.index] ?? 0) + 1;
  }

  return units.map((value) => value / 100);
}

export interface MechanicalVerification {
  readonly items: readonly NormalizedItem[];
  readonly review: readonly ReviewFlag[];
}

/** Capa gratuita y no desconectable: una cita inexistente nunca pasa en silencio. */
export function verifyMechanically(
  items: readonly NormalizedItem[],
  pages: readonly TranscriptionPage[],
): MechanicalVerification {
  const pageByNumber = new Map(pages.map((page) => [page.page, normalizeCanonical(page.latex)]));
  const review: ReviewFlag[] = [];
  const verifiedItems = items.map((item) => {
    let confidence = item.confidence;
    if (item.aiPoints < item.maxPoints) {
      if (item.aiQuote === null || item.aiQuote.trim() === '' || item.aiQuotePage === null) {
        confidence = Math.min(confidence, 0.49);
        review.push({
          label: item.label,
          reason: 'missing_quote',
          detail: `El apartado ${item.label} descuenta puntos sin una cita del trabajo del alumno.`,
        });
      } else {
        const source = pageByNumber.get(item.aiQuotePage) ?? '';
        if (!source.includes(normalizeCanonical(item.aiQuote))) {
          confidence = Math.min(confidence, 0.49);
          review.push({
            label: item.label,
            reason: 'fabricated_quote',
            detail: `La cita del apartado ${item.label} no aparece en la página ${item.aiQuotePage}.`,
          });
        }
      }
    }

    if (item.aiPoints === item.maxPoints && /(?:[-−–—]\s*\d+(?:[,.]\d+)?|descuent(?:o|a)|pierde\s+\d)/iu.test(item.aiFeedback)) {
      confidence = Math.min(confidence, 0.49);
      review.push({
        label: item.label,
        reason: 'score_feedback_mismatch',
        detail: `El feedback del apartado ${item.label} anuncia un descuento, pero conserva la puntuación máxima.`,
      });
    }
    return { ...item, confidence };
  });

  return { items: verifiedItems, review };
}

/** "1.a" y "1a" son el mismo apartado para el profesor; que lo sean también aquí. */
function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    // NFD separa la tilde de la letra y el filtro siguiente se lleva la tilde:
    // así "Apartado 1.á" y "apartado1a" acaban siendo la misma clave.
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');
}

// ── Confianza global ────────────────────────────────────────────────────────

/**
 * Combina la confianza del OCR con la de la corrección. La transcripción pesa
 * menos (0,4) porque un error de lectura suele afectar a un apartado suelto,
 * mientras que una corrección dudosa compromete la nota entera. Las marcas del
 * OCR ya se reflejan en la confianza de lectura y siguen generando avisos de
 * revisión; restarlas otra vez aquí penalizaría dos veces el mismo hallazgo.
 *
 * Sin transcripción (foros) no hay nada que ponderar: manda la corrección. Y
 * sin apartados que promediar (actividad no puntuable) se usa la confianza que
 * reporta el propio proveedor, que es la del documento que ha redactado.
 */
export function overallConfidence(
  transcriptionConfidence: number | null,
  items: readonly { confidence: number }[],
  _flagCount: number,
  gradeConfidence = 0,
): number {
  const correction =
    items.length > 0
      ? items.reduce((sum, item) => sum + item.confidence, 0) / items.length
      : gradeConfidence;
  const combined =
    transcriptionConfidence === null
      ? correction
      : TRANSCRIPTION_WEIGHT * transcriptionConfidence + (1 - TRANSCRIPTION_WEIGHT) * correction;
  return round2(clamp(combined, 0, 1));
}

// ── Detección de avisos ─────────────────────────────────────────────────────

export interface DetectInput {
  readonly items: readonly NormalizedItem[];
  /** Apartados que la IA no devolvió, tal y como los reporta `alignItems`. */
  readonly missingLabels?: readonly string[];
  readonly flags: readonly TranscriptionFlag[];
  readonly pointsAllocation: readonly PointsAllocation[];
  /** Si la actividad se puntúa. Con `false` no se comprueba el reparto de puntos. */
  readonly graded?: boolean;
  readonly maxScore: number | null;
  /** Modo de autonomía de la actividad. Por defecto, revisarlo todo. */
  readonly autonomy?: AutonomyMode;
  /** Confianza global ya calculada, para contrastarla con la autonomía. */
  readonly confidence?: number;
  readonly lowConfidenceThreshold?: number;
}

/**
 * Todo lo que el profesor tiene que mirar sí o sí antes de validar. Se calcula
 * aquí, y no en la UI, para que el lote nocturno pueda contar avisos sin
 * duplicar la regla.
 */
export function detectReviewFlags(input: DetectInput): readonly ReviewFlag[] {
  const review: ReviewFlag[] = [];
  const lowConfidenceThreshold = input.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
  const flaggedPages = new Set(input.flags.map((flag) => flag.page));
  const missing = new Set(input.missingLabels ?? []);

  input.items.forEach((item, index) => {
    if (missing.has(item.label)) {
      review.push({
        label: item.label,
        reason: 'missing_item',
        detail: `La IA no ha corregido el apartado ${item.label}.`,
      });
      return;
    }
    if (item.confidence < lowConfidenceThreshold) {
      review.push({
        label: item.label,
        reason: 'low_confidence',
        detail: `Confianza baja (${formatConfidence(item.confidence)}) en el apartado ${item.label}.`,
      });
    }
    if (item.alternativeMethod) {
      review.push({
        label: item.label,
        reason: 'alternative_method',
        detail: `El apartado ${item.label} se resuelve por un método distinto al de la solución de referencia.`,
      });
    }
    // Los apartados van en el orden del enunciado, así que el apartado n-ésimo
    // suele corresponder a la página n-ésima del escaneo.
    if (flaggedPages.has(index + 1)) {
      review.push({
        label: item.label,
        reason: 'transcription_flag',
        detail: `Hay marcas de transcripción en la página del apartado ${item.label}.`,
      });
    }
  });

  // El reparto sólo tiene sentido en una actividad que se puntúa.
  if ((input.graded ?? true) && input.maxScore !== null && input.pointsAllocation.length > 0) {
    const allocated = round2(
      input.pointsAllocation.reduce((sum, entry) => sum + entry.maxPoints, 0),
    );
    if (allocated !== input.maxScore) {
      review.push({
        label: null,
        reason: 'allocation_mismatch',
        detail: `El reparto de puntos suma ${formatPoints(allocated)} y la nota máxima de la actividad es ${formatPoints(input.maxScore)}.`,
      });
    }
  }

  // Si el modo de autonomía permitiría publicar sin que lo viera nadie pero la
  // confianza no acompaña, se avisa: es la salvaguarda que impide que el modo
  // autónomo publique justo la corrección que no debía.
  const autonomy = input.autonomy ?? 'review_all';
  const confidence = input.confidence;
  if (
    autonomy !== 'review_all' &&
    confidence !== undefined &&
    confidence < lowConfidenceThreshold
  ) {
    review.push({
      label: null,
      reason: 'autonomy_below_threshold',
      detail: `La actividad está en modo «${AUTONOMY_MODE_LABEL[autonomy]}», pero la confianza global es ${formatConfidence(confidence)}: esta corrección necesita que la valides antes de publicarse.`,
    });
  }

  return review;
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)} %`;
}

/** Puntos con coma decimal: el aviso lo lee un profesor, no un log. */
function formatPoints(value: number): string {
  return value.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
