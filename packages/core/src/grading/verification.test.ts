import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TranscribeResult } from '../ai/provider.js';
import type { NormalizedItem } from './engine.js';
import { verifyMechanically } from './engine.js';
import {
  PARTIAL_READING_NOTE,
  consolidateTranscriptions,
  normalizeCanonical,
  partialReadingPages,
} from './verification.js';

const NO_USAGE = { inputTokens: 1, outputTokens: 2, cachedInputTokens: 3, costCents: 0.1 };

function reading(latex: string): TranscribeResult {
  return {
    pages: [{ page: 1, latex, imageUrl: '/original.pdf#page=1' }],
    flags: [],
    confidence: 0.92,
    model: 'reader',
    usage: NO_USAGE,
  };
}

function item(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    label: '1a',
    statement: 'Calcula.',
    maxPoints: 2,
    aiPoints: 1,
    aiFeedback: 'Hay un error; -1.',
    aiQuote: 'x=3,5',
    aiQuotePage: 1,
    confidence: 0.9,
    alternativeMethod: false,
    position: 0,
    ...overrides,
  };
}

test('la forma canónica iguala fracciones, espaciado y coma decimal', () => {
  assert.equal(
    normalizeCanonical('x = \\dfrac{1}{2} + 3,5'),
    normalizeCanonical('x=\\frac{1}{2}+3.5'),
  );
});

test('dos lecturas equivalentes se consolidan sin falso positivo', () => {
  const result = consolidateTranscriptions(reading('x=\\tfrac{1}{2}'), reading('x = \\frac{1}{2}'));
  assert.equal(result.passCount, 2);
  assert.deepEqual(result.discrepancies, []);
  assert.equal(result.usage.inputTokens, 2);
});

test('una diferencia material conserva ambas lecturas y baja la confianza', () => {
  const result = consolidateTranscriptions(reading('x=2'), reading('x=7'));
  assert.equal(result.discrepancies[0]?.readingA, 'x=2');
  assert.equal(result.discrepancies[0]?.readingB, 'x=7');
  assert.ok(result.pages[0]?.latex.includes('[DISCREPANCIA'));
  assert.ok(result.flags.some((flag) => flag.kind === 'DISCREPANCIA'));
  assert.ok(result.confidence < 0.92);
});

test('una cita canónica existente pasa la comprobación mecánica', () => {
  const result = verifyMechanically([item()], [{ page: 1, latex: 'Resultado: x=3.5', imageUrl: '/a' }]);
  assert.deepEqual(result.review, []);
  assert.equal(result.items[0]?.confidence, 0.9);
});

test('un descuento sin cita o con cita fabricada queda por debajo de 0,5', () => {
  const missing = verifyMechanically([item({ aiQuote: null, aiQuotePage: null })], []);
  assert.equal(missing.review[0]?.reason, 'missing_quote');
  assert.equal(missing.items[0]?.confidence, 0.49);

  const fabricated = verifyMechanically([item({ aiQuote: 'x=99' })], [
    { page: 1, latex: 'x=3,5', imageUrl: '/a' },
  ]);
  assert.equal(fabricated.review[0]?.reason, 'fabricated_quote');
  assert.equal(fabricated.items[0]?.confidence, 0.49);
});

test('detecta feedback con descuento y puntuación completa', () => {
  const result = verifyMechanically([item({ aiPoints: 2, aiQuote: null, aiQuotePage: null })], []);
  assert.equal(result.review[0]?.reason, 'score_feedback_mismatch');
});

// ── Consolidación asimétrica ────────────────────────────────────────────────

function pages(...numbers: number[]): TranscribeResult {
  return {
    pages: numbers.map((page) => ({ page, latex: `Página ${page}: x=${page}`, imageUrl: '/o' })),
    flags: [],
    confidence: 0.92,
    model: 'reader',
    usage: NO_USAGE,
  };
}

test('una página que sólo trae una lectura se conserva tal cual, con marca y una única penalización', () => {
  const result = consolidateTranscriptions(pages(1, 2, 3), pages(1));

  assert.deepEqual(result.pages.map((page) => page.page), [1, 2, 3]);
  // El texto llega limpio: nada de «[PÁGINA AUSENTE…]» dentro del latex.
  assert.equal(result.pages[1]?.latex, 'Página 2: x=2');
  assert.deepEqual(result.discrepancies, []);
  assert.deepEqual(partialReadingPages(result.flags), [2, 3]);
  const partial = result.flags.filter((flag) => flag.note === PARTIAL_READING_NOTE);
  assert.equal(partial.length, 2);
  assert.equal(partial[0]?.kind, 'DISCREPANCIA');
  assert.equal(partial[0]?.excerpt, 'Página 2: x=2');
  // Dos páginas sin contraste restan UNA vez, no dos: 0,92 − 0,15.
  assert.equal(result.confidence, 0.77);
});

test('la confianza y las notas por página se consolidan sin inventar claves', () => {
  const a = reading('x=1');
  const b = reading('x = 1');
  const plain = consolidateTranscriptions(a, b);
  assert.ok(!('confidence' in (plain.pages[0] ?? {})), 'sin metadatos no aparece la clave');
  assert.ok(!('notes' in (plain.pages[0] ?? {})));

  const withMeta = consolidateTranscriptions(
    { ...a, pages: [{ ...a.pages[0]!, confidence: 0.9, notes: 'Escaneo torcido.' }] },
    { ...b, pages: [{ ...b.pages[0]!, confidence: 0.7, notes: 'Margen recortado.' }] },
  );
  assert.equal(withMeta.pages[0]?.confidence, 0.7);
  assert.equal(withMeta.pages[0]?.notes, 'Escaneo torcido. · Margen recortado.');
});
