import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Play, User as UserIcon } from 'lucide-react';
import type { BatchRun } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { useAuth } from '@/lib/auth';
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

/**
 * Qué tipos barrió el proceso. Cuando barre los dos no se etiqueta: es el caso
 * normal y la etiqueta sólo aportaría ruido.
 */
function kindsLabel(run: BatchRun): string | null {
  if (run.kinds.length !== 1) return null;
  return run.kinds[0] === 'forum' ? 'Sólo foros' : 'Sólo entregas';
}

function RunCard({ run }: { run: BatchRun }) {
  const scheduled = run.triggeredBy === null;
  const elapsed = duration(run);
  const scope = kindsLabel(run);

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
          {scope ? <Badge variant="outline">{scope}</Badge> : null}
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

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
          <Figure label="Ingeridas" value={formatInteger(run.submissionsIngested)} />
          <Figure label="Procesadas" value={formatInteger(run.submissionsProcessed)} />
          <Figure
            label="Autopublicadas"
            value={formatInteger(run.submissionsAutoPublished)}
            emphasis={run.submissionsAutoPublished > 0}
          />
          <Figure label="Fallidas" value={formatInteger(run.submissionsFailed)} />
          <Figure label="Coste" value={formatEurosFromCents(run.usage.costCents)} />
        </div>

        {run.activitiesFailed > 0 ? (
          <div className="mt-3">
            <p className="text-ui text-muted-foreground">
              {run.activitiesFailed === 1
                ? 'No se han podido leer las entregas de una actividad.'
                : `No se han podido leer las entregas de ${formatInteger(run.activitiesFailed)} actividades.`}{' '}
              {run.problems.some((problem) => problem.kind === 'config')
                ? 'Hay algo que arreglar en Ajustes: reintentar no lo resolverá.'
                : 'Parece pasajero: el siguiente proceso lo reintenta solo.'}
            </p>
            {/* El motivo, y no sólo el número: es la diferencia entre saber que
                falta una función en el servicio web de Moodle y tener que ir a
                buscarlo al log del servidor. */}
            {run.problems.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {run.problems.map((problem) => (
                  <li key={`${problem.activityId}-${problem.message}`} className="text-ui">
                    <span className="font-mono text-muted-foreground">{problem.slug}</span>
                    <span className="px-1.5 text-border-strong">·</span>
                    <span className="text-muted-foreground">{problem.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {run.submissionsAutoPublished > 0 ? (
          <p className="mt-3 text-ui text-muted-foreground">
            {run.submissionsAutoPublished === 1
              ? 'Una corrección se publicó automáticamente, sin revisión docente.'
              : `${formatInteger(run.submissionsAutoPublished)} correcciones se publicaron automáticamente, sin revisión docente.`}
          </p>
        ) : null}
      </li>
    </Card>
  );
}

export function ProcessesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Forzar el proceso gasta dinero real en cuanto el proveedor deja de ser el
  // simulado, así que el API lo restringe a administración. El botón se esconde
  // en vez de fallar con un 403 después de pulsarlo.
  const canTrigger = user?.role === 'admin';

  const query = useQuery({
    queryKey: queryKeys.batchRuns,
    queryFn: ({ signal }) => api.batchRuns(signal),
    // Mientras haya un proceso en marcha la pantalla se refresca sola: corre en
    // el servidor y puede durar minutos, así que sin esto habría que recargar a
    // mano para enterarse de que ha terminado.
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some((run) => run.status === 'running') ? 5_000 : false,
  });

  const trigger = useMutation({
    mutationFn: () => api.triggerBatch(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.batchRuns });
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueRoot });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      // Cuando esto llega, el proceso acaba de empezar: no hay ningún recuento
      // que dar todavía. Prometer uno aquí es lo que hacía que un proceso con
      // entregas por corregir anunciara «no había entregas pendientes».
      notify.success(
        'Proceso lanzado',
        'Corre en segundo plano: trae lo nuevo de Moodle y corrige lo pendiente. El resultado aparece aquí en cuanto termine.',
      );
    },
    onError: (error) => notify.error('No se ha podido lanzar el proceso', error),
  });

  const runs = query.data?.items ?? [];
  const running = runs.some((run) => run.status === 'running');

  return (
    <div>
      <PageHeader
        eyebrow="Corrección"
        title="Procesos"
        actions={
          canTrigger ? (
            <Button
              variant="default"
              // También mientras corre en el servidor, no sólo mientras viaja la
              // petición: el proceso dura minutos y el botón enseñaría el
              // triángulo de «iniciar» junto al texto que dice lo contrario.
              loading={trigger.isPending || running}
              // El API rechaza un segundo proceso simultáneo con un 409; más
              // vale decirlo en el botón que después de pulsarlo.
              disabled={running}
              onClick={() => trigger.mutate()}
            >
              <Play aria-hidden="true" />
              {running ? 'Proceso en marcha' : 'Forzar proceso'}
            </Button>
          ) : null
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
          description={
            canTrigger
              ? 'El planificador los lanza cada cierto tiempo. También puedes forzar uno ahora.'
              : 'El planificador los lanza cada cierto tiempo. Forzar uno es cosa de administración.'
          }
          action={
            canTrigger ? (
              <Button variant="default" loading={trigger.isPending} onClick={() => trigger.mutate()}>
                Forzar proceso
              </Button>
            ) : null
          }
        />
      ) : (
        // La lista se refresca sola cada 5 s mientras algo corre: sin región
        // viva, quien usa lector de pantalla no se entera de que el proceso ha
        // terminado aunque la pantalla ya lo esté enseñando.
        <ul className="flex flex-col gap-2" aria-live="polite">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </ul>
      )}
    </div>
  );
}
