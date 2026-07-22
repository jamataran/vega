import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  DownloadedFile,
  FeedbackFile,
  LmsConnectionInfo,
  LmsConnector,
  RemoteGrade,
  RemoteReply,
  RemoteSubmission,
  SubmissionRef,
} from '@vega/connector-lms';
import type { Activity, Correction, CorrectionItem, Submission } from '@vega/shared';
import { publishToLms, toRemoteGrade, toRemoteReply, type PublishInput } from './publish.js';

/**
 * La publicación es el único punto del sistema en el que Vega escribe en el
 * mundo exterior, y el que peor se puede probar a mano: exige un Moodle, una
 * entrega validada y la voluntad de ponerle una nota a alguien. Estas pruebas
 * cubren lo que decide el resultado —qué nota viaja y qué pasa cuando sólo una
 * de las dos operaciones sale bien— con un conector de laboratorio.
 */

// ── Utilería ────────────────────────────────────────────────────────────────

function item(overrides: Partial<CorrectionItem> = {}): CorrectionItem {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    correctionId: '00000000-0000-4000-8000-000000000002',
    label: '1a',
    statement: '',
    maxPoints: 2.5,
    aiPoints: 2,
    aiFeedback: 'Lo de la IA',
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
    aiLatex: '\\section{Corrección}',
    teacherLatex: null,
    aiSummary: 'Resumen de la IA',
    teacherSummary: null,
    confidence: 0.9,
    model: 'mock-1',
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costCents: 0 },
    annotatedFileUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    validatedBy: '00000000-0000-4000-8000-00000000000a',
    validatedAt: '2026-01-02T00:00:00.000Z',
    publishedAt: null,
    publishedAutomatically: false,
    publishNotice: null,
    ...overrides,
  };
}

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: '00000000-0000-4000-8000-000000000004',
    slug: 'tema04',
    name: 'Tema 04',
    kind: 'assignment',
    courseId: null,
    courseName: 'Matemáticas I',
    moodleRef: 'assign-42',
    enabled: true,
    graded: true,
    maxScore: 10,
    referenceSolution: null,
    pointsAllocation: [],
    autonomy: 'review_all',
    createdAt: '2026-01-01T00:00:00.000Z',
    files: [],
    ...overrides,
  };
}

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    activityId: '00000000-0000-4000-8000-000000000004',
    studentRef: 'moodle-17',
    studentAlias: null,
    status: 'validated',
    originalFilename: 'examen.pdf',
    pageCount: 3,
    textContent: null,
    submittedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    errorMessage: null,
    ...overrides,
  };
}

function input(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    submission: submission(),
    activity: activity(),
    correction: correction(),
    alreadyPublished: { grade: false, file: false },
    transcription: null,
    ...overrides,
  };
}

const REF: SubmissionRef = {
  activity: { slug: 'tema04', lmsRef: 'assign-42', kind: 'assignment' },
  studentRef: 'moodle-17',
  remoteId: '42:17:0',
};

/** Conector de laboratorio: registra lo que recibe y falla donde se le pida. */
class LabConnector implements LmsConnector {
  readonly name = 'lab';
  readonly grades: RemoteGrade[] = [];
  readonly files: FeedbackFile[] = [];
  readonly replies: RemoteReply[] = [];

  constructor(
    private readonly fail: { grade?: string; file?: string; reply?: string } = {},
  ) {}

  listCourses(): Promise<never[]> {
    return Promise.resolve([]);
  }
  verifyConnection(): Promise<LmsConnectionInfo> {
    return Promise.resolve({ siteName: '', username: '', courseCount: 0, checks: [] });
  }
  listActivities(): Promise<never[]> {
    return Promise.resolve([]);
  }
  listSubmissions(): Promise<RemoteSubmission[]> {
    return Promise.resolve([]);
  }
  download(): Promise<DownloadedFile> {
    return Promise.reject(new Error('no procede'));
  }
  publishGrade(_ref: SubmissionRef, grade: RemoteGrade): Promise<void> {
    if (this.fail.grade !== undefined) return Promise.reject(new Error(this.fail.grade));
    this.grades.push(grade);
    return Promise.resolve();
  }
  publishFeedbackFile(_ref: SubmissionRef, file: FeedbackFile): Promise<void> {
    if (this.fail.file !== undefined) return Promise.reject(new Error(this.fail.file));
    this.files.push(file);
    return Promise.resolve();
  }
  publishForumReply(_ref: SubmissionRef, reply: RemoteReply): Promise<void> {
    if (this.fail.reply !== undefined) return Promise.reject(new Error(this.fail.reply));
    this.replies.push(reply);
    return Promise.resolve();
  }
}

// ── Qué nota viaja ──────────────────────────────────────────────────────────

test('la nota publicada es la efectiva, no la que propuso la IA', () => {
  const grade = toRemoteGrade(
    input({
      correction: correction({
        items: [item({ aiPoints: 2, teacherPoints: 1 }), item({ aiPoints: 2 })],
      }),
    }),
  );

  assert.equal(grade.score, 3);
  assert.equal(grade.items[0]?.points, 1);
});

test('el feedback publicado es el del profesor cuando lo ha escrito', () => {
  const grade = toRemoteGrade(
    input({
      correction: correction({
        items: [item({ teacherFeedback: 'Lo del profesor' })],
        teacherSummary: 'Resumen del profesor',
      }),
    }),
  );

  assert.equal(grade.summary, 'Resumen del profesor');
  assert.equal(grade.items[0]?.feedback, 'Lo del profesor');
  // Lo que el profesor sustituyó no puede llegar al alumno por ninguna vía.
  assert.ok(!JSON.stringify(grade).includes('Lo de la IA'));
});

test('una actividad no puntuable no manda nota ni apartados', () => {
  const grade = toRemoteGrade(
    input({
      activity: activity({ kind: 'forum', graded: false, maxScore: null }),
      correction: correction({ maxScore: null }),
    }),
  );

  assert.equal(grade.score, null);
  assert.equal(grade.maxScore, null);
  assert.deepEqual(grade.items, []);
});

// ── Publicación completa, parcial y fallida ─────────────────────────────────

test('una entrega con fichero publica nota y PDF de corrección', async () => {
  const connector = new LabConnector();
  const outcome = await publishToLms(connector, REF, input());

  assert.equal(outcome.gradePublished, true);
  assert.equal(outcome.filePublished, true);
  assert.equal(outcome.complete, true);
  assert.equal(outcome.notice, null);
  assert.equal(connector.grades.length, 1);
  assert.equal(connector.files.length, 1);
  assert.equal(connector.files[0]?.mediaType, 'application/pdf');
});

// ── Foro: el otro camino de publicación ─────────────────────────────────────

/**
 * Estas cuatro pruebas existen por un fallo concreto y silencioso. Antes de
 * bifurcar, un foro validado se publicaba con `publishGrade`, y el `remoteId`
 * de una duda —`<foro>:<debate>:<mensaje>`— se parseaba sin error como
 * `<tarea>:<usuario>:<intento>`. Es decir: la respuesta se escribía como nota
 * de la tarea cuyo id coincidía con el del foro, a un alumno cualquiera. No
 * lanzaba nada. Es justo lo que HU-20 (RN-4) prohíbe.
 */
const FORUM_REF: SubmissionRef = {
  activity: { slug: 'foro-didactica', lmsRef: 'forum-9', kind: 'forum' },
  studentRef: 'moodle-17',
  remoteId: '9:311:4820',
};

function forumInput(overrides: Partial<PublishInput> = {}): PublishInput {
  return input({
    activity: activity({ kind: 'forum', graded: false, maxScore: null, moodleRef: 'forum-9' }),
    submission: submission({ originalFilename: null, pageCount: 0 }),
    correction: correction({ items: [], maxScore: null }),
    ...overrides,
  });
}

test('un foro publica una respuesta, no una nota', async () => {
  const connector = new LabConnector();
  const outcome = await publishToLms(connector, FORUM_REF, forumInput());

  assert.equal(outcome.complete, true);
  assert.equal(connector.replies.length, 1);
  // Lo que importa de verdad: el libro de notas no se toca.
  assert.equal(connector.grades.length, 0, 'un foro no tiene libro de notas');
  assert.equal(connector.files.length, 0, 'un foro no adjunta PDF de corrección');
});

test('la respuesta publicada es la del profesor cuando la ha editado', () => {
  const reply = toRemoteReply(
    forumInput({
      correction: correction({
        items: [],
        maxScore: null,
        aiLatex: 'Lo que redactó la IA',
        teacherLatex: 'Lo que reescribió el profesor',
      }),
    }),
  );

  assert.equal(reply.body, 'Lo que reescribió el profesor');
  // Lo que el profesor sustituyó no puede llegar al alumno por ninguna vía.
  assert.ok(!JSON.stringify(reply).includes('Lo que redactó la IA'));
});

test('si falla la respuesta el error sube y no queda nada publicado', async () => {
  const connector = new LabConnector({ reply: 'Moodle no responde' });
  await assert.rejects(
    () => publishToLms(connector, FORUM_REF, forumInput()),
    /Moodle no responde/,
  );
  assert.equal(connector.grades.length, 0);
});

test('reintentar un foro ya publicado no vuelve a escribir el mensaje', async () => {
  const connector = new LabConnector();
  const outcome = await publishToLms(
    connector,
    FORUM_REF,
    forumInput({ alreadyPublished: { grade: true, file: false } }),
  );

  assert.equal(outcome.complete, true);
  assert.equal(connector.replies.length, 0, 'el alumno vería dos respuestas a la misma duda');
});

test('si el conector no admite el fichero, la nota se publica igual y se avisa', async () => {
  // Es exactamente el caso de Moodle 3 con `assignfeedback_file`.
  const connector = new LabConnector({ file: 'área assignfeedback_file no soportada' });
  const outcome = await publishToLms(connector, REF, input());

  assert.equal(outcome.gradePublished, true);
  assert.equal(outcome.filePublished, false);
  // Completa a propósito: la nota está puesta y el alumno la ve. Dejarla en
  // error obligaría al profesor a reintentar algo que ya no puede salir mejor.
  assert.equal(outcome.complete, true);
  assert.match(outcome.notice ?? '', /PDF de corrección no/);
  assert.equal(connector.grades.length, 1);
});

test('si falla la nota no se publica nada y el error sube', async () => {
  const connector = new LabConnector({ grade: 'Moodle no responde' });
  await assert.rejects(() => publishToLms(connector, REF, input()), /Moodle no responde/);
  assert.equal(connector.files.length, 0);
});

test('reintentar no vuelve a publicar la nota que ya estaba puesta', async () => {
  const connector = new LabConnector();
  const outcome = await publishToLms(
    connector,
    REF,
    input({ alreadyPublished: { grade: true, file: false } }),
  );

  assert.equal(outcome.gradePublished, true);
  assert.equal(connector.grades.length, 0, 'la nota no debe reenviarse');
  assert.equal(connector.files.length, 1, 'el fichero sí, que es lo que faltaba');
});
