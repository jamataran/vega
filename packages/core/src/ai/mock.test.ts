import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockAiProvider } from './mock.js';
import type { GradeInput, TranscribeInput } from './provider.js';

const SUBMISSION_A = '11111111-1111-4111-8111-111111111111';
const SUBMISSION_B = '22222222-2222-4222-8222-222222222222';

function transcribeInput(submissionId: string, pageCount = 4): TranscribeInput {
  return {
    submissionId,
    studentRef: 'alumno-0007',
    activityKind: 'assignment',
    pages: Array.from({ length: pageCount }, (_unused, index) => ({
      page: index + 1,
      path: `entregas/${submissionId}/${index + 1}.pdf`,
    })),
  };
}

function gradeInputFor(submissionId: string): GradeInput {
  return {
    submissionId,
    activityKind: 'assignment',
    transcription: { pages: [], flags: [], confidence: 0.9 },
    textContent: null,
    student: null,
    context: '## Instrucciones globales\n\nCorrige con rigor.',
    pointsAllocation: [
      { label: '1a', statement: 'Derivada', maxPoints: 2.5 },
      { label: '1b', statement: 'Simplificación', maxPoints: 2.5 },
      { label: '2a', statement: 'Integral', maxPoints: 5 },
    ],
    graded: true,
    maxScore: 10,
  };
}

/** Foro típico: sin transcripción, sin nota y con el texto del alumno. */
function forumInputFor(submissionId: string, textContent: string | null = null): GradeInput {
  return {
    submissionId,
    activityKind: 'forum',
    transcription: null,
    textContent,
    student: null,
    context: '## Instrucciones globales\n\nValora la argumentación.',
    pointsAllocation: [],
    graded: false,
    maxScore: null,
  };
}

test('la transcripción es determinista para la misma entrega', async () => {
  const provider = new MockAiProvider();
  const first = await provider.transcribe(transcribeInput(SUBMISSION_A));
  const second = await provider.transcribe(transcribeInput(SUBMISSION_A));
  assert.deepEqual(first, second);
});

test('una instancia nueva del proveedor da el mismo resultado', async () => {
  const first = await new MockAiProvider().transcribe(transcribeInput(SUBMISSION_A));
  const second = await new MockAiProvider({ delayMs: 0 }).transcribe(
    transcribeInput(SUBMISSION_A),
  );
  assert.deepEqual(first, second);
});

test('entregas distintas producen correcciones distintas', async () => {
  const provider = new MockAiProvider();
  const ids = [SUBMISSION_A, SUBMISSION_B, '33333333-3333-4333-8333-333333333333'];
  const results = await Promise.all(ids.map((id) => provider.grade(gradeInputFor(id))));
  const serialized = new Set(results.map((result) => JSON.stringify(result.items)));
  assert.ok(serialized.size > 1, 'el mock debería variar entre entregas');
});

test('la corrección es determinista para la misma entrega', async () => {
  const provider = new MockAiProvider();
  const first = await provider.grade(gradeInputFor(SUBMISSION_B));
  const second = await provider.grade(gradeInputFor(SUBMISSION_B));
  assert.deepEqual(first, second);
});

test('la corrección de un foro también es determinista', async () => {
  const provider = new MockAiProvider();
  const first = await provider.grade(forumInputFor(SUBMISSION_A));
  const second = await provider.grade(forumInputFor(SUBMISSION_A));
  assert.deepEqual(first, second);
});

test('la transcripción devuelve LaTeX creíble por página', async () => {
  const provider = new MockAiProvider();
  const result = await provider.transcribe(transcribeInput(SUBMISSION_A, 5));

  assert.equal(result.pages.length, 5);
  for (const page of result.pages) {
    // Convención de `TranscriptionPage.latex`: texto con las fórmulas
    // delimitadas. Sin los `$$`, la UI pinta el LaTeX en crudo (KaTeX no sabe
    // componer un documento de varios párrafos).
    assert.match(page.latex, /\$\$[\s\S]+?\$\$/u, 'la página debe traer fórmulas delimitadas');
    assert.match(page.latex, /\\[a-zA-Z]+/u, 'la página debe traer comandos LaTeX');
    assert.ok(page.imageUrl.includes(SUBMISSION_A));
  }
  assert.ok(result.confidence > 0 && result.confidence <= 1);
});

test('cada marca de transcripción aparece dentro del LaTeX de su página', async () => {
  const provider = new MockAiProvider();
  // Varias entregas para asegurar que en alguna salen marcas.
  for (const id of [SUBMISSION_A, SUBMISSION_B, '44444444-4444-4444-8444-444444444444']) {
    const result = await provider.transcribe(transcribeInput(id, 6));
    for (const flag of result.flags) {
      const page = result.pages.find((candidate) => candidate.page === flag.page);
      if (page === undefined) throw new Error('la marca apunta a una página inexistente');
      assert.ok(page.latex.includes(`[${flag.kind}]`));
      assert.notEqual(flag.note, '');
    }
  }
});

test('la corrección respeta el reparto de puntos y habla en español', async () => {
  const provider = new MockAiProvider();
  const result = await provider.grade(gradeInputFor(SUBMISSION_A));

  assert.equal(result.items.length, 3);
  for (const item of result.items) {
    assert.ok(item.aiPoints >= 0 && item.aiPoints <= item.maxPoints);
    assert.ok(item.aiFeedback.length > 20);
    assert.ok(item.confidence > 0 && item.confidence <= 1);
  }
  assert.ok(result.aiSummary.length > 40);
  assert.ok(result.usage.costCents > 0, 'el coste simulado debería ser mayor que cero');
});

// ── Foros y actividades no puntuables ───────────────────────────────────────

test('una actividad no puntuable no inventa puntuaciones', async () => {
  const provider = new MockAiProvider();
  const result = await provider.grade(forumInputFor(SUBMISSION_A));

  assert.deepEqual(result.items, [], 'sin nota no debe haber apartados puntuados');
  // El resumen es cualitativo: no puede hablar de nota.
  assert.ok(result.aiSummary.length > 40);
  assert.ok(!/\bnota\s+\d/u.test(result.aiSummary));
  assert.ok(result.confidence > 0 && result.confidence <= 1);
});

test('un foro puntuable sí devuelve apartados', async () => {
  const provider = new MockAiProvider();
  const result = await provider.grade({
    ...forumInputFor(SUBMISSION_B),
    graded: true,
    maxScore: 4,
    pointsAllocation: [
      { label: 'Argumentación', statement: 'Sostiene su postura', maxPoints: 2 },
      { label: 'Diálogo', statement: 'Responde a los compañeros', maxPoints: 2 },
    ],
  });

  assert.equal(result.items.length, 2);
  for (const item of result.items) {
    assert.ok(item.aiPoints >= 0 && item.aiPoints <= item.maxPoints);
  }
});

test('el feedback de un foro comenta el texto que ha escrito el alumno', async () => {
  const provider = new MockAiProvider();
  const text =
    'Respondo a Marta: creo que el límite debe aparecer cuando el alumnado lo necesita, ' +
    'no antes. La derivada da el contexto que hace falta para entenderlo.';
  const result = await provider.grade(forumInputFor(SUBMISSION_A, text));

  // El tema se reconoce por las palabras del texto, así que la corrección habla
  // del hilo correcto y no de uno cualquiera del banco.
  assert.match(result.aiLatex, /límite|derivada/iu);
  // Y la intervención del alumno se cita en el documento.
  assert.ok(result.aiLatex.includes('Respondo a Marta'));
});

// ── Documento de corrección en LaTeX ────────────────────────────────────────

test('aiLatex sale no vacío tanto si se puntúa como si no', async () => {
  const provider = new MockAiProvider();
  const graded = await provider.grade(gradeInputFor(SUBMISSION_A));
  const ungraded = await provider.grade(forumInputFor(SUBMISSION_A));

  for (const result of [graded, ungraded]) {
    assert.ok(result.aiLatex.trim().length > 200, 'el documento no puede venir vacío');
    assert.ok(result.aiLatex.includes('\\begin{document}'));
    assert.ok(result.aiLatex.includes('\\end{document}'));
    assert.match(result.aiLatex, /\\section\*\{/u);
  }

  // Con nota, el documento la lleva y en español: coma decimal, no punto.
  assert.match(graded.aiLatex, /Calificación propuesta: \d+(,\d+)? sobre 10/u);
  assert.ok(!/Calificación propuesta: \d+\.\d/u.test(graded.aiLatex));

  // Sin nota, el documento lo dice y no cuela ninguna calificación.
  assert.ok(ungraded.aiLatex.includes('no puntuable'));
  assert.ok(!ungraded.aiLatex.includes('Calificación propuesta'));
});

test('el LaTeX escapa lo que viene de fuera en lugar de romperse', async () => {
  const provider = new MockAiProvider();
  const result = await provider.grade(
    forumInputFor(SUBMISSION_B, 'El 50 % del grupo usa la notación f(x) & g(x); el resto no.'),
  );

  // Un `%` sin escapar comentaría el resto de la línea al compilar.
  assert.ok(result.aiLatex.includes('50 \\%'));
  assert.ok(result.aiLatex.includes('\\&'));
});

test('el retardo simulado por defecto es cero', async () => {
  const started = Date.now();
  await new MockAiProvider().transcribe(transcribeInput(SUBMISSION_A, 2));
  assert.ok(Date.now() - started < 200);
});
