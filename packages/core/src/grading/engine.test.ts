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
  assessPageAssembly,
  detectReviewFlags,
  gradeSubmission,
  normalizePoints,
  overallConfidence,
  planTranscriptionRequests,
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
    async triage() {
      return { label: 'sencilla', confidence: 1, reason: 'stub', model: 'stub', usage: NO_USAGE };
    },
    async verify() {
      return { coherent: true, issues: [], confidence: 1, model: 'stub', usage: NO_USAGE };
    },
    async verifyConnection() {
      return { ok: true, message: 'stub', model: 'stub-grader', usage: null };
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

test('sin reparto configurado los máximos inferidos suman la nota de la actividad', () => {
  const { items } = alignItems(
    [
      {
        label: '1', maxPoints: 2.5, aiPoints: 2, aiFeedback: 'Bien.',
        confidence: 0.9, alternativeMethod: false,
      },
      {
        label: '2', maxPoints: 7.5, aiPoints: 6, aiFeedback: 'Bien.',
        confidence: 0.9, alternativeMethod: false,
      },
    ],
    [],
    10,
  );

  assert.deepEqual(items.map((item) => item.maxPoints), [2.5, 7.5]);
  assert.deepEqual(items.map((item) => item.aiPoints), [2, 6]);
  assert.equal(items.reduce((sum, item) => sum + item.maxPoints, 0), 10);
});

test('sin reparto nunca usa la nota completa como máximo de cada apartado', () => {
  const { items } = alignItems(
    ['1', '2', '3'].map((label) => ({
      label, maxPoints: 10, aiPoints: 5, aiFeedback: 'Revisar.',
      confidence: 0.7, alternativeMethod: false,
    })),
    [],
    10,
  );

  assert.deepEqual(items.map((item) => item.maxPoints), [3.34, 3.33, 3.33]);
  assert.equal(items.reduce((sum, item) => sum + item.maxPoints, 0), 10);
  assert.ok(items.every((item) => item.aiPoints <= item.maxPoints));
});

// ── Confianza global ────────────────────────────────────────────────────────

test('la confianza global pondera transcripción y corrección', () => {
  const items = [{ confidence: 0.9 }, { confidence: 0.7 }];
  assert.equal(overallConfidence(0.8, items, 0), 0.8); // 0,4·0,8 + 0,6·0,8
});

test('no descuenta de nuevo los avisos ya reflejados en lectura y apartados', () => {
  const items = [0.49, 0.49, 0.49, 0.72, 0.6, 0.58].map((confidence) => ({ confidence }));

  // Caso regresión: antes nueve avisos restaban 0,45 adicionales y lo
  // convertían artificialmente en 0 pese a conservar evidencia útil.
  assert.equal(overallConfidence(0.2, items, 9), 0.42);
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
        aiQuote: null,
        aiQuotePage: null,
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
        aiQuote: 'Regular.',
        aiQuotePage: 1,
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

  const customThreshold = detectReviewFlags({
    items: [{
      label: '1a', statement: '', maxPoints: 2.5, aiPoints: 2.5,
      aiFeedback: 'Correcto.', aiQuote: null, aiQuotePage: null,
      confidence: 0.8, alternativeMethod: false, position: 0,
    }],
    flags: [],
    pointsAllocation: [],
    maxScore: null,
    graded: false,
    lowConfidenceThreshold: 0.85,
  });
  assert.ok(customThreshold.some((flag) => flag.reason === 'low_confidence'));
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
  assert.equal(result.usage.inputTokens, 600);
  assert.equal(result.usage.cachedInputTokens, 200);
  assert.equal(result.usage.costCents, 5.5);

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

test('los datos del alumno viajan aparte y NO dentro del contexto cacheado', async () => {
  // No es una cuestión de orden: el contexto es el prefijo que comparten todas
  // las entregas de una actividad y que lleva `cache_control`. Meter ahí el
  // nombre —que cambia en cada entrega— invalidaría la caché en todas ellas, y
  // ese fallo no da error: sólo multiplica la factura.
  const provider = stubProvider({}, {});

  await gradeSubmission({
    provider,
    submissionId: '00000000-0000-4000-8000-0000000000f1',
    studentRef: 'moodle-4217',
    student: { name: 'Ana Beltrán Ruiz', community: 'ANDALUCIA, MURCIA', fields: [] },
    activityKind: 'forum',
    pages: [],
    textContent: 'Una intervención cualquiera.',
    context: { global: 'Global.', activityKind: 'Foro.', activity: 'Actividad.' },
    pointsAllocation: [],
    graded: false,
    maxScore: null,
  });

  const input = provider.calls.grade[0];
  assert.equal(input?.student?.name, 'Ana Beltrán Ruiz');
  assert.equal(input?.student?.community, 'ANDALUCIA, MURCIA');
  assert.doesNotMatch(JSON.stringify(input?.context ?? []), /Ana Beltrán/);
  assert.doesNotMatch(JSON.stringify(input?.context ?? []), /ANDALUCIA/);
});

test('sin ficha del alumno el motor manda `null`, no un objeto vacío', async () => {
  const provider = stubProvider({}, {});

  await gradeSubmission({
    provider,
    submissionId: '00000000-0000-4000-8000-0000000000f2',
    studentRef: 'moodle-4217',
    activityKind: 'forum',
    pages: [],
    textContent: 'Otra intervención.',
    context: { global: 'Global.', activityKind: 'Foro.', activity: 'Actividad.' },
    pointsAllocation: [],
    graded: false,
    maxScore: null,
  });

  assert.equal(provider.calls.grade[0]?.student, null);
});

// ── Lectura con reintento dirigido ──────────────────────────────────────────

/** Un examen de seis páginas en dos bloques, como lo trocea la ingesta. */
const DOS_BLOQUES = [
  { page: 1, pageNumbers: [1, 2, 3, 4], path: 'examen.pdf#1-4' },
  { page: 5, pageNumbers: [5, 6], path: 'examen.pdf#5-6' },
];

function pagina(page: number, latex = `Página ${page}`) {
  return { page, latex, imageUrl: '/o' };
}

/**
 * Proveedor con guion: cada lectura (`a`/`b`) devuelve, llamada a llamada, las
 * páginas que se le indiquen. Apunta cada petición para poder mirar qué se
 * pidió en la relectura.
 */
function lectorConGuion(guion: { a: number[][]; b: number[][] }) {
  const peticiones: TranscribeInput[] = [];
  const turno = { a: 0, b: 0 };
  const base = stubProvider({}, {});
  const provider: AiProvider = {
    ...base,
    async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
      peticiones.push(input);
      const reading = input.reading ?? 'a';
      const respuestas = guion[reading];
      const numeros = respuestas[Math.min(turno[reading], respuestas.length - 1)] ?? [];
      turno[reading] += 1;
      return {
        pages: numeros.map((page) => pagina(page)),
        flags: [],
        confidence: 0.9,
        model: 'stub-ocr',
        usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, costCents: 1 },
      };
    },
  };
  return { provider, peticiones };
}

function corregir(provider: AiProvider) {
  return gradeSubmission({
    provider,
    submissionId: SUBMISSION,
    studentRef: 'alumno-0002',
    activityKind: 'assignment',
    pages: DOS_BLOQUES,
    context: { global: 'Global.', activityKind: '', activity: 'Actividad.' },
    pointsAllocation: ALLOCATION,
    graded: true,
    maxScore: 10,
  });
}

test('una lectura completa a la primera lleva el manifiesto del original y no se relee', async () => {
  const todas = [1, 2, 3, 4, 5, 6];
  const { provider, peticiones } = lectorConGuion({ a: [todas], b: [todas] });

  const result = await corregir(provider);

  assert.equal(peticiones.length, 2);
  for (const peticion of peticiones) {
    assert.deepEqual(peticion.manifest, { totalPages: 6 });
    assert.equal(peticion.pages.length, 2);
  }
  assert.equal(result.transcription?.pages.length, 6);
  assert.ok(!result.review.some((flag) => flag.reason === 'lectura_parcial'));
});

test('una lectura incompleta se relee sólo con los bloques que contienen lo que falta', async () => {
  // El caso real: la lectura B se queda en la página 1; la relectura la trae entera.
  const { provider, peticiones } = lectorConGuion({
    a: [[1, 2, 3, 4, 5, 6]],
    b: [[1, 2, 3, 4], [5, 6]],
  });

  const result = await corregir(provider);

  assert.equal(peticiones.length, 3, 'dos lecturas y una relectura');
  const relectura = peticiones[2]!;
  assert.equal(relectura.reading, 'b');
  assert.deepEqual(relectura.manifest, { totalPages: 6, retryOf: [5, 6] });
  // Sólo viaja el bloque que contiene las páginas que faltaban.
  assert.deepEqual(relectura.pages.map((page) => page.pageNumbers), [[5, 6]]);

  assert.deepEqual(result.transcription?.pages.map((page) => page.page), [1, 2, 3, 4, 5, 6]);
  assert.ok(!result.transcription?.flags.some((flag) => flag.kind === 'DISCREPANCIA'));
  assert.ok(!result.review.some((flag) => flag.reason === 'lectura_parcial'));
  // La relectura se paga y se cuenta.
  assert.equal(result.usage.inputTokens, 30);
});

test('si la relectura tampoco trae la página, la otra lectura la cubre con aviso', async () => {
  const { provider, peticiones } = lectorConGuion({
    a: [[1, 2, 3, 4, 5, 6]],
    b: [[1, 2, 3, 4], [1, 2, 3, 4]],
  });

  const result = await corregir(provider);

  assert.equal(peticiones.length, 3, 'un único reintento, no un bucle');
  assert.deepEqual(result.transcription?.pages.map((page) => page.page), [1, 2, 3, 4, 5, 6]);
  assert.equal(result.transcription?.pages[4]?.latex, 'Página 5');

  const parcial = result.review.find((flag) => flag.reason === 'lectura_parcial');
  assert.ok(parcial, 'el profesor tiene que saber que 5 y 6 no tienen contraste');
  assert.match(parcial.detail, /páginas 5, 6/);
  assert.equal(parcial.label, null);
  // Y llega a la ficha por los avisos de verificación, que es lo que se persiste.
  assert.equal(result.correction.verification.coherent, false);
  assert.ok(
    result.correction.verification.issues.some(
      (issue) => issue.kind === 'lectura_parcial' && issue.source === 'mechanical',
    ),
  );
  // Una penalización global, no una por página: 0,9 − 0,15.
  assert.equal(result.transcription?.confidence, 0.75);
});

test('sin ninguna lectura de una página, la entrega falla diciendo que ya se reintentó', async () => {
  const { provider } = lectorConGuion({
    a: [[1, 2, 3, 4], [1, 2, 3, 4]],
    b: [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5]],
  });

  await assert.rejects(corregir(provider), (error: Error) => {
    assert.match(error.message, /tras reintentar la lectura/);
    assert.match(error.message, /la página 6/);
    assert.match(error.message, /no se corrige/);
    return true;
  });
});

test('un duplicado vacío se ignora y un duplicado con texto fuerza la relectura', () => {
  const limpio = assessPageAssembly(
    {
      pages: [pagina(1), pagina(1, ''), pagina(2), pagina(3), pagina(4), pagina(5), pagina(6)],
      flags: [],
      confidence: 0.9,
      model: 'stub-ocr',
      usage: NO_USAGE,
    },
    DOS_BLOQUES,
  );
  assert.deepEqual(limpio.toReread, []);
  assert.equal(limpio.reading.pages.length, 6);
  assert.equal(limpio.reading.pages[0]?.latex, 'Página 1');

  const dudoso = assessPageAssembly(
    {
      pages: [pagina(1), pagina(1, 'Otra lectura de la 1'), pagina(2), pagina(3), pagina(4), pagina(7)],
      flags: [{ kind: 'DUDA', page: 7, excerpt: 'x', note: 'n' }],
      confidence: 0.9,
      model: 'stub-ocr',
      usage: NO_USAGE,
    },
    DOS_BLOQUES,
  );
  assert.deepEqual(dudoso.duplicated, [1]);
  assert.deepEqual(dudoso.missing, [5, 6]);
  assert.deepEqual(dudoso.unexpected, [7]);
  assert.deepEqual(dudoso.toReread, [1, 5, 6]);
  // La página inventada se va, y sus marcas con ella.
  assert.ok(!dudoso.reading.pages.some((page) => page.page === 7));
  assert.deepEqual(dudoso.reading.flags, []);
});

// ── Decisiones de foro que no son de una entrega ────────────────────────────

test('una entrega con fichero nunca se aparca por «no es una duda» ni escala', async () => {
  // Producción, 25-08-2026: el modelo contestó `noEsDuda: true` a un simulacro
  // de tema —que no es una duda— y el lote lo aparcó tirando la corrección.
  const provider = stubProvider(
    { pages: [{ page: 1, latex: 'Tema 8.', imageUrl: '/a.png' }] },
    { noEsDuda: true, escalate: true, confidence: 0.9 },
  );

  const result = await gradeSubmission({
    provider,
    submissionId: SUBMISSION,
    studentRef: 'alumno-0003',
    activityKind: 'assignment',
    pages: [{ page: 1, path: 'examen.pdf' }],
    context: { global: '', activityKind: '', activity: '' },
    pointsAllocation: [],
    graded: true,
    maxScore: 10,
  });

  assert.equal(result.correction.noEsDuda, false);
  assert.equal(result.correction.escalate, false);
});

test('en un foro esas decisiones sí se respetan', async () => {
  const provider = stubProvider({}, { noEsDuda: true, escalate: true, confidence: 0.9 });

  const result = await gradeSubmission({
    provider,
    submissionId: SUBMISSION,
    studentRef: 'alumno-0003',
    activityKind: 'forum',
    pages: [],
    textContent: 'Gracias, ya lo entendí.',
    context: { global: '', activityKind: '', activity: '' },
    pointsAllocation: [],
    graded: false,
    maxScore: null,
  });

  assert.equal(result.correction.noEsDuda, true);
  assert.equal(result.correction.escalate, true);
});

// ── Reparto de la lectura en varias peticiones ──────────────────────────────

test('los bloques se agrupan bajo el presupuesto sin dejar ningún grupo vacío', async () => {
  const bloque = (page: number, kb: number) => ({
    page,
    pageNumbers: [page],
    bytes: new Uint8Array(kb * 1024),
  });
  const grupos = await planTranscriptionRequests(
    [bloque(1, 600), bloque(2, 600), bloque(3, 600)],
    1024 * 1024,
  );

  assert.deepEqual(
    grupos.map((grupo) => grupo.map((b) => b.page)),
    [[1], [2], [3]],
    'con 600 KB por bloque y 1 MB de presupuesto, no caben dos juntos',
  );
  assert.ok(grupos.every((grupo) => grupo.length > 0));
});

test('con presupuesto de sobra hay una sola petición', async () => {
  const grupos = await planTranscriptionRequests(
    [1, 2, 3, 4].map((page) => ({ page, pageNumbers: [page], bytes: new Uint8Array(1024) })),
    20 * 1024 * 1024,
  );
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0]?.length, 4);
});

test('los grupos conservan el orden y cubren todos los bloques', async () => {
  const bloques = [1, 2, 3, 4, 5].map((page) => ({
    page,
    pageNumbers: [page],
    bytes: new Uint8Array(400 * 1024),
  }));
  const grupos = await planTranscriptionRequests(bloques, 1024 * 1024);
  assert.deepEqual(
    grupos.flatMap((grupo) => grupo.map((b) => b.page)),
    [1, 2, 3, 4, 5],
    'mezclar bloques salteados haría que el modelo numerase mal',
  );
});

test('lo que no se puede medir cuenta cero y no trocea de más', async () => {
  // Es el caso del proveedor simulado: rutas que no existen en disco. Tratarlas
  // como enormes multiplicaría las peticiones sin ningún motivo.
  const grupos = await planTranscriptionRequests(
    [1, 2, 3].map((page) => ({ page, pageNumbers: [page], path: `/no/existe/${page}.pdf` })),
    1024,
  );
  assert.equal(grupos.length, 1);
});
