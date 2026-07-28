import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODEL_PRICING, USD_TO_EUR, estimateCostCents, formatCents, priceUsage, pricingFor } from './pricing.js';

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
  assert.deepEqual(pricingFor('mock-claude-opus-4-8'), MODEL_PRICING['claude-opus-4-8']?.[0]);
});

test('un modelo desconocido queda señalado y nunca figura como coste cero', () => {
  assert.equal(pricingFor('modelo-inventado'), undefined);
  assert.throws(() =>
    estimateCostCents('modelo-inventado', {
      inputTokens: 50_000,
      outputTokens: 10_000,
      cachedInputTokens: 0,
    }),
  );
});

/**
 * El incidente del 27/07/2026 en el entorno de test: dos triajes de foro
 * cobrados y tirados porque la API contesta con el id **resuelto**
 * (`claude-haiku-4-5-20251001`) y la tabla sólo conoce el alias.
 */
test('la foto fechada se valora con la tarifa de su alias', () => {
  assert.deepEqual(
    pricingFor('claude-haiku-4-5-20251001'),
    MODEL_PRICING['claude-haiku-4-5']?.[0],
  );
  for (const alias of Object.keys(MODEL_PRICING)) {
    assert.deepEqual(
      pricingFor(`${alias}-20260101`),
      pricingFor(alias),
      `la foto fechada de ${alias} debería costar lo mismo que su alias`,
    );
  }
});

test('resolver el alias nunca inventa el precio de otro modelo', () => {
  // El peligro de recortar «los dígitos del final»: la versión de la familia
  // va en números sueltos, así que «claude-sonnet-4-6» quedaría en Sonnet 4.
  assert.equal(pricingFor('claude-sonnet-4-6')?.inputPerMillionUsd, 3);
  assert.equal(pricingFor('claude-opus-4-8')?.inputPerMillionUsd, 5);
  assert.equal(pricingFor('claude-sonnet-4'), undefined);
  assert.equal(pricingFor('claude-opus-4'), undefined);
});

test('sólo se resuelve un sufijo que sea una fecha de verdad', () => {
  for (const suffix of ['-fast', '-latest', '-v2', '-2025100', '-202510011', '-20251301', '-20251000']) {
    assert.equal(
      pricingFor(`claude-haiku-4-5${suffix}`),
      undefined,
      `«${suffix}» no es una fecha y no debería resolver a ningún alias`,
    );
  }
});

test('una clave rara no revienta la búsqueda de tarifa', () => {
  // Con un objeto literal, `MODEL_PRICING['__proto__']` devuelve
  // `Object.prototype` y el `.filter` de después lanza un TypeError.
  assert.equal(pricingFor('__proto__'), undefined);
  assert.equal(pricingFor('constructor'), undefined);
});

test('el simulado fechado también resuelve, con el doble recorte', () => {
  const usage = { inputTokens: 12_000, outputTokens: 3_000, cachedInputTokens: 0 };
  assert.equal(
    estimateCostCents('mock-claude-opus-4-8-20260101', usage),
    estimateCostCents('claude-opus-4-8', usage),
  );
});

test('la tarifa la elige la fecha de la llamada, no la del snapshot', () => {
  assert.equal(pricingFor('claude-sonnet-5-20260701', new Date('2026-08-31'))?.inputPerMillionUsd, 2);
  assert.equal(pricingFor('claude-sonnet-5-20260701', new Date('2026-09-01'))?.inputPerMillionUsd, 3);
});

test('una llamada ya pagada nunca se pierde por no saber el precio', () => {
  const usage = { inputTokens: 50_000, outputTokens: 10_000, cachedInputTokens: 0 };
  assert.deepEqual(priceUsage('modelo-inventado', usage), { costCents: 0, unpriced: true });
  assert.deepEqual(priceUsage('claude-opus-4-8', usage), {
    costCents: estimateCostCents('claude-opus-4-8', usage),
    unpriced: false,
  });
});

test('contabiliza la creación de caché y aplica el descuento de lote', () => {
  const sync = estimateCostCents('claude-opus-4-8', {
    inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 100_000,
  });
  const batch = estimateCostCents('claude-opus-4-8', {
    inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 100_000, transport: 'batch',
  });
  assert.ok(sync > 0);
  assert.equal(batch, sync / 2);
});

test('Sonnet 5 conserva la tarifa introductoria hasta septiembre de 2026', () => {
  assert.equal(pricingFor('claude-sonnet-5', new Date('2026-08-31'))?.inputPerMillionUsd, 2);
  assert.equal(pricingFor('claude-sonnet-5', new Date('2026-09-01'))?.inputPerMillionUsd, 3);
});

test('el importe se formatea en español', () => {
  assert.ok(formatCents(84).includes('€'));
  assert.ok(formatCents(84).startsWith('0,84'));
});
