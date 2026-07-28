import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ACTIVITY_KIND_LABEL, SUBMISSION_STATUS_LABEL } from '@vega/shared';
import type { BatchRunRole } from '@vega/shared';
import { api } from '@/lib/api';
import { formatInteger, formatRelativeTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/common/Feedback';
import { StatusBadge } from '@/components/common/status';

const ROLE_COPY: Record<BatchRunRole, { title: string; description: string; empty: string }> = {
  ingested: {
    title: 'Entregas ingeridas',
    description: 'Lo que este proceso se trajo de Moodle por primera vez.',
    empty: 'Este proceso no trajo nada nuevo: todo lo que había en Moodle ya estaba en Vega.',
  },
  processed: {
    title: 'Entregas procesadas',
    description: 'Las que este proceso llegó a leer y corregir.',
    empty: 'Este proceso no llegó a corregir ninguna entrega.',
  },
  failed: {
    title: 'Entregas que fallaron',
    description: 'Las que se rompieron durante este proceso y siguen en error.',
    empty: 'Ninguna de las entregas de este proceso sigue en error.',
  },
};

const PAGE_SIZE = 20;

/**
 * Qué hay detrás de una cifra del proceso.
 *
 * El panel decía «5 ingeridas, 1 procesada, 1 fallida» y ahí se acababa: para
 * saber **cuáles** había que irse a la cola, filtrar por estado y deducirlo por
 * la hora. Cada número es ahora una puerta, y cada fila lleva a su entrega.
 *
 * Sale en un panel y no en una pantalla propia porque la pregunta se hace
 * mirando el proceso: llevarse al profesor a otra ruta le obligaría a volver
 * para mirar la siguiente cifra.
 */
export function RunSubmissionsSheet({
  runId,
  role,
  onClose,
}: {
  runId: string;
  /** `null` con el panel cerrado: así no se pide nada hasta que hace falta. */
  role: BatchRunRole | null;
  onClose: () => void;
}) {
  const copy = role ? ROLE_COPY[role] : null;

  const query = useInfiniteQuery({
    queryKey: ['batch', 'runs', runId, 'submissions', role],
    queryFn: ({ pageParam, signal }) =>
      api.batchRunSubmissions(runId, { role: role!, page: pageParam, pageSize: PAGE_SIZE }, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,
    enabled: role !== null,
  });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0]?.meta.total ?? 0;

  return (
    <Sheet open={role !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{copy?.title ?? 'Entregas del proceso'}</SheetTitle>
          <SheetDescription>{copy?.description}</SheetDescription>
        </SheetHeader>

        <SheetBody className="max-h-[60vh] overflow-y-auto">
          {query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : query.isPending ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="h-14 w-full rounded-md" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState title="Nada que enseñar" description={copy?.empty} />
          ) : (
            <>
              <p className="pb-2 text-ui text-muted-foreground">
                {formatInteger(total)} {total === 1 ? 'entrega' : 'entregas'}
              </p>
              <ul className="flex flex-col gap-1.5">
                {items.map(({ submission, activity }) => (
                  <li key={submission.id}>
                    <Link
                      to={`/entrega/${submission.id}`}
                      onClick={onClose}
                      className="flex items-center gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:bg-muted"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-medium">
                          {submission.studentAlias ?? submission.studentRef}
                        </span>
                        <span className="block truncate text-ui text-muted-foreground">
                          {activity.name}
                          <span className="px-1.5 text-border-strong">·</span>
                          {ACTIVITY_KIND_LABEL[activity.kind]}
                          <span className="px-1.5 text-border-strong">·</span>
                          {formatRelativeTime(submission.submittedAt)}
                        </span>
                      </span>
                      <StatusBadge status={submission.status} />
                      <ChevronRight
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="sr-only">
                        Abrir la entrega. Estado: {SUBMISSION_STATUS_LABEL[submission.status]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              {query.hasNextPage ? (
                <Button
                  className="mt-3 w-full"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  Cargar más
                </Button>
              ) : null}
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
