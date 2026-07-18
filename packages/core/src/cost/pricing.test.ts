import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODEL_PRICING, USD_TO_EUR, estimateCostCents, formatCents, pricingFor } from './pricing.js';

test('calcula el coste en céntimos de euro a partir de la tarifa del modelo', () => {
  const cost = estimateCostCents('claude-opus-4-8', {
    inputTokens: 1_000_000,
    outputTokens: 0,
    cachedInputTokens: 0,
  });
  // 1 M de tokens de entrada = 5 USD = 500 centavos → euros al cambio fijo.
  assert.equal(cost, Math.round(5 * USD_TO_EUR * 100 * 10_000) / 10_000);
});

test('los tokens leídos de caché salen mucho más baratos que los normales', () => {
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 100_000 };
  const cached = estimateCostCents('claude-opus-4-8', usage);
  const uncached = estimateCostCents('claude-opus-4-8', {
    inputTokens: 100_000,
    outputTokens: 0,
    cachedInputTokens: 0,
  });

  assert.ok(cached > 0);
  assert.ok(cached < uncached / 5, 'la lectura de caché debería costar ~0,1×');
});

test('el modelo simulado se valora con la tarifa del modelo real', () => {
  const usage = { inputTokens: 12_000, outputTokens: 3_000, cachedInputTokens: 2_000 };
  assert.equal(
    estimateCostCents('mock-claude-opus-4-8', usage),
    estimateCostCents('claude-opus-4-8', usage),
  );
  assert.deepEqual(pricingFor('mock-claude-opus-4-8'), MODEL_PRICING['claude-opus-4-8']);
});

test('un modelo desconocido no rompe la corrección: coste cero', () => {
  assert.equal(pricingFor('modelo-inventado'), undefined);
  assert.equal(
    estimateCostCents('modelo-inventado', {
      inputTokens: 50_000,
      outputTokens: 10_000,
      cachedInputTokens: 0,
    }),
    0,
  );
});

test('el importe se formatea en español', () => {
  assert.ok(formatCents(84).includes('€'));
  assert.ok(formatCents(84).startsWith('0,84'));
});
