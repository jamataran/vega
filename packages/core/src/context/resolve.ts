import { CONTEXT_LEVEL_LABEL } from '@vega/shared';
import type { ActivityFile, ContextLevel, ResolvedContextResponse } from '@vega/shared';

/**
 * Resolución del contexto de corrección a tres niveles.
 *
 * El orden global → tipo de actividad → actividad no es estético: es el orden
 * de especificidad, y también el que aprovecha el prompt caching. Lo que menos
 * cambia va primero, de modo que el prefijo compartido entre entregas de la
 * misma actividad sea lo más largo posible.
 */

export interface ResolveContextInput {
  /** Instrucciones comunes a toda la academia. */
  readonly global?: string | null;
  /** Instrucciones del tipo de actividad: no se corrige igual una entrega que un foro. */
  readonly activityKind?: string | null;
  /** Solución de referencia e indicaciones de la actividad concreta. */
  readonly activity?: string | null;
  /** Ficheros que acompañan al contexto de la actividad. Puede llegar vacío. */
  readonly files?: readonly ActivityFile[];
}

/** Separador entre niveles: dos saltos para que el Markdown respire. */
const SEPARATOR = '\n\n';

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function section(level: ContextLevel, body: string): string {
  return `## ${CONTEXT_LEVEL_LABEL[level]}${SEPARATOR}${body}`;
}

/**
 * Devuelve los tres niveles por separado (para que la UI pueda mostrarlos) y el
 * texto ya montado que se manda al modelo. Los niveles vacíos no generan
 * cabecera: una sección con título y sin contenido sólo gasta tokens.
 */
export function resolveContext(input: ResolveContextInput): ResolvedContextResponse {
  const global = clean(input.global);
  const activityKind = clean(input.activityKind);
  const activity = clean(input.activity);

  const parts: string[] = [];
  if (global !== '') parts.push(section('global', global));
  if (activityKind !== '') parts.push(section('activity_kind', activityKind));
  if (activity !== '') parts.push(section('activity', activity));

  return {
    global,
    activityKind,
    activity,
    merged: parts.join(SEPARATOR),
    files: [...(input.files ?? [])],
  };
}
