import { useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Search } from 'lucide-react';
import { ACTIVITY_KIND_LABEL, SUBMISSION_STATUS_LABEL, SubmissionStatus } from '@vega/shared';
import type { QueueSummaryResponse } from '@vega/shared';
import { api } from '@/lib/api';
import type { QueueParams } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/cn';
import { formatClock, formatDateTime, formatEvery, formatInteger, formatRelativeTime } from '@/lib/format';
import { pendingWork, useQueueSummary } from '@/hooks/useQueueCounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, ErrorState } from '@/components/common/Feedback';
import { HelpBlock, HelpDialog, HelpTerms } from '@/components/common/HelpDialog';
import { QueueRow, QueueRowSkeleton } from '@/components/queue/QueueRow';
import { AutoTextarea } from '@/components/ui/textarea';
import { notify } from '@/lib/notify';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * El orden es el del trabajo, no el del ciclo de vida.
 *
 * Delante van los dos pasos que el profesor repite cada día —revisar lo que
 * propone la IA y publicar lo que ya ha validado—; después, lo que espera turno
 * y lo que se ha roto. Al final, las dos vías muertas: lo descartado y el
 * archivo de lo publicado. Antes «Publicadas» iba entre medias con un contador
 * que sólo crecía, compitiendo por la atención con la única pestaña que pide
 * algo.
 *
 * `pending` está porque es el destino de devolver una entrega a la cola: sin
 * pestaña, desaparecería justo cuando alguien acaba de pedir a mano que se
 * vuelva a corregir. Los estados de trabajo en curso —transcribiendo,
 * corrigiendo— no salen aquí: viven en Procesos, y como pestañas sólo serían
 * casillas que parpadean.
 */
const TAB_ORDER: readonly SubmissionStatus[] = [
  'graded',
  'validated',
  'pending',
  'error',
  'parked',
  'published',
];

const EMPTY_COPY: Record<SubmissionStatus, { title: string; description: string }> = {
  graded: {
    title: 'Nada por revisar',
    description: 'Cuando termine el próximo proceso, las propuestas de feedback aparecerán aquí.',
  },
  parked: {
    title: 'Nada descartado',
    description:
      'Aquí acaba lo que Vega ha apartado —por antigüedad o por triaje— y lo que descartas tú.',
  },
  error: {
    title: 'Ninguna entrega ha fallado',
    description: 'Las entregas que el sistema no pueda procesar se listarán aquí para relanzarlas.',
  },
  validated: {
    title: 'Nada validado pendiente de publicar',
    description: 'Las correcciones que valides esperarán aquí hasta que las publiques.',
  },
  published: {
    title: 'Todavía no has publicado nada',
    description: 'Las correcciones que llegan al alumno quedan archivadas en esta pestaña.',
  },
  pending: {
    title: 'Sin entregas pendientes',
    description: 'Aquí esperan las entregas descargadas de Moodle que aún no se han corregido.',
  },
  transcribing: { title: 'Nada transcribiéndose', description: 'No hay OCR en curso ahora mismo.' },
  transcribed: {
    title: 'Nada esperando corrección',
    description: 'No hay transcripciones a la espera de la corrección de la IA.',
  },
  grading: { title: 'Nada corrigiéndose', description: 'No hay correcciones de IA en curso.' },
};

const PAGE_SIZE = 20;
/** Radix Select reserva la cadena vacía, así que «todas» viaja con su propio valor. */
const ALL_ACTIVITIES = 'all';

/**
 * La pestaña viaja en la URL.
 *
 * Es lo que permite que el panel enlace directamente a «Validadas» o a
 * «Errores» en vez de dejar al profesor en la primera pestaña buscando dónde
 * estaba lo que acababa de leer. También hace que recargar no pierda el sitio.
 */
function statusFromParams(raw: string | null): SubmissionStatus {
  const parsed = SubmissionStatus.safeParse(raw);
  return parsed.success && TAB_ORDER.includes(parsed.data) ? parsed.data : 'graded';
}

export function QueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = statusFromParams(searchParams.get('estado'));
  const setStatus = (next: SubmissionStatus) => {
    setSearchParams(next === 'graded' ? {} : { estado: next }, { replace: true });
  };
  const [activityId, setActivityId] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const summaryQuery = useQueueSummary();
  const activitiesQuery = useQuery({
    queryKey: queryKeys.activities,
    queryFn: ({ signal }) => api.activities(signal),
    staleTime: 5 * 60 * 1000,
  });

  const params: QueueParams = useMemo(
    () => ({
      status,
      activityId: activityId || undefined,
      q: debouncedSearch.trim() || undefined,
      pageSize: PAGE_SIZE,
    }),
    [status, activityId, debouncedSearch],
  );

  const queue = useInfiniteQuery({
    queryKey: queryKeys.queue(params),
    queryFn: ({ pageParam, signal }) => api.queue({ ...params, page: pageParam }, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,
  });

  const items = useMemo(() => queue.data?.pages.flatMap((page) => page.items) ?? [], [queue.data]);
  const total = queue.data?.pages[0]?.meta.total ?? 0;
  const isFiltered = activityId !== '' || debouncedSearch.trim() !== '';

  const empty = EMPTY_COPY[status];

  return (
    <Tabs
      value={status}
      onValueChange={(value) => setStatus(value as SubmissionStatus)}
      activationMode="manual"
    >
      <h1 className="sr-only">Revisión</h1>

      <div className="sticky top-14 z-10 -mx-4 border-b border-border bg-background px-4 pb-3 pt-1">
        <div className="flex items-center gap-2">
          <TabsList aria-label="Filtrar la cola por estado" className="min-w-0 flex-1">
            {TAB_ORDER.map((value) => {
              const work = pendingWork(summaryQuery.data, value);
              return (
                <TabsTrigger key={value} value={value}>
                  <span>{SUBMISSION_STATUS_LABEL[value]}</span>
                  {/*
                    El número es **trabajo pendiente**, no cuántas filas hay: un
                    fallo ya visto no cuenta y el archivo de publicadas no lleva
                    contador. Un cero tampoco se pinta: «0» al lado de una
                    pestaña vacía es tinta que no informa de nada.
                  */}
                  {work !== null && work > 0 ? (
                    <span
                      className={cn(
                        'rounded-sm px-1 text-micro font-semibold',
                        value === 'graded' ? 'text-primary-ink' : 'text-muted-foreground',
                      )}
                    >
                      {work}
                    </span>
                  ) : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
          <QueueHelp />
        </div>

        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar alumno…"
              aria-label="Buscar por alias o referencia del alumno"
              className="h-10 pl-8"
            />
          </div>

          <Select
            value={activityId || ALL_ACTIVITIES}
            onValueChange={(value) => setActivityId(value === ALL_ACTIVITIES ? '' : value)}
          >
            <SelectTrigger
              aria-label="Filtrar por actividad"
              className="h-10 max-w-40 text-ui sm:max-w-56"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ACTIVITIES}>Todas</SelectItem>
              {activitiesQuery.data?.items.map((activity) => (
                <SelectItem key={activity.id} value={activity.id}>
                  {activity.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <TabsContent value={status} tabIndex={-1}>
        {/* Lo pendiente no pide nada al profesor: pide saber cuándo se moverá. */}
        {status === 'pending' ? <NextRunNotice summary={summaryQuery.data} /> : null}
        {status === 'pending' && total > 0 ? (
          <DiscardPending
            total={total}
            activityId={activityId || undefined}
            activityName={
              activitiesQuery.data?.items.find((activity) => activity.id === activityId)?.name
            }
            searching={debouncedSearch.trim() !== ''}
          />
        ) : null}

        {queue.isError ? (
          <ErrorState
            className="mt-4"
            title="No se ha podido cargar la cola"
            error={queue.error}
            onRetry={() => void queue.refetch()}
          />
        ) : queue.isPending ? (
          <ul className="mt-4 flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((key) => (
              <QueueRowSkeleton key={key} />
            ))}
          </ul>
        ) : items.length === 0 ? (
          <EmptyState
            title={isFiltered ? 'Sin resultados' : empty.title}
            description={
              isFiltered
                ? 'Ninguna entrega de esta pestaña coincide con el filtro.'
                : empty.description
            }
            action={
              isFiltered ? (
                <Button
                  onClick={() => {
                    setSearch('');
                    setActivityId('');
                  }}
                >
                  Quitar filtros
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <p className="px-1 pb-2 pt-3 text-ui text-muted-foreground" aria-live="polite">
              {formatInteger(total)} {total === 1 ? 'entrega' : 'entregas'}
              {isFiltered ? ' con los filtros aplicados' : ''}
            </p>

            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <QueueRow key={item.submission.id} item={item} />
              ))}
            </ul>

            {queue.hasNextPage ? (
              <Button
                size="lg"
                className="mt-3 w-full"
                loading={queue.isFetchingNextPage}
                onClick={() => void queue.fetchNextPage()}
              >
                Cargar más
              </Button>
            ) : items.length >= PAGE_SIZE ? (
              <p className="py-5 text-center text-ui text-muted-foreground">No hay más entregas.</p>
            ) : null}
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}

/**
 * Cuándo va a pasar Vega por lo pendiente.
 *
 * Es la pregunta que deja sin respuesta una pestaña llamada «Pendiente»: el
 * profesor ve doce entregas descargadas y no sabe si se corregirán en cinco
 * minutos o esta noche, así que o espera mirando o pide que se fuerce un
 * proceso que quizá iba a correr solo dentro de un rato.
 */
/**
 * Descarte en bloque de lo pendiente.
 *
 * Existe por un accidente que se repite: se importa una actividad sin fijar la
 * antigüedad máxima de la ingesta y Moodle devuelve años de histórico de golpe.
 * Ciento y pico entregas que nadie va a corregir, que el lote de esta noche sí
 * procesaría, y que hasta ahora sólo se podían quitar por SQL.
 *
 * Sólo aparece en «Pendientes» y sólo cuando hay algo. Lo que descarta es
 * **exactamente lo que se está viendo**, filtro incluido, y lo dice antes de
 * pedir confirmación: un botón que se lleva más de lo que muestra la pantalla
 * es la peor forma de perder trabajo.
 */
function DiscardPending({
  total,
  activityId,
  activityName,
  searching,
}: {
  total: number;
  activityId: string | undefined;
  activityName: string | undefined;
  searching: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reasonId = useId();
  const queryClient = useQueryClient();

  const bulkPark = useMutation({
    mutationFn: () =>
      api.bulkPark({ reason: reason.trim(), activityId, expectedCount: total }),
    onSuccess: ({ parked }) => {
      setOpen(false);
      setReason('');
      notify.success(
        parked === 1 ? 'Se ha descartado 1 entrega' : `Se han descartado ${formatInteger(parked)} entregas`,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.queue({}) , exact: false });
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueCounts });
    },
    onError: (error) => notify.error('No se han podido descartar las entregas', error),
  });

  // La búsqueda por alumno no viaja al descarte: el servidor filtra por estado,
  // actividad y fecha, no por texto. Antes que descartar de más, se avisa y se
  // desactiva.
  const alcance = activityName ? `de «${activityName}»` : 'de todas las actividades';

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <p className="text-ui text-muted-foreground">
          {formatInteger(total)} {total === 1 ? 'entrega pendiente' : 'entregas pendientes'} {alcance}.
        </p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={searching}>
          Descartar {total === 1 ? 'la pendiente' : 'las pendientes'}
        </Button>
      </div>

      <Sheet open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              ¿Descartar {formatInteger(total)} {total === 1 ? 'entrega' : 'entregas'}?
            </SheetTitle>
            <SheetDescription>
              Son todas las pendientes {alcance}. Salen de la revisión activa y quedan en
              «Descartadas» con el motivo. No se pierden: se pueden volver a procesar una a una.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <label className="eyebrow mb-1.5 block" htmlFor={reasonId}>
              Motivo
            </label>
            <AutoTextarea
              id={reasonId}
              value={reason}
              minRows={3}
              autoFocus
              placeholder="Por ejemplo, histórico importado por error al no fijar la antigüedad."
              onChange={(event) => setReason(event.target.value)}
            />
          </SheetBody>
          <SheetFooter>
            <Button
              variant="ghost"
              size="lg"
              disabled={bulkPark.isPending}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              size="lg"
              disabled={reason.trim() === ''}
              loading={bulkPark.isPending}
              onClick={() => bulkPark.mutate()}
            >
              Descartar {formatInteger(total)}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function NextRunNotice({ summary }: { summary: QueueSummaryResponse | undefined }) {
  if (summary === undefined) return null;

  if (summary.running) {
    return (
      <p className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-ui text-muted-foreground">
        <Clock className="size-4 shrink-0" aria-hidden="true" />
        Hay un proceso en marcha ahora mismo: estas entregas se están corrigiendo.
      </p>
    );
  }

  const slots = (['assignment', 'forum'] as const).filter((kind) => summary.schedule[kind].enabled);
  if (slots.length === 0) {
    return (
      <p className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-ui text-muted-foreground">
        <Clock className="size-4 shrink-0" aria-hidden="true" />
        El proceso automático está parado: esto no se corregirá hasta que administración lance uno.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-muted px-3 py-2">
      <ul className="flex flex-col gap-1">
        {slots.map((kind) => (
          <li key={kind} className="flex items-start gap-2 text-ui text-muted-foreground">
            <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {ACTIVITY_KIND_LABEL[kind]}s: {formatEvery(summary.schedule[kind].everyMinutes)}
              {summary.schedule[kind].nextRunAt
                ? ` · próxima pasada ${nextRunLabel(summary.schedule[kind].nextRunAt!)}`
                : ' · la próxima, en cuanto arranque el planificador'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * «a las 03:00» si cae hoy o esta madrugada; la fecha entera si es más lejos.
 * La hora suelta de dentro de tres días no dice nada, y la fecha completa de
 * dentro de veinte minutos, tampoco.
 */
function nextRunLabel(iso: string): string {
  const when = new Date(iso).getTime();
  const inMs = when - Date.now();
  if (inMs <= 0) return 'en cuanto termine el ciclo actual';
  if (inMs < 60 * 60_000) return formatRelativeTime(iso);
  if (inMs < 24 * 60 * 60_000) return `a las ${formatClock(iso)}`;
  return `el ${formatDateTime(iso)}`;
}

/**
 * El modelo mental de la operativa, a un toque.
 *
 * En las pruebas reales, la queja no fue que faltara información sino que no
 * había forma de saber qué significaba cada pestaña ni quién movía las entregas
 * de una a otra. Eso es una explicación de una pantalla, no una columna más.
 */
function QueueHelp() {
  return (
    <HelpDialog
      title="Cómo funciona la revisión"
      description="Cada entrega recorre siempre el mismo camino. Tú decides en un solo punto: validar."
    >
      <HelpBlock title="El camino de una entrega">
        <ol className="flex flex-col gap-2 text-ui text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1. Pendiente.</span> Vega la ha
            descargado de Moodle. Espera al siguiente proceso, que corre solo cada cierto tiempo.
          </li>
          <li>
            <span className="font-medium text-foreground">2. Por revisar.</span> La IA ya ha
            propuesto nota y feedback. Aquí es donde trabajas: repasas, corriges lo que haga falta
            y validas.
          </li>
          <li>
            <span className="font-medium text-foreground">3. Validada.</span> Lo que hayas
            decidido queda fijado. Todavía no ha salido nada hacia el alumno.
          </li>
          <li>
            <span className="font-medium text-foreground">4. Publicada.</span> La corrección ya
            está en Moodle, o la has entregado tú por otro camino y la has dado por cerrada.
          </li>
        </ol>
      </HelpBlock>

      <HelpBlock title="Las dos vías de salida">
        <HelpTerms
          items={[
            {
              term: 'Descartada',
              text: 'Vega la ha apartado —por antigüedad, o porque el triaje decidió que no necesitaba respuesta— o la has descartado tú con un motivo. No se corrige. Administración puede devolverla a pendientes.',
            },
            {
              term: 'Error',
              text: 'Algo se rompió al procesarla: un fichero ilegible, Moodle sin responder, el modelo sin crédito. Puedes darlo por visto para que deje de reclamar; administración puede devolverla a la cola.',
            },
          ]}
        />
      </HelpBlock>

      <HelpBlock title="Los números de las pestañas">
        <p className="text-ui text-muted-foreground">
          Cuentan lo que <strong className="font-medium text-foreground">te queda por hacer</strong>
          , no cuántas entregas hay dentro. Por eso un fallo ya visto no suma y «Publicadas» no
          lleva número: es un archivo.
        </p>
      </HelpBlock>

      <HelpBlock title="Nada sale sin ti">
        <p className="text-ui text-muted-foreground">
          La IA propone; la corrección que recibe el alumno es la que tú has validado. Mientras una
          entrega no pase por «Validada», no hay nada publicado.
        </p>
      </HelpBlock>
    </HelpDialog>
  );
}
