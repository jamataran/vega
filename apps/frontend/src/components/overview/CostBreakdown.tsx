import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { CostDimension, CostGroup, CostPeriod } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import {
  formatEurosFromCents,
  formatInteger,
  formatPreciseEurosFromCents,
  formatTokens,
} from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState, ErrorState, Section } from '@/components/common/Feedback';
import { Figure } from '@/components/common/Figure';

const PERIOD_LABEL: Record<CostPeriod, string> = {
  this_month: 'Mes en curso',
  last_30_days: 'Últimos 30 días',
  this_quarter: 'Trimestre en curso',
  all_time: 'Todo',
};

const DIMENSION_LABEL: Record<CostDimension, string> = {
  activity_kind: 'Tipo',
  course: 'Curso',
  activity: 'Actividad',
  operation: 'Operación',
};

const PERIODS = Object.keys(PERIOD_LABEL) as CostPeriod[];
const DIMENSIONS = Object.keys(DIMENSION_LABEL) as CostDimension[];

/**
 * Fila del desglose. La barra no es decoración: en una lista ordenada por
 * gasto, la proporción es justo la pregunta —qué se está comiendo el mes— y se
 * lee antes que comparar cuatro cifras en euros. Para métricas sueltas seguimos
 * prefiriendo el número solo (ver `Figure` en `OverviewPage`).
 */
function BreakdownRow({ group, share }: { group: CostGroup; share: number }) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base">{group.label}</span>
          {group.kind === 'forum' ? (
            <Badge variant="quiet" className="shrink-0">
              Sin nota
            </Badge>
          ) : null}
        </span>
        <span className="shrink-0 font-display text-base font-semibold">
          {formatEurosFromCents(group.costCents)}
        </span>
      </div>

      {/* Refuerzo visual del reparto: el euro exacto ya está en texto arriba. */}
      <Progress
        aria-hidden="true"
        className="mt-2"
        value={Math.max(share * 100, share > 0 ? 2 : 0)}
      />

      <p className="mt-1.5 text-ui text-muted-foreground">
        {formatInteger(group.corrections)}{' '}
        {group.corrections === 1 ? 'corrección' : 'correcciones'} ·{' '}
        {formatPreciseEurosFromCents(group.avgCostCents)} cada una
      </p>
    </>
  );

  // Sólo la dimensión de actividad tiene a dónde llevar: su ficha.
  if (group.activityId) {
    return (
      <li>
        <Link
          to={`/actividades/${group.activityId}`}
          className="block rounded-md py-2.5 transition-colors hover:bg-accent/60"
        >
          {body}
        </Link>
      </li>
    );
  }

  return <li className="py-2.5">{body}</li>;
}

/**
 * Desglose del gasto: elige ventana, elige eje, y baja del total a las
 * actividades que lo han provocado sin cambiar de pantalla.
 */
export function CostBreakdown() {
  const [period, setPeriod] = useState<CostPeriod>('this_month');
  const [dimension, setDimension] = useState<CostDimension>('activity_kind');

  const params = { period, dimension };
  const query = useQuery({
    queryKey: queryKeys.costBreakdown(params),
    queryFn: ({ signal }) => api.costBreakdown(params, signal),
    // Cambiar de eje o de periodo no debe vaciar la pantalla: se conserva lo
    // anterior atenuado (`stale`) hasta que llega la respuesta nueva.
    placeholderData: (previous) => previous,
  });

  const periodSelect = (
    <Select value={period} onValueChange={(value) => setPeriod(value as CostPeriod)}>
      <SelectTrigger className="w-44" aria-label="Periodo del desglose">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERIODS.map((value) => (
          <SelectItem key={value} value={value}>
            {PERIOD_LABEL[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (query.isError) {
    return (
      <Section title="Coste" actions={periodSelect}>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Section>
    );
  }

  if (!query.data) {
    return (
      <Section title="Coste" actions={periodSelect}>
        <Skeleton className="h-40 w-full rounded-lg" />
      </Section>
    );
  }

  const data = query.data;
  const totalTokens = data.usage.inputTokens + data.usage.outputTokens;
  const cacheRatio =
    data.usage.inputTokens > 0 ? data.usage.cachedInputTokens / data.usage.inputTokens : 0;
  // La escala es la fila más cara, no el total: si no, todo se ve plano.
  const top = data.groups[0]?.costCents ?? 0;
  const stale = query.isPlaceholderData;

  return (
    <Section title="Coste" actions={periodSelect}>
      {/*
        Los totales dependen del periodo, así que al cambiarlo también quedan
        obsoletos hasta que llega la respuesta: se atenúan con la lista. En un
        panel de coste, enseñar una cifra vieja sin marcarla es un error.
      */}
      <div className={cn('grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4', stale && 'opacity-60')}>
        <Figure
          label="Gasto"
          value={formatEurosFromCents(data.usage.costCents)}
          note={`${formatTokens(totalTokens)} tokens`}
        />
        <Figure label="Correcciones" value={formatInteger(data.corrections)} />
        <Figure
          label="Por corrección"
          value={formatPreciseEurosFromCents(data.avgCostCents)}
        />
        <Figure
          label="Desde la caché"
          value={`${Math.round(cacheRatio * 100)} %`}
          note="De los tokens de entrada"
        />
      </div>

      <Tabs
        value={dimension}
        onValueChange={(value) => setDimension(value as CostDimension)}
        className="mt-6"
      >
        <TabsList className="w-full" aria-label="Eje del desglose de coste">
          {DIMENSIONS.map((value) => (
            <TabsTrigger key={value} value={value} className="flex-1">
              {DIMENSION_LABEL[value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {data.groups.length === 0 ? (
        <EmptyState
          title="Sin gasto en este periodo"
          description="Cuando se ejecute un proceso que llame a la IA, aquí aparecerá en qué se ha ido."
        />
      ) : (
        <ul className={cn('mt-2 divide-y divide-border', stale && 'opacity-60')}>
          {data.groups.map((group) => (
            <BreakdownRow
              key={group.key}
              group={group}
              share={top > 0 ? group.costCents / top : 0}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}
