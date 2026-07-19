import { desc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type {
  ActivityKind,
  CostBreakdownResponse,
  CostGroup,
  OverviewResponse,
  QueueCounts,
  SubmissionStatus,
} from '@vega/shared';
import { z } from 'zod';
import { ACTIVITY_KIND_LABEL, CostDimension, CostPeriod, routes } from '@vega/shared';
import { schema } from '../db/client.js';
import { toBatchRun } from '../db/mappers.js';
import { parseOrThrow } from '../http/errors.js';
import type { AppContext } from '../context.js';

export async function statsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, sql } = ctx;

  app.get(routes.overview, { preHandler: app.authenticate }, async (): Promise<OverviewResponse> => {
    const counts = {
      pending: 0,
      transcribing: 0,
      transcribed: 0,
      grading: 0,
      graded: 0,
      validated: 0,
      published: 0,
      error: 0,
    } satisfies QueueCounts;

    const statusRows = await sql<{ status: SubmissionStatus; count: string }[]>`
      SELECT status, COUNT(*) AS count FROM submissions GROUP BY status
    `;
    for (const row of statusRows) counts[row.status] = Number(row.count);

    const [totals] = await sql<
      {
        graded_30d: string;
        input_tokens: string;
        output_tokens: string;
        cached_input_tokens: string;
        cost_cents: string;
        corrections_this_month: string;
      }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')          AS graded_30d,
        COALESCE(SUM(input_tokens)        FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS input_tokens,
        COALESCE(SUM(output_tokens)       FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS output_tokens,
        COALESCE(SUM(cached_input_tokens) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS cached_input_tokens,
        COALESCE(SUM(cost_cents)          FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS cost_cents,
        COUNT(*)                          FILTER (WHERE created_at >= date_trunc('month', now()))     AS corrections_this_month
      FROM corrections
    `;

    /**
     * Desviación media IA vs profesor: por cada corrección ya validada,
     * la diferencia entre lo que puso el profesor y lo que propuso la IA.
     * Positiva ⇒ el profesor tiende a subir la nota.
     */
    const [deviation] = await sql<{ avg_deviation: string | null }[]>`
      SELECT AVG(diff) AS avg_deviation
      FROM (
        SELECT SUM(COALESCE(ci.teacher_points, ci.ai_points) - ci.ai_points) AS diff
        FROM corrections c
        JOIN correction_items ci ON ci.correction_id = c.id
        WHERE c.validated_at IS NOT NULL
        GROUP BY c.id
      ) per_correction
    `;

    /**
     * Proporción de correcciones validadas que el profesor **no ha tocado**:
     * ni puntos, ni feedback de apartado, ni resumen, ni LaTeX. Es la métrica
     * que dice cuándo una actividad se puede pasar a modo autónomo: si el
     * profesor lleva semanas validando sin cambiar nada, su intervención ya no
     * está aportando y puede dejar de ser obligatoria.
     */
    const [untouched] = await sql<{ validated: string; untouched: string }[]>`
      SELECT
        COUNT(*)                          AS validated,
        COUNT(*) FILTER (WHERE untouched) AS untouched
      FROM (
        SELECT
          c.teacher_summary IS NULL
          AND c.teacher_latex IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM correction_items ci
            WHERE ci.correction_id = c.id
              AND (ci.teacher_points IS NOT NULL OR ci.teacher_feedback IS NOT NULL)
          ) AS untouched
        FROM corrections c
        WHERE c.validated_at IS NOT NULL
      ) per_correction
    `;

    const validatedCount = Number(untouched?.validated ?? 0);
    const untouchedCount = Number(untouched?.untouched ?? 0);

    const [lastRun] = await db
      .select()
      .from(schema.batchRuns)
      .orderBy(desc(schema.batchRuns.startedAt))
      .limit(1);

    const correctionsThisMonth = Number(totals?.corrections_this_month ?? 0);
    const costCents = Number(totals?.cost_cents ?? 0);

    return {
      counts,
      gradedLast30Days: Number(totals?.graded_30d ?? 0),
      usageThisMonth: {
        inputTokens: Number(totals?.input_tokens ?? 0),
        outputTokens: Number(totals?.output_tokens ?? 0),
        cachedInputTokens: Number(totals?.cached_input_tokens ?? 0),
        costCents,
      },
      avgCostCentsPerCorrection:
        correctionsThisMonth === 0 ? 0 : Math.round((costCents / correctionsThisMonth) * 100) / 100,
      avgTeacherDeviation:
        deviation?.avg_deviation == null ? 0 : Math.round(Number(deviation.avg_deviation) * 100) / 100,
      // Sin correcciones validadas todavía no hay señal: 0 es "aún no sabemos".
      untouchedRatio:
        validatedCount === 0 ? 0 : Math.round((untouchedCount / validatedCount) * 100) / 100,
      lastBatchRun: lastRun ? toBatchRun(lastRun) : null,
    };
  });

  /**
   * Desglose del gasto de una ventana por un eje. Es lo que convierte el panel
   * en algo accionable: el total no dice nada, «los foros de Lengua II se han
   * comido la mitad del mes» sí. Mismo periodo, otra dimensión, misma pantalla.
   */
  app.get(
    routes.costBreakdown,
    { preHandler: app.authenticate },
    async (request): Promise<CostBreakdownResponse> => {
      const { period, dimension } = parseOrThrow(
        z.object({
          period: CostPeriod.default('this_month'),
          dimension: CostDimension.default('activity_kind'),
        }),
        request.query,
        'Los filtros del panel',
      );

      /**
       * `all_time` no puede ser `-infinity`: el contrato devuelve una fecha ISO
       * y hay que poder rotular la ventana. Se ancla en la primera corrección.
       */
      const since =
        period === 'this_month'
          ? sql`date_trunc('month', now())`
          : period === 'last_30_days'
            ? sql`now() - interval '30 days'`
            : period === 'this_quarter'
              ? sql`date_trunc('quarter', now())`
              : sql`COALESCE((SELECT MIN(created_at) FROM corrections), now())`;

      // Un curso sin nombre existe: `course_name` es texto libre con default ''.
      const course = sql`NULLIF(a.course_name, '')`;

      const [key, label, kind, activityId, groupBy] =
        dimension === 'activity_kind'
          ? [sql`a.kind`, sql`a.kind`, sql`a.kind`, sql`NULL`, sql`a.kind`]
          : dimension === 'course'
            ? [
                // `key` no puede ser cadena vacía: el contrato la exige con `min(1)`
                // y una actividad sin curso reventaría la validación en el front.
                sql`COALESCE(${course}, 'sin-curso')`,
                sql`COALESCE(${course}, 'Sin curso')`,
                sql`NULL`,
                sql`NULL`,
                sql`a.course_name`,
              ]
            : [sql`a.id::text`, sql`a.name`, sql`a.kind`, sql`a.id`, sql`a.id, a.name, a.kind`];

      const rows = await sql<
        {
          key: string;
          label: string;
          kind: ActivityKind | null;
          activity_id: string | null;
          cost_cents: number;
          corrections: number;
        }[]
      >`
        SELECT
          ${key}          AS key,
          ${label}        AS label,
          ${kind}         AS kind,
          ${activityId}   AS activity_id,
          SUM(c.cost_cents)::float8 AS cost_cents,
          COUNT(*)::int             AS corrections
        FROM corrections c
        JOIN submissions s ON s.id = c.submission_id
        JOIN activities  a ON a.id = s.activity_id
        WHERE c.created_at >= ${since}
        GROUP BY ${groupBy}
        ORDER BY cost_cents DESC
      `;

      const [totals] = await sql<
        {
          from_ts: Date;
          to_ts: Date;
          input_tokens: number;
          output_tokens: number;
          cached_input_tokens: number;
          cost_cents: number;
          corrections: number;
        }[]
      >`
        SELECT
          ${since}  AS from_ts,
          now()     AS to_ts,
          COALESCE(SUM(input_tokens), 0)::int          AS input_tokens,
          COALESCE(SUM(output_tokens), 0)::int         AS output_tokens,
          COALESCE(SUM(cached_input_tokens), 0)::int   AS cached_input_tokens,
          COALESCE(SUM(cost_cents), 0)::float8         AS cost_cents,
          COUNT(*)::int                                AS corrections
        FROM corrections
        WHERE created_at >= ${since}
      `;

      const corrections = totals?.corrections ?? 0;
      const costCents = totals?.cost_cents ?? 0;

      const groups: CostGroup[] = rows.map((row) => ({
        key: row.key,
        // Al agrupar por tipo, la clave es el enum; la etiqueta legible vive en `@vega/shared`.
        label:
          dimension === 'activity_kind' && row.kind
            ? ACTIVITY_KIND_LABEL[row.kind]
            : row.label || 'Sin curso',
        activityId: row.activity_id,
        kind: row.kind,
        costCents: row.cost_cents,
        corrections: row.corrections,
        avgCostCents:
          row.corrections === 0 ? 0 : Math.round((row.cost_cents / row.corrections) * 10000) / 10000,
      }));

      return {
        period,
        from: (totals?.from_ts ?? new Date()).toISOString(),
        to: (totals?.to_ts ?? new Date()).toISOString(),
        dimension,
        usage: {
          inputTokens: totals?.input_tokens ?? 0,
          outputTokens: totals?.output_tokens ?? 0,
          cachedInputTokens: totals?.cached_input_tokens ?? 0,
          costCents,
        },
        corrections,
        avgCostCents:
          corrections === 0 ? 0 : Math.round((costCents / corrections) * 10000) / 10000,
        groups,
      };
    },
  );
}
