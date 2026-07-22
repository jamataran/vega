import { AiProviderName } from './provider.js';
import type { AiProvider } from './provider.js';
import { MockAiProvider } from './mock.js';
import { AnthropicAiProvider } from './anthropic.js';

export interface AiProviderConfig {
  /** `AI_PROVIDER`. Si no llega, se usa el mock: en dev nunca gastamos tokens sin querer. */
  readonly provider?: string;
  readonly apiKey?: string;
  readonly transcriptionModel?: string;
  readonly gradingModel?: string;
  readonly triageModel?: string;
  readonly verifyModel?: string;
  /** Tope de tokens de respuesta del proveedor real. */
  readonly maxTokens?: number;
  /** Prompts activos leídos del registro versionado de la instalación. */
  readonly systemPrompts?: Readonly<Record<string, string>>;
  /** Sólo para el mock: retardo simulado por llamada. */
  readonly mockDelayMs?: number;
}

/**
 * Lee la configuración del entorno. Vive aquí para que ni el motor ni la CLI
 * tengan que saber cómo se llaman las variables.
 */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiProviderConfig {
  return {
    provider: env['AI_PROVIDER'],
    apiKey: env['ANTHROPIC_API_KEY'],
    transcriptionModel: env['AI_MODEL_TRANSCRIPTION'],
    gradingModel: env['AI_MODEL_GRADING'],
    triageModel: env['AI_MODEL_TRIAGE'],
    verifyModel: env['AI_MODEL_VERIFY'],
  };
}

export function createAiProvider(config: AiProviderConfig = {}): AiProvider {
  const parsed = AiProviderName.safeParse(config.provider ?? 'mock');
  if (!parsed.success) {
    throw new Error(
      `Proveedor de IA desconocido: "${config.provider ?? ''}". Valores admitidos: mock, anthropic.`,
    );
  }

  if (parsed.data === 'anthropic') {
    if (config.apiKey === undefined || config.apiKey === '') {
      throw new Error(
        'Falta ANTHROPIC_API_KEY. Configúrala o usa AI_PROVIDER=mock para trabajar sin coste.',
      );
    }
    return new AnthropicAiProvider({
      apiKey: config.apiKey,
      ...(config.transcriptionModel !== undefined
        ? { transcriptionModel: config.transcriptionModel }
        : {}),
      ...(config.gradingModel !== undefined ? { gradingModel: config.gradingModel } : {}),
      ...(config.triageModel !== undefined ? { triageModel: config.triageModel } : {}),
      ...(config.verifyModel !== undefined ? { verifyModel: config.verifyModel } : {}),
      ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
      ...(config.systemPrompts !== undefined ? { systemPrompts: config.systemPrompts } : {}),
    });
  }

  return new MockAiProvider({
    ...(config.mockDelayMs !== undefined ? { delayMs: config.mockDelayMs } : {}),
    ...(config.systemPrompts !== undefined
      ? { promptSalt: Object.entries(config.systemPrompts).sort().flat().join('\n') }
      : {}),
  });
}

export { MockAiProvider } from './mock.js';
export {
  AnthropicAiProvider,
  DEFAULT_GRADING_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  DEFAULT_TRIAGE_MODEL,
  DEFAULT_VERIFY_MODEL,
} from './anthropic.js';
export * from '../grading/verification.js';
export * from './provider.js';
