import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { REVIEWABLE_STATUSES, SUBMISSION_STATUS_LABEL } from '@vega/shared';
import type { SubmissionStatus } from '@vega/shared';
import { api } from '@/lib/api';
import type { QueueParams } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { useDebounce } from '@/lib/useDebounce';
import { formatInteger } from '@/lib/format';
import { countOf, useQueueCounts } from '@/hooks/useQueueCounts';
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
import { QueueRow, QueueRowSkeleton } from '@/components/queue/QueueRow';

/** Lo que reclama al profesor va primero; el resto sigue el orden del ciclo de vida. */
const TAB_ORDER: readonly SubmissionStatus[] = [
  'graded',
  'parked',
  'error',
  'validated',
  'pending',
  'transcribing',
  'transcribed',
  'grading',
  'published',
];

const EMPTY_COPY: Record<SubmissionStatus, { title: string; description: string }> = {
  graded: {
    title: 'Nada por revisar',
    description: 'Cuando termine el próximo proceso, las propuestas de feedback aparecerán aquí.',
  },
  parked: {
    title: 'Nada aparcado',
    description: 'Las entregas omitidas o clasificadas para revisión posterior aparecerán aquí.',
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
    description: 'Las correcciones publicadas en Moodle quedan archivadas en esta pestaña.',
  },
  pending: {
    title: 'Sin entregas pendientes',
    description: 'No hay entregas descargadas de Moodle sin procesar.',
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

export function QueuePage() {
  const [status, setStatus] = useState<SubmissionStatus>('graded');
  const [activityId, setActivityId] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const countsQuery = useQueueCounts();
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

  const tabs = useMemo(() => {
    const always = new Set<SubmissionStatus>(REVIEWABLE_STATUSES);
    return TAB_ORDER.filter(
      (value) => always.has(value) || value === status || countOf(countsQuery.data, value) > 0,
    );
  }, [countsQuery.data, status]);

  const empty = EMPTY_COPY[status];

  return (
    <Tabs
      value={status}
      onValueChange={(value) => setStatus(value as SubmissionStatus)}
      activationMode="manual"
    >
      <h1 className="sr-only">Revisión</h1>

      <div className="sticky top-14 z-10 -mx-4 border-b border-border bg-background px-4 pb-3 pt-1">
        <TabsList aria-label="Filtrar la cola por estado">
          {tabs.map((value) => (
            <TabsTrigger key={value} value={value}>
              <span>{SUBMISSION_STATUS_LABEL[value]}</span>
              <span className="rounded-sm px-1 text-micro font-semibold text-muted-foreground">
                {countOf(countsQuery.data, value)}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

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
