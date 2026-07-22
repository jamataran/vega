import type {
  Activity,
  ActivityFile,
  AiCall,
  BatchRun,
  Correction,
  CorrectionItem,
  Course,
  GradingContext,
  Prompt,
  Student,
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

/**
 * Igual, pero para valores que vienen de una consulta en crudo.
 *
 * Esas no pasan por el mapeo de tipos de Drizzle, así que una `timestamptz`
 * puede llegar como `Date` o como cadena según el parseador que tenga puesto el
 * driver. El tipo declarado dice `Date` y la cadena se cuela sin que el
 * typecheck se entere: por eso esto existe, y por eso está en un solo sitio.
 */
export const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
    // El token nunca sale; sólo si lo hay. Ver `users.moodle_token`.
    moodleTokenConfigured: (row.moodleToken ?? '') !== '',
  };
}

export function toCourse(row: Row<typeof schema.courses>): Course {
  return {
    id: row.id,
    moodleCourseId: row.moodleCourseId,
    name: row.name,
    createdAt: iso(row.createdAt),
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
    hasContent: row.content !== null,
    uploadComplete: row.uploadComplete,
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
    courseId: row.courseId,
    courseName: row.courseName,
    moodleRef: row.moodleRef,
    enabled: row.enabled,
    graded: row.graded,
    maxScore: numOrNull(row.maxScore),
    pointsAllocation: row.pointsAllocation ?? [],
    referenceSolution: row.referenceSolution,
    templateKey: row.templateKey,
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
    batchRunId: row.batchRunId,
    parkedReason: row.parkedReason,
    parkedBy: row.parkedBy,
    triageLabel: row.triageLabel,
    triageConfidence: numOrNull(row.triageConfidence),
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
    discrepancies: row.discrepancies ?? [],
    passCount: row.passCount,
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
    aiQuote: row.aiQuote,
    aiQuotePage: row.aiQuotePage,
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
  cacheCreationTokens?: number;
  costCents: string | number;
}): UsageMetrics {
  return {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedInputTokens: row.cachedInputTokens,
    cacheCreationTokens: row.cacheCreationTokens ?? 0,
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
    teacherNotes: row.teacherNotes,
    verification: row.verification,
    simulated: row.simulated,
    confidence: num(row.confidence),
    model: row.model,
    usage: toUsage(row),
    annotatedFileUrl: row.annotatedFileUrl,
    createdAt: iso(row.createdAt),
    validatedBy: row.validatedBy,
    validatedAt: isoOrNull(row.validatedAt),
    publishedAt: isoOrNull(row.publishedAt),
    publishedAutomatically: row.publishedAutomatically,
    publishNotice: row.publishNotice,
  };
}

/**
 * Ficha del alumno hacia el contrato.
 *
 * Sale entera hacia el profesor a propósito: es quien tiene que saber de quién
 * es lo que está firmando. Lo que **no** sale entera es hacia el modelo, y de
 * eso se encarga `studentContextFor()` en `@vega/shared`, no este mapeador.
 */
export function toStudent(row: Row<typeof schema.students>): Student {
  return {
    id: row.id,
    studentRef: row.studentRef,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    idnumber: row.idnumber,
    institution: row.institution,
    department: row.department,
    city: row.city,
    country: row.country,
    community: row.community,
    customFields: row.customFields,
    syncedAt: iso(row.syncedAt),
  };
}

export function toGradingContext(row: {
  context: Row<typeof schema.gradingContexts>;
  version: Row<typeof schema.gradingContextVersions>;
}): GradingContext {
  return {
    id: row.context.id,
    level: row.context.level,
    key: row.context.key,
    activeVersion: row.context.activeVersion,
    content: row.version.content,
    contentHash: row.version.contentHash,
    source: row.version.source,
    updatedAt: iso(row.version.createdAt),
    updatedBy: row.version.createdBy,
  };
}

export function toPrompt(row: Row<typeof schema.prompts>): Prompt {
  return {
    key: row.key,
    version: row.version,
    content: row.content,
    active: row.active,
    updatedBy: row.updatedBy,
    updatedAt: iso(row.updatedAt),
  };
}

export function toAiCall(row: Row<typeof schema.aiCalls>): AiCall {
  return {
    id: row.id,
    batchRunId: row.batchRunId,
    aiBatchId: row.aiBatchId,
    submissionId: row.submissionId,
    operation: row.operation,
    transport: row.transport,
    provider: row.provider,
    modelRequested: row.modelRequested,
    modelReturned: row.modelReturned,
    promptKey: row.promptKey,
    promptVersion: row.promptVersion,
    contextHash: row.contextHash,
    contextVersions: row.contextVersions,
    requestParams: row.requestParams,
    responseRaw: row.responseRaw,
    parsedOk: row.parsedOk,
    stopReason: row.stopReason,
    error: row.error,
    latencyMs: row.latencyMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    costCents: row.costCents === null ? null : num(row.costCents),
    unpriced: row.unpriced,
    simulated: row.simulated,
    createdAt: iso(row.createdAt),
  };
}

export function toBatchRun(row: Row<typeof schema.batchRuns>): BatchRun {
  return {
    id: row.id,
    startedAt: iso(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    status: row.status,
    triggeredBy: row.triggeredBy,
    kinds: row.kinds,
    submissionsProcessed: row.submissionsProcessed,
    submissionsFailed: row.submissionsFailed,
    submissionsAutoPublished: row.submissionsAutoPublished,
    submissionsIngested: row.submissionsIngested,
    activitiesFailed: row.activitiesFailed,
    usage: toUsage(row),
  };
}
