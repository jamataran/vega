/** Tarifas fechadas: el histórico nunca se recalcula con el precio de hoy. */
export interface ModelPricing {
  readonly validFrom: string;
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
  readonly cachedInputPerMillionUsd: number;
  readonly cacheCreationPerMillionUsd: number;
}

/**
 * Tarifas por alias, que es lo único que se configura en Ajustes.
 *
 * `Object.create(null)` y no un objeto literal: la tabla se consulta con un
 * identificador que llega de fuera, y en un objeto normal `MODEL_PRICING['__proto__']`
 * no devuelve `undefined` sino `Object.prototype`, con lo que el `.filter` de
 * abajo revienta con un TypeError en vez de decir «no hay tarifa».
 */
export const MODEL_PRICING: Readonly<Record<string, readonly ModelPricing[]>> = Object.assign(
  Object.create(null) as Record<string, readonly ModelPricing[]>,
  {
    'claude-fable-5': [rate('2026-01-01', 10, 50)],
    'claude-mythos-5': [rate('2026-01-01', 10, 50)],
    'claude-opus-5': [rate('2026-01-01', 5, 25)],
    'claude-opus-4-8': [rate('2026-01-01', 5, 25)],
    'claude-opus-4-7': [rate('2026-01-01', 5, 25)],
    'claude-opus-4-6': [rate('2026-01-01', 5, 25)],
    'claude-sonnet-5': [rate('2026-01-01', 2, 10), rate('2026-09-01', 3, 15)],
    'claude-sonnet-4-6': [rate('2026-01-01', 3, 15)],
    'claude-haiku-4-5': [rate('2026-01-01', 1, 5)],
  },
);

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

/**
 * Sufijo de foto fechada: exactamente ocho dígitos con forma de fecha.
 *
 * Ocho y no «los dígitos del final» porque las familias llevan su versión en
 * números sueltos separados por guiones: recortar «claude-sonnet-4-6» a
 * «claude-sonnet-4» sería facturar con la tarifa de otro modelo, que es mucho
 * peor que quedarse sin tarifa.
 */
const SNAPSHOT_SUFFIX = /-(\d{4})(\d{2})(\d{2})$/;

/** El alias del que cuelga una foto fechada, o `null` si el sufijo no es una fecha. */
function aliasOf(model: string): string | null {
  const match = SNAPSHOT_SUFFIX.exec(model);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return model.slice(0, match.index);
}

/**
 * Tarifa vigente de un modelo en un instante.
 *
 * **La API devuelve el identificador resuelto, no el que se pidió**: a
 * `claude-haiku-4-5` responde `claude-haiku-4-5-20251001`. La tabla se indexa
 * por alias —es lo que se configura y lo que factura la cuenta—, así que la
 * foto fechada se reduce a su alias. Primero se prueba la clave exacta, para no
 * pisar una tarifa que legítimamente terminara en dígitos; la tarifa la elige
 * la fecha de la llamada, nunca la del snapshot.
 */
export function pricingFor(model: string, at: Date = new Date()): ModelPricing | undefined {
  const key = model.startsWith(MOCK_MODEL_PREFIX) ? model.slice(MOCK_MODEL_PREFIX.length) : model;
  const alias = aliasOf(key);
  const rates = MODEL_PRICING[key] ?? (alias === null ? undefined : MODEL_PRICING[alias]);
  const instant = at.toISOString().slice(0, 10);
  return rates
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

export interface PricedUsage {
  readonly costCents: number;
  /** `true` si la llamada se pagó pero no hay tarifa: `costCents` es relleno. */
  readonly unpriced: boolean;
}

/**
 * Valoración de una llamada **ya pagada**. Aquí no se puede lanzar.
 *
 * El dinero está gastado y la respuesta es el producto. Perder una corrección
 * porque falta una fila en una tabla de precios es, de los dos fallos posibles,
 * el caro —y es exactamente lo que pasó en el entorno de test: dos triajes de
 * foro cobrados, respondidos y tirados a la basura, con sus entregas en
 * `error`—. Sin tarifa se marca `unpriced`, que es como el registro de IA
 * distingue «no sabemos cuánto costó» (coste NULL) de «fue gratis».
 *
 * El 0 es relleno del tipo, no un coste. Los agregados que suman céntimos lo
 * absorben como cero y por eso el panel avisa de que el gasto mostrado es un
 * mínimo; el importe real se puede reconstruir después, porque el registro
 * guarda los tokens.
 *
 * `estimateCostCents` se conserva y sigue lanzando: es el contrato de quien
 * valora **antes** de gastar y todavía puede parar a tiempo.
 */
export function priceUsage(model: string, usage: TokenUsage, at: Date = new Date()): PricedUsage {
  if (!pricingFor(model, at)) return { costCents: 0, unpriced: true };
  return { costCents: estimateCostCents(model, usage, at), unpriced: false };
}

export function formatCents(cents: number): string {
  return `${(cents / 100).toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })} €`;
}
