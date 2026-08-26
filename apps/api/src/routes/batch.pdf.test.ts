import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { MockAiProvider, gradeSubmission } from '@vega/core';
import { splitPdfIntoPageSources } from './batch.js';

async function syntheticPdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.addPage([595, 842]);
    page.drawText(`Página ${index + 1}`);
  }
  return new Uint8Array(await document.save());
}

test('un PDF de 16 páginas produce cuatro bloques reales con manifiesto exacto', async () => {
  const chunks = await splitPdfIntoPageSources(await syntheticPdf(16), 4);
  assert.equal(chunks.length, 4);
  assert.deepEqual(chunks.map((chunk) => chunk.pageNumbers), [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
  ]);

  for (const chunk of chunks) {
    assert.ok(chunk.bytes && chunk.bytes.length > 0);
    const parsed = await PDFDocument.load(chunk.bytes!);
    assert.equal(parsed.getPageCount(), 4);
  }

  const result = await gradeSubmission({
    provider: new MockAiProvider(),
    submissionId: '11111111-2222-4333-8444-555555555555',
    studentRef: 'alumno-test',
    activityKind: 'assignment',
    pages: chunks,
    context: {},
    pointsAllocation: [],
    graded: true,
    maxScore: 10,
  });
  assert.equal(result.transcription?.pages.length, 16);
  assert.deepEqual(result.transcription?.pages.map((page) => page.page),
    Array.from({ length: 16 }, (_unused, index) => index + 1));
});

// ── Presupuesto de bytes por bloque ─────────────────────────────────────────
//
// El troceado por páginas nunca acotó el tamaño de la petición: ése fue el
// `413` de producción del 23-08-2026. Ahora corta también por bytes.

test('con presupuesto ajustado, el bloque baja a una página y el manifiesto sigue cubriendo 1..N', async () => {
  const pdf = await syntheticPdf(6);
  // Un presupuesto por debajo del tamaño medio de página fuerza el mínimo.
  const chunks = await splitPdfIntoPageSources(pdf, {
    pagesPerChunk: 4,
    maxChunkBytes: Math.floor(pdf.byteLength / 6),
  });

  assert.equal(chunks.length, 6, 'una página por bloque');
  assert.deepEqual(
    chunks.flatMap((chunk) => chunk.pageNumbers ?? []),
    [1, 2, 3, 4, 5, 6],
    'ninguna página se pierde ni se duplica al cortar por bytes',
  );
});

test('un presupuesto holgado no cambia nada: manda el tope de páginas', async () => {
  const chunks = await splitPdfIntoPageSources(await syntheticPdf(8), {
    pagesPerChunk: 4,
    maxChunkBytes: 100 * 1024 * 1024,
  });
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map((chunk) => chunk.pageNumbers), [[1, 2, 3, 4], [5, 6, 7, 8]]);
});

test('el presupuesto nunca deja un bloque vacío, por pequeño que sea', async () => {
  const chunks = await splitPdfIntoPageSources(await syntheticPdf(3), {
    pagesPerChunk: 4,
    maxChunkBytes: 1,
  });
  assert.equal(chunks.length, 3);
  assert.ok(
    chunks.every((chunk) => (chunk.pageNumbers ?? []).length >= 1),
    'un bloque sin páginas rompería el manifiesto',
  );
});

test('la forma antigua —un número suelto— sigue valiendo', async () => {
  const chunks = await splitPdfIntoPageSources(await syntheticPdf(4), 2);
  assert.equal(chunks.length, 2);
});
