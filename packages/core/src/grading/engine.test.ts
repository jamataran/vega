import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PointsAllocation } from '@vega/shared';
import type {
  AiProvider,
  GradeInput,
  GradeResult,
  TranscribeInput,
  TranscribeResult,
} from '../ai/provider.js';
import {
  LOW_CONFIDENCE_THRESHOLD,
  alignItems,
  detectReviewFlags,
  gradeSubmission,
  normalizePoints,
  overallConfidence,
} from './engine.js';

const SUBMISSION = '55555555-5555-4555-8555-555555555555';

const ALLOCATION: readonly PointsAllocation[] = [
  { label: '1a', statement: 'Derivada', maxPoints: 2.5 },
  { label: '1b', statement: 'Simplificación', maxPoints: 2.5 },
  { label: '2', statement: 'Integral', maxPoints: 5 },
];

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costCents: 0 };

/** Proveedor de laboratorio: devuelve exactamente lo que le pasemos. */
function stubProvider(
  transcription: Partial<TranscribeResult>,
  grade: Partial<GradeResult>,
): AiProvider & { readonly calls: { transcribe: number; grade: GradeInput[] } } {
  const calls = { transcribe: 0, grade: [] as GradeInput[] };
  return {
    name: 'stub',
    calls,
    async transcribe(_input: TranscribeInput): Promise<TranscribeResult> {
      calls.transcribe += 1;
      return {
        pages: [],
        flags: [],
        confidence: 1,
        model: 'stub-ocr',
        usage: NO_USAGE,
        ...transcription,
      };
    },
    async grade(input: GradeInput): Promise<GradeResult> {
      calls.grade.push(input);
      return {
        items: [],
        aiLatex: '\\section*{Corrección}\n\nDocumento de prueba.',
        aiSummary: 'Resumen de prueba.',
        confidence: 1,
        model: 'stub-grader',
        usage: NO_USAGE,
        ...grade,
      };
    },
  };
}

// ── Normalización de puntos ─────────────────────────────────────────────────

test('la puntuación nunca supera el máximo del apartado', () => {
  assert.equal(normalizePoints(4, 2.5), 2.5);
  assert.equal(normalizePoints(2.6, 2.5), 2.5);
});

test('la puntuación se redondea a cuartos de punto', () => {
  assert.equal(normalizePoints(1.13, 2.5), 1.25);
  assert.equal(normalizePoints(1.1, 2.5), 1);
  assert.equal(normalizePoints(1.874, 2.5), 1.75);
});

test('los valores negativos o no numéricos se quedan en cero', () => {
  assert.equal(normalizePoints(-3, 2.5), 0);
  assert.equal(normalizePoints(Number.NaN, 2.5), 0);
});

// ── Emparejado con el reparto de puntos ─────────────────────────────────────

test('empareja apartados aunque la IA escriba la etiqueta de otra forma', () => {
  const { items, missingLabels } = alignItems(
    [
      {
        label: '1.A',
        maxPoints: 99,
        aiPoints: 2.4,
        aiFeedback: 'Bien.',
        confidence: 0.9,
        alternativeMethod: false,
      },
    ],
    ALLOCATION.slice(0, 1),
    10,
  );

  assert.equal(items[0]?.label, '1a');
  // El máximo lo pone la actividad, no la IA.
  assert.equal(items[0]?.maxPoints, 2.5);
  assert.equal(items[0]?.aiPoints, 2.5);
  assert.deepEqual(missingLabels, []);
});

test('un apartado que la IA no devuelve se puntúa a cero y se reporta', () => {
  const { items, missingLabels } = alignItems([], ALLOCATION, 10);

  assert.equal(items.length, 3);
  assert.ok(items.every((item) => item.aiPoints === 0 && item.confidence === 0));
  assert.deepEqual(missingLabels, ['1a', '1b', '2']);
});

// ── Confianza global ────────────────────────────────────────────────────────

test('la confianza global pondera transcripción y corrección, y penaliza marcas', () => {
  const items = [{ confidence: 0.9 }, { confidence: 0.7 }];
  const clean = overallConfidence(0.8, items, 0);
  assert.equal(clean, 0.8); // 0,4·0,8 + 0,6·0,8

  const withFlags = overallConfidence(0.8, items, 2);
  assert.ok(withFlags < clean);
  assert.equal(withFlags, 0.7);
});

test('sin transcripción la confianza no se pondera con algo que no existe', () => {
  const items = [{ confidence: 0.9 }, { confidence: 0.7 }];
  // Manda la corrección: la media de los apartados, tal cual.
  assert.equal(overallConfidence(null, items, 0), 0.8);

  // Y sin apartados que promediar, la que reporta el proveedor.
  assert.equal(overallConfidence(null, [], 0, 0.86), 0.86);
});

// ── Avisos ──────────────────────────────────────────────────────────────────

test('señala baja confianza, método alternativo y reparto que no cuadra', () => {
  const review = detectReviewFlags({
    items: [
      {
        label: '1a',
        statement: '',
        maxPoints: 2.5,
        aiPoints: 2.5,
        aiFeedback: 'Perfecto.',
        confidence: 0.95,
        alternativeMethod: true,
        position: 0,
      },
      {
        label: '1b',
        statement: '',
        maxPoints: 2.5,
        aiPoints: 1,
        aiFeedback: 'Regular.',
        confidence: LOW_CONFIDENCE_THRESHOLD - 0.2,
        alternativeMethod: false,
        position: 1,
      },
    ],
    missingLabels: [],
    flags: [],
    pointsAllocation: ALLOCATION,
    maxScore: 10,
  });

  const reasons = review.map((flag) => flag.reason);
  assert.ok(reasons.includes('alternative_method'));
  assert.ok(reasons.includes('low_confidence'));
  // El reparto de ALLOCATION suma 10 y la nota máxima es 10: no debe avisar.
  assert.ok(!reasons.includes('allocation_mismatch'));

  const mismatch = detectReviewFlags({
    items: [],
    flags: [],
    pointsAllocation: ALLOCATION,
    maxScore: 9,
  });
  assert.equal(mismatch[0]?.reason, 'allocation_mismatch');
});

// ── Orquestación completa ───────────────────────────────────────────────────

test('gradeSubmission normaliza, acota la nota y arrastra el contexto resuelto', async () => {
  const provider = stubProvider(
    {
      pages: [{ page: 1, latex: 'f(x)=x^2', imageUrl: '/a.png' }],
      flags: [{ kind: 'DUDA', page: 1, excerpt: 'x^2', note: 'Podría ser x^3.' }],
      confidence: 0.8,
      usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, costCents: 1.5 },
    },
    {
      items: [
        {
          label: '1a',
          maxPoints: 2.5,
          aiPoints: 99, // la IA se pasa: el motor lo tiene que acotar
          aiFeedback: 'Correcto.',
          confidence: 0.9,
          alternativeMethod: false,
        },
        {
          label: '1b',
          maxPoints: 2.5,
          aiPoints: 1.13, // decimales raros: el motor los lleva a cuartos
          aiFeedback: 'A medias.',
          confidence: 0.6,
          alternativeMethod: false,
        },
        {
          label: '2',
          maxPoints: 5,
          aiPoints: 5,
          aiFeedback: 'Muy bien.',
          confidence: 0.95,
          alternativeMethod: true,
        },
      ],
      usage: { inputTokens: 400, outputTokens: 90, cachedInputTokens: 200, costCents: 2.5 },
    },
  );

  const result = await gradeSubmission({
    provider,
    submissionId: SUBMISSION,
    studentRef: 'alumno-0001',
    activityKind: 'assignment',
    pages: [{ page: 1, path: 'examen.pdf' }],
    context: { global: 'Global.', activityKind: '', activity: 'Actividad.' },
    pointsAllocation: ALLOCATION,
    graded: true,
    maxScore: 10,
  });

  assert.equal(result.correction.items[0]?.aiPoints, 2.5);
  assert.equal(result.correction.items[1]?.aiPoints, 1.25);
  assert.equal(result.score, 8.75);
  assert.ok(result.score <= 10);

  // Contexto resuelto y consumo agregado viajan con el resultado.
  assert.ok(result.resolvedContext.merged.includes('Global.'));
  assert.ok(result.resolvedContext.merged.includes('Actividad.'));
  assert.equal(result.usage.inputTokens, 500);
  assert.equal(result.usage.cachedInputTokens, 200);
  assert.equal(result.usage.costCents, 4);

  const reasons = result.review.map((flag) => flag.reason);
  assert.ok(reasons.includes('low_confidence'), 'el apartado 1b va por debajo del umbral');
  assert.ok(reasons.includes('alternative_method'));
  assert.ok(reasons.includes('transcription_flag'));
});

test('la nota total nunca supera la nota máxima de la actividad', async () => {
  const provider = stubProvider(
    {},
    {
      items: ALLOCATION.map((entry) => ({
        label: entry.label,
        maxPoints: entry.maxPoints,
        aiPoints: entry.maxPoints * 10,
        aiFeedback: 'Todo perfecto.',
        confidence: 1,
        alternativeMethod: false,
      })),
    },
  );

  const result = await gradeSubmission({
    provider,
    submissionId: SUBMISSION,
    studentRef: 'alumno-0002',
    activityKind: 'assignment',
    pages: [{ page: 1, path: 'examen.pdf' }],
    context: {},
    pointsAllocation: ALLOCATION,
    graded: true,
    maxScore: 10,
  });

  assert.equal(result.score, 10);
});

// ── Foros: sin fichero, sin transcripción ───────────────────────────────────

test('un foro no pasa por transcripción y se corrige sobre el texto', async () => {
  const provider = stubProvider(
    {},
    {
      items: [],
      aiLatex: '\\section*{Valoración}\n\nBuena intervención.',
      confidence: 0.9,
    },
  );

  const result = await gradeSubmission({
    provider,
    submissionId: SUBMISSION,
    studentRef: 'alumno-0003',
    activityKind: 'forum',
    pages: [],
    textContent: 'Respondo a Marta: el límite debe aparecer cuando hace falta.',
    context: { global: 'Global.' },
    pointsAllocation: [],
    graded: false,
    maxScore: null,
  });

  assert.equal(provider.calls.transcribe, 0, 'un foro no debe llamar a transcribe');
  assert.equal(result.transcription, null);

  // El texto del alumno es lo que llega al corrector, en lugar de la transcripción.
  const gradeCall = provider.calls.grade[0];
  assert.equal(gradeCall?.transcription, null);
  assert.ok(gradeCall?.textContent?.includes('Respondo a Marta'));

  // Sin transcripción, la confianza global es la de la corrección: no se
  // pondera con algo que no existe.
  assert.equal(result.correction.confidence, 0.9);
  // Y el consumo es sólo el de la corrección.
  assert.equal(result.usage.inputTokens, 0);
  assert.ok(result.correction.aiLatex.length > 0);
});

// ── Actividades no puntuables ───────────────────────────────────────────────

test('una actividad no puntuable no tiene apartados ni nota', async () => {
  const provider = stubProvider(
    {},
    {
      // Aunque la IA se empeñe en devolver apartados, sin nota no se normalizan.
      items: [
        {
          label: '1a',
          maxPoints: 2.5,
          aiPoints: 2,
          aiFeedback: 'No debería contarse.',
          confidence: 0.9,
          alternativeMethod: false,
        },
      ],
      aiLatex: '\\section*{Valoración}\n\nComentario cualitativo.',
      confidence: 0.88,
    },
  );

  const result = await gradeSubmission({
    provider,
    submissionId: SUBMISSION,
    studentRef: 'alumno-0004',
    activityKind: 'forum',
    pages: [],
    textContent: 'Mi intervención en el hilo.',
    context: {},
    pointsAllocation: [],
    graded: false,
    maxScore: null,
  });

  assert.deepEqual(result.correction.items, []);
  assert.equal(result.score, null);
  assert.equal(result.correction.maxScore, null);
  // El documento es la única salida con valor: no puede venir vacío.
  assert.ok(result.correction.aiLatex.trim().length > 0);
  // Y sin reparto de puntos no tiene sentido avisar de que el reparto no cuadra.
  assert.ok(!result.review.some((flag) => flag.reason === 'allocation_mismatch'));
});

test('una entrega puntuable sigue trayendo nota y LaTeX', async () => {
  const provider = stubProvider(
    { confidence: 0.9 },
    {
      items: ALLOCATION.map((entry) => ({
        label: entry.label,
        maxPoints: entry.maxPoints,
        aiPoints: entry.maxPoints / 2,
        aiFeedback: 'A medias.',
        confidence: 0.9,
        alternativeMethod: false,
      })),
      aiLatex: '\\section*{Corrección}\n\nCon nota.',
    },
  );

  const result = await gradeSubmission({
    provider,
    submissionId: SUBMISSION,
    studentRef: 'alumno-0005',
    activityKind: 'assignment',
    pages: [{ page: 1, path: 'examen.pdf' }],
    context: {},
    pointsAllocation: ALLOCATION,
    graded: true,
    maxScore: 10,
  });

  assert.equal(result.score, 5);
  assert.equal(result.correction.maxScore, 10);
  assert.ok(result.correction.aiLatex.trim().length > 0);
});

// ── Autonomía ───────────────────────────────────────────────────────────────

test('avisa cuando la autonomía publicaría sola una corrección de baja confianza', async () => {
  const lowConfidenceItems = ALLOCATION.map((entry) => ({
    label: entry.label,
    maxPoints: entry.maxPoints,
    aiPoints: entry.maxPoints,
    aiFeedback: 'Correcto, pero la IA no lo tiene claro.',
    confidence: 0.4,
    alternativeMethod: false,
  }));

  async function run(autonomy: 'review_all' | 'review_low_confidence' | 'autonomous') {
    return gradeSubmission({
      provider: stubProvider({ confidence: 0.5 }, { items: lowConfidenceItems }),
      submissionId: SUBMISSION,
      studentRef: 'alumno-0006',
      activityKind: 'assignment',
      pages: [{ page: 1, path: 'examen.pdf' }],
      context: {},
      pointsAllocation: ALLOCATION,
      graded: true,
      maxScore: 10,
      autonomy,
    });
  }

  for (const autonomy of ['review_low_confidence', 'autonomous'] as const) {
    const result = await run(autonomy);
    assert.ok(
      result.review.some((flag) => flag.reason === 'autonomy_below_threshold'),
      `debería avisar en modo ${autonomy}`,
    );
  }

  // En modo "reviso todas" el aviso sobra: ya lo va a mirar el profesor.
  const reviewAll = await run('review_all');
  assert.ok(!reviewAll.review.some((flag) => flag.reason === 'autonomy_below_threshold'));

  // Y con confianza alta tampoco se avisa, aunque el modo sea autónomo.
  const confident = await gradeSubmission({
    provider: stubProvider(
      { confidence: 1 },
      {
        items: ALLOCATION.map((entry) => ({
          label: entry.label,
          maxPoints: entry.maxPoints,
          aiPoints: entry.maxPoints,
          aiFeedback: 'Impecable.',
          confidence: 0.97,
          alternativeMethod: false,
        })),
      },
    ),
    submissionId: SUBMISSION,
    studentRef: 'alumno-0006',
    activityKind: 'assignment',
    pages: [{ page: 1, path: 'examen.pdf' }],
    context: {},
    pointsAllocation: ALLOCATION,
    graded: true,
    maxScore: 10,
    autonomy: 'autonomous',
  });
  assert.ok(!confident.review.some((flag) => flag.reason === 'autonomy_below_threshold'));
});
