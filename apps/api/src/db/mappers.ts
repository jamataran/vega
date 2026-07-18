import type {
  Activity,
  ActivityFile,
  BatchRun,
  Correction,
  CorrectionItem,
  GradingContext,
  Submission,
  Transcription,
  UsageMetrics,
  User,
} from '@vega/shared';
import type { schema } from './client.js';

/**
 * Conversión fila de BD → DTO de la API.
 *
 * Las columnas `numeric` de Postgres llegan como *string* por el driver (para
 * no perder precisión), así que aquí es donde se convierten a número una sola
 * vez. Si esto se hiciera en cada ruta, tarde o temprano se colaría un
 * `"7.50" + 1 === "7.501"`.
 */

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];

const num = (value: string | number): number => (typeof value === 'number' ? value : Number(value));
const numOrNull = (value: string | number | null): number | null =>
  value === null ? null : num(value);
const iso = (value: Date): string => value.toISOString();
const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toUser(row: Row<typeof schema.users>): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active,
    createdAt: iso(row.createdAt),
    lastLoginAt: isoOrNull(row.lastLoginAt),
  };
}

export function toActivityFile(row: Row<typeof schema.activityFiles>): ActivityFile {
  return {
    id: row.id,
    activityId: row.activityId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    url: `/api/activities/${row.activityId}/files/${row.id}`,
    uploadedAt: iso(row.uploadedAt),
  };
}

export function toActivity(
  row: Row<typeof schema.activities>,
  files: Row<typeof schema.activityFiles>[] = [],
): Activity {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    courseName: row.courseName,
    moodleRef: row.moodleRef,
    enabled: row.enabled,
    graded: row.graded,
    maxScore: numOrNull(row.maxScore),
    pointsAllocation: row.pointsAllocation ?? [],
    referenceSolution: row.referenceSolution,
    autonomy: row.autonomy,
    files: files.map(toActivityFile),
    createdAt: iso(row.createdAt),
  };
}

export function toSubmission(row: Row<typeof schema.submissions>): Submission {
  return {
    id: row.id,
    activityId: row.activityId,
    studentRef: row.studentRef,
    studentAlias: row.studentAlias,
    status: row.status,
    originalFilename: row.originalFilename,
    pageCount: row.pageCount,
    textContent: row.textContent,
    submittedAt: iso(row.submittedAt),
    updatedAt: iso(row.updatedAt),
    errorMessage: row.errorMessage,
  };
}

export function toTranscription(row: Row<typeof schema.transcriptions>): Transcription {
  return {
    id: row.id,
    submissionId: row.submissionId,
    pages: row.pages ?? [],
    flags: row.flags ?? [],
    confidence: num(row.confidence),
    model: row.model,
    createdAt: iso(row.createdAt),
  };
}

export function toCorrectionItem(row: Row<typeof schema.correctionItems>): CorrectionItem {
  return {
    id: row.id,
    correctionId: row.correctionId,
    label: row.label,
    statement: row.statement,
    maxPoints: num(row.maxPoints),
    aiPoints: num(row.aiPoints),
    aiFeedback: row.aiFeedback,
    teacherPoints: numOrNull(row.teacherPoints),
    teacherFeedback: row.teacherFeedback,
    confidence: num(row.confidence),
    alternativeMethod: row.alternativeMethod,
    position: row.position,
  };
}

function toUsage(row: {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costCents: string | number;
}): UsageMetrics {
  return {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedInputTokens: row.cachedInputTokens,
    costCents: num(row.costCents),
  };
}

export function toCorrection(
  row: Row<typeof schema.corrections>,
  items: Row<typeof schema.correctionItems>[],
): Correction {
  return {
    id: row.id,
    submissionId: row.submissionId,
    items: items.map(toCorrectionItem),
    maxScore: numOrNull(row.maxScore),
    aiLatex: row.aiLatex,
    teacherLatex: row.teacherLatex,
    aiSummary: row.aiSummary,
    teacherSummary: row.teacherSummary,
    confidence: num(row.confidence),
    model: row.model,
    usage: toUsage(row),
    annotatedFileUrl: row.annotatedFileUrl,
    createdAt: iso(row.createdAt),
    validatedBy: row.validatedBy,
    validatedAt: isoOrNull(row.validatedAt),
    publishedAt: isoOrNull(row.publishedAt),
    publishedAutomatically: row.publishedAutomatically,
  };
}

export function toGradingContext(row: Row<typeof schema.gradingContexts>): GradingContext {
  return {
    id: row.id,
    level: row.level,
    key: row.key,
    content: row.content,
    updatedAt: iso(row.updatedAt),
    updatedBy: row.updatedBy,
  };
}

export function toBatchRun(row: Row<typeof schema.batchRuns>): BatchRun {
  return {
    id: row.id,
    startedAt: iso(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    status: row.status,
    triggeredBy: row.triggeredBy,
    submissionsProcessed: row.submissionsProcessed,
    submissionsFailed: row.submissionsFailed,
    submissionsAutoPublished: row.submissionsAutoPublished,
    usage: toUsage(row),
  };
}
