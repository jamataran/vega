/** Tarifas fechadas: el histórico nunca se recalcula con el precio de hoy. */
export interface ModelPricing {
  readonly validFrom: string;
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
  readonly cachedInputPerMillionUsd: number;
  readonly cacheCreationPerMillionUsd: number;
}

export const MODEL_PRICING: Readonly<Record<string, readonly ModelPricing[]>> = {
  'claude-opus-4-8': [rate('2026-01-01', 5, 25)],
  'claude-opus-4-7': [rate('2026-01-01', 5, 25)],
  'claude-sonnet-5': [rate('2026-01-01', 2, 10), rate('2026-09-01', 3, 15)],
  'claude-sonnet-4-6': [rate('2026-01-01', 3, 15)],
  'claude-haiku-4-5': [rate('2026-01-01', 1, 5)],
  'claude-fable-5': [rate('2026-01-01', 10, 50)],
};

export const USD_TO_EUR_HISTORY = [
  { validFrom: '2026-01-01', value: 0.92 },
] as const;
export const USD_TO_EUR = USD_TO_EUR_HISTORY.at(-1)!.value;
export const MOCK_MODEL_PREFIX = 'mock-';

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens?: number;
  readonly transport?: 'sync' | 'batch';
}

function rate(validFrom: string, input: number, output: number): ModelPricing {
  return {
    validFrom,
    inputPerMillionUsd: input,
    outputPerMillionUsd: output,
    cachedInputPerMillionUsd: input * 0.1,
    cacheCreationPerMillionUsd: input * 1.25,
  };
}

export function pricingFor(model: string, at: Date = new Date()): ModelPricing | undefined {
  const key = model.startsWith(MOCK_MODEL_PREFIX) ? model.slice(MOCK_MODEL_PREFIX.length) : model;
  const instant = at.toISOString().slice(0, 10);
  return MODEL_PRICING[key]
    ?.filter((entry) => entry.validFrom <= instant)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
}

export function exchangeRateFor(at: Date = new Date()): number {
  const instant = at.toISOString().slice(0, 10);
  return [...USD_TO_EUR_HISTORY]
    .filter((entry) => entry.validFrom <= instant)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]?.value ?? USD_TO_EUR;
}

export class UnpricedModelError extends Error {
  constructor(readonly model: string) {
    super(`El modelo «${model}» no tiene una tarifa fechada configurada.`);
    this.name = 'UnpricedModelError';
  }
}

export function estimateCostCents(model: string, usage: TokenUsage, at: Date = new Date()): number {
  const pricing = pricingFor(model, at);
  if (!pricing) throw new UnpricedModelError(model);
  const usd = (
    usage.inputTokens * pricing.inputPerMillionUsd
    + usage.outputTokens * pricing.outputPerMillionUsd
    + usage.cachedInputTokens * pricing.cachedInputPerMillionUsd
    + (usage.cacheCreationTokens ?? 0) * pricing.cacheCreationPerMillionUsd
  ) / 1_000_000;
  const transportDiscount = usage.transport === 'batch' ? 0.5 : 1;
  return Math.round(usd * exchangeRateFor(at) * 100 * transportDiscount * 10_000) / 10_000;
}

export function formatCents(cents: number): string {
  return `${(cents / 100).toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })} €`;
}
