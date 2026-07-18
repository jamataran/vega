import { desc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { OverviewResponse, QueueCounts, SubmissionStatus } from '@vega/shared';
import { routes } from '@vega/shared';
import { schema } from '../db/client.js';
import { toBatchRun } from '../db/mappers.js';
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
}
