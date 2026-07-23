import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import type { Activity, Correction, CorrectionItem, Submission, Transcription } from '@vega/shared';
import { buildFeedbackPdf, splitLatexSegments } from './pdf.js';

/**
 * El texto que un lector vería en el PDF.
 *
 * Se descomprimen los flujos de contenido y se recogen los operandos de `Tj`,
 * que pdf-lib emite como cadenas hexadecimales en WinAnsi. Es rodeo suficiente
 * para lo que compra: comprobar sobre el fichero de verdad qué acaba leyendo el
 * alumno, en vez de sobre una proyección intermedia que podría no ser la que se
 * dibuja.
 */
function pdfText(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const raw = buffer.toString('latin1');
  const chunks: string[] = [];

  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end === -1) continue;
    const slice = buffer.subarray(start, end);
    let decoded: Buffer;
    try {
      decoded = inflateSync(slice);
    } catch {
      decoded = slice;
    }
    chunks.push(decoded.toString('latin1'));
  }

  // Cada palabra se dibuja con su propio `Tj`, así que se recogen en orden y se
  // unen con un espacio: es la frase que se lee, sin los operadores de posición
  // que van entre medias.
  return [...chunks.join('\n').matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)]
    .map((match) => Buffer.from(match[1] ?? '', 'hex').toString('latin1'))
    .join(' ')
    .replace(/\s+/g, ' ');
}

function item(overrides: Partial<CorrectionItem> = {}): CorrectionItem {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    correctionId: '00000000-0000-4000-8000-000000000002',
    label: '1',
    statement: '',
    maxPoints: 2.5,
    aiPoints: 2,
    aiFeedback: 'Calcula $2^n\\cdot 3^m$ y obtiene $\\sqrt{2}$.',
    aiQuote: null,
    aiQuotePage: null,
    teacherPoints: null,
    teacherFeedback: null,
    confidence: 0.9,
    alternativeMethod: false,
    position: 0,
    ...overrides,
  };
}

function correction(overrides: Partial<Correction> = {}): Correction {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    submissionId: '00000000-0000-4000-8000-000000000003',
    items: [item()],
    maxScore: 10,
    aiLatex: '\\section*{Corrección}\nLa suma es $\\sum_{i=1}^{n} i$.',
    teacherLatex: null,
    aiSummary: 'Repasa $\\frac{1}{2}$ y $\\sqrt{3}$.',
    teacherSummary: null,
    teacherNotes: null,
    verification: null,
    simulated: true,
    confidence: 0.9,
    model: 'mock-1',
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costCents: 0 },
    annotatedFileUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    validatedBy: null,
    validatedAt: null,
    publishedAt: null,
    publishedAutomatically: false,
    publishNotice: null,
    ...overrides,
  };
}

const activity = {
  graded: true,
} as const;

function fullActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: '00000000-0000-4000-8000-000000000004',
    slug: 'tema-04',
    name: 'Tema 04',
    kind: 'assignment',
    courseId: null,
    courseName: 'Matemáticas I',
    moodleRef: 'assign-42',
    enabled: true,
    graded: true,
    maxScore: 10,
    pointsAllocation: [],
    referenceSolution: null,
    templateKey: null,
    autonomy: 'review_all',
    files: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    activityId: '00000000-0000-4000-8000-000000000004',
    studentRef: 'moodle-17',
    studentAlias: 'Alumno de prueba',
    status: 'graded',
    batchRunId: null,
    parkedReason: null,
    parkedBy: null,
    triageLabel: null,
    triageConfidence: null,
    originalFilename: 'examen.pdf',
    pageCount: 2,
    textContent: null,
    submittedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    errorMessage: null,
    ...overrides,
  };
}

function transcription(overrides: Partial<Transcription> = {}): Transcription {
  return {
    id: '00000000-0000-4000-8000-000000000005',
    submissionId: '00000000-0000-4000-8000-000000000003',
    pages: [
      { page: 1, latex: 'Primera página transcrita', imageUrl: '' },
      { page: 2, latex: 'Segunda página transcrita', imageUrl: '' },
    ],
    flags: [],
    discrepancies: [],
    passCount: 2,
    confidence: 0.9,
    model: 'mock-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('separa la prosa de las fórmulas sin tocar el contenido de ninguna', () => {
  // Es el paso que hace posible componer el TeX: si la limpieza fuera primero,
  // borraría los `$` y deshría los `\\frac` antes de que nadie los viera.
  const segments = splitLatexSegments('Sea $x^2$ el cuadrado:\n\\[ \\frac{a}{b} \\]\nfin.');

  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ['text', 'inline', 'text', 'display', 'text'],
  );
  assert.equal(segments[1]?.value, 'x^2');
  assert.equal(segments[3]?.value.trim(), '\\frac{a}{b}');
});

test('un dólar escapado no abre una fórmula', () => {
  // «cuesta \\$5» es prosa. Tratarlo como fórmula se comería medio párrafo
  // hasta encontrar el siguiente dólar.
  const segments = splitLatexSegments('El libro cuesta \\$5 y el cuaderno \\$2.');
  assert.deepEqual(segments.map((segment) => segment.kind), ['text']);
});

test('el PDF lleva la versión del profesor y no la de la IA', async () => {
  // La regla de producto entera en una línea: lo que sustituyó el profesor no
  // viaja a ninguna parte. Se comprueba sobre el fichero, que es lo que se
  // descarga y se entrega.
  const bytes = await buildFeedbackPdf({
    submission: submission({ originalFilename: null }),
    activity: fullActivity({ kind: 'forum' }),
    correction: correction({
      aiLatex: 'Documento propuesto por la IA.',
      teacherLatex: 'Documento reescrito por el profesor.',
      aiSummary: 'Resumen de la IA.',
      teacherSummary: 'Resumen del profesor.',
      items: [item({ aiFeedback: 'Feedback de la IA.', teacherFeedback: 'Feedback del profesor.' })],
    }),
    transcription: null,
  });

  const text = pdfText(bytes);
  for (const written of ['Documento reescrito por el profesor', 'Resumen del profesor', 'Feedback del profesor']) {
    assert.match(text, new RegExp(written), `debería leerse «${written}»`);
  }
  for (const replaced of ['Documento propuesto por la IA', 'Resumen de la IA', 'Feedback de la IA']) {
    assert.doesNotMatch(text, new RegExp(replaced), `no debería leerse «${replaced}»`);
  }
});

test('los apartados salen todos, también los que nadie comentó', async () => {
  // Un apartado sin feedback sigue teniendo nota: esconderlo dejaría al alumno
  // sin saber de dónde sale parte de su calificación.
  const bytes = await buildFeedbackPdf({
    submission: submission({ originalFilename: null }),
    activity: fullActivity({ kind: 'forum' }),
    correction: correction({
      items: [
        item({ id: '00000000-0000-4000-8000-00000000000a', label: '1', aiFeedback: 'Bien planteado.' }),
        item({ id: '00000000-0000-4000-8000-00000000000b', label: '2', aiFeedback: '', position: 1 }),
      ],
    }),
    transcription: null,
  });

  const text = pdfText(bytes);
  assert.match(text, /Bien planteado/);
  assert.match(text, /Sin comentarios sobre este apartado/);
});

test('una fórmula que no se puede componer se lee igual, en texto plano', async () => {
  // El respaldo no es decorativo: la corrección la redacta un modelo y llega
  // TeX inválido. Que la frase siga leyéndose es lo que evita un hueco mudo.
  const bytes = await buildFeedbackPdf({
    submission: submission({ originalFilename: null }),
    activity: fullActivity({ kind: 'forum', graded: false }),
    correction: correction({
      items: [],
      aiLatex: 'Revisa $\\comandoquenoexiste{7}$ antes de entregar.',
      aiSummary: '',
    }),
    transcription: null,
  });

  const text = pdfText(bytes);
  assert.match(text, /Revisa/);
  assert.match(text, /antes de entregar/);
  assert.doesNotMatch(text, /Undefined control sequence/);
});

test('inserta todas las páginas del PDF original antes de la corrección', async () => {
  const original = await PDFDocument.create();
  original.addPage([300, 400]);
  original.addPage([400, 300]);

  const result = await buildFeedbackPdf({
    activity: fullActivity(),
    submission: submission(),
    correction: correction(),
    transcription: transcription(),
    originalFile: {
      bytes: await original.save(),
      // Moodle puede servir un PDF con este MIME genérico: se detecta por firma.
      mediaType: 'application/octet-stream',
    },
  });

  const rendered = await PDFDocument.load(result);
  // Portada + dos páginas originales + corrección. La transcripción no se duplica.
  assert.equal(rendered.getPageCount(), 4);
  assert.deepEqual(rendered.getPage(1).getSize(), { width: 300, height: 400 });
  assert.deepEqual(rendered.getPage(2).getSize(), { width: 400, height: 300 });
});

test('inserta una imagen original ajustada a una página A4', async () => {
  // PNG RGB de 1 x 1 píxel.
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );

  const result = await buildFeedbackPdf({
    activity: fullActivity(),
    submission: submission({ originalFilename: 'foto.png', pageCount: 1 }),
    correction: correction(),
    transcription: transcription(),
    originalFile: { bytes: png, mediaType: 'image/png' },
  });

  const rendered = await PDFDocument.load(result);
  assert.equal(rendered.getPageCount(), 3);
  assert.deepEqual(rendered.getPage(1).getSize(), { width: 595.28, height: 841.89 });
});

test('si el original no se puede abrir usa la transcripción sin bloquear la descarga', async () => {
  const result = await buildFeedbackPdf({
    activity: fullActivity(),
    submission: submission(),
    correction: correction(),
    transcription: transcription(),
    originalFile: {
      bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x72, 0x6f, 0x74, 0x6f]),
      mediaType: 'application/pdf',
    },
  });

  const rendered = await PDFDocument.load(result);
  // Portada + dos páginas de transcripción + corrección.
  assert.equal(rendered.getPageCount(), 4);
});
