import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIVITY_KIND_LABEL } from '@vega/shared';
import type { DiscoveredActivity } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/common/Feedback';

/** Agrupamos por curso: es como el profesor reconoce sus actividades. */
function byCourse(items: readonly DiscoveredActivity[]): [string, DiscoveredActivity[]][] {
  const groups = new Map<string, DiscoveredActivity[]>();
  for (const item of items) {
    const list = groups.get(item.courseName) ?? [];
    list.push(item);
    groups.set(item.courseName, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'));
}

/**
 * Catálogo de Moodle con las actividades que Vega todavía no gestiona.
 *
 * Las ya importadas se listan igualmente, marcadas y sin casilla: verlas evita
 * que el profesor se pregunte si se le ha olvidado alguna.
 */
export function DiscoverActivitiesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);

  const query = useQuery({
    queryKey: queryKeys.discoverActivities,
    queryFn: ({ signal }) => api.discoverActivities(signal),
    enabled: open,
    staleTime: 0,
  });

  const groups = useMemo(() => byCourse(query.data?.items ?? []), [query.data]);
  const available = (query.data?.items ?? []).filter((item) => !item.alreadyImported);

  const importMutation = useMutation({
    mutationFn: () => api.importActivities({ moodleRefs: selected }),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities });
      notify.success(
        response.items.length === 1 ? 'Actividad importada' : 'Actividades importadas',
        `${response.items.length} en Vega. Revisa su configuración antes del próximo proceso.`,
      );
      setSelected([]);
      onOpenChange(false);
    },
    onError: (error) => notify.error('No se han podido importar las actividades', error),
  });

  const toggle = (moodleRef: string) => {
    setSelected((current) =>
      current.includes(moodleRef)
        ? current.filter((ref) => ref !== moodleRef)
        : [...current, moodleRef],
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSelected([]);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] grid-rows-[auto_1fr_auto]">
        <DialogHeader>
          <DialogTitle>Actividades en Moodle</DialogTitle>
          <DialogDescription>
            Elige a cuáles quieres que reaccione Vega. Empiezan con revisión completa: nada llega al
            alumno sin que lo valides.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto">
          {query.isError ? (
            <ErrorState
              title="No se ha podido consultar Moodle"
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          ) : query.isPending ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="h-14 w-full rounded-md" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              title="Moodle no devuelve actividades"
              description="Comprueba el conector y el token en Ajustes."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map(([courseName, items]) => (
                <section key={courseName}>
                  <h3 className="eyebrow mb-1.5">{courseName}</h3>
                  <ul className="flex flex-col gap-1.5">
                    {items.map((item) => (
                      <li key={item.moodleRef}>
                        <label
                          className={cn(
                            'flex items-start gap-3 rounded-md border border-border px-3 py-2.5',
                            'transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                            'has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-popover',
                            item.alreadyImported
                              ? 'bg-muted text-muted-foreground'
                              : 'cursor-pointer hover:border-border-strong',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 size-4 shrink-0 accent-primary"
                            checked={
                              item.alreadyImported || selected.includes(item.moodleRef)
                            }
                            disabled={item.alreadyImported}
                            onChange={() => toggle(item.moodleRef)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-base font-medium">
                              {item.name}
                            </span>
                            <span className="mt-0.5 block text-ui text-muted-foreground">
                              {ACTIVITY_KIND_LABEL[item.kind]}
                              <span className="px-1.5 text-border-strong">·</span>
                              {item.pendingCount === 0
                                ? 'Sin entregas pendientes'
                                : `${item.pendingCount} ${
                                    item.pendingCount === 1
                                      ? 'entrega pendiente'
                                      : 'entregas pendientes'
                                  }`}
                            </span>
                          </span>
                          {item.alreadyImported ? (
                            <Badge variant="success" className="mt-0.5 shrink-0">
                              Ya importada
                            </Badge>
                          ) : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <p className="mr-auto self-center text-ui text-muted-foreground" aria-live="polite">
            {available.length === 0
              ? 'Todas las actividades están ya en Vega.'
              : `${selected.length} de ${available.length} seleccionadas`}
          </p>
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="default"
            size="lg"
            disabled={selected.length === 0}
            loading={importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            Importar seleccionadas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
