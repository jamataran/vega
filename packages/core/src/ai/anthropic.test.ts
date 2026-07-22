import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicAiProvider } from './anthropic.js';
import type { PageSource } from './provider.js';

/**
 * Lo que estas pruebas fijan salió de la primera pasada contra la API real, con
 * exámenes de verdad: dos fallos que se comieron entregas ya pagadas.
 */

const SUBMISSION = '11111111-1111-4111-8111-111111111111';

/** Un examen de seis páginas partido en dos bloques, como lo trocea la ingesta. */
const SEIS_PAGINAS: PageSource[] = [
  { page: 1, pageNumbers: [1, 2, 3, 4], mediaType: 'application/pdf', bytes: new Uint8Array([1]) },
  { page: 5, pageNumbers: [5, 6], mediaType: 'application/pdf', bytes: new Uint8Array([2]) },
];

interface Llamada {
  readonly maxTokens: number;
  readonly texto: string;
}

/**
 * Un cliente de Anthropic de mentira: apunta cada llamada y devuelve lo que se
 * le diga, incluida la posibilidad de fallar las primeras veces.
 */
function clienteFalso(
  respuestas: Array<{ error?: Error; pages?: Array<{ page: number; latex: string }> }>,
): { client: Anthropic; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  let indice = 0;

  const parse = async (body: Record<string, unknown>): Promise<unknown> => {
    const contenido = (body['messages'] as Array<{ content: unknown[] }>)[0]?.content ?? [];
    const texto = contenido
      .filter((bloque): bloque is { type: 'text'; text: string } =>
        typeof bloque === 'object' && bloque !== null && (bloque as { type?: string }).type === 'text',
      )
      .map((bloque) => bloque.text)
      .join('\n');
    llamadas.push({ maxTokens: body['max_tokens'] as number, texto });

    const respuesta = respuestas[Math.min(indice, respuestas.length - 1)];
    indice += 1;
    if (respuesta?.error) throw respuesta.error;

    return {
      model: body['model'] as string,
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 10 },
      parsed_output: {
        pages: respuesta?.pages ?? [{ page: 1, latex: 'x' }],
        flags: [],
        confidence: 0.9,
      },
    };
  };

  return { client: { messages: { parse } } as unknown as Anthropic, llamadas };
}

function proveedor(client: Anthropic, model = 'claude-opus-4-8'): AnthropicAiProvider {
  return new AnthropicAiProvider({ apiKey: 'sk-de-prueba', transcriptionModel: model, client });
}

test('la transcripción pide las páginas del original, no los bloques enviados', async () => {
  const { client, llamadas } = clienteFalso([{}]);

  await proveedor(client).transcribe({
    submissionId: SUBMISSION,
    studentRef: 'alumno-0007',
    activityKind: 'assignment',
    pages: SEIS_PAGINAS,
  });

  const texto = llamadas[0]?.texto ?? '';
  // El fallo real: se pedían «2 páginas» —los dos bloques— de un examen de
  // seis, el modelo devolvía dos entradas numeradas 1, y el ensamblado tiraba
  // la entrega con «faltan [2,3,4,5,6], duplicadas [1]».
  assert.match(texto, /6 páginas/);
  assert.match(texto, /2 bloques/);
  assert.doesNotMatch(texto, /Transcribe las 2 páginas/);
  // La numeración esperada viaja explícita: es lo que el ensamblado comprueba.
  assert.match(texto, /1, 2, 3, 4, 5, 6/);
});

test('una salida cortada a mitad del JSON se reintenta con más tokens', async () => {
  // El SDK lanza al parsear, así que `stop_reason` nunca llega a mirarse: sin
  // este camino, la entrega moría con un «Unterminated string in JSON».
  const cortada = new Error(
    'Failed to parse structured output: Error: Failed to parse structured output as JSON: Unterminated string in JSON at position 4120',
  );
  const { client, llamadas } = clienteFalso([{ error: cortada }, {}]);

  const resultado = await proveedor(client).transcribe({
    submissionId: SUBMISSION,
    studentRef: 'alumno-0007',
    activityKind: 'assignment',
    pages: SEIS_PAGINAS,
  });

  assert.equal(llamadas.length, 2);
  assert.ok(
    llamadas[1]!.maxTokens > llamadas[0]!.maxTokens,
    'el reintento debe pedir más presupuesto que el intento que se quedó corto',
  );
  assert.equal(resultado.pages.length, 1);
});

test('el reintento respeta el techo de salida del modelo', async () => {
  // Haiku 4.5 corta en 64k: pedir más es un 400, y un reintento que revienta
  // por eso convierte un fallo recuperable en uno definitivo.
  const cortada = new Error('Failed to parse structured output as JSON: Unterminated string');
  const { client, llamadas } = clienteFalso([{ error: cortada }, {}]);

  await proveedor(client, 'claude-haiku-4-5').transcribe({
    submissionId: SUBMISSION,
    studentRef: 'alumno-0007',
    activityKind: 'assignment',
    pages: SEIS_PAGINAS,
  });

  for (const llamada of llamadas) {
    assert.ok(llamada.maxTokens <= 64_000, `max_tokens ${llamada.maxTokens} supera el techo de Haiku`);
  }
});

test('si sigue cortada tras ampliar, el error explica qué hacer', async () => {
  const cortada = new Error('Failed to parse structured output as JSON: Unterminated string');
  const { client } = clienteFalso([{ error: cortada }]);

  await assert.rejects(
    () =>
      proveedor(client).transcribe({
        submissionId: SUBMISSION,
        studentRef: 'alumno-0007',
        activityKind: 'assignment',
        pages: SEIS_PAGINAS,
      }),
    /Páginas por bloque/,
  );
});
