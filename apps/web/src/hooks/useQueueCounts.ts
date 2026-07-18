import { useQuery } from '@tanstack/react-query';
import type { QueueCounts, SubmissionStatus } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/** Recuentos por estado. Se comparten entre las pestañas de la cola y la navegación. */
export function useQueueCounts() {
  return useQuery({
    queryKey: queryKeys.queueCounts,
    queryFn: ({ signal }) => api.queueCounts(signal),
    staleTime: 30_000,
  });
}

/** El API puede omitir estados sin entregas: para la UI eso es un cero. */
export function countOf(counts: QueueCounts | undefined, status: SubmissionStatus): number {
  return counts?.[status] ?? 0;
}
