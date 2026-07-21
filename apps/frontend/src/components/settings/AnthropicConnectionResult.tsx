import { CheckCircle2, XCircle } from 'lucide-react';
import type { AnthropicConnectionResponse } from '@vega/shared';

/**
 * Resultado de probar la conexión con Anthropic.
 *
 * Espejo de `MoodleConnectionResult`, más simple: aquí no hay funciones que
 * listar, sólo si la llamada respondió. Un fallo de credencial llega con
 * `ok: false` y su mensaje, en el mismo sitio donde el administrador acaba de
 * pegar la clave.
 */
export function AnthropicConnectionResult({ result }: { result: AnthropicConnectionResponse }) {
  const tokens = result.usage ? result.usage.inputTokens + result.usage.outputTokens : null;

  return (
    <div className="rounded-md border border-border px-3 py-2.5" aria-live="polite">
      <div className="flex items-start gap-2">
        {result.ok ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-ink" aria-hidden="true" />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive-ink" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-base">{result.message}</p>
          {result.model ? (
            <p className="mt-0.5 text-ui text-muted-foreground">
              <code className="select-all break-all font-mono text-[0.9em]">{result.model}</code>
              {tokens !== null ? ` · ${tokens} tokens en la prueba` : null}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
