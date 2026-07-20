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
import type { PointsAllocation, TranscriptionFlag, TranscriptionPage } from '@vega/shared';

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

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    studentRef: text('student_ref').notNull(),
    studentAlias: text('student_alias'),
    status: text('status')
      .$type<
        | 'pending'
        | 'transcribing'
        | 'transcribed'
        | 'grading'
        | 'graded'
        | 'validated'
        | 'published'
        | 'error'
      >()
      .notNull()
      .default('pending'),
    /** `null` en actividades sin fichero (foros). */
    originalFilename: text('original_filename'),
    pageCount: integer('page_count').notNull().default(0),
    /** Contenido textual cuando no hay fichero: los mensajes del foro. */
    textContent: text('text_content'),
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
  publishedAt: timestamp('published_at', { withTimezone: true }),
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
    level: text('level').$type<'global' | 'activity_kind' | 'activity'>().notNull(),
    key: text('key').notNull(),
    content: text('content').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [uniqueIndex('grading_contexts_level_key').on(table.level, table.key)],
);

export const batchRuns = pgTable('batch_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').$type<'running' | 'done' | 'failed'>().notNull().default('running'),
  /** `null` si lo lanzó el planificador y no una persona. */
  triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
  submissionsProcessed: integer('submissions_processed').notNull().default(0),
  submissionsFailed: integer('submissions_failed').notNull().default(0),
  submissionsAutoPublished: integer('submissions_auto_published').notNull().default(0),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
  costCents: numeric('cost_cents', { precision: 10, scale: 4 }).notNull().default('0'),
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
