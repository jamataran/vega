import { createHash } from 'node:crypto';
import type {
  AiOperation,
  AiTransport,
  ContextSegment,
  UsageMetrics,
} from '@vega/shared';
import type {
  AiCallOptions,
  AiProvider,
  GradeInput,
  PageSource,
  TriageInput,
  TranscribeInput,
  VerifyInput,
} from '@vega/core';
import { UnpricedModelError, gradePromptKey } from '@vega/core';
import { schema } from '../db/client.js';
import { eq, lt } from 'drizzle-orm';
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
    const [pending] = await ctx.db
      .insert(schema.aiCalls)
      .values({
        batchRunId: options.batchRunId ?? null,
        aiBatchId: options.aiBatchId ?? null,
        submissionId: args.submissionId,
        operation: args.operation,
        transport: options.transport,
        provider: provider.name,
        modelRequested: options.models[args.operation],
        promptKey: args.promptKey,
        promptVersion: args.promptKey ? options.prompts[args.promptKey] ?? null : null,
        contextHash: hashContext(args.segments ?? []),
        contextVersions: (args.segments ?? []).map(
          ({ level, key, contextId, version, contentHash }) => ({
            level,
            key,
            contextId,
            version,
            contentHash,
          }),
        ),
        requestParams: sanitize(args.request),
        simulated: provider.name === 'mock',
      })
      .returning({ id: schema.aiCalls.id });

    // Registrar antes de llamar al proveedor hace visible una espera larga y,
    // además, evita consumir una llamada de pago si el ledger no está disponible.
    if (!pending) throw new Error('No se ha podido registrar el inicio de la llamada de IA.');

    let result: T;
    try {
      result = await args.call();
    } catch (error) {
      await ctx.db
        .update(schema.aiCalls)
        .set({
          modelReturned: error instanceof UnpricedModelError ? error.model : null,
          parsedOk: false,
          unpriced: error instanceof UnpricedModelError,
          error: error instanceof Error ? error.message.slice(0, 2_000) : String(error),
          latencyMs: Date.now() - started,
        })
        .where(eq(schema.aiCalls.id, pending.id));
      throw error;
    }

    const usage = args.usage(result);
    await ctx.db
      .update(schema.aiCalls)
      .set({
        modelReturned: args.model(result),
        responseRaw: result,
        parsedOk: true,
        stopReason: 'end_turn',
        latencyMs: Date.now() - started,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheReadTokens: usage?.cachedInputTokens ?? 0,
        cacheCreationTokens: usage?.cacheCreationTokens ?? 0,
        costCents: usage === null ? null : String(usage.costCents),
      })
      .where(eq(schema.aiCalls.id, pending.id));
    return result;
  };

  return {
    name: provider.name,
    transcribe: (input: TranscribeInput, callOptions?: AiCallOptions) => execute({
      operation: input.reading === 'b' ? 'reading_b' : 'reading_a',
      submissionId: input.submissionId,
      promptKey: 'transcription.system',
      request: input,
      call: () => provider.transcribe(input, callOptions),
      usage: (result) => result.usage,
      model: (result) => result.model,
    }),
    grade: (input: GradeInput, callOptions?: AiCallOptions) => execute({
      operation: input.activityKind === 'forum' ? 'forum_answer' : 'grade',
      submissionId: input.submissionId,
      // La misma regla que aplica el proveedor: si divergieran, el registro
      // atribuiría la llamada a un prompt que no se usó.
      promptKey: gradePromptKey(input),
      segments: input.context,
      request: input,
      call: () => provider.grade(input, callOptions),
      usage: (result) => result.usage,
      model: (result) => result.model,
    }),
    triage: (input: TriageInput, callOptions?: AiCallOptions) => execute({
      operation: 'triage', submissionId: input.submissionId, promptKey: 'triage.system', request: input,
      call: () => provider.triage(input, callOptions), usage: (result) => result.usage, model: (result) => result.model,
    }),
    verify: (input: VerifyInput, callOptions?: AiCallOptions) => execute({
      operation: 'verify', submissionId: input.submissionId, promptKey: 'verify.system', request: input,
      call: () => provider.verify(input, callOptions), usage: (result) => result.usage, model: (result) => result.model,
    }),
    verifyConnection: (callOptions?: AiCallOptions) => execute({
      operation: 'connection_test', submissionId: null, promptKey: null, request: {},
      call: () => provider.verifyConnection(callOptions), usage: (result) => result.usage, model: (result) => result.model,
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
