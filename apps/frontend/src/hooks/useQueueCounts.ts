import { useQuery } from '@tanstack/react-query';
import type { QueueCounts, QueueSummaryResponse, SubmissionStatus } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Lo que rotula las pestañas de la cola: recuentos, errores sin ver y cuándo
 * pasará el próximo proceso. Viene en una sola llamada porque se pinta en una
 * sola franja: en tres, los números llegan desacompasados y se ve el salto.
 */
export function useQueueSummary() {
  return useQuery({
    queryKey: queryKeys.queueCounts,
    queryFn: ({ signal }) => api.queueSummary(signal),
    staleTime: 30_000,
    // Mientras hay un proceso en marcha lo pendiente se está moviendo solo, y
    // una pestaña que dice «12» cuando ya van 7 es peor que no decir nada.
    refetchInterval: (query) => (query.state.data?.running ? 10_000 : false),
  });
}

/** El API puede omitir estados sin entregas: para la UI eso es un cero. */
export function countOf(counts: QueueCounts | undefined, status: SubmissionStatus): number {
  return counts?.[status] ?? 0;
}

/**
 * Cuánto trabajo reclama cada pestaña, que **no** es cuántas entregas contiene.
 *
 * La diferencia está en los dos extremos del ciclo: un fallo que alguien ya ha
 * mirado sigue en su pestaña pero ya no pide nada, y «Publicadas» es un archivo
 * —lo que hay ahí está terminado—, así que un número enorme al lado sólo
 * competía por la atención con el que sí importaba.
 *
 * `null` significa «esta pestaña no reclama nada»: no se pinta contador.
 */
export function pendingWork(
  summary: QueueSummaryResponse | undefined,
  status: SubmissionStatus,
): number | null {
  if (summary === undefined) return null;
  if (status === 'published') return null;
  if (status === 'error') return summary.unseenErrors;
  return countOf(summary.counts, status);
}
