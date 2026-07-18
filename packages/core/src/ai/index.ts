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
    });
  }

  return new MockAiProvider(
    config.mockDelayMs !== undefined ? { delayMs: config.mockDelayMs } : {},
  );
}

export { MockAiProvider } from './mock.js';
export { AnthropicAiProvider, DEFAULT_GRADING_MODEL, DEFAULT_TRANSCRIPTION_MODEL } from './anthropic.js';
export * from './provider.js';
