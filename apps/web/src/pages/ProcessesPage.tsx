import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Play, User as UserIcon } from 'lucide-react';
import type { BatchRun } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { formatDateTime, formatEurosFromCents, formatInteger, formatRelativeTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/Feedback';

const RUN_STATUS_LABEL: Record<BatchRun['status'], string> = {
  running: 'En curso',
  done: 'Terminado',
  failed: 'Fallido',
};

const RUN_STATUS_VARIANT: Record<BatchRun['status'], 'info' | 'success' | 'destructive'> = {
  running: 'info',
  done: 'success',
  failed: 'destructive',
};

/** Duración de un proceso ya cerrado, en la unidad que se lee de un vistazo. */
function duration(run: BatchRun): string | null {
  if (!run.finishedAt) return null;
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function Figure({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p
        className={
          emphasis
            ? 'mt-1 font-display text-base font-semibold text-warning-ink'
            : 'mt-1 font-display text-base font-semibold'
        }
      >
        {value}
      </p>
    </div>
  );
}

function RunCard({ run }: { run: BatchRun }) {
  const scheduled = run.triggeredBy === null;
  const elapsed = duration(run);

  return (
    <Card asChild>
      <li className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* El origen no se comunica sólo con el icono: lleva su texto. */}
          <Badge variant={scheduled ? 'default' : 'primary'}>
            {scheduled ? (
              <Clock className="size-3" aria-hidden="true" />
            ) : (
              <UserIcon className="size-3" aria-hidden="true" />
            )}
            {scheduled ? 'Planificador' : 'Forzado a mano'}
          </Badge>
          <Badge variant={RUN_STATUS_VARIANT[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
          <span className="text-ui text-muted-foreground">
            {formatDateTime(run.startedAt)}
            <span className="px-1.5 text-border-strong">·</span>
            {formatRelativeTime(run.startedAt)}
            {elapsed ? (
              <>
                <span className="px-1.5 text-border-strong">·</span>
                {elapsed}
              </>
            ) : null}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Figure label="Procesadas" value={formatInteger(run.submissionsProcessed)} />
          <Figure
            label="Autopublicadas"
            value={formatInteger(run.submissionsAutoPublished)}
            emphasis={run.submissionsAutoPublished > 0}
          />
          <Figure label="Fallidas" value={formatInteger(run.submissionsFailed)} />
          <Figure label="Coste" value={formatEurosFromCents(run.usage.costCents)} />
        </div>

        {run.submissionsAutoPublished > 0 ? (
          <p className="mt-3 text-ui text-muted-foreground">
            {run.submissionsAutoPublished === 1
              ? 'Una corrección se publicó sin revisión, por el modo de autonomía de su actividad.'
              : `${formatInteger(run.submissionsAutoPublished)} correcciones se publicaron sin revisión, por el modo de autonomía de sus actividades.`}
          </p>
        ) : null}
      </li>
    </Card>
  );
}

export function ProcessesPage() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.batchRuns,
    queryFn: ({ signal }) => api.batchRuns(signal),
  });

  const trigger = useMutation({
    mutationFn: () => api.triggerBatch(),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.batchRuns });
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueRoot });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      notify.success(
        'Proceso lanzado',
        response.queued === 0
          ? 'No había entregas pendientes.'
          : `${formatInteger(response.queued)} ${
              response.queued === 1 ? 'entrega procesada' : 'entregas procesadas'
            }.`,
      );
    },
    onError: (error) => notify.error('No se ha podido lanzar el proceso', error),
  });

  const runs = query.data?.items ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Corrección"
        title="Procesos"
        actions={
          <Button
            variant="default"
            loading={trigger.isPending}
            onClick={() => trigger.mutate()}
          >
            <Play aria-hidden="true" />
            Forzar proceso
          </Button>
        }
      >
        Cada pasada de corrección sobre las entregas pendientes de las actividades activas.
      </PageHeader>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <ul className="flex flex-col gap-2">
          {[0, 1, 2].map((key) => (
            <Card key={key} asChild>
              <li className="p-4">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="mt-3 h-10 w-full" />
              </li>
            </Card>
          ))}
        </ul>
      ) : runs.length === 0 ? (
        <EmptyState
          title="Todavía no se ha ejecutado ningún proceso"
          description="El planificador los lanza cada cierto tiempo. También puedes forzar uno ahora."
          action={
            <Button
              variant="default"
              loading={trigger.isPending}
              onClick={() => trigger.mutate()}
            >
              Forzar proceso
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </ul>
      )}
    </div>
  );
}
