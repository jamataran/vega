/**
 * Tabla de precios y cálculo de coste. **Fuente única de verdad**: si el coste
 * hay que tocarlo, se toca aquí y en ningún otro sitio.
 *
 * ⚠️ REVISAR PERIÓDICAMENTE contra la documentación vigente de Anthropic
 * (https://platform.claude.com/docs/en/pricing). Los precios cambian, y con
 * ellos el coste por corrección que enseñamos en el panel. Última revisión
 * contra la documentación: junio de 2026.
 */

/** Precios en dólares por millón de tokens. */
export interface ModelPricing {
  /** Tokens de entrada que NO vienen de caché. */
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
  /**
   * Lectura de caché. Anthropic la factura a ~0,1× la entrada normal; el
   * *write* de caché cuesta ~1,25×, pero no lo modelamos por separado porque
   * la API lo reporta en un campo propio que aún no persistimos.
   */
  readonly cachedInputPerMillionUsd: number;
}

/**
 * Precios de lista, en USD por millón de tokens.
 * Sólo incluimos los modelos que Vega puede llegar a usar.
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  'claude-opus-4-8': { inputPerMillionUsd: 5, outputPerMillionUsd: 25, cachedInputPerMillionUsd: 0.5 },
  'claude-opus-4-7': { inputPerMillionUsd: 5, outputPerMillionUsd: 25, cachedInputPerMillionUsd: 0.5 },
  'claude-sonnet-5': { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cachedInputPerMillionUsd: 0.3 },
  'claude-sonnet-4-6': { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cachedInputPerMillionUsd: 0.3 },
  'claude-haiku-4-5': { inputPerMillionUsd: 1, outputPerMillionUsd: 5, cachedInputPerMillionUsd: 0.1 },
};

/**
 * ⚠️ REVISAR: tipo de cambio fijo. Guardamos el coste en céntimos de euro
 * (así lo pide `UsageMetrics`) pero Anthropic factura en dólares. Un tipo fijo
 * basta para estimar el coste por corrección en el panel; si algún día hay que
 * cuadrar con la factura real, habrá que guardar también el importe en USD.
 */
export const USD_TO_EUR = 0.92;

/**
 * Prefijo que usa el proveedor mock: `mock-claude-opus-4-8` se valora con la
 * tarifa de `claude-opus-4-8`. Así el coste simulado es realista sin que nadie
 * confunda una entrega simulada con una real mirando el modelo.
 */
export const MOCK_MODEL_PREFIX = 'mock-';

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
}

/** Devuelve la tarifa del modelo, resolviendo antes el prefijo del mock. */
export function pricingFor(model: string): ModelPricing | undefined {
  const key = model.startsWith(MOCK_MODEL_PREFIX)
    ? model.slice(MOCK_MODEL_PREFIX.length)
    : model;
  return MODEL_PRICING[key];
}

/**
 * Coste en céntimos de euro. Un modelo desconocido devuelve 0 en lugar de
 * lanzar: preferimos una métrica incompleta a una corrección que se cae por no
 * tener el precio en la tabla. Cuando pase, se ve en el panel como coste cero.
 */
export function estimateCostCents(model: string, usage: TokenUsage): number {
  const pricing = pricingFor(model);
  if (pricing === undefined) return 0;

  const usd =
    (usage.inputTokens * pricing.inputPerMillionUsd +
      usage.outputTokens * pricing.outputPerMillionUsd +
      usage.cachedInputTokens * pricing.cachedInputPerMillionUsd) /
    1_000_000;

  // Cuatro decimales de céntimo: una corrección barata no debe redondear a 0.
  return Math.round(usd * USD_TO_EUR * 100 * 10_000) / 10_000;
}

/** Céntimos → cadena legible en español ("0,84 €"). */
export function formatCents(cents: number): string {
  return `${(cents / 100).toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })} €`;
}
