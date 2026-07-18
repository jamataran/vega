import { Link } from 'react-router-dom';
import { ACTIVITY_KIND_LABEL } from '@vega/shared';
import type { QueueItem } from '@vega/shared';
import { cn } from '@/lib/cn';
import { formatRelativeTime, formatScore } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { LOW_CONFIDENCE } from '@/components/common/status';

/**
 * Prioridad de la fila. El espinazo de color es el único adorno de la lista y
 * dice exactamente una cosa: cuánto te reclama esta entrega. Nunca va solo —
 * las etiquetas de debajo explican con texto lo mismo que insinúa el color.
 */
function spineClass(item: QueueItem): string {
  if (item.submission.status === 'error') return 'bg-destructive';
  if (needsAttention(item)) return 'bg-warning';
  if (item.submission.status === 'validated') return 'bg-success';
  return 'bg-border-strong';
}

function needsAttention(item: QueueItem): boolean {
  return (
    (item.confidence !== null && item.confidence < LOW_CONFIDENCE) ||
    item.flagCount > 0 ||
    item.lowConfidenceItems > 0
  );
}

function plural(count: number, singular: string, plural_: string): string {
  return `${count} ${count === 1 ? singular : plural_}`;
}

export function QueueRow({ item }: { item: QueueItem }) {
  const { submission, activity } = item;
  const name = submission.studentAlias ?? submission.studentRef;
  // Una actividad no puntuable no enseña nota: no hay nada que enseñar, ni un
  // guion sobre diez que sugiera que falta algo.
  const showsScore = activity.graded && item.score !== null && item.maxScore !== null;

  return (
    <li>
      <Link
        to={`/entrega/${submission.id}`}
        className="relative flex gap-3 rounded-md border border-border bg-card py-3 pl-4 pr-3 transition-colors hover:border-border-strong"
      >
        <span
          aria-hidden="true"
          className={cn('absolute inset-y-2 left-0 w-0.5 rounded-full', spineClass(item))}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-base font-medium">
              {name}
              {submission.studentAlias === null ? (
                <span className="sr-only"> (referencia interna, sin alias)</span>
              ) : null}
            </p>
            {showsScore && item.score !== null && item.maxScore !== null ? (
              <p className="shrink-0 font-display text-base font-semibold">
                {formatScore(item.score)}
                <span className="text-muted-foreground"> / {formatScore(item.maxScore)}</span>
              </p>
            ) : activity.graded ? (
              <p className="shrink-0 text-ui text-muted-foreground">Sin corregir</p>
            ) : null}
          </div>

          <p className="mt-0.5 truncate text-ui text-muted-foreground">
            {activity.name}
            <span className="px-1.5 text-border-strong">·</span>
            {ACTIVITY_KIND_LABEL[activity.kind]}
            <span className="px-1.5 text-border-strong">·</span>
            {formatRelativeTime(submission.submittedAt)}
          </p>

          {submission.status === 'error' && submission.errorMessage ? (
            <p className="mt-2 line-clamp-2 text-ui text-destructive-ink">
              {submission.errorMessage}
            </p>
          ) : (
            <AttentionSignals item={item} />
          )}
        </div>
      </Link>
    </li>
  );
}

function AttentionSignals({ item }: { item: QueueItem }) {
  const lowConfidence = item.confidence !== null && item.confidence < LOW_CONFIDENCE;
  if (!lowConfidence && item.flagCount === 0 && item.lowConfidenceItems === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {lowConfidence && item.confidence !== null ? (
        <li>
          <Badge variant="warning" title="La IA no está segura de esta corrección">
            Confianza {Math.round(item.confidence * 100)} %
          </Badge>
        </li>
      ) : null}
      {item.flagCount > 0 ? (
        <li>
          <Badge variant="warning" title="Marcas [ILEGIBLE] o [DUDA] en la transcripción">
            {plural(item.flagCount, 'marca', 'marcas')}
          </Badge>
        </li>
      ) : null}
      {item.lowConfidenceItems > 0 ? (
        <li>
          <Badge title="Apartados que la IA marca con baja confianza">
            {plural(item.lowConfidenceItems, 'apartado dudoso', 'apartados dudosos')}
          </Badge>
        </li>
      ) : null}
    </ul>
  );
}

export function QueueRowSkeleton() {
  return (
    <li className="rounded-md border border-border bg-card py-3 pl-4 pr-3">
      <div className="flex items-baseline justify-between gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="mt-2.5 h-3 w-48" />
      <Skeleton className="mt-3 h-4 w-24" />
    </li>
  );
}
