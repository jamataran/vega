import type {
  TranscriptionDiscrepancy,
  TranscriptionFlag,
  TranscriptionPage,
  UsageMetrics,
} from '@vega/shared';
import type { TranscribeResult } from '../ai/provider.js';

/**
 * Forma estable para comparar lecturas y comprobar citas sin confundir
 * diferencias puramente tipográficas de LaTeX con diferencias matemáticas.
 */
export function normalizeCanonical(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\\(?:dfrac|tfrac)\b/g, '\\frac')
    .replace(/\\(?:left|right)\b/g, '')
    .replace(/\\(?:,|;|:|!|quad\b|qquad\b)/g, '')
    .replace(/(?<=\d)[,.](?=\d)/g, '.')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, '')
    .trim();
}

export interface ConsolidatedTranscription extends TranscribeResult {
  readonly discrepancies: TranscriptionDiscrepancy[];
  readonly passCount: 2;
}

/**
 * Nota con la que se marca una página que sólo una de las dos lecturas ha
 * traído. Es texto fijo a propósito: es lo que permite reconocer después esas
 * páginas (`partialReadingPages`) sin guardar un campo más en la transcripción,
 * también en un reproceso `grade_only` que parte de la lectura persistida.
 */
export const PARTIAL_READING_NOTE =
  'Sólo una de las dos lecturas ha transcrito esta página; no se ha podido contrastar con la otra.';

/**
 * Lo que resta a la confianza global una lectura parcial: **una vez**, no una
 * por página. Restar 0,15 por cada página que faltase en una lectura dejaba a
 * cero un examen de trece páginas leído entero por la otra, que es justo el
 * caso en que la transcripción es buena y sólo falta el contraste.
 */
export const PARTIAL_READING_PENALTY = 0.15;

/** Descuento por cada página en la que las dos lecturas difieren de verdad. */
const DISCREPANCY_PENALTY = 0.15;

/** Páginas que sólo una lectura trajo, a partir de las marcas consolidadas. */
export function partialReadingPages(flags: readonly TranscriptionFlag[]): number[] {
  const pages = flags
    .filter((flag) => flag.kind === 'DISCREPANCIA' && flag.note === PARTIAL_READING_NOTE)
    .map((flag) => flag.page);
  return [...new Set(pages)].sort((a, b) => a - b);
}

/**
 * La lectura A es la hipótesis visible; la B nunca la modifica en silencio.
 * Cuando discrepan conservamos ambas y añadimos una marca auditable.
 *
 * Una página que sólo trae una de las lecturas **no** es una discrepancia: es
 * una página sin contraste. Se toma tal cual —sin meter ningún marcador en el
 * texto—, se marca con `DISCREPANCIA` y `PARTIAL_READING_NOTE`, y la entrega
 * paga una única penalización global. Antes se insertaba «[PÁGINA AUSENTE EN
 * LECTURA B]» en el `latex` y se restaba por página: el corrector recibía un
 * texto sucio y una confianza de cero para una transcripción que era buena.
 */
export function consolidateTranscriptions(
  readingA: TranscribeResult,
  readingB: TranscribeResult,
): ConsolidatedTranscription {
  const aByPage = new Map(readingA.pages.map((page) => [page.page, page]));
  const bByPage = new Map(readingB.pages.map((page) => [page.page, page]));
  const pageNumbers = [...new Set([...aByPage.keys(), ...bByPage.keys()])].sort((a, b) => a - b);
  const discrepancies: TranscriptionDiscrepancy[] = [];
  const discrepancyFlags: TranscriptionFlag[] = [];
  let partial = 0;

  const pages: TranscriptionPage[] = pageNumbers.map((pageNumber) => {
    const a = aByPage.get(pageNumber);
    const b = bByPage.get(pageNumber);

    if (a === undefined || b === undefined) {
      const present = (a ?? b) as TranscriptionPage;
      partial += 1;
      discrepancyFlags.push({
        kind: 'DISCREPANCIA',
        page: pageNumber,
        excerpt: firstLine(present.latex),
        note: PARTIAL_READING_NOTE,
      });
      return present;
    }

    if (normalizeCanonical(a.latex) === normalizeCanonical(b.latex)) {
      return mergeMetadata(a, b, a.latex);
    }

    const marker = `[DISCREPANCIA · lectura A: ${a.latex} · lectura B: ${b.latex}]`;
    discrepancies.push({
      page: pageNumber,
      readingA: a.latex,
      readingB: b.latex,
      marker,
    });
    discrepancyFlags.push({
      kind: 'DISCREPANCIA',
      page: pageNumber,
      excerpt: marker,
      note: 'Las dos lecturas independientes no coinciden. Revisa el original.',
    });

    return mergeMetadata(a, b, `${a.latex}\n\n${marker}`);
  });

  return {
    pages,
    flags: [...readingA.flags, ...readingB.flags, ...discrepancyFlags],
    discrepancies,
    passCount: 2,
    confidence: clamp01(
      Math.min(readingA.confidence, readingB.confidence) -
        discrepancies.length * DISCREPANCY_PENALTY -
        (partial > 0 ? PARTIAL_READING_PENALTY : 0),
    ),
    model: readingA.model === readingB.model ? readingA.model : `${readingA.model} / ${readingB.model}`,
    usage: sumUsage(readingA.usage, readingB.usage),
  };
}

/**
 * La página consolidada lleva el texto que se le pase y, de las dos lecturas,
 * la confianza más baja y las notas de ambas. Sólo se escriben las claves que
 * existen: una lectura antigua sin `confidence` no debe ganar un `undefined`.
 */
function mergeMetadata(a: TranscriptionPage, b: TranscriptionPage, latex: string): TranscriptionPage {
  const confidences = [a.confidence, b.confidence].filter(
    (value): value is number => typeof value === 'number',
  );
  const notes = [...new Set([a.notes, b.notes].filter((note): note is string => Boolean(note?.trim())))];
  return {
    ...a,
    latex,
    imageUrl: a.imageUrl || b.imageUrl,
    ...(confidences.length > 0 ? { confidence: Math.min(...confidences) } : {}),
    ...(notes.length > 0 ? { notes: notes.join(' · ') } : {}),
  };
}

/** Primer renglón con contenido, acotado: es el `excerpt` de una marca de página. */
function firstLine(latex: string): string {
  const line = latex
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part !== '');
  return (line ?? '').slice(0, 120);
}

export function sumUsage(a: UsageMetrics, b: UsageMetrics): UsageMetrics {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheCreationTokens: (a.cacheCreationTokens ?? 0) + (b.cacheCreationTokens ?? 0),
    costCents: Math.round((a.costCents + b.costCents) * 10_000) / 10_000,
    // Un sumando sin tarifa convierte el total en un mínimo, no en el coste
    // real. La marca viaja con la suma para que nadie lo presente como exacto.
    ...((a.unpriced ?? false) || (b.unpriced ?? false) ? { unpriced: true } : {}),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
