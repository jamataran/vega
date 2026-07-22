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
import { ACTIVITY_KIND_LABEL, AI_OPERATION_LABEL, CostDimension, CostPeriod, routes } from '@vega/shared';
import { currentUser } from '../auth/plugin.js';
import { seesEverything, visibleActivityIds } from '../auth/scope.js';
import { schema } from '../db/client.js';
import { toBatchRun, toIso } from '../db/mappers.js';
import { parseOrThrow } from '../http/errors.js';
import type { AppContext } from '../context.js';

export async function statsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, sql } = ctx;

  app.get(
    routes.overview,
    { preHandler: app.authenticate },
    async (request): Promise<OverviewResponse> => {
      const user = currentUser(request);

      /**
       * El panel tiene que cuadrar con la cola: si un profesor ve doce entregas
       * pendientes y el resumen le dice cuarenta, deja de fiarse de los dos. Y
       * el gasto ajeno no es sólo ruido —es el presupuesto de otro curso, que
       * no tiene por qué conocer.
       *
       * Un profesor sin ninguna actividad alcanzable llega con `[]`, y
       * `= ANY('{}'::uuid[])` no casa con ninguna fila: ve ceros. Es justo lo
       * contrario de lo que haría un `IN ()` armado a mano, que se quedaría sin
       * condición y le enseñaría el total del claustro.
       */
      const visible = await visibleActivityIds(ctx, user);
      const mine = visible === null ? sql`` : sql`AND s.activity_id = ANY(${visible}::uuid[])`;

      const counts = {
        pending: 0,
        transcribing: 0,
        transcribed: 0,
        grading: 0,
        graded: 0,
        parked: 0,
        validated: 0,
        published: 0,
        error: 0,
      } satisfies QueueCounts;

      const statusRows = await sql<{ status: SubmissionStatus; count: string }[]>`
        SELECT s.status, COUNT(*) AS count
        FROM submissions s
        WHERE TRUE
          ${mine}
        GROUP BY s.status
      `;
      for (const row of statusRows) counts[row.status] = Number(row.count);

      /**
       * `corrections` no guarda de qué actividad viene: hay que pasar por la
       * entrega. El JOIN es 1:1 —`submission_id` es único y obligatorio— así
       * que no duplica filas ni cambia los totales de quien lo ve todo.
       */
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
          COUNT(*) FILTER (WHERE c.created_at >= now() - interval '30 days')          AS graded_30d,
          COALESCE(SUM(c.input_tokens)        FILTER (WHERE c.created_at >= date_trunc('month', now())), 0) AS input_tokens,
          COALESCE(SUM(c.output_tokens)       FILTER (WHERE c.created_at >= date_trunc('month', now())), 0) AS output_tokens,
          COALESCE(SUM(c.cached_input_tokens) FILTER (WHERE c.created_at >= date_trunc('month', now())), 0) AS cached_input_tokens,
          COALESCE(SUM(c.cost_cents)          FILTER (WHERE c.created_at >= date_trunc('month', now())), 0) AS cost_cents,
          COUNT(*)                            FILTER (WHERE c.created_at >= date_trunc('month', now()))     AS corrections_this_month
        FROM corrections c
        JOIN submissions s ON s.id = c.submission_id
        WHERE TRUE
          ${mine}
      `;

      /**
       * Desviación media IA vs profesor: por cada corrección ya validada,
       * la diferencia entre lo que puso el profesor y lo que propuso la IA.
       * Positiva ⇒ el profesor tiende a subir la nota.
       *
       * Acotarla importa más que en las demás: es una medida de **criterio
       * docente**, y promediarla con la de otros la vuelve un dato de nadie.
       */
      const [deviation] = await sql<{ avg_deviation: string | null }[]>`
        SELECT AVG(diff) AS avg_deviation
        FROM (
          SELECT SUM(COALESCE(ci.teacher_points, ci.ai_points) - ci.ai_points) AS diff
          FROM corrections c
          JOIN correction_items ci ON ci.correction_id = c.id
          JOIN submissions s ON s.id = c.submission_id
          WHERE c.validated_at IS NOT NULL
            ${mine}
          GROUP BY c.id
        ) per_correction
      `;

      /**
       * Proporción de correcciones validadas que el profesor **no ha tocado**:
       * ni puntos, ni feedback de apartado, ni resumen, ni LaTeX. Es la métrica
       * que dice cuándo una actividad se puede pasar a modo autónomo: si el
       * profesor lleva semanas validando sin cambiar nada, su intervención ya no
       * está aportando y puede dejar de ser obligatoria.
       *
       * Por eso mismo tiene que ser suya y no del claustro: la decisión de
       * soltar la validación se toma sobre las actividades de uno, y el ratio
       * de un compañero meticuloso escondería que las propias ya no se tocan.
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
          JOIN submissions s ON s.id = c.submission_id
          WHERE c.validated_at IS NOT NULL
            ${mine}
        ) per_correction
      `;

      const validatedCount = Number(untouched?.validated ?? 0);
      const untouchedCount = Number(untouched?.untouched ?? 0);
      const [quality] = await sql<{
        readings: string;
        readings_clean: string;
        deductions: string;
        deductions_cited: string;
        verifications: string;
        verifications_clean: string;
        simulated_calls: string;
        real_calls: string;
        unpriced_calls: string;
      }[]>`
        SELECT
          (SELECT COUNT(*) FROM transcriptions t JOIN submissions s ON s.id = t.submission_id WHERE TRUE ${mine}) AS readings,
          (SELECT COUNT(*) FROM transcriptions t JOIN submissions s ON s.id = t.submission_id WHERE jsonb_array_length(COALESCE(t.discrepancies, '[]'::jsonb)) = 0 ${mine}) AS readings_clean,
          (SELECT COUNT(*) FROM correction_items ci JOIN corrections c ON c.id = ci.correction_id JOIN submissions s ON s.id = c.submission_id WHERE ci.ai_points < ci.max_points ${mine}) AS deductions,
          (SELECT COUNT(*) FROM correction_items ci JOIN corrections c ON c.id = ci.correction_id JOIN submissions s ON s.id = c.submission_id WHERE ci.ai_points < ci.max_points AND ci.ai_quote IS NOT NULL ${mine}) AS deductions_cited,
          (SELECT COUNT(*) FROM corrections c JOIN submissions s ON s.id = c.submission_id WHERE c.verification IS NOT NULL ${mine}) AS verifications,
          (SELECT COUNT(*) FROM corrections c JOIN submissions s ON s.id = c.submission_id WHERE c.verification IS NOT NULL AND jsonb_array_length(COALESCE(c.verification->'issues', '[]'::jsonb)) = 0 ${mine}) AS verifications_clean,
          (SELECT COUNT(*) FROM ai_calls ac JOIN submissions s ON s.id = ac.submission_id WHERE ac.simulated ${mine}) AS simulated_calls,
          (SELECT COUNT(*) FROM ai_calls ac JOIN submissions s ON s.id = ac.submission_id WHERE NOT ac.simulated ${mine}) AS real_calls,
          (SELECT COUNT(*) FROM ai_calls ac JOIN submissions s ON s.id = ac.submission_id WHERE ac.cost_cents IS NULL AND ac.error IS NULL ${mine}) AS unpriced_calls
      `;
      const ratio = (part: string | undefined, total: string | undefined): number => {
        const denominator = Number(total ?? 0);
        return denominator === 0 ? 0 : Math.round((Number(part ?? 0) / denominator) * 10_000) / 10_000;
      };
      const citationsVerified = ratio(quality?.deductions_cited, quality?.deductions);
      const readingsWithoutDiscrepancy = ratio(quality?.readings_clean, quality?.readings);
      const verificationsWithoutIssues = ratio(quality?.verifications_clean, quality?.verifications);
      const untouchedRatio = validatedCount === 0 ? 0 : Math.round((untouchedCount / validatedCount) * 100) / 100;
      const reliabilityScore = Math.round(((citationsVerified + readingsWithoutDiscrepancy + verificationsWithoutIssues + untouchedRatio) / 4) * 10_000) / 10_000;
      const simulatedCalls = Number(quality?.simulated_calls ?? 0);
      const realCalls = Number(quality?.real_calls ?? 0);

      /**
       * El último lote se reserva a administración.
       *
       * Un `batch_run` es una ejecución del sistema entera: recorre las entregas
       * de todo el claustro y sus cifras —procesadas, fallidas, autopublicadas,
       * coste— son la suma de todas. Y no hay manera de recortarlo: `batch_runs`
       * no guarda de qué corrección sale cada número, así que la tarjeta o se
       * enseña entera o no se enseña. Entera, a un profesor le estaría diciendo
       * el gasto de la academia sin darle nada sobre lo suyo, justo lo que este
       * alcance viene a evitar. Y es información de operación: quién lanza el
       * proceso nocturno y quién tiene que enterarse de que ha fallado es
       * administración, no el profesorado.
       */
      const [lastRun] = seesEverything(user)
        ? await db
            .select()
            .from(schema.batchRuns)
            .orderBy(desc(schema.batchRuns.startedAt))
            .limit(1)
        : [];

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
          correctionsThisMonth === 0
            ? 0
            : Math.round((costCents / correctionsThisMonth) * 100) / 100,
        avgTeacherDeviation:
          deviation?.avg_deviation == null
            ? 0
            : Math.round(Number(deviation.avg_deviation) * 100) / 100,
        // Sin correcciones validadas todavía no hay señal: 0 es "aún no sabemos".
        untouchedRatio,
        reliability: {
          score: reliabilityScore,
          citationsVerified,
          readingsWithoutDiscrepancy,
          verificationsWithoutIssues,
        },
        aiMode: simulatedCalls > 0 && realCalls > 0 ? 'mixed' : realCalls > 0 ? 'real' : simulatedCalls > 0 ? 'simulated' : 'none',
        unpricedCalls: Number(quality?.unpriced_calls ?? 0),
        lastBatchRun: lastRun ? toBatchRun(lastRun) : null,
      };
    },
  );

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

      // Mismo alcance que el resumen: el desglose es la vista que más delata
      // —nombra cursos y actividades una a una—, así que un profesor sólo puede
      // ver filas suyas y el total tiene que ser la suma de esas filas y de
      // ninguna más.
      const visible = await visibleActivityIds(ctx, currentUser(request));
      const mine = visible === null ? sql`` : sql`AND s.activity_id = ANY(${visible}::uuid[])`;

      /**
       * `all_time` no puede ser `-infinity`: el contrato devuelve una fecha ISO
       * y hay que poder rotular la ventana. Se ancla en la primera corrección
       * **del propio alcance**: anclarla en la del claustro rotularía «desde
       * marzo» a quien empezó en octubre, y de paso contaría cuándo arrancó la
       * academia.
       */
      const since =
        period === 'this_month'
          ? sql`date_trunc('month', now())`
          : period === 'last_30_days'
            ? sql`now() - interval '30 days'`
            : period === 'this_quarter'
              ? sql`date_trunc('quarter', now())`
              : sql`COALESCE((
                  SELECT MIN(c.created_at)
                  FROM corrections c
                  JOIN submissions s ON s.id = c.submission_id
                  WHERE TRUE
                    ${mine}
                ), now())`;

      // El nombre sale de `courses` y no de la copia `a.course_name`: es la que
      // se actualiza al re-sincronizar. Agrupar por la copia partía en dos el
      // gasto de un curso en cuanto alguien lo renombraba en Moodle, que es
      // justo el defecto que la entidad `courses` vino a arreglar.
      const courseName = sql`NULLIF(COALESCE(co.name, a.course_name), '')`;

      if (dimension === 'operation') {
        const operationRows = await sql<{
          operation: keyof typeof AI_OPERATION_LABEL;
          input_tokens: number;
          output_tokens: number;
          cached_tokens: number;
          cost_cents: number;
          corrections: number;
          from_ts: Date;
          to_ts: Date;
        }[]>`
          SELECT ac.operation,
                 SUM(ac.input_tokens)::int AS input_tokens,
                 SUM(ac.output_tokens)::int AS output_tokens,
                 SUM(ac.cache_read_tokens)::int AS cached_tokens,
                 COALESCE(SUM(ac.cost_cents), 0)::float8 AS cost_cents,
                 COUNT(DISTINCT ac.submission_id)::int AS corrections,
                 MIN(ac.created_at) AS from_ts,
                 MAX(ac.created_at) AS to_ts
            FROM ai_calls ac
            LEFT JOIN submissions s ON s.id = ac.submission_id
           WHERE ac.created_at >= ${since}
             AND ac.submission_id IS NOT NULL
             ${mine}
           GROUP BY ac.operation
           ORDER BY cost_cents DESC
        `;
        const totals = operationRows.reduce(
          (total, row) => ({
            inputTokens: total.inputTokens + row.input_tokens,
            outputTokens: total.outputTokens + row.output_tokens,
            cachedInputTokens: total.cachedInputTokens + row.cached_tokens,
            costCents: total.costCents + row.cost_cents,
            corrections: total.corrections + row.corrections,
          }),
          { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costCents: 0, corrections: 0 },
        );
        const first = operationRows.at(-1);
        const last = operationRows[0];
        return {
          period,
          from: toIso(first?.from_ts ?? new Date()),
          to: toIso(last?.to_ts ?? new Date()),
          dimension,
          usage: {
            inputTokens: totals.inputTokens,
            outputTokens: totals.outputTokens,
            cachedInputTokens: totals.cachedInputTokens,
            costCents: totals.costCents,
          },
          corrections: totals.corrections,
          avgCostCents: totals.corrections === 0 ? 0 : totals.costCents / totals.corrections,
          groups: operationRows.map((row) => ({
            key: row.operation,
            label: AI_OPERATION_LABEL[row.operation],
            activityId: null,
            kind: null,
            costCents: row.cost_cents,
            corrections: row.corrections,
            avgCostCents: row.corrections === 0 ? 0 : row.cost_cents / row.corrections,
          })),
        };
      }

      const [key, label, kind, activityId, groupBy] =
        dimension === 'activity_kind'
          ? [sql`a.kind`, sql`a.kind`, sql`a.kind`, sql`NULL`, sql`a.kind`]
          : dimension === 'course'
            ? [
                // `key` no puede ser cadena vacía: el contrato la exige con `min(1)`
                // y una actividad sin curso reventaría la validación en el front.
                // El id del curso es estable aunque le cambien el nombre.
                sql`COALESCE(a.course_id::text, 'sin-curso')`,
                sql`COALESCE(${courseName}, 'Sin curso')`,
                sql`NULL`,
                sql`NULL`,
                sql`a.course_id, co.name, a.course_name`,
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
        LEFT JOIN courses co ON co.id = a.course_id
        WHERE c.created_at >= ${since}
          ${mine}
        GROUP BY ${groupBy}
        ORDER BY cost_cents DESC
      `;

      const [totals] = await sql<
        {
          from_ts: Date | string;
          to_ts: Date | string;
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
          COALESCE(SUM(c.input_tokens), 0)::int          AS input_tokens,
          COALESCE(SUM(c.output_tokens), 0)::int         AS output_tokens,
          COALESCE(SUM(c.cached_input_tokens), 0)::int   AS cached_input_tokens,
          COALESCE(SUM(c.cost_cents), 0)::float8         AS cost_cents,
          COUNT(*)::int                                  AS corrections
        FROM corrections c
        JOIN submissions s ON s.id = c.submission_id
        WHERE c.created_at >= ${since}
          ${mine}
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
        from: toIso(totals?.from_ts ?? new Date()),
        to: toIso(totals?.to_ts ?? new Date()),
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
