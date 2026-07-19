import type { ContextLevel } from '@vega/shared';
import type { CostBreakdownParams, QueueParams } from './api';

/** Claves centralizadas: invalidar desde una mutación no debe ser adivinar. */
export const queryKeys = {
  me: ['me'] as const,
  health: ['health'] as const,
  queue: (params: QueueParams) => ['queue', 'list', params] as const,
  queueRoot: ['queue'] as const,
  queueCounts: ['queue', 'counts'] as const,
  submission: (id: string) => ['submission', id] as const,
  activities: ['activities'] as const,
  activity: (id: string) => ['activities', 'detail', id] as const,
  activityFiles: (id: string) => ['activities', 'detail', id, 'files'] as const,
  discoverActivities: ['activities', 'discover'] as const,
  contexts: ['contexts'] as const,
  resolvedContext: (activityId: string) => ['contexts', 'resolved', activityId] as const,
  users: ['users'] as const,
  settings: ['settings'] as const,
  overview: ['overview'] as const,
  costBreakdown: (params: CostBreakdownParams) => ['overview', 'cost', params] as const,
  batchRuns: ['batch', 'runs'] as const,
};

/** Clave de un contexto concreto dentro del listado, para invalidaciones finas. */
export function contextKey(level: ContextLevel, key: string): readonly unknown[] {
  return ['contexts', level, key];
}
