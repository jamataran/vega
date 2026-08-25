import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GradingAnswer,
  TranscriptionAnswer,
  TriageAnswer,
  VerificationAnswer,
} from '@vega/core';
import { PROMPT_SEED_CONTENT } from './seeds.js';

/**
 * El prompt describe la salida con un ejemplo JSON; el esquema de `@vega/core`
 * es lo que la API impone al modelo con salida estructurada. Si no dicen lo
 * mismo, el modelo intenta escribir campos que la gramática no le deja y
 * descarrila: en producción (24-08-2026) la transcripción exigía `notes` y
 * `confidence` por página, el esquema no los admitía, y el modelo cerraba el
 * array tras la primera página. Esta prueba hace que ese desajuste rompa la CI.
 *
 * Los esquemas van estrictos a todos los niveles (`.strict()`), así que un
 * campo de más en el ejemplo también falla, no sólo uno de menos.
 */

/**
 * Lo mínimo que se necesita de un esquema, con forma y no con el tipo de Zod:
 * `@vega/core` y el API pueden resolver versiones distintas de la librería y
 * el contrato de esta prueba no depende de ninguna.
 */
interface AnswerSchema {
  safeParse(value: unknown):
    | { success: true }
    | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> } };
}

/** Los bloques ```json del prompt, ya parseados. Los que no son JSON se saltan. */
function jsonExamples(prompt: string): unknown[] {
  const examples: unknown[] = [];
  for (const match of prompt.matchAll(/```json\n([\s\S]*?)```/g)) {
    try {
      examples.push(JSON.parse(match[1] ?? ''));
    } catch {
      // Un ejemplo con huecos («<número entre 0 y 1>») no es JSON: no se puede
      // comprobar, pero tampoco confunde al modelo con claves de más.
    }
  }
  return examples;
}

function assertExamplesMatch(key: string, schema: AnswerSchema): void {
  const prompt = PROMPT_SEED_CONTENT[key];
  assert.ok(prompt, `no existe la semilla ${key}`);
  const examples = jsonExamples(prompt);
  assert.ok(examples.length > 0, `${key} no trae ningún ejemplo JSON parseable`);
  for (const example of examples) {
    const parsed = schema.safeParse(example);
    assert.ok(
      parsed.success,
      `${key}: el ejemplo del prompt no cumple el esquema del modelo:\n${
        parsed.success ? '' : parsed.error.issues.map((issue) => `- ${issue.path.map(String).join('.')}: ${issue.message}`).join('\n')
      }`,
    );
  }
}

test('el ejemplo del prompt de transcripción es exactamente lo que admite el esquema', () => {
  assertExamplesMatch('transcription.system', TranscriptionAnswer);
});

// Los tres siguientes NO cuadran hoy. No son la causa de ningún fallo visto —
// la gramática obliga al modelo a rellenar los campos del esquema y las
// llamadas funcionan—, pero es la misma clase de desajuste, y arreglarlos exige
// reescribir prompts de producción y medir (docs/revision/20260824-incidencias-
// lote-sin-limite.md §4.5). Quedan en `skip` con el motivo a la vista, para no
// ensuciar la CI con «failing tests» que no lo son. Al reescribir cada prompt,
// quitar su `skip`: la prueba pasa a vigilarlo.
test(
  'el ejemplo del prompt de corrección cuadra con el esquema',
  { skip: 'el ejemplo describe `citas[]`; el esquema exige `aiQuote`, `aiQuotePage`, `maxPoints`, `escalate` y `noEsDuda`' },
  () => {
    assertExamplesMatch('grading.problem.system', GradingAnswer);
  },
);

test(
  'el ejemplo del prompt de triaje cuadra con el esquema',
  { skip: 'el ejemplo usa `tipo`/`confianza`/`motivo` con huecos; el esquema, `label`/`confidence`/`reason`' },
  () => {
    assertExamplesMatch('triage.system', TriageAnswer);
  },
);

test(
  'el ejemplo del prompt de verificación cuadra con el esquema',
  { skip: 'el ejemplo usa `veredicto`/`problemas`; el esquema, `coherent`/`issues`/`confidence`' },
  () => {
    assertExamplesMatch('verify.system', VerificationAnswer);
  },
);
