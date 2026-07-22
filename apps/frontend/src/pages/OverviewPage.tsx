import { useQuery } from '@tanstack/react-query';
import { SUBMISSION_STATUS_LABEL, SubmissionStatus } from '@vega/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { queryKeys } from '@/lib/queryKeys';
import {
  formatDateTime,
  formatDelta,
  formatEurosFromCents,
  formatInteger,
  formatPercent,
} from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, PageHeader, Section } from '@/components/common/Feedback';
import { Figure } from '@/components/common/Figure';
import { CostBreakdown } from '@/components/overview/CostBreakdown';

export function OverviewPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

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

  return (
    <div>
      <PageHeader eyebrow="Métricas" title="Panel">
        Estado de la cola y en qué se va el gasto del periodo.
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

        <Section
          title="Fiabilidad"
          description="Señales calculadas sobre citas, lecturas, verificación y cambios docentes."
          actions={
            <Badge variant={data.aiMode === 'real' ? 'success' : data.aiMode === 'none' ? 'outline' : 'warning'}>
              {data.aiMode === 'real' ? 'IA real' : data.aiMode === 'simulated' ? 'Modo simulado' : data.aiMode === 'mixed' ? 'Datos mixtos' : 'Sin llamadas'}
            </Badge>
          }
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <Figure label="Índice compuesto" value={formatPercent(data.reliability.score)} />
            <Figure label="Citas presentes" value={formatPercent(data.reliability.citationsVerified)} />
            <Figure label="Lecturas coincidentes" value={formatPercent(data.reliability.readingsWithoutDiscrepancy)} />
            <Figure label="Sin avisos al verificar" value={formatPercent(data.reliability.verificationsWithoutIssues)} />
          </div>
          {data.unpricedCalls > 0 ? (
            <p role="alert" className="mt-4 text-ui text-warning-ink">
              {data.unpricedCalls} {data.unpricedCalls === 1 ? 'llamada no tiene' : 'llamadas no tienen'} una tarifa conocida. No se muestran como coste cero.
            </p>
          ) : null}
        </Section>

        <CostBreakdown />

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

        {/*
          El último proceso es una ejecución del sistema entera y sus cifras son
          las de todo el claustro, así que el API sólo lo devuelve a
          administración. Para el resto la sección no se pinta: enseñarla vacía
          diría «no se ha ejecutado nada», que es falso.
        */}
        {isAdmin ? (
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
        ) : null}
      </div>
    </div>
  );
}
