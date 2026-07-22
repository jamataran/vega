import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import type { TranscriptionFlag, TranscriptionPage } from '@vega/shared';
import { estimateCostCents } from '../cost/pricing.js';
import { gradePromptKey } from './provider.js';
import type {
  AiProvider,
  GradedItem,
  GradeInput,
  GradeResult,
  PageSource,
  TriageInput,
  TriageResult,
  TranscribeInput,
  TranscribeResult,
  VerifyInput,
  VerifyResult,
  VerifyConnectionResult,
} from './provider.js';

/**
 * Proveedor real contra la API de Anthropic.
 *
 * ⚠️ ENTREGA 1: implementación mínima. La interfaz y la estructura de los
 * prompts son las definitivas, pero NADA de este fichero se ha ejecutado
 * contra la API real: no hay clave en el entorno de desarrollo y el proveedor
 * por defecto es el mock. Los puntos concretos que quedan sin comprobar están
 * marcados con `// TODO(vega): sin verificar contra la API real`.
 *
 * Decisiones de diseño que sí son deliberadas:
 *  - Modelo por defecto `claude-opus-4-8` (visión + razonamiento). Los ids de
 *    modelo salen de la configuración, nunca escritos a mano en el código.
 *  - El bloque de contexto de corrección lleva `cache_control` porque es
 *    exactamente lo que se repite entre todas las entregas de una misma actividad:
 *    es de donde sale el ahorro del lote nocturno.
 *  - El contexto va DESPUÉS de las instrucciones fijas y ANTES de la
 *    transcripción del alumno. El caché es un prefijo: lo estable primero.
 */

export const DEFAULT_TRANSCRIPTION_MODEL = 'claude-opus-4-8';
export const DEFAULT_GRADING_MODEL = 'claude-opus-4-8';
export const DEFAULT_TRIAGE_MODEL = 'claude-haiku-4-5';
export const DEFAULT_VERIFY_MODEL = 'claude-sonnet-5';

/** Sin streaming el SDK corta por timeout mucho antes de 128k. */
const MAX_TOKENS = 16_000;

/**
 * Suelo de salida para la transcripción. El razonamiento adaptativo gasta del
 * mismo presupuesto que el texto, así que con 16k un examen de seis páginas
 * agotaba el tope a mitad del JSON y la entrega moría con un error de parseo.
 */
const TRANSCRIPTION_MIN_TOKENS = 32_000;

/**
 * Timeout explícito para las llamadas largas (transcripción y corrección).
 * Sin él, el SDK **rechaza** una petición no-streaming cuyo `max_tokens`
 * implique más de ~10 minutos de generación; con un timeout explícito acepta
 * y espera. Una corrección con razonamiento extendido puede tardar varios
 * minutos con toda normalidad.
 */
const LONG_CALL_TIMEOUT_MS = 60 * 60 * 1_000;

/** Haiku 4.5 es de una generación anterior: `thinking: adaptive` y `effort` devuelven 400. */
function supportsExtendedReasoning(model: string): boolean {
  return !model.includes('haiku');
}

/**
 * `effort: 'xhigh'` sólo está garantizado en los modelos de gama alta y exige
 * `max_tokens ≥ 64k`. Para el resto se degrada a `high`, que es válido en toda
 * la familia con razonamiento.
 */
function clampEffort(model: string, effort: 'high' | 'xhigh'): 'high' | 'xhigh' {
  if (effort === 'xhigh' && !(model.includes('opus-4-8') || model.includes('fable'))) {
    return 'high';
  }
  return effort;
}

/** Suelo de `max_tokens` que impone el nivel de esfuerzo pedido. */
function minTokensFor(effort: 'high' | 'xhigh'): number {
  return effort === 'xhigh' ? 64_000 : 16_000;
}

/**
 * Techo de `max_tokens` del modelo. Pedir más es un 400, así que el reintento
 * por respuesta truncada tiene que respetarlo: Haiku 4.5 llega a 64k y el
 * resto de la familia actual, a 128k.
 */
function maxOutputFor(model: string): number {
  return model.includes('haiku') ? 64_000 : 128_000;
}

/**
 * Una salida estructurada que no se puede parsear casi siempre es una
 * **respuesta cortada**: el modelo agotó `max_tokens` a mitad de una cadena y
 * el JSON quedó sin cerrar.
 *
 * Importa distinguirlo porque el SDK lanza al parsear, **antes** de que nadie
 * pueda mirar `stop_reason`, así que el reintento por tope de tokens no se
 * activaba nunca: la entrega moría con un «Unterminated string in JSON» que no
 * le dice nada a un profesor.
 */
function isTruncatedOutput(error: unknown): boolean {
  return error instanceof Error && /parse structured output/i.test(error.message);
}

export interface AnthropicAiProviderOptions {
  readonly apiKey?: string;
  readonly transcriptionModel?: string;
  readonly gradingModel?: string;
  readonly triageModel?: string;
  readonly verifyModel?: string;
  /** Tope de tokens de respuesta. Lo fija el administrador en Ajustes. */
  readonly maxTokens?: number;
  readonly systemPrompts?: Readonly<Record<string, string>>;
  /** Inyectable para poder testear sin red. */
  readonly client?: Anthropic;
}

// ── Respuestas esperadas del modelo ─────────────────────────────────────────

const TranscriptionAnswer = z.object({
  pages: z.array(
    z.object({
      page: z.number(),
      latex: z.string(),
    }),
  ),
  flags: z.array(
    z.object({
      kind: z.enum(['ILEGIBLE', 'DUDA', 'DISCREPANCIA']),
      page: z.number(),
      excerpt: z.string(),
      note: z.string(),
    }),
  ),
  confidence: z.number(),
});

const GradingAnswer = z.object({
  /** Vacío cuando la actividad no se puntúa. */
  items: z.array(
    z.object({
      label: z.string(),
      aiPoints: z.number(),
      aiFeedback: z.string(),
      aiQuote: z.string().nullable(),
      aiQuotePage: z.number().nullable(),
      confidence: z.number(),
      alternativeMethod: z.boolean(),
    }),
  ),
  aiLatex: z.string(),
  aiSummary: z.string(),
  teacherNotes: z.string().nullable(),
  confidence: z.number(),
  escalate: z.boolean(),
  noEsDuda: z.boolean(),
});

const TriageAnswer = z.object({
  label: z.enum(['errata', 'administrativa', 'no_es_duda', 'sencilla', 'dificil']),
  confidence: z.number(),
  reason: z.string(),
});

const VerificationAnswer = z.object({
  coherent: z.boolean(),
  issues: z.array(z.object({
    kind: z.string(),
    itemLabel: z.string().nullable(),
    detail: z.string(),
  })),
  confidence: z.number(),
});

// ── Prompts ─────────────────────────────────────────────────────────────────

const TRANSCRIPTION_SYSTEM = `Eres un transcriptor de exámenes de matemáticas manuscritos.

Transcribe ÍNTEGRAMENTE el desarrollo del alumno, respetando su orden y sus
errores: no corrijas, no completes y no reordenes nada.

Formato de \`latex\` (lo pinta KaTeX, que no compone documentos enteros):
- Texto normal en Markdown y cada fórmula delimitada entre $$ ... $$.
- Una fórmula por línea del desarrollo, separadas por una línea en blanco.
- Si un fragmento no se lee, marca [ILEGIBLE]; si admite dos lecturas, marca
  [DUDA] y registra las dos posibilidades sin elegir. Las marcas van FUERA de los $$:
  dentro, KaTeX las interpretaría como matemáticas.

La respuesta debe ajustarse al esquema estructurado indicado por la API.`;

const GRADING_SYSTEM = `Eres un profesor de matemáticas de una academia de oposiciones corrigiendo la entrega de un alumno.

Corriges apartado por apartado contra la solución de referencia y el reparto de
puntos que se te dan. Reglas:
- Un método distinto al de la solución de referencia es válido si es
  matemáticamente correcto: márcalo con alternativeMethod y puntúalo igual.
- El feedback va dirigido al alumno, en español de España, concreto y breve:
  qué hace bien, qué falla y cuántos puntos cuesta ("...; -0,25").
- Nunca puntúes por encima del máximo del apartado.
- Si la transcripción trae marcas [ILEGIBLE] o [DUDA] en ese apartado, baja la
  confianza: la decisión final es del profesor.
- Si la actividad NO se puntúa, devuelve "items": [] y no inventes ninguna
  puntuación: todo el valor va en el documento de corrección.
- Si la actividad es un foro, no hay fichero ni transcripción: valoras el texto
  que ha escrito el alumno (argumentación, uso de fuentes, diálogo con los
  compañeros), no su cálculo.
- Si descuentas puntos en un apartado, incluye una cita literal del alumno y su
  página. Si no puedes citar el error, no descuentes.

"aiLatex" es la corrección redactada como documento LaTeX completo y compilable
(\\documentclass … \\begin{document} … \\end{document}), en español y con coma
decimal. Es lo que el profesor edita y lo que se imprime como páginas de
feedback, así que se devuelve siempre, se puntúe o no la actividad.

La respuesta debe ajustarse al esquema estructurado indicado por la API.`;

const TRIAGE_SYSTEM = `Clasifica una intervención de foro sin usar contexto externo. Distingue errata, consulta administrativa, texto que no es una duda, duda sencilla y duda difícil. No respondas a la duda. Devuelve solo la salida estructurada.`;

const VERIFY_SYSTEM = `Audita una propuesta de corrección usando únicamente el trabajo transcrito y la propuesta. Comprueba coherencia entre citas, descuentos, puntuaciones, feedback y conclusión. No rehagas la corrección y no supongas criterios que no están presentes. Devuelve solo la salida estructurada.`;

// ── Proveedor ───────────────────────────────────────────────────────────────

export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';

  readonly #client: Anthropic;
  readonly #transcriptionModel: string;
  readonly #gradingModel: string;
  readonly #triageModel: string;
  readonly #verifyModel: string;
  readonly #maxTokens: number;
  readonly #systemPrompts: Readonly<Record<string, string>>;

  constructor(options: AnthropicAiProviderOptions = {}) {
    this.#client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    this.#transcriptionModel = options.transcriptionModel ?? DEFAULT_TRANSCRIPTION_MODEL;
    this.#gradingModel = options.gradingModel ?? DEFAULT_GRADING_MODEL;
    this.#triageModel = options.triageModel ?? DEFAULT_TRIAGE_MODEL;
    this.#verifyModel = options.verifyModel ?? DEFAULT_VERIFY_MODEL;
    this.#systemPrompts = options.systemPrompts ?? {};
    // El tope configurado manda; `MAX_TOKENS` es sólo el valor por defecto de
    // una instalación que aún no lo ha tocado.
    this.#maxTokens = options.maxTokens && options.maxTokens > 0 ? options.maxTokens : MAX_TOKENS;
  }

  /**
   * Bloques de sistema de una operación: primero las instrucciones globales
   * (`global.system`, si el administrador las ha escrito) y después las
   * específicas de la operación, que llevan el punto de caché porque son el
   * final del prefijo estable.
   */
  #systemBlocks(key: string, fallback: string): Anthropic.TextBlockParam[] {
    const blocks: Anthropic.TextBlockParam[] = [];
    const global = (this.#systemPrompts['global.system'] ?? '').trim();
    if (global !== '') blocks.push({ type: 'text', text: global });
    blocks.push({
      type: 'text',
      text: this.#systemPrompts[key] ?? fallback,
      cache_control: { type: 'ephemeral' },
    });
    return blocks;
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const attachments = await Promise.all(
      input.pages.map(async (page): Promise<Anthropic.ContentBlockParam[]> => [
        {
          type: 'text',
          text: `Bloque del original: páginas ${(page.pageNumbers ?? [page.page]).join(', ')}. Conserva esta numeración en la salida.`,
        },
        await toContentBlock(page),
      ]),
    );

    // Los números de página REALES del original, no cuántos bloques se mandan.
    // El PDF viaja troceado (`ai.pagesPerChunk`), así que `input.pages` son
    // bloques: pedir «transcribe las 2 páginas» de un examen de seis hacía que
    // el modelo devolviera dos entradas numeradas 1 y 1, y el ensamblado se
    // caía con «faltan [2,3,4,5,6], duplicadas [1]». La entrega moría después
    // de haber pagado las dos lecturas.
    const pageNumbers = input.pages.flatMap((page) => page.pageNumbers ?? [page.page]);

    const model = this.#transcriptionModel;
    // TODO(vega): sin verificar contra la API real — límites de tamaño de
    // petición (32 MB) y de páginas por PDF; un simulacro largo escaneado a
    // 300 ppp puede pasarse y habrá que trocearlo.
    const response = await withStopRetry(
      (maxTokens) =>
        this.#client.messages.parse({
        model,
        max_tokens: maxTokens,
        ...(supportsExtendedReasoning(model) ? { thinking: { type: 'adaptive' as const } } : {}),
        output_config: {
          ...(supportsExtendedReasoning(model) ? { effort: clampEffort(model, 'high') } : {}),
          format: zodOutputFormat(TranscriptionAnswer),
        },
        system: this.#systemBlocks('transcription.system', TRANSCRIPTION_SYSTEM),
        messages: [
          {
            role: 'user',
            content: [
              ...attachments.flat(),
              {
                type: 'text',
                text:
                  `Transcribe el examen completo: ${pageNumbers.length} ` +
                  `${pageNumbers.length === 1 ? 'página' : 'páginas'} repartidas en ` +
                  `${input.pages.length} ${input.pages.length === 1 ? 'bloque' : 'bloques'}. ` +
                  `Devuelve una entrada por página, numeradas ${pageNumbers.join(', ')} ` +
                  '—los números del original, no la posición dentro de su bloque—. ' +
                  `Referencia interna del alumno: ${input.studentRef}.`,
              },
            ],
          },
        ],
        }, { timeout: LONG_CALL_TIMEOUT_MS }),
      // Un examen entero de manuscrito pasado a LaTeX no cabe en topes
      // pequeños, y el razonamiento adaptativo consume del mismo presupuesto:
      // con 16k, seis páginas cortaban el JSON a mitad de una cadena. Se
      // garantiza un suelo alto aunque el ajuste de la instalación sea menor.
      Math.max(this.#maxTokens, TRANSCRIPTION_MIN_TOKENS),
      maxOutputFor(model),
    );

    const answer = response.parsed_output;
    if (answer === null) throw new AiResponseError('invalid_output', 'La transcripción no contiene una salida estructurada.');

    const pages: TranscriptionPage[] = answer.pages.map((page) => ({
      page: Math.max(1, Math.trunc(page.page)),
      latex: page.latex,
      imageUrl: `/api/submissions/${input.submissionId}/original`,
    }));
    const flags: TranscriptionFlag[] = answer.flags.map((flag) => ({
      ...flag,
      page: Math.max(1, Math.trunc(flag.page)),
    }));

    return {
      pages,
      flags,
      confidence: clamp01(answer.confidence),
      model: response.model,
      usage: toUsage(response.model, response.usage),
    };
  }

  async grade(input: GradeInput): Promise<GradeResult> {
    const originals = await Promise.all(input.document.map((page) => toContentBlock(page)));
    const allocation = input.pointsAllocation
      .map((entry) => `- ${entry.label} (${entry.maxPoints} puntos): ${entry.statement}`)
      .join('\n');

    // Una entrega llega transcrita; un foro llega como texto del alumno. Es la
    // única diferencia real entre corregir lo uno y lo otro.
    const work =
      input.transcription !== null
        ? `Transcripción del examen del alumno:\n\n${input.transcription.pages
            .map((page) => `% --- Página ${page.page} ---\n${page.latex}`)
            .join('\n\n')}\n\nCorrige apartado por apartado siguiendo el reparto de puntos.`
        : `Intervención del alumno en el foro:\n\n${input.textContent ?? '(sin texto)'}\n\n${
            input.graded
              ? 'Corrige apartado por apartado siguiendo el reparto de puntos.'
              : 'Actividad no puntuable: redacta el comentario cualitativo y devuelve "items": [].'
          }`;

    const scoring = input.graded
      ? `Reparto de puntos (nota máxima ${input.maxScore ?? 0}):\n${allocation}`
      : 'Esta actividad NO se puntúa: no devuelvas apartados ni nota.';

    // Los datos del alumno van con SU trabajo y no con el contexto de la
    // actividad. No es una cuestión de orden: el bloque de contexto lleva
    // `cache_control` y lo comparten todas las entregas de la actividad, así que
    // meter aquí un dato que cambia en cada entrega invalidaría la caché en
    // todas ellas y el ahorro desaparecería.
    const about = renderStudent(input.student);

    // El orden importa para el caché: instrucciones fijas → contexto de la actividad
    // (con el punto de caché) → transcripción, que cambia en cada entrega.
    // La clave del prompt la decide `gradePromptKey`, la misma regla que
    // registra el ledger: problema/tema según la plantilla, sencilla/experta
    // según la ruta del foro.
    const system: Anthropic.TextBlockParam[] = [
      ...this.#systemBlocks(gradePromptKey(input), GRADING_SYSTEM),
      ...input.context.map((segment) => ({
        type: 'text' as const,
        text: `## Contexto · ${segment.level} · ${segment.key}\n\n${segment.content}`,
        ...(segment.level === 'template' ? { cache_control: { type: 'ephemeral' as const } } : {}),
      })),
      ...(input.material.trim() === ''
        ? []
        : [{ type: 'text' as const, text: input.material }]),
      {
        type: 'text',
        text: scoring,
        cache_control: { type: 'ephemeral' },
      },
    ];

    const model = input.route === 'standard' ? this.#verifyModel : this.#gradingModel;
    // `xhigh` exige max_tokens ≥ 64k; si el modelo no lo admite se corrige con
    // `high`, que sigue siendo razonamiento extendido.
    const effort = clampEffort(model, 'xhigh');
    const response = await withStopRetry(
      (maxTokens) =>
        this.#client.messages.parse({
        model,
        max_tokens: maxTokens,
        ...(supportsExtendedReasoning(model) ? { thinking: { type: 'adaptive' as const } } : {}),
        output_config: {
          ...(supportsExtendedReasoning(model) ? { effort } : {}),
          format: zodOutputFormat(GradingAnswer),
        },
        system,
        messages: [{ role: 'user', content: [...originals, { type: 'text', text: `${about}AI_TEACHER_NOTES=${input.explanations === false ? 'false' : 'true'}\n\n${work}` }] }],
        }, { timeout: LONG_CALL_TIMEOUT_MS }),
      Math.max(this.#maxTokens, 32_000, minTokensFor(effort)),
      maxOutputFor(model),
    );

    const answer = response.parsed_output;
    if (answer === null) throw new AiResponseError('invalid_output', 'La corrección no contiene una salida estructurada.');

    // El máximo de cada apartado lo pone el profesor, no el modelo: lo
    // recuperamos del reparto en lugar de fiarnos de lo que devuelva la IA.
    const maxByLabel = new Map(input.pointsAllocation.map((entry) => [entry.label, entry.maxPoints]));
    const items: GradedItem[] = answer.items.map((item) => ({
      ...item,
      aiPoints: Math.max(0, item.aiPoints),
      aiQuotePage:
        item.aiQuotePage === null ? null : Math.max(1, Math.trunc(item.aiQuotePage)),
      confidence: clamp01(item.confidence),
      maxPoints: maxByLabel.get(item.label) ?? 0,
    }));

    return {
      items,
      aiLatex: answer.aiLatex,
      aiSummary: answer.aiSummary,
      teacherNotes: input.explanations === false ? null : answer.teacherNotes,
      confidence: clamp01(answer.confidence),
      model: response.model,
      usage: toUsage(response.model, response.usage),
      escalate: answer.escalate,
      noEsDuda: answer.noEsDuda,
    };
  }

  async triage(input: TriageInput): Promise<TriageResult> {
    // Sin `thinking` ni `effort` a propósito: el modelo de triaje por defecto
    // es Haiku 4.5, de una generación que responde 400 a ambos parámetros.
    const response = await withStopRetry(
      (maxTokens) => this.#client.messages.parse({
        model: this.#triageModel,
        max_tokens: maxTokens,
        output_config: { format: zodOutputFormat(TriageAnswer) },
        system: this.#systemBlocks('triage.system', TRIAGE_SYSTEM),
        messages: [{
          role: 'user',
          content: `Hilo previo:\n${input.thread.join('\n---\n') || '(vacío)'}\n\nMensaje nuevo:\n${input.message}`,
        }],
      }),
      1_000,
      maxOutputFor(this.#triageModel),
    );
    const answer = response.parsed_output;
    if (answer === null) throw new AiResponseError('invalid_output', 'El triaje no contiene una salida estructurada.');
    return {
      ...answer,
      confidence: clamp01(answer.confidence),
      model: response.model,
      usage: toUsage(response.model, response.usage),
    };
  }

  async verify(input: VerifyInput): Promise<VerifyResult> {
    const transcript = input.transcription?.pages
      .map((page) => `Página ${page.page}:\n${page.latex}`)
      .join('\n\n') ?? '(sin transcripción; intervención de foro)';
    const model = this.#verifyModel;
    const response = await withStopRetry(
      (maxTokens) => this.#client.messages.parse({
        model,
        max_tokens: maxTokens,
        ...(supportsExtendedReasoning(model) ? { thinking: { type: 'adaptive' as const } } : {}),
        output_config: {
          ...(supportsExtendedReasoning(model) ? { effort: clampEffort(model, 'high') } : {}),
          format: zodOutputFormat(VerificationAnswer),
        },
        system: this.#systemBlocks('verify.system', VERIFY_SYSTEM),
        messages: [{
          role: 'user',
          content: `Trabajo:\n${transcript}\n\nApartados propuestos:\n${JSON.stringify(input.items)}\n\nResumen:\n${input.aiSummary}\n\nDocumento de corrección:\n${input.aiLatex}`,
        }],
      }),
      Math.min(this.#maxTokens, 8_000),
      maxOutputFor(model),
    );
    const answer = response.parsed_output;
    if (answer === null) throw new AiResponseError('invalid_output', 'La verificación no contiene una salida estructurada.');
    return {
      ...answer,
      confidence: clamp01(answer.confidence),
      model: response.model,
      usage: toUsage(response.model, response.usage),
    };
  }

  /**
   * Prueba mínima de conexión: un mensaje de coste ínfimo que valida clave y
   * modelo. No activa thinking ni effort porque aquí sólo se comprueba que la
   * tubería responde, no se corrige nada. Nunca lanza:
   * un fallo de credencial se devuelve como `ok: false` con un mensaje accionable.
   */
  async verifyConnection(): Promise<VerifyConnectionResult> {
    try {
      const response = await this.#client.messages.create({
        model: this.#gradingModel,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Responde solo con: OK' }],
      });
      return {
        ok: true,
        message: `Conexión correcta con Anthropic. Modelo «${this.#gradingModel}» disponible.`,
        model: this.#gradingModel,
        usage: toUsage(this.#gradingModel, response.usage),
      };
    } catch (error) {
      return {
        ok: false,
        message: describeAnthropicError(error, this.#gradingModel),
        model: this.#gradingModel,
        usage: null,
      };
    }
  }
}

// ── Utilidades ──────────────────────────────────────────────────────────────

export type AiResponseErrorCode = 'refusal' | 'max_tokens' | 'invalid_output';

export class AiResponseError extends Error {
  constructor(readonly code: AiResponseErrorCode, message: string) {
    super(message);
    this.name = 'AiResponseError';
  }
}

/**
 * Reintenta UNA vez, y sólo cuando la respuesta se cortó por `max_tokens`.
 *
 * Un `refusal` no se reintenta jamás: repetir la misma petición tras un
 * rechazo no cambia el resultado y va contra la guía de uso de la API. Se
 * lanza directamente para que el ledger lo registre y el profesor lo vea.
 */
async function withStopRetry<T extends Anthropic.Message>(
  request: (maxTokens: number) => Promise<T>,
  initialMaxTokens: number,
  ceiling: number,
): Promise<T> {
  let maxTokens = Math.min(initialMaxTokens, ceiling);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ampliado = Math.min(Math.max(maxTokens * 2, 32_000), ceiling);
    let response: T;
    try {
      response = await request(maxTokens);
    } catch (error) {
      // El JSON llegó cortado: es el mismo caso que `stop_reason: max_tokens`,
      // sólo que el SDK revienta al parsear antes de que se pueda comprobar.
      if (attempt === 0 && isTruncatedOutput(error) && ampliado > maxTokens) {
        maxTokens = ampliado;
        continue;
      }
      if (isTruncatedOutput(error)) {
        throw new AiResponseError(
          'max_tokens',
          'La respuesta del modelo se ha cortado por el límite de salida, incluso tras ampliarlo. ' +
            'Suele pasar con entregas muy largas: baja «Páginas por bloque» en Ajustes para partirlas más.',
        );
      }
      throw error;
    }

    if (response.stop_reason === 'refusal') {
      throw new AiResponseError(
        'refusal',
        'El modelo ha rechazado esta petición. No se reintenta: revisa el contenido de la entrega y los prompts.',
      );
    }
    if (response.stop_reason !== 'max_tokens') {
      return response;
    }
    if (attempt === 0 && ampliado > maxTokens) {
      maxTokens = ampliado;
      continue;
    }
    throw new AiResponseError(
      'max_tokens',
      'El modelo ha agotado el límite de salida después de un reintento controlado.',
    );
  }
  throw new AiResponseError('invalid_output', 'La llamada no ha producido una respuesta.');
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Lee la página del disco si hace falta y la envuelve en el bloque adecuado. */
async function toContentBlock(page: PageSource): Promise<Anthropic.ContentBlockParam> {
  const bytes = page.bytes ?? (await readFile(page.path ?? ''));
  const data = Buffer.from(bytes).toString('base64');
  const mediaType = page.mediaType ?? 'application/pdf';

  if (mediaType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data },
    };
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data },
  };
}

/**
 * `input_tokens` sólo cuenta lo que NO venía de caché; los tokens leídos de
 * caché van en su propio campo y se facturan a ~0,1×. Sumarlos aquí inflaría el
 * coste, así que se guardan por separado.
 *
 * TODO(vega): sin verificar contra la API real — falta decidir dónde
 * contabilizar `cache_creation_input_tokens` (se factura a ~1,25×).
 */
function toUsage(model: string, usage: Anthropic.Usage) {
  const tokens = {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
  };
  return { ...tokens, costCents: estimateCostCents(model, tokens) };
}

/**
 * Traduce un fallo de la API de Anthropic a un mensaje accionable en español.
 * Los errores del SDK son tipados: los reconocemos por su clase, no por el texto.
 */
function describeAnthropicError(error: unknown, model: string): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'La clave de API de Anthropic no es válida. Revísala en Ajustes.';
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return `La clave no tiene permiso para usar el modelo «${model}».`;
  }
  if (error instanceof Anthropic.NotFoundError) {
    return `El modelo «${model}» no existe o no está disponible para esta clave.`;
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Anthropic ha limitado las peticiones. Espera unos segundos y reinténtalo.';
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'No se ha podido contactar con la API de Anthropic. Comprueba la conexión de red.';
  }
  return error instanceof Error
    ? error.message
    : 'No se ha podido probar la conexión con Anthropic.';
}

/**
 * La sección de alumno del mensaje, o cadena vacía si no hay nada que contar.
 *
 * Vacía y no un encabezado suelto: un «## Alumno» sin contenido gasta tokens y
 * le sugiere al modelo que hay información que se le ha ocultado.
 *
 * Lo que llega aquí ya viene recortado por `studentContextFor()`; este código no
 * decide qué se manda, sólo cómo se escribe.
 */
function renderStudent(student: GradeInput['student']): string {
  if (student === null) return '';

  const lines: string[] = [];
  if (student.name !== null) lines.push(`Alumno: ${student.name}`);
  if (student.community !== null) {
    // En plural cuando son varias: un opositor se presenta en más de una
    // comunidad y el criterio de corrección puede depender de todas.
    const varias = student.community.includes(',');
    lines.push(`Comunidad autónoma en la que se presenta${varias ? 'n' : ''}: ${student.community}`);
  }
  for (const field of student.fields) lines.push(`${field.label}: ${field.value}`);

  return `${lines.join('\n')}\n\n`;
}
