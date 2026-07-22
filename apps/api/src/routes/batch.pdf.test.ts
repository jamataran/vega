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
