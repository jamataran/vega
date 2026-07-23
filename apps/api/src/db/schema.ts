import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  AiOperation,
  AiTransport,
  BatchRunProblem,
  ContextLevel,
  CorrectionVerification,
  PointsAllocation,
  StudentCustomField,
  TranscriptionDiscrepancy,
  TranscriptionFlag,
  TranscriptionPage,
  TriageLabel,
} from '@vega/shared';

/**
 * Definiciones Drizzle para consultar. El esquema *real* lo crean las
 * migraciones SQL de `migrations/`; esto debe mantenerse en sintonía con ellas.
 * Drizzle aquí es sólo el constructor de consultas tipado, no la fuente de verdad.
 */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<'teacher' | 'admin'>().notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  /**
   * Token de Moodle de este usuario. Nunca sale por la API: sólo se informa de
   * si está puesto. Es de cada uno porque decide qué cursos ve la aplicación.
   */
  moodleToken: text('moodle_token'),
  moodleTokenUpdatedAt: timestamp('moodle_token_updated_at', { withTimezone: true }),
});

/** Curso de Moodle del que cuelgan las actividades. */
export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  moodleCourseId: text('moodle_course_id').notNull().unique(),
  name: text('name').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Qué cursos alcanza cada profesor, según lo que devolvió su token la última
 * vez que listó sus cursos. Es lo que decide qué ve dentro de Vega.
 */
export const courseTeachers = pgTable(
  'course_teachers',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.courseId, table.userId] })],
);

export const activities = pgTable('activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  kind: text('kind').$type<'assignment' | 'forum'>().notNull(),
  courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),
  /** Copia del nombre del curso. La fuente de verdad es `courses`. */
  courseName: text('course_name').notNull().default(''),
  /** Con prefijo de tipo (`assign-42`, `forum-42`) y único desde la 0003. */
  moodleRef: text('moodle_ref'),
  /** Quién la importó: su token es el que se usa para ingerir sus entregas. */
  importedBy: uuid('imported_by').references(() => users.id, { onDelete: 'set null' }),
  enabled: boolean('enabled').notNull().default(true),
  graded: boolean('graded').notNull().default(true),
  /** `null` cuando la actividad no se puntúa. */
  maxScore: numeric('max_score', { precision: 6, scale: 2 }),
  referenceSolution: text('reference_solution'),
  templateKey: text('template_key'),
  pointsAllocation: jsonb('points_allocation').$type<PointsAllocation[]>().notNull().default([]),
  autonomy: text('autonomy')
    .$type<'review_all' | 'review_low_confidence' | 'autonomous'>()
    .notNull()
    .default('review_all'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const activityFiles = pgTable('activity_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  activityId: uuid('activity_id')
    .notNull()
    .references(() => activities.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull().default('application/octet-stream'),
  sizeBytes: integer('size_bytes').notNull().default(0),
  storagePath: text('storage_path'),
  /**
   * Contenido del fichero cuando es texto (`.tex`, `.md`). Es lo que viaja al
   * modelo con el contexto; `null` en binarios, que se guardan sólo como
   * referencia para el profesor.
   */
  content: text('content'),
  /** `false` mientras llegan los trozos: ni se lista ni entra en el contexto. */
  uploadComplete: boolean('upload_complete').notNull().default(true),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Ficha del alumno tal y como la ve el LMS.
 *
 * Tabla propia porque un alumno entrega muchas veces: repetir su perfil en cada
 * entrega haría que actualizar un dato exigiera recorrerlas todas y que dos
 * entregas suyas pudieran discrepar.
 */
export const students = pgTable('students', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Identidad del LMS, en el mismo formato que `submissions.student_ref`. */
  studentRef: text('student_ref').notNull().unique(),
  username: text('username'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  fullName: text('full_name'),
  email: text('email'),
  phone: text('phone'),
  idnumber: text('idnumber'),
  institution: text('institution'),
  department: text('department'),
  city: text('city'),
  country: text('country'),
  /**
   * Comunidad autónoma, resuelta del campo personalizado `CCAA`. Puede traer
   * varias separadas por coma: un opositor se presenta en más de una.
   */
  community: text('community'),
  /** Campos personalizados tal cual llegan del LMS; aquí no se interpretan. */
  customFields: jsonb('custom_fields').$type<StudentCustomField[]>().notNull().default([]),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    studentRef: text('student_ref').notNull(),
    /** Nombre legible. Lo rellena la ingesta con el del perfil del alumno. */
    studentAlias: text('student_alias'),
    /** Ficha completa del alumno. `null` en entregas sembradas o sin perfil. */
    studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
    status: text('status')
      .$type<
        | 'pending'
        | 'transcribing'
        | 'transcribed'
        | 'grading'
        | 'graded'
        | 'parked'
        | 'validated'
        | 'published'
        | 'error'
      >()
      .notNull()
      .default('pending'),
    batchRunId: uuid('batch_run_id').references(() => batchRuns.id, { onDelete: 'set null' }),
    parkedReason: text('parked_reason'),
    parkedBy: uuid('parked_by').references(() => users.id, { onDelete: 'set null' }),
    triageLabel: text('triage_label').$type<TriageLabel>(),
    triageConfidence: numeric('triage_confidence', { precision: 4, scale: 3 }),
    /** `null` en actividades sin fichero (foros). */
    originalFilename: text('original_filename'),
    pageCount: integer('page_count').notNull().default(0),
    /** Contenido textual cuando no hay fichero: los mensajes del foro. */
    textContent: text('text_content'),
    /**
     * Identidad de la entrega en el sistema de origen (`SubmissionRef.remoteId`).
     * Es lo que hace idempotente la ingesta también en foros, donde la clave
     * natural no protege porque `original_filename` es `null`.
     */
    remoteId: text('remote_id'),
    /** Ruta del fichero descargado, relativa a `STORAGE_ROOT`. `null` en foros. */
    storagePath: text('storage_path'),
    mediaType: text('media_type'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    errorMessage: text('error_message'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('submissions_natural_key').on(
      table.activityId,
      table.studentRef,
      table.originalFilename,
    ),
    // Índice parcial: sólo las entregas que vienen de un conector tienen
    // `remote_id`, y dos sembradas sin él no deben colisionar entre sí.
    uniqueIndex('submissions_remote_key')
      .on(table.activityId, table.remoteId)
      .where(sql`remote_id IS NOT NULL`),
  ],
);

export const transcriptions = pgTable('transcriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id')
    .notNull()
    .unique()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  pages: jsonb('pages').$type<TranscriptionPage[]>().notNull().default([]),
  flags: jsonb('flags').$type<TranscriptionFlag[]>().notNull().default([]),
  discrepancies: jsonb('discrepancies').$type<TranscriptionDiscrepancy[]>().notNull().default([]),
  passCount: integer('pass_count').notNull().default(1),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0'),
  model: text('model').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const corrections = pgTable('corrections', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id')
    .notNull()
    .unique()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  maxScore: numeric('max_score', { precision: 6, scale: 2 }),
  /** La corrección redactada en LaTeX: la salida principal del motor. */
  aiLatex: text('ai_latex').notNull().default(''),
  teacherLatex: text('teacher_latex'),
  aiSummary: text('ai_summary').notNull().default(''),
  teacherSummary: text('teacher_summary'),
  verification: jsonb('verification').$type<CorrectionVerification>(),
  teacherNotes: text('teacher_notes'),
  simulated: boolean('simulated').notNull().default(false),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0'),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
  costCents: numeric('cost_cents', { precision: 10, scale: 4 }).notNull().default('0'),
  annotatedFileUrl: text('annotated_file_url'),
  publishedAutomatically: boolean('published_automatically').notNull().default(false),
  validatedBy: uuid('validated_by').references(() => users.id, { onDelete: 'set null' }),
  validatedAt: timestamp('validated_at', { withTimezone: true }),
  /**
   * `published_at` significa **publicación completa**. Las dos marcas de abajo
   * dicen qué se llegó a publicar cuando se queda a medias, que es lo que
   * permite reintentar sin volver a mandar la nota al alumno.
   */
  publishedAt: timestamp('published_at', { withTimezone: true }),
  gradePublishedAt: timestamp('grade_published_at', { withTimezone: true }),
  feedbackFilePublishedAt: timestamp('feedback_file_published_at', { withTimezone: true }),
  /** Por qué la publicación no fue completa, en español y para el profesor. */
  publishNotice: text('publish_notice'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const correctionItems = pgTable('correction_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  correctionId: uuid('correction_id')
    .notNull()
    .references(() => corrections.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  statement: text('statement').notNull().default(''),
  maxPoints: numeric('max_points', { precision: 6, scale: 2 }).notNull(),
  aiPoints: numeric('ai_points', { precision: 6, scale: 2 }).notNull().default('0'),
  aiFeedback: text('ai_feedback').notNull().default(''),
  aiQuote: text('ai_quote'),
  aiQuotePage: integer('ai_quote_page'),
  teacherPoints: numeric('teacher_points', { precision: 6, scale: 2 }),
  teacherFeedback: text('teacher_feedback'),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0'),
  alternativeMethod: boolean('alternative_method').notNull().default(false),
  position: integer('position').notNull().default(0),
});

export const gradingContexts = pgTable(
  'grading_contexts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    level: text('level').$type<ContextLevel>().notNull(),
    key: text('key').notNull(),
    activeVersion: integer('active_version').notNull().default(1),
  },
  (table) => [uniqueIndex('grading_contexts_level_key').on(table.level, table.key)],
);

export const batchRuns = pgTable('batch_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status')
    .$type<'running' | 'done' | 'failed' | 'cancelled'>()
    .notNull()
    .default('running'),
  /** `null` si lo lanzó el planificador y no una persona. */
  triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
  /** Tipos de actividad que barrió: el planificador corre por tipo. */
  kinds: text('kinds')
    .array()
    .$type<Array<'assignment' | 'forum'>>()
    .notNull()
    .default(['assignment', 'forum']),
  submissionsProcessed: integer('submissions_processed').notNull().default(0),
  submissionsFailed: integer('submissions_failed').notNull().default(0),
  submissionsAutoPublished: integer('submissions_auto_published').notNull().default(0),
  /** Entregas nuevas traídas del LMS en este lote. */
  submissionsIngested: integer('submissions_ingested').notNull().default(0),
  /** Actividades cuya ingesta falló entera (LMS caído, token, configuración). */
  activitiesFailed: integer('activities_failed').notNull().default(0),
  /** El motivo de cada una, para poder leerlo sin entrar en el log del servidor. */
  problems: jsonb('problems').$type<BatchRunProblem[]>().notNull().default([]),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
  costCents: numeric('cost_cents', { precision: 10, scale: 4 }).notNull().default('0'),
  /** Por qué se cerró el proceso, cuando hay algo que contar. */
  closedReason: text('closed_reason'),
});

export const gradingContextVersions = pgTable(
  'grading_context_versions',
  {
    contextId: uuid('context_id')
      .notNull()
      .references(() => gradingContexts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: text('content').notNull().default(''),
    contentHash: text('content_hash').notNull(),
    source: text('source').$type<'seed' | 'migration' | 'edit' | 'restore'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [primaryKey({ columns: [table.contextId, table.version] })],
);

export const prompts = pgTable(
  'prompts',
  {
    key: text('key').notNull(),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    active: boolean('active').notNull().default(false),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.version] }),
    uniqueIndex('prompts_one_active_per_key').on(table.key).where(sql`active`),
  ],
);

export const aiBatches = pgTable('ai_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  batchRunId: uuid('batch_run_id')
    .notNull()
    .references(() => batchRuns.id, { onDelete: 'cascade' }),
  providerBatchId: text('provider_batch_id'),
  phase: text('phase').$type<'reading' | 'grading' | 'verify'>().notNull(),
  status: text('status')
    .$type<'pending' | 'in_progress' | 'ended' | 'failed' | 'canceled'>()
    .notNull()
    .default('pending'),
  requestCount: integer('request_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

export const aiCalls = pgTable('ai_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  batchRunId: uuid('batch_run_id').references(() => batchRuns.id, { onDelete: 'set null' }),
  aiBatchId: uuid('ai_batch_id').references(() => aiBatches.id, { onDelete: 'set null' }),
  submissionId: uuid('submission_id').references(() => submissions.id, { onDelete: 'set null' }),
  operation: text('operation').$type<AiOperation>().notNull(),
  transport: text('transport').$type<AiTransport>().notNull(),
  provider: text('provider').notNull(),
  modelRequested: text('model_requested').notNull(),
  modelReturned: text('model_returned'),
  promptKey: text('prompt_key'),
  promptVersion: integer('prompt_version'),
  contextHash: text('context_hash'),
  contextVersions: jsonb('context_versions')
    .$type<
      {
        level: ContextLevel;
        key: string;
        contextId: string;
        version: number;
        contentHash: string;
      }[]
    >()
    .notNull()
    .default([]),
  requestParams: jsonb('request_params').$type<Record<string, unknown>>().notNull().default({}),
  responseRaw: jsonb('response_raw').$type<unknown>(),
  parsedOk: boolean('parsed_ok').notNull().default(false),
  stopReason: text('stop_reason'),
  error: text('error'),
  latencyMs: integer('latency_ms'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  costCents: numeric('cost_cents', { precision: 12, scale: 6 }),
  unpriced: boolean('unpriced').notNull().default(false),
  simulated: boolean('simulated').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Ajustes editables desde la aplicación, en clave/valor. `isSecret` marca lo
 * que la API nunca devuelve: claves de API, tokens y contraseñas se escriben
 * pero no se leen.
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default(''),
  isSecret: boolean('is_secret').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});
