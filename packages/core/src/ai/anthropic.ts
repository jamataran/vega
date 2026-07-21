import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { TranscriptionFlagKind } from '@vega/shared';
import type { TranscriptionFlag, TranscriptionPage } from '@vega/shared';
import { estimateCostCents } from '../cost/pricing.js';
import type {
  AiProvider,
  GradedItem,
  GradeInput,
  GradeResult,
  PageSource,
  TranscribeInput,
  TranscribeResult,
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

/** Sin streaming el SDK corta por timeout mucho antes de 128k. */
const MAX_TOKENS = 16_000;

export interface AnthropicAiProviderOptions {
  readonly apiKey?: string;
  readonly transcriptionModel?: string;
  readonly gradingModel?: string;
  /** Tope de tokens de respuesta. Lo fija el administrador en Ajustes. */
  readonly maxTokens?: number;
  /** Inyectable para poder testear sin red. */
  readonly client?: Anthropic;
}

// ── Respuestas esperadas del modelo ─────────────────────────────────────────

const TranscriptionAnswer = z.object({
  pages: z.array(
    z.object({
      page: z.number().int().positive(),
      latex: z.string(),
    }),
  ),
  flags: z
    .array(
      z.object({
        kind: TranscriptionFlagKind,
        page: z.number().int().positive(),
        excerpt: z.string(),
        note: z.string(),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(1),
});

const GradingAnswer = z.object({
  /** Vacío cuando la actividad no se puntúa. */
  items: z
    .array(
      z.object({
        label: z.string().min(1),
        aiPoints: z.number().min(0),
        aiFeedback: z.string(),
        confidence: z.number().min(0).max(1),
        alternativeMethod: z.boolean(),
      }),
    )
    .default([]),
  aiLatex: z.string(),
  aiSummary: z.string(),
  confidence: z.number().min(0).max(1),
});

// ── Prompts ─────────────────────────────────────────────────────────────────

const TRANSCRIPTION_SYSTEM = `Eres un transcriptor de exámenes de matemáticas manuscritos.

Transcribe ÍNTEGRAMENTE el desarrollo del alumno, respetando su orden y sus
errores: no corrijas, no completes y no reordenes nada.

Formato de \`latex\` (lo pinta KaTeX, que no compone documentos enteros):
- Texto normal en Markdown y cada fórmula delimitada entre $$ ... $$.
- Una fórmula por línea del desarrollo, separadas por una línea en blanco.
- Si un fragmento no se lee, marca [ILEGIBLE]; si admite dos lecturas, [DUDA] y
  elige la más coherente con el paso siguiente. Las marcas van FUERA de los $$:
  dentro, KaTeX las interpretaría como matemáticas.

Responde exclusivamente con un objeto JSON con esta forma:
{"pages":[{"page":1,"latex":"..."}],"flags":[{"kind":"ILEGIBLE","page":1,"excerpt":"...","note":"..."}],"confidence":0.0}`;

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

"aiLatex" es la corrección redactada como documento LaTeX completo y compilable
(\\documentclass … \\begin{document} … \\end{document}), en español y con coma
decimal. Es lo que el profesor edita y lo que se imprime como páginas de
feedback, así que se devuelve siempre, se puntúe o no la actividad.

Responde exclusivamente con un objeto JSON con esta forma:
{"items":[{"label":"1a","aiPoints":0,"aiFeedback":"...","confidence":0.0,"alternativeMethod":false}],"aiLatex":"...","aiSummary":"...","confidence":0.0}`;

// ── Proveedor ───────────────────────────────────────────────────────────────

export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';

  readonly #client: Anthropic;
  readonly #transcriptionModel: string;
  readonly #gradingModel: string;
  readonly #maxTokens: number;

  constructor(options: AnthropicAiProviderOptions = {}) {
    this.#client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    this.#transcriptionModel = options.transcriptionModel ?? DEFAULT_TRANSCRIPTION_MODEL;
    this.#gradingModel = options.gradingModel ?? DEFAULT_GRADING_MODEL;
    // El tope configurado manda; `MAX_TOKENS` es sólo el valor por defecto de
    // una instalación que aún no lo ha tocado.
    this.#maxTokens = options.maxTokens && options.maxTokens > 0 ? options.maxTokens : MAX_TOKENS;
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const attachments = await Promise.all(input.pages.map((page) => toContentBlock(page)));

    // TODO(vega): sin verificar contra la API real — límites de tamaño de
    // petición (32 MB) y de páginas por PDF; un simulacro largo escaneado a
    // 300 ppp puede pasarse y habrá que trocearlo.
    const response = await this.#client.messages.create(
      buildParams({
        model: this.#transcriptionModel,
        max_tokens: this.#maxTokens,
        system: [{ type: 'text', text: TRANSCRIPTION_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: [
              ...attachments,
              {
                type: 'text',
                text: `Transcribe las ${input.pages.length} páginas del examen (referencia interna del alumno: ${input.studentRef}).`,
              },
            ],
          },
        ],
      }),
    );

    const answer = TranscriptionAnswer.parse(JSON.parse(extractText(response)));

    const pages: TranscriptionPage[] = answer.pages.map((page) => ({
      page: page.page,
      latex: page.latex,
      imageUrl: `/api/scans/${input.submissionId}/${page.page}.svg`,
    }));
    const flags: TranscriptionFlag[] = answer.flags.map((flag) => ({ ...flag }));

    return {
      pages,
      flags,
      confidence: answer.confidence,
      model: this.#transcriptionModel,
      usage: toUsage(this.#transcriptionModel, response.usage),
    };
  }

  async grade(input: GradeInput): Promise<GradeResult> {
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

    // El orden importa para el caché: instrucciones fijas → contexto de la actividad
    // (con el punto de caché) → transcripción, que cambia en cada entrega.
    const response = await this.#client.messages.create(
      buildParams({
        model: this.#gradingModel,
        max_tokens: this.#maxTokens,
        system: [
          { type: 'text', text: GRADING_SYSTEM },
          {
            type: 'text',
            text: `Contexto de corrección de esta actividad:\n\n${input.context}\n\n${scoring}`,
            // TODO(vega): sin verificar contra la API real — hay que comprobar
            // que `usage.cache_read_input_tokens > 0` a partir de la segunda
            // entrega de la misma actividad. Por debajo de ~1024 tokens el prefijo no
            // se cachea y el ahorro no aparece.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: [{ type: 'text', text: work }] }],
      }),
    );

    const answer = GradingAnswer.parse(JSON.parse(extractText(response)));

    // El máximo de cada apartado lo pone el profesor, no el modelo: lo
    // recuperamos del reparto en lugar de fiarnos de lo que devuelva la IA.
    const maxByLabel = new Map(input.pointsAllocation.map((entry) => [entry.label, entry.maxPoints]));
    const items: GradedItem[] = answer.items.map((item) => ({
      ...item,
      maxPoints: maxByLabel.get(item.label) ?? 0,
    }));

    return {
      items,
      aiLatex: answer.aiLatex,
      aiSummary: answer.aiSummary,
      confidence: answer.confidence,
      model: this.#gradingModel,
      usage: toUsage(this.#gradingModel, response.usage),
    };
  }

  /**
   * Prueba mínima de conexión: un mensaje de coste ínfimo que valida clave y
   * modelo. NO usa `buildParams` a propósito —ni thinking ni effort— porque aquí
   * sólo se comprueba que la tubería responde, no se corrige nada. Nunca lanza:
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

/**
 * `thinking: {type:"adaptive"}` y `output_config.effort` son parámetros más
 * nuevos que los tipos del SDK fijado en el package.json. Los añadimos en un
 * único punto, en vez de repartir conversiones de tipo por todo el fichero.
 *
 * TODO(vega): sin verificar contra la API real — al subir el SDK habrá que
 * quitar esta función y pasar los parámetros directamente.
 */
function buildParams(
  base: Anthropic.MessageCreateParamsNonStreaming,
): Anthropic.MessageCreateParamsNonStreaming {
  const extra: Record<string, unknown> = {
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
  };
  return { ...base, ...extra } as Anthropic.MessageCreateParamsNonStreaming;
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
 * Concatena los bloques de texto de la respuesta. Se comprueba antes
 * `stop_reason`: en `refusal` el contenido puede venir vacío y leerlo a ciegas
 * revienta con un error que no dice nada.
 */
function extractText(response: Anthropic.Message): string {
  if (response.stop_reason === 'refusal') {
    throw new Error('El modelo ha rechazado la petición; revisa el contenido de la entrega.');
  }
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (text.trim() === '') {
    throw new Error('La respuesta del modelo no contiene texto.');
  }
  return text;
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
