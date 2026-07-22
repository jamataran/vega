import { createAiProvider } from '@vega/core';
import type { AiProvider } from '@vega/core';
import { getSettings, readSecret } from '../settings/service.js';
import type { AppContext } from '../context.js';

/**
 * Construcción del proveedor de IA de la instalación.
 *
 * Simétrico a `lms/factory.ts`: **`app_settings` manda sobre el `.env`**. El
 * proveedor, los modelos y la clave se leen de la configuración que el
 * administrador edita en la web, y sólo si faltan se cae al fichero de entorno,
 * que es el valor de arranque de una instalación nueva.
 *
 * Esto cierra un hueco real: hasta ahora la clave que se pegaba en Ajustes se
 * guardaba en `app_settings` y **no la leía nadie** —el lote la tomaba del
 * `.env`—, así que configurar el proveedor por la interfaz no tenía efecto.
 *
 * La clave es un secreto: se lee con `readSecret`, que no pasa por el mapeador y
 * nunca cruza la frontera HTTP.
 */
export async function aiProviderForInstall(ctx: AppContext): Promise<AiProvider> {
  const settings = await getSettings(ctx);
  const apiKey = (await readSecret(ctx, 'anthropic.apiKey')) ?? ctx.config.ANTHROPIC_API_KEY;

  return createAiProvider({
    provider: settings.anthropic.provider,
    ...(apiKey ? { apiKey } : {}),
    transcriptionModel: settings.anthropic.transcriptionModel,
    gradingModel: settings.anthropic.gradingModel,
    maxTokens: settings.anthropic.maxTokens,
  });
}
