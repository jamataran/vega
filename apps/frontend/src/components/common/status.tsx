import {
  ACTIVITY_KIND_LABEL,
  AUTONOMY_MODE_LABEL,
  LOW_CONFIDENCE_THRESHOLD,
  SUBMISSION_STATUS_LABEL,
} from '@vega/shared';
import type { ActivityKind, AutonomyMode, SubmissionStatus } from '@vega/shared';
import { Badge } from '@/components/ui/badge';
import type { BadgeProps } from '@/components/ui/badge';

type StatusVariant = NonNullable<BadgeProps['variant']>;

/**
 * Variante por estado. `graded` es el único que le pide algo al profesor ahora
 * mismo, así que es el único que lleva el color de marca; el resto son neutros
 * o conservan su semántica de estado.
 */
export const STATUS_VARIANT: Record<SubmissionStatus, StatusVariant> = {
  pending: 'default',
  transcribing: 'default',
  transcribed: 'default',
  grading: 'default',
  graded: 'primary',
  parked: 'warning',
  validated: 'success',
  published: 'quiet',
  error: 'destructive',
};

export function StatusBadge({
  status,
  className,
}: {
  status: SubmissionStatus;
  className?: string;
}) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={className}>
      {SUBMISSION_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Entrega o foro. Neutro: es una clasificación, no un aviso. */
export function ActivityKindBadge({ kind }: { kind: ActivityKind }) {
  return <Badge variant="outline">{ACTIVITY_KIND_LABEL[kind]}</Badge>;
}

/**
 * Variante por modo de autonomía. `autonomous` publica sin que nadie mire, y
 * eso merece destacarse: es la única configuración en la que el profesor deja
 * de estar en el circuito.
 */
const AUTONOMY_VARIANT: Record<AutonomyMode, StatusVariant> = {
  review_all: 'default',
  review_low_confidence: 'info',
  autonomous: 'warning',
};

export function AutonomyBadge({ mode }: { mode: AutonomyMode }) {
  return <Badge variant={AUTONOMY_VARIANT[mode]}>{AUTONOMY_MODE_LABEL[mode]}</Badge>;
}

/** Umbral del contrato: por debajo de 0,75 la transcripción o la corrección se señala. */
export const LOW_CONFIDENCE = LOW_CONFIDENCE_THRESHOLD;

/**
 * La confianza no se comunica sólo con color: la etiqueta lleva siempre el
 * porcentaje y, cuando es baja, la palabra que lo explica.
 */
export function ConfidenceBadge({ value, label }: { value: number; label?: string }) {
  const percent = Math.round(value * 100);
  const low = value < LOW_CONFIDENCE;
  return (
    <Badge
      variant={low ? 'warning' : 'default'}
      title={`Confianza de la IA: ${percent} %`}
    >
      {label ? `${label} ` : ''}
      {percent} %{low ? ' · baja' : ''}
    </Badge>
  );
}
