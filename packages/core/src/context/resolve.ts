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
  /**
   * Solución de referencia del profesor, o material asociado si la actividad no
   * se puntúa. Va **al final y en su propia sección**: es lo más concreto y lo
   * que más cambia entre actividades, así que ponerlo antes acortaría el
   * prefijo cacheable sin ganar nada.
   */
  readonly referenceSolution?: string | null;
  /** Si la actividad se puntúa, para rotular la sección anterior como toca. */
  readonly graded?: boolean;
  /**
   * Contenido de los ficheros de texto adjuntos (`.tex`, `.md`): el enunciado,
   * el material sobre el que preguntan los alumnos. Se envían enteros porque
   * son la referencia contra la que Vega juzga lo que escribe el alumno.
   */
  readonly fileContents?: readonly { readonly filename: string; readonly content: string }[];
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

  // En una actividad no puntuable no hay solución que contrastar: lo que el
  // profesor sube es el material sobre el que preguntan los alumnos. Es el
  // mismo campo con dos usos, y llamarlo por su nombre evita que el modelo lo
  // trate como plantilla de respuesta correcta en un foro de dudas.
  const reference = clean(input.referenceSolution);
  if (reference !== '') {
    const title = input.graded === false ? 'Material asociado' : 'Solución de referencia';
    parts.push(`## ${title}${SEPARATOR}${reference}`);
  }

  for (const file of input.fileContents ?? []) {
    const body = clean(file.content);
    if (body === '') continue;
    parts.push(`## Material adjunto · ${file.filename}${SEPARATOR}${body}`);
  }

  return {
    global,
    activityKind,
    activity,
    merged: parts.join(SEPARATOR),
    files: [...(input.files ?? [])],
  };
}
