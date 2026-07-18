import { useQuery } from '@tanstack/react-query';
import type { QueueItem } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/**
 * La siguiente entrega por revisar, para encadenar correcciones sin volver a la
 * lista. Es simplemente la primera de la cola `graded` que no sea la actual.
 */
export function useNextInQueue(currentId: string): QueueItem | null {
  const query = useQuery({
    queryKey: [...queryKeys.queueRoot, 'next'],
    queryFn: ({ signal }) => api.queue({ status: 'graded', pageSize: 20 }, signal),
    staleTime: 30_000,
  });

  return query.data?.items.find((item) => item.submission.id !== currentId) ?? null;
}
