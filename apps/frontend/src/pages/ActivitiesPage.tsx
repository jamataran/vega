import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import type { Activity } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { formatPoints } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/Feedback';
import { ActivityKindBadge } from '@/components/common/status';
import { DiscoverActivitiesDialog } from '@/components/activity/DiscoverActivitiesDialog';

/** Agrupadas por curso de Moodle: es el orden con el que el profesor las busca. */
function byCourse(items: readonly Activity[]): [string, Activity[]][] {
  const groups = new Map<string, Activity[]>();
  for (const item of items) {
    const list = groups.get(item.courseName) ?? [];
    list.push(item);
    groups.set(item.courseName, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'));
}

function ActivityRow({ activity }: { activity: Activity }) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.updateActivity(activity.id, { enabled }),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities });
      notify.success(
        response.activity.enabled ? 'Actividad activada' : 'Actividad desactivada',
        response.activity.enabled
          ? 'Entrará en los próximos procesos.'
          : 'Vega la ignorará en los procesos.',
      );
    },
    onError: (error) => notify.error('No se ha podido cambiar la actividad', error),
  });

  return (
    <li>
      <Card className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <Link
            to={`/actividades/${activity.id}`}
            className="group flex items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <span className="truncate text-base font-medium group-hover:underline">
              {activity.name}
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </Link>

          <ul className="mt-2 flex flex-wrap items-center gap-1.5">
            <li>
              <ActivityKindBadge kind={activity.kind} />
            </li>
            <li className="text-ui text-muted-foreground">
              {activity.graded && activity.maxScore !== null
                ? `Se puntúa sobre ${formatPoints(activity.maxScore)}`
                : 'Sin nota'}
            </li>
          </ul>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1">
          <Switch
            checked={activity.enabled}
            disabled={toggle.isPending}
            onCheckedChange={(checked) => toggle.mutate(checked)}
            aria-label={`Actividad activa: ${activity.name}`}
          />
          <span className="text-micro text-muted-foreground">
            {activity.enabled ? 'Activa' : 'Inactiva'}
          </span>
        </div>
      </Card>
    </li>
  );
}

export function ActivitiesPage() {
  const [discoverOpen, setDiscoverOpen] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.activities,
    queryFn: ({ signal }) => api.activities(signal),
  });

  const groups = useMemo(() => byCourse(query.data?.items ?? []), [query.data]);

  return (
    <div>
      <PageHeader
        eyebrow="Configuración"
        title="Actividades"
        actions={
          <Button onClick={() => setDiscoverOpen(true)}>
            <Search aria-hidden="true" />
            Buscar en Moodle
          </Button>
        }
      >
        Las actividades de Moodle a las que reacciona Vega, con su tipo y su nota.
      </PageHeader>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <ul className="flex flex-col gap-2">
          {[0, 1, 2].map((key) => (
            <Card key={key} asChild>
              <li className="p-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2.5 h-3 w-56" />
              </li>
            </Card>
          ))}
        </ul>
      ) : groups.length === 0 ? (
        <EmptyState
          title="Todavía no hay actividades"
          description="Busca en Moodle e importa las actividades que quieras que Vega corrija."
          action={<Button onClick={() => setDiscoverOpen(true)}>Buscar en Moodle</Button>}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([courseName, activities]) => (
            <section key={courseName}>
              <h2 className="eyebrow mb-2">{courseName}</h2>
              <ul className="flex flex-col gap-2">
                {activities.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <DiscoverActivitiesDialog open={discoverOpen} onOpenChange={setDiscoverOpen} />
    </div>
  );
}
