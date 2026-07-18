import { useQuery } from '@tanstack/react-query';
import { SUBMISSION_STATUS_LABEL, SubmissionStatus } from '@vega/shared';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import {
  formatDateTime,
  formatDelta,
  formatEurosFromCents,
  formatInteger,
  formatPercent,
  formatPreciseEurosFromCents,
  formatTokens,
} from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, PageHeader, Section } from '@/components/common/Feedback';

/**
 * Cifra tipografiada. Descartamos las gráficas a propósito: con seis métricas
 * escalares y una lista de ocho estados, un número bien puesto se lee más
 * rápido en un móvil que cualquier barra.
 */
function Figure({
  label,
  value,
  note,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="eyebrow">{label}</p>
      <p className="mt-1.5 font-display text-title font-semibold leading-none">{value}</p>
      {note ? <p className="mt-1.5 text-ui text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function OverviewPage() {
  const query = useQuery({
    queryKey: queryKeys.overview,
    queryFn: ({ signal }) => api.overview(signal),
  });

  if (query.isError) {
    return (
      <>
        <PageHeader eyebrow="Métricas" title="Panel" />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    );
  }

  if (!query.data) {
    return (
      <>
        <PageHeader eyebrow="Métricas" title="Panel" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </>
    );
  }

  const data = query.data;
  const { usageThisMonth: usage } = data;
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const cacheRatio = usage.inputTokens > 0 ? usage.cachedInputTokens / usage.inputTokens : 0;

  return (
    <div>
      <PageHeader eyebrow="Métricas" title="Panel">
        Lo que se ha corregido este mes y lo que ha costado.
      </PageHeader>

      <div className="flex flex-col gap-3">
        <Section title="Corrección">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <Figure
              label="Corregidas · 30 días"
              value={formatInteger(data.gradedLast30Days)}
              note="Entregas con corrección de la IA"
            />
            <Figure
              label="Desviación media"
              value={`${formatDelta(data.avgTeacherDeviation)} pts`}
              note={
                data.avgTeacherDeviation === 0
                  ? 'La IA y tú coincidís'
                  : data.avgTeacherDeviation > 0
                    ? 'De media, subes la nota de la IA'
                    : 'De media, bajas la nota de la IA'
              }
            />
            {/* La métrica que decide cuándo una actividad aguanta más autonomía. */}
            <Figure
              className="col-span-2"
              label="Validadas sin tocar"
              value={formatPercent(data.untouchedRatio)}
              note={
                data.untouchedRatio >= 0.9
                  ? 'Casi nunca cambias la propuesta: esta es la señal para dar más autonomía a una actividad.'
                  : data.untouchedRatio >= 0.6
                    ? 'Sueles aceptar la propuesta, pero todavía intervienes en una de cada tres.'
                    : 'Intervienes a menudo: conviene afinar el contexto antes de dar autonomía.'
              }
            />
          </div>
        </Section>

        <Section title="Coste del mes">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <Figure
              label="Gasto"
              value={formatEurosFromCents(usage.costCents)}
              note={`${formatTokens(totalTokens)} tokens`}
            />
            <Figure
              label="Por corrección"
              value={formatPreciseEurosFromCents(data.avgCostCentsPerCorrection)}
              note="Media del mes"
            />
            <Figure
              label="Tokens de entrada"
              value={formatTokens(usage.inputTokens)}
              note={`${Math.round(cacheRatio * 100)} % desde la caché`}
            />
            <Figure label="Tokens de salida" value={formatTokens(usage.outputTokens)} />
          </div>
        </Section>

        <Section title="Cola por estado">
          <dl className="divide-y divide-border">
            {SubmissionStatus.options.map((status) => {
              const count = data.counts[status] ?? 0;
              return (
                <div key={status} className="flex items-baseline justify-between gap-4 py-2">
                  <dt className={cn('text-base', count === 0 && 'text-muted-foreground')}>
                    {SUBMISSION_STATUS_LABEL[status]}
                  </dt>
                  <dd
                    className={cn(
                      'font-display text-base font-semibold',
                      count === 0 && 'font-normal text-muted-foreground',
                      status === 'graded' && count > 0 && 'text-primary-ink',
                    )}
                  >
                    {formatInteger(count)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Section>

        <Section title="Último proceso">
          {data.lastBatchRun ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    data.lastBatchRun.status === 'done'
                      ? 'success'
                      : data.lastBatchRun.status === 'failed'
                        ? 'destructive'
                        : 'info'
                  }
                >
                  {data.lastBatchRun.status === 'done'
                    ? 'Terminado'
                    : data.lastBatchRun.status === 'failed'
                      ? 'Fallido'
                      : 'En curso'}
                </Badge>
                <span className="text-ui text-muted-foreground">
                  {formatDateTime(data.lastBatchRun.startedAt)}
                  {data.lastBatchRun.finishedAt
                    ? ` → ${formatDateTime(data.lastBatchRun.finishedAt)}`
                    : ''}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Figure
                  label="Procesadas"
                  value={formatInteger(data.lastBatchRun.submissionsProcessed)}
                />
                <Figure
                  label="Autopublicadas"
                  value={formatInteger(data.lastBatchRun.submissionsAutoPublished)}
                />
                <Figure
                  label="Fallidas"
                  value={formatInteger(data.lastBatchRun.submissionsFailed)}
                />
                <Figure
                  label="Coste"
                  value={formatEurosFromCents(data.lastBatchRun.usage.costCents)}
                />
              </div>
            </div>
          ) : (
            <p className="text-base text-muted-foreground">
              Todavía no se ha ejecutado ningún proceso.
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
