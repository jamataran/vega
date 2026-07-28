import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Clock, ListChecks, Send } from 'lucide-react';
import { ACTIVITY_KIND_LABEL } from '@vega/shared';
import type { TeacherPanelResponse } from '@vega/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { queryKeys } from '@/lib/queryKeys';
import {
  formatClock,
  formatDateTime,
  formatEvery,
  formatInteger,
  formatRelativeTime,
} from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, PageHeader, Section } from '@/components/common/Feedback';

/**
 * Panel del profesor: qué te toca hacer y qué pasó anoche.
 *
 * La pantalla que había antes en esta ruta —coste del mes, fiabilidad del
 * motor, tokens— es una pantalla de instalación: contesta «¿cuánto se está
 * gastando la academia?». En las pruebas reales quedó claro que la pregunta que
 * trae aquí a un profesor es otra y mucho más corta: qué tengo pendiente, dónde
 * está y si el último proceso dejó algo roto. Aquélla vive ahora en Métricas,
 * que es de administración.
 */
export function PanelPage() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: queryKeys.teacherPanel,
    queryFn: ({ signal }) => api.teacherPanel(signal),
    refetchInterval: (query) => (query.state.data?.running ? 10_000 : false),
  });

  if (query.isError) {
    return (
      <>
        <PageHeader eyebrow="Tu trabajo" title="Panel" />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    );
  }

  if (!query.data) {
    return (
      <>
        <PageHeader eyebrow="Tu trabajo" title="Panel" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-36 w-full rounded-lg" />
        </div>
      </>
    );
  }

  const data = query.data;
  const nothingToDo =
    data.counts.graded === 0 && data.counts.validated === 0 && data.unseenErrors === 0;

  return (
    <div>
      <PageHeader eyebrow="Tu trabajo" title={`Hola, ${firstName(user?.name)}`}>
        {nothingToDo
          ? 'No tienes nada pendiente ahora mismo.'
          : 'Esto es lo que te reclama, por orden.'}
      </PageHeader>

      <div className="flex flex-col gap-3">
        <Section title="Por hacer">
          <ul className="flex flex-col gap-2">
            <WorkRow
              to="/"
              Icon={ListChecks}
              label="Correcciones por revisar"
              count={data.counts.graded ?? 0}
              hint="La IA ya ha propuesto nota y feedback. Repasa y valida."
              primary
            />
            <WorkRow
              to="/?estado=validated"
              Icon={Send}
              label="Validadas sin publicar"
              count={data.counts.validated ?? 0}
              hint="Ya las has dado por buenas. Falta que lleguen al alumno."
            />
            <WorkRow
              to="/?estado=error"
              Icon={AlertTriangle}
              label="Errores sin revisar"
              count={data.unseenErrors}
              hint="Entregas que no se han podido procesar y que nadie ha mirado."
              alarming
            />
          </ul>
        </Section>

        <Section
          title="En camino"
          description="Entregas descargadas de Moodle que todavía no se han corregido."
        >
          <p className="flex items-baseline gap-2">
            <span className="font-display text-score font-semibold leading-none">
              {formatInteger(data.counts.pending ?? 0)}
            </span>
            <span className="text-base text-muted-foreground">
              {(data.counts.pending ?? 0) === 1 ? 'entrega pendiente' : 'entregas pendientes'}
            </span>
          </p>
          <div className="mt-3">
            <NextRunLines data={data} />
          </div>
        </Section>

        <Section title="Último proceso">
          <LastRun data={data} />
        </Section>
      </div>
    </div>
  );
}

function firstName(name: string | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'de nuevo';
}

/**
 * Una fila de trabajo pendiente. El número manda, y sólo lleva a algún sitio
 * cuando hay algo detrás: un enlace a una pestaña vacía es un viaje en balde.
 */
function WorkRow({
  to,
  Icon,
  label,
  count,
  hint,
  primary,
  alarming,
}: {
  to: string;
  Icon: typeof ListChecks;
  label: string;
  count: number;
  hint: string;
  primary?: boolean;
  alarming?: boolean;
}) {
  const content = (
    <>
      <Icon
        className={cn(
          'size-5 shrink-0',
          count === 0
            ? 'text-border-strong'
            : alarming
              ? 'text-destructive-ink'
              : primary
                ? 'text-primary-ink'
                : 'text-muted-foreground',
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium">{label}</span>
        <span className="block text-ui text-muted-foreground">{hint}</span>
      </span>
      <span
        className={cn(
          'shrink-0 font-display text-title font-semibold tabular-nums',
          count === 0
            ? 'text-muted-foreground'
            : alarming
              ? 'text-destructive-ink'
              : primary
                ? 'text-primary-ink'
                : 'text-foreground',
        )}
      >
        {formatInteger(count)}
      </span>
      {count > 0 ? (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
    </>
  );

  return (
    <li>
      {count === 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-border px-3 py-3 opacity-70">
          {content}
        </div>
      ) : (
        <Link
          to={to}
          className="flex items-center gap-3 rounded-md border border-border px-3 py-3 transition-colors hover:border-border-strong hover:bg-muted"
        >
          {content}
        </Link>
      )}
    </li>
  );
}

/** Cuándo pasará Vega por lo pendiente, por tipo de actividad. */
function NextRunLines({ data }: { data: TeacherPanelResponse }) {
  if (data.running) {
    return (
      <p className="flex items-center gap-2 text-ui text-muted-foreground">
        <Clock className="size-4 shrink-0" aria-hidden="true" />
        Hay un proceso en marcha: se están corrigiendo ahora.
      </p>
    );
  }

  const kinds = (['assignment', 'forum'] as const).filter((kind) => data.schedule[kind].enabled);
  if (kinds.length === 0) {
    return (
      <p className="flex items-center gap-2 text-ui text-warning-ink">
        <Clock className="size-4 shrink-0" aria-hidden="true" />
        El proceso automático está parado. Habla con administración.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {kinds.map((kind) => {
        const slot = data.schedule[kind];
        return (
          <li key={kind} className="flex items-start gap-2 text-ui text-muted-foreground">
            <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {ACTIVITY_KIND_LABEL[kind]}s: {formatEvery(slot.everyMinutes)}
              {slot.nextRunAt ? ` · la próxima ${whenLabel(slot.nextRunAt)}` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function whenLabel(iso: string): string {
  const inMs = new Date(iso).getTime() - Date.now();
  if (inMs <= 0) return 'de un momento a otro';
  if (inMs < 60 * 60_000) return formatRelativeTime(iso);
  if (inMs < 24 * 60 * 60_000) return `a las ${formatClock(iso)}`;
  return `el ${formatDateTime(iso)}`;
}

/**
 * Qué dejó el último proceso **en tus entregas**.
 *
 * Las cifras del proceso son las del claustro entero y por eso no se le
 * enseñan a un profesor; éstas están recortadas a lo suyo, que es lo único
 * sobre lo que puede actuar.
 */
function LastRun({ data }: { data: TeacherPanelResponse }) {
  const run = data.lastRun;
  if (!run) {
    return (
      <p className="text-base text-muted-foreground">
        Todavía no se ha ejecutado ningún proceso.
      </p>
    );
  }

  const when =
    run.status === 'running'
      ? `Empezó ${formatRelativeTime(run.startedAt)} y sigue en marcha.`
      : run.finishedAt
        ? `Terminó ${formatRelativeTime(run.finishedAt)}, a las ${formatClock(run.finishedAt)}.`
        : `Empezó ${formatRelativeTime(run.startedAt)}.`;

  const nothingMine = run.ingested === 0 && run.processed === 0 && run.failed === 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base">
        {when}
        {run.status === 'failed' ? (
          <span className="text-destructive-ink"> Se cortó por un fallo.</span>
        ) : run.status === 'cancelled' ? (
          <span className="text-warning-ink"> Lo pararon a mano.</span>
        ) : null}
      </p>

      {nothingMine ? (
        <p className="text-ui text-muted-foreground">
          No tocó ninguna entrega tuya: no había nada nuevo en tus actividades.
        </p>
      ) : (
        <dl className="grid grid-cols-3 gap-x-4">
          <RunFigure label="Traídas de Moodle" value={run.ingested} />
          <RunFigure label="Corregidas" value={run.processed} />
          <RunFigure label="Con fallo" value={run.failed} alarming={run.failed > 0} />
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        {run.failed > 0 ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/?estado=error">Ver los fallos</Link>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="ghost">
          <Link to="/procesos">Ver todos los procesos</Link>
        </Button>
      </div>
    </div>
  );
}

function RunFigure({
  label,
  value,
  alarming,
}: {
  label: string;
  value: number;
  alarming?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cn(
          'mt-1 font-display text-base font-semibold',
          alarming ? 'text-destructive-ink' : undefined,
        )}
      >
        {formatInteger(value)}
      </dd>
    </div>
  );
}
