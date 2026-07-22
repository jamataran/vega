import { createHash } from 'node:crypto';
import type {
  AiOperation,
  AiTransport,
  ContextSegment,
  UsageMetrics,
} from '@vega/shared';
import type {
  AiProvider,
  GradeInput,
  PageSource,
  TriageInput,
  TranscribeInput,
  VerifyInput,
} from '@vega/core';
import { UnpricedModelError } from '@vega/core';
import { schema } from '../db/client.js';
import { lt } from 'drizzle-orm';
import type { AppContext } from '../context.js';

interface LedgerOptions {
  readonly batchRunId?: string | null;
  readonly aiBatchId?: string | null;
  readonly transport: AiTransport;
  readonly models: Readonly<Record<AiOperation, string>>;
  readonly prompts: Readonly<Record<string, number>>;
}

/** Purga diaria gobernada por el ajuste de retención; no toca correcciones. */
export async function purgeAiCalls(ctx: AppContext, retentionDays: number, now = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - retentionDays * 86_400_000);
  const removed = await ctx.db
    .delete(schema.aiCalls)
    .where(lt(schema.aiCalls.createdAt, threshold))
    .returning({ id: schema.aiCalls.id });
  return removed.length;
}

/** Decorador transparente: registra cada intento, también los que lanzan. */
export function withAiLedger(
  ctx: AppContext,
  provider: AiProvider,
  options: LedgerOptions,
): AiProvider {
  const execute = async <T>(args: {
    operation: AiOperation;
    submissionId: string | null;
    promptKey: string | null;
    segments?: readonly ContextSegment[];
    request: unknown;
    call: () => Promise<T>;
    usage: (result: T) => UsageMetrics | null;
    model: (result: T) => string | null;
  }): Promise<T> => {
    const started = Date.now();
    try {
      const result = await args.call();
      const usage = args.usage(result);
      await ctx.db.insert(schema.aiCalls).values({
        batchRunId: options.batchRunId ?? null,
        aiBatchId: options.aiBatchId ?? null,
        submissionId: args.submissionId,
        operation: args.operation,
        transport: options.transport,
        provider: provider.name,
        modelRequested: options.models[args.operation],
        modelReturned: args.model(result),
        promptKey: args.promptKey,
        promptVersion: args.promptKey ? options.prompts[args.promptKey] ?? null : null,
        contextHash: hashContext(args.segments ?? []),
        contextVersions: (args.segments ?? []).map(({ level, key, contextId, version, contentHash }) => ({
          level, key, contextId, version, contentHash,
        })),
        requestParams: sanitize(args.request),
        responseRaw: result,
        parsedOk: true,
        stopReason: 'end_turn',
        latencyMs: Date.now() - started,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheReadTokens: usage?.cachedInputTokens ?? 0,
        cacheCreationTokens: usage?.cacheCreationTokens ?? 0,
        costCents: usage === null ? null : String(usage.costCents),
        simulated: provider.name === 'mock',
      });
      return result;
    } catch (error) {
      await ctx.db.insert(schema.aiCalls).values({
        batchRunId: options.batchRunId ?? null,
        aiBatchId: options.aiBatchId ?? null,
        submissionId: args.submissionId,
        operation: args.operation,
        transport: options.transport,
        provider: provider.name,
        modelRequested: options.models[args.operation],
        modelReturned: error instanceof UnpricedModelError ? error.model : null,
        promptKey: args.promptKey,
        promptVersion: args.promptKey ? options.prompts[args.promptKey] ?? null : null,
        contextHash: hashContext(args.segments ?? []),
        contextVersions: (args.segments ?? []).map(({ level, key, contextId, version, contentHash }) => ({
          level, key, contextId, version, contentHash,
        })),
        requestParams: sanitize(args.request),
        parsedOk: false,
        unpriced: error instanceof UnpricedModelError,
        error: error instanceof Error ? error.message.slice(0, 2_000) : String(error),
        latencyMs: Date.now() - started,
        simulated: provider.name === 'mock',
      });
      throw error;
    }
  };

  return {
    name: provider.name,
    transcribe: (input: TranscribeInput) => execute({
      operation: input.reading === 'b' ? 'reading_b' : 'reading_a',
      submissionId: input.submissionId,
      promptKey: 'transcription.system',
      request: input,
      call: () => provider.transcribe(input),
      usage: (result) => result.usage,
      model: (result) => result.model,
    }),
    grade: (input: GradeInput) => execute({
      operation: input.activityKind === 'forum' ? 'forum_answer' : 'grade',
      submissionId: input.submissionId,
      promptKey: input.activityKind === 'forum' ? 'forum.answer.expert.system' : 'grading.problem.system',
      segments: input.context,
      request: input,
      call: () => provider.grade(input),
      usage: (result) => result.usage,
      model: (result) => result.model,
    }),
    triage: (input: TriageInput) => execute({
      operation: 'triage', submissionId: input.submissionId, promptKey: 'triage.system', request: input,
      call: () => provider.triage(input), usage: (result) => result.usage, model: (result) => result.model,
    }),
    verify: (input: VerifyInput) => execute({
      operation: 'verify', submissionId: input.submissionId, promptKey: 'verify.system', request: input,
      call: () => provider.verify(input), usage: (result) => result.usage, model: (result) => result.model,
    }),
    verifyConnection: () => execute({
      operation: 'connection_test', submissionId: null, promptKey: null, request: {},
      call: () => provider.verifyConnection(), usage: (result) => result.usage, model: (result) => result.model,
    }),
  };
}

function hashContext(segments: readonly ContextSegment[]): string | null {
  if (segments.length === 0) return null;
  return createHash('sha256').update(segments.map((segment) => segment.content).join('\n\n')).digest('hex');
}

function sanitize(value: unknown): Record<string, unknown> {
  const clean = JSON.parse(JSON.stringify(value, (_key, current) => {
    if (current && typeof current === 'object' && 'bytes' in current) {
      const page = current as PageSource;
      return {
        page: page.page,
        pageNumbers: page.pageNumbers,
        mediaType: page.mediaType,
        path: page.path,
        byteLength: page.bytes?.byteLength ?? null,
        sha256: page.bytes
          ? createHash('sha256').update(page.bytes).digest('hex')
          : null,
      };
    }
    return current;
  })) as unknown;
  return clean && typeof clean === 'object' && !Array.isArray(clean)
    ? clean as Record<string, unknown>
    : { value: clean };
}
