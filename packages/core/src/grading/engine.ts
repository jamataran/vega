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
import type { AiProvider, GradedItem, PageSource, StudentContext } from '../ai/provider.js';
import { consolidateTranscriptions, normalizeCanonical, sumUsage } from './verification.js';

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

/** Cuánta confianza resta cada marca [ILEGIBLE]/[DUDA]. */
const FLAG_PENALTY = 0.05;

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
   * El modo de autonomía dejaría publicar esto sin que lo viera nadie, pero la
   * confianza global no da para tanto. Es el aviso que evita que el modo
   * autónomo publique justo lo que no debía.
   */
  | 'autonomy_below_threshold';

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
    const [rawA, rawB] = await Promise.all([
      input.provider.transcribe({ ...transcriptionInput, reading: 'a' }),
      input.provider.transcribe({ ...transcriptionInput, reading: 'b' }),
    ]);
    transcription = consolidateTranscriptions(
      validatePageAssembly(rawA, input.pages),
      validatePageAssembly(rawB, input.pages),
    );
  }

  const resolvedContext = resolveContext(input.context);

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
    document: [...input.pages],
    textContent: input.textContent ?? null,
    context: resolvedContext.segments,
    material: renderActivityMaterial(input.context),
    pointsAllocation: [...input.pointsAllocation],
    graded: input.graded,
    maxScore: input.maxScore,
    route: input.forumRoute,
    explanations: input.explanations ?? true,
  });

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
      });
  const verification: CorrectionVerification = {
    coherent: mechanical.review.length === 0 && (aiVerification?.coherent ?? true),
    confidence: aiVerification?.confidence ?? null,
    aiEnabled: input.verifyWithAi !== false,
    issues: [
      ...mechanical.review.map((issue) => ({
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
    ...mechanical.review,
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
      escalate: graded.escalate ?? false,
      noEsDuda: graded.noEsDuda ?? false,
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

function validatePageAssembly(
  reading: import('../ai/provider.js').TranscribeResult,
  sources: readonly PageSource[],
): import('../ai/provider.js').TranscribeResult {
  const manifested = sources.some((source) => source.pageNumbers !== undefined);
  if (!manifested) return reading;
  const expected = sources.flatMap((source) => source.pageNumbers ?? [source.page]);
  const actual = reading.pages.map((page) => page.page);
  const unique = new Set(actual);
  const missing = expected.filter((page) => !unique.has(page));
  const duplicates = actual.filter((page, index) => actual.indexOf(page) !== index);
  const unexpected = actual.filter((page) => !expected.includes(page));
  if (missing.length > 0 || duplicates.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Ensamblado de transcripción inválido: faltan [${missing.join(', ')}], duplicadas [${duplicates.join(', ')}], inesperadas [${unexpected.join(', ')}].`,
    );
  }
  return reading;
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
    // Actividad sin reparto: la entrega se corrige como un único bloque.
    const items = gradedItems.map((item, position) => {
      const max = item.maxPoints > 0 ? item.maxPoints : maxScore;
      return {
        label: item.label,
        statement: '',
        maxPoints: max,
        aiPoints: normalizePoints(item.aiPoints, max),
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
 * OCR restan aparte: ya han bajado la confianza de la transcripción, pero
 * además son trabajo manual seguro para el profesor.
 *
 * Sin transcripción (foros) no hay nada que ponderar: manda la corrección. Y
 * sin apartados que promediar (actividad no puntuable) se usa la confianza que
 * reporta el propio proveedor, que es la del documento que ha redactado.
 */
export function overallConfidence(
  transcriptionConfidence: number | null,
  items: readonly { confidence: number }[],
  flagCount: number,
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
  return round2(clamp(combined - flagCount * FLAG_PENALTY, 0, 1));
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
