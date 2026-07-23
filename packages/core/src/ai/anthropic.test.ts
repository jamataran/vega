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
  readonly signal: AbortSignal | undefined;
}

/**
 * Un cliente de Anthropic de mentira: apunta cada llamada y devuelve lo que se
 * le diga, incluida la posibilidad de fallar las primeras veces.
 *
 * Implementa `messages.stream(...).finalMessage()`, que es el único contrato
 * que usa el proveedor: todas las llamadas van por streaming porque el SDK
 * rechaza en local las peticiones sin streaming con `max_tokens` altos.
 */
function clienteFalso(
  respuestas: Array<{
    error?: Error;
    pages?: Array<{ page: number; latex: string }>;
    stopReason?: string;
  }>,
): { client: Anthropic; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  let indice = 0;

  const stream = (
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): { finalMessage: () => Promise<unknown> } => ({
    finalMessage: async (): Promise<unknown> => {
      const contenido = (body['messages'] as Array<{ content: unknown[] }>)[0]?.content ?? [];
      const texto = contenido
        .filter((bloque): bloque is { type: 'text'; text: string } =>
          typeof bloque === 'object' && bloque !== null && (bloque as { type?: string }).type === 'text',
        )
        .map((bloque) => bloque.text)
        .join('\n');
      llamadas.push({ maxTokens: body['max_tokens'] as number, texto, signal: options?.signal });

      const respuesta = respuestas[Math.min(indice, respuestas.length - 1)];
      indice += 1;
      if (respuesta?.error) throw respuesta.error;

      return {
        model: body['model'] as string,
        stop_reason: respuesta?.stopReason ?? 'end_turn',
        usage: { input_tokens: 10, output_tokens: 10 },
        parsed_output: {
          pages: respuesta?.pages ?? [{ page: 1, latex: 'x' }],
          flags: [],
          confidence: 0.9,
        },
      };
    },
  });

  return { client: { messages: { stream } } as unknown as Anthropic, llamadas };
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
  assert.ok(llamadas[0]?.signal, 'la lectura debe poder abortar el stream completo');
  assert.equal(llamadas[0]?.signal?.aborted, false);
});

test('el triaje usa un timeout corto para no bloquear la cola', async () => {
  let signal: AbortSignal | undefined;
  const client = {
    messages: {
      stream: (_body: unknown, options?: { signal?: AbortSignal }) => {
        signal = options?.signal;
        return {
          finalMessage: async () => ({
            model: 'claude-haiku-4-5',
            stop_reason: 'end_turn',
            usage: { input_tokens: 4, output_tokens: 2 },
            parsed_output: {
              label: 'sencilla',
              confidence: 0.9,
              reason: 'Clasificación de prueba',
            },
          }),
        };
      },
    },
  } as unknown as Anthropic;

  await new AnthropicAiProvider({ apiKey: 'sk-de-prueba', client }).triage({
    submissionId: SUBMISSION,
    message: '¿Cómo se resuelve?',
    thread: [],
  });

  assert.ok(signal);
  assert.equal(signal.aborted, false);
});

test('sin reparto configurado conserva los máximos propuestos y exige que sumen la nota', async () => {
  let systemText = '';
  const client = {
    messages: {
      stream: (body: { model: string; system: Array<{ text: string }> }) => {
        systemText = body.system.map((block) => block.text).join('\n');
        return {
          finalMessage: async () => ({
            model: body.model,
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 10 },
            parsed_output: {
              items: [
                {
                  label: '1',
                  maxPoints: 2.5,
                  aiPoints: 2,
                  aiFeedback: 'Bien.',
                  aiQuote: 'x=2',
                  aiQuotePage: 1,
                  confidence: 0.8,
                  alternativeMethod: false,
                },
                {
                  label: '2',
                  maxPoints: 7.5,
                  aiPoints: 6,
                  aiFeedback: 'Bien.',
                  aiQuote: 'y=3',
                  aiQuotePage: 2,
                  confidence: 0.8,
                  alternativeMethod: false,
                },
              ],
              aiLatex: '\\section*{Corrección}',
              aiSummary: 'Resumen',
              teacherNotes: 'Reparto inferido.',
              confidence: 0.8,
              escalate: true,
              noEsDuda: false,
            },
          }),
        };
      },
    },
  } as unknown as Anthropic;

  const result = await new AnthropicAiProvider({ apiKey: 'sk-de-prueba', client }).grade({
    submissionId: SUBMISSION,
    activityKind: 'assignment',
    transcription: null,
    document: [],
    textContent: 'Entrega de prueba',
    context: [],
    material: '',
    student: null,
    pointsAllocation: [],
    graded: true,
    maxScore: 10,
  });

  assert.deepEqual(result.items.map((item) => item.maxPoints), [2.5, 7.5]);
  assert.match(systemText, /suma de todos los maxPoints sea exactamente 10/);
});

test('un stream que conecta pero no termina se aborta al vencer el deadline', async () => {
  let signal: AbortSignal | undefined;
  const client = {
    messages: {
      stream: (_body: unknown, options?: { signal?: AbortSignal }) => {
        signal = options?.signal;
        return {
          // Ignora la señal deliberadamente: el deadline debe ganar la carrera
          // incluso si el transporte no coopera con el aborto.
          finalMessage: () => new Promise<never>(() => undefined),
        };
      },
    },
  } as unknown as Anthropic;

  const provider = new AnthropicAiProvider({
    apiKey: 'sk-de-prueba',
    client,
    shortCallTimeoutMs: 10,
  });

  await assert.rejects(
    provider.triage({ submissionId: SUBMISSION, message: '¿Cómo se resuelve?', thread: [] }),
    /no ha terminado la operación en 1 segundo/,
  );
  assert.equal(signal?.aborted, true);
});

test('la cancelación del lote aborta el stream activo del proveedor', async () => {
  let providerSignal: AbortSignal | undefined;
  const client = {
    messages: {
      stream: (_body: unknown, options?: { signal?: AbortSignal }) => {
        providerSignal = options?.signal;
        return { finalMessage: () => new Promise<never>(() => undefined) };
      },
    },
  } as unknown as Anthropic;
  const controller = new AbortController();
  const pending = new AnthropicAiProvider({ apiKey: 'sk-de-prueba', client }).triage(
    { submissionId: SUBMISSION, message: '¿Cómo se resuelve?', thread: [] },
    { signal: controller.signal },
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort(new Error('El lote ha agotado su tiempo.'));

  await assert.rejects(pending, /agotado su tiempo/);
  assert.equal(providerSignal?.aborted, true);
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

test('un stop_reason max_tokens con JSON válido también se reintenta con más presupuesto', async () => {
  // Con salida estructurada lo normal es que el corte reviente el parseo, pero
  // si el JSON queda casualmente completo la señal es el stop_reason. Ambos
  // caminos deben acabar en el mismo reintento.
  const { client, llamadas } = clienteFalso([{ stopReason: 'max_tokens' }, {}]);

  await proveedor(client).transcribe({
    submissionId: SUBMISSION,
    studentRef: 'alumno-0007',
    activityKind: 'assignment',
    pages: SEIS_PAGINAS,
  });

  assert.equal(llamadas.length, 2);
  assert.ok(llamadas[1]!.maxTokens > llamadas[0]!.maxTokens);
});

test('un refusal no se reintenta jamás', async () => {
  const { client, llamadas } = clienteFalso([{ stopReason: 'refusal' }]);

  await assert.rejects(
    () =>
      proveedor(client).transcribe({
        submissionId: SUBMISSION,
        studentRef: 'alumno-0007',
        activityKind: 'assignment',
        pages: SEIS_PAGINAS,
      }),
    /rechazado/,
  );
  assert.equal(llamadas.length, 1, 'repetir una petición rechazada va contra la guía de la API');
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
