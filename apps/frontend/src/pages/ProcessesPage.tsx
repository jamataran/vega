import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Play, Square, User as UserIcon } from 'lucide-react';
import type { BatchRun, BatchRunRole } from '@vega/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatEurosFromCents, formatInteger, formatRelativeTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/Feedback';
import { HelpBlock, HelpDialog, HelpTerms } from '@/components/common/HelpDialog';
import { RunSubmissionsSheet } from '@/components/queue/RunSubmissionsSheet';

const RUN_STATUS_LABEL: Record<BatchRun['status'], string> = {
  running: 'En curso',
  done: 'Terminado',
  failed: 'Fallido',
  cancelled: 'Parado',
};

/**
 * Parar no es fallar: un proceso que alguien detuvo hizo exactamente lo que se
 * le pidió. Pintarlo en rojo junto a los que se rompieron solos obligaría a
 * leer cada línea para saber cuál exige actuar.
 */
const RUN_STATUS_VARIANT: Record<
  BatchRun['status'],
  'info' | 'success' | 'destructive' | 'warning'
> = {
  running: 'info',
  done: 'success',
  failed: 'destructive',
  cancelled: 'warning',
};

/** Duración de un proceso ya cerrado, en la unidad que se lee de un vistazo. */
function duration(run: BatchRun): string | null {
  if (!run.finishedAt) return null;
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/**
 * Una cifra del proceso.
 *
 * Cuando hay algo detrás, es un botón: «5 ingeridas» sin forma de llegar a esas
 * cinco obligaba a irse a la cola, filtrar por estado y deducirlo por la hora.
 * Cuando el número es cero no hay nada que abrir y se queda como texto, para
 * que no haya botones que no llevan a ninguna parte.
 */
function Figure({
  label,
  value,
  emphasis,
  onOpen,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  onOpen?: () => void;
}) {
  const valueClass = emphasis
    ? 'mt-1 font-display text-base font-semibold text-warning-ink'
    : 'mt-1 font-display text-base font-semibold';

  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            valueClass,
            'rounded-sm text-primary-ink underline decoration-border-strong underline-offset-4',
            'hover:decoration-current focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          )}
        >
          {value}
          <span className="sr-only"> — ver cuáles</span>
        </button>
      ) : (
        <p className={valueClass}>{value}</p>
      )}
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

function RunCard({ run, onCancel, cancelling }: {
  run: BatchRun;
  /** `null` en quien no puede pararlo: entonces no se ofrece el botón. */
  onCancel: (() => void) | null;
  cancelling: boolean;
}) {
  const scheduled = run.triggeredBy === null;
  const elapsed = duration(run);
  const scope = kindsLabel(run);
  const [role, setRole] = useState<BatchRunRole | null>(null);

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
          {run.status === 'running' && onCancel !== null ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              loading={cancelling}
              onClick={onCancel}
            >
              <Square aria-hidden="true" />
              Parar
            </Button>
          ) : null}
        </div>

        {run.closedReason ? (
          <p className="mt-2 text-ui text-muted-foreground">{run.closedReason}</p>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
          <Figure
            label="Ingeridas"
            value={formatInteger(run.submissionsIngested)}
            onOpen={run.submissionsIngested > 0 ? () => setRole('ingested') : undefined}
          />
          <Figure
            label="Procesadas"
            value={formatInteger(run.submissionsProcessed)}
            onOpen={run.submissionsProcessed > 0 ? () => setRole('processed') : undefined}
          />
          <Figure
            label="Autopublicadas"
            value={formatInteger(run.submissionsAutoPublished)}
            emphasis={run.submissionsAutoPublished > 0}
          />
          <Figure
            label="Fallidas"
            value={formatInteger(run.submissionsFailed)}
            onOpen={run.submissionsFailed > 0 ? () => setRole('failed') : undefined}
          />
          <Figure label="Coste" value={formatEurosFromCents(run.usage.costCents)} />
        </div>

        <RunSubmissionsSheet runId={run.id} role={role} onClose={() => setRole(null)} />

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
                    {/* El nombre de la actividad, no su `slug`: «forum-29» no le
                        dice nada a nadie, y desde aquí se llega a su ficha. */}
                    <Link
                      to={`/actividades/${problem.activityId}`}
                      className="font-medium text-primary-ink underline-offset-4 hover:underline"
                    >
                      {problem.name || problem.slug}
                    </Link>
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

/**
 * Qué es un proceso, en los términos del profesor y no en los del sistema.
 *
 * La pantalla enseñaba cinco cifras y un botón sin decir en ningún sitio qué
 * hace un proceso, cuándo corre ni qué le pasa a una entrega mientras tanto.
 * Quien no ha construido esto no tiene forma de deducirlo de «Ingeridas 5».
 */
function ProcessHelp() {
  return (
    <HelpDialog
      title="Qué hace un proceso"
      description="Una pasada completa: trae lo nuevo de Moodle y corrige lo que estaba esperando."
    >
      <HelpBlock title="Qué hace, por orden">
        <ol className="flex flex-col gap-2 text-ui text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1. Ingerir.</span> Pregunta a Moodle por
            las entregas nuevas de tus actividades activas y se las descarga. Aparecen en
            «Pendiente».
          </li>
          <li>
            <span className="font-medium text-foreground">2. Leer.</span> Transcribe el manuscrito
            de cada entrega. Los foros se saltan este paso: ya son texto.
          </li>
          <li>
            <span className="font-medium text-foreground">3. Corregir.</span> Propone nota y
            feedback apartado por apartado, y los verifica. Al terminar, la entrega pasa a «Por
            revisar» y te toca a ti.
          </li>
        </ol>
      </HelpBlock>

      <HelpBlock title="Cuándo corre">
        <p className="text-ui text-muted-foreground">
          Solo, cada cierto tiempo, y con una cadencia distinta para entregas y foros: una duda de
          foro no puede esperar a la noche, y un lote de exámenes en PDF no tiene por qué correr
          cada pocos minutos. La próxima pasada se anuncia en la pestaña «Pendiente» de Revisión.
          Administración puede además forzar uno.
        </p>
      </HelpBlock>

      <HelpBlock title="Las cifras">
        <HelpTerms
          items={[
            {
              term: 'Ingeridas',
              text: 'Entregas que este proceso trajo de Moodle por primera vez. Pulsa el número para ver cuáles.',
            },
            {
              term: 'Procesadas',
              text: 'Las que llegó a leer y corregir en esta misma pasada.',
            },
            {
              term: 'Fallidas',
              text: 'Las que se rompieron: un fichero ilegible, Moodle sin responder, el modelo sin crédito. Están en la pestaña «Error» de Revisión.',
            },
            {
              term: 'Coste',
              text: 'Lo que han costado sus llamadas al modelo. En modo simulado es lo que habrían costado, no un gasto real. Si alguna llamada usó un modelo sin tarifa configurada, la cifra es un mínimo: el aviso sale en Métricas.',
            },
          ]}
        />
      </HelpBlock>

      <HelpBlock title="Si se para a medias">
        <p className="text-ui text-muted-foreground">
          La entrega que estuviera a medias vuelve a «Pendiente»: nadie ha dictaminado nada sobre
          ella y la recogerá el siguiente proceso. No se da por corregida ni se marca como fallida.
        </p>
      </HelpBlock>
    </HelpDialog>
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

  const cancel = useMutation({
    mutationFn: (runId: string) => api.cancelBatchRun(runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.batchRuns });
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueRoot });
      notify.success(
        'Proceso parado',
        'La entrega que estaba a medias vuelve a la cola: no se ha dado por corregida.',
      );
    },
    onError: (error) => notify.error('No se ha podido parar el proceso', error),
  });

  const runs = query.data?.items ?? [];
  const running = runs.some((run) => run.status === 'running');

  return (
    <div>
      <PageHeader
        eyebrow="Corrección"
        title="Procesos"
        actions={
          <>
            <ProcessHelp />
            {canTrigger ? (
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
            ) : null}
          </>
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
            <RunCard
              key={run.id}
              run={run}
              onCancel={canTrigger ? () => cancel.mutate(run.id) : null}
              cancelling={cancel.isPending && cancel.variables === run.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
