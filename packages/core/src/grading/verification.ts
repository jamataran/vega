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
 * La lectura A es la hipótesis visible; la B nunca la modifica en silencio.
 * Cuando discrepan conservamos ambas y añadimos una marca auditable.
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

  const pages: TranscriptionPage[] = pageNumbers.map((pageNumber) => {
    const a = aByPage.get(pageNumber);
    const b = bByPage.get(pageNumber);
    const readingAText = a?.latex ?? '[PÁGINA AUSENTE EN LECTURA A]';
    const readingBText = b?.latex ?? '[PÁGINA AUSENTE EN LECTURA B]';

    if (normalizeCanonical(readingAText) === normalizeCanonical(readingBText)) {
      return a ?? b!;
    }

    const marker = `[DISCREPANCIA · lectura A: ${readingAText} · lectura B: ${readingBText}]`;
    discrepancies.push({
      page: pageNumber,
      readingA: readingAText,
      readingB: readingBText,
      marker,
    });
    discrepancyFlags.push({
      kind: 'DISCREPANCIA',
      page: pageNumber,
      excerpt: marker,
      note: 'Las dos lecturas independientes no coinciden. Revisa el original.',
    });

    return {
      page: pageNumber,
      latex: `${readingAText}\n\n${marker}`,
      imageUrl: a?.imageUrl ?? b?.imageUrl ?? '',
    };
  });

  return {
    pages,
    flags: [...readingA.flags, ...readingB.flags, ...discrepancyFlags],
    discrepancies,
    passCount: 2,
    confidence: clamp01(
      Math.min(readingA.confidence, readingB.confidence) - discrepancies.length * 0.15,
    ),
    model: readingA.model === readingB.model ? readingA.model : `${readingA.model} / ${readingB.model}`,
    usage: sumUsage(readingA.usage, readingB.usage),
  };
}

export function sumUsage(a: UsageMetrics, b: UsageMetrics): UsageMetrics {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheCreationTokens: (a.cacheCreationTokens ?? 0) + (b.cacheCreationTokens ?? 0),
    costCents: Math.round((a.costCents + b.costCents) * 10_000) / 10_000,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
