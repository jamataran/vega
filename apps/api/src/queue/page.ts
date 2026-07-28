import type { ActivityKind, QueueItem, QueueQuery, QueueResponse, SubmissionStatus } from '@vega/shared';
import type { TokenPayload } from '../auth/plugin.js';
import type { AppContext } from '../context.js';
import { visibleActivityIds } from '../auth/scope.js';
import { toIso } from '../db/mappers.js';
import { getSettings } from '../settings/service.js';

/**
 * La consulta de la cola, en un módulo propio.
 *
 * La comparten la pantalla de revisión y la ficha de un proceso —«¿cuáles son
 * esas cinco entregas ingeridas?»— y ninguna de las dos puede tener su propia
 * copia: duplicar la consulta es duplicar el filtro de visibilidad, que es lo
 * último que conviene tener escrito dos veces. Vive fuera de las rutas para que
 * `batch.ts` pueda usarla sin importar `submissions.ts`, que ya importa de él.
 */

interface QueueRow {
  id: string;
  activity_id: string;
  student_ref: string;
  student_alias: string | null;
  status: SubmissionStatus;
  batch_run_id: string | null;
  ingested_run_id: string | null;
  parked_reason: string | null;
  parked_by: string | null;
  error_seen_at: Date | string | null;
  triage_label: QueueItem['submission']['triageLabel'];
  triage_confidence: string | null;
  original_filename: string | null;
  page_count: number;
  text_content: string | null;
  error_message: string | null;
  submitted_at: Date | string;
  updated_at: Date | string;
  a_slug: string;
  a_name: string;
  a_kind: ActivityKind;
  a_course_name: string;
  a_graded: boolean;
  a_max_score: string | null;
  c_confidence: string | null;
  score: string | null;
  low_confidence_items: string | null;
  flag_count: string | null;
  verification_issue_count: string | null;
  total_count: string;
}

/**
 * Filtros de una página de la cola.
 *
 * Es un objeto y no un fragmento de SQL para que ningún consumidor —hoy la
 * cola, mañana la ficha de un proceso— pueda colar texto libre en la consulta.
 */
export interface QueuePageFilter {
  readonly status?: SubmissionStatus;
  /** Todo menos este estado. Lo usa «procesadas», que es «no falladas». */
  readonly notStatus?: SubmissionStatus;
  readonly activityId?: string;
  readonly kind?: ActivityKind;
  /** Búsqueda libre sobre alias o referencia del alumno. */
  readonly q?: string;
  /** Entregas que **trajo del LMS** un proceso concreto. */
  readonly ingestedRunId?: string;
  /** Entregas que **procesó** un proceso concreto. */
  readonly batchRunId?: string;
  readonly sort?: QueueQuery['sort'];
  readonly order?: QueueQuery['order'];
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Una página de la cola, con el alcance del usuario ya aplicado.
 *
 * Vive fuera de la ruta porque la pantalla de procesos necesita exactamente
 * estas mismas filas —con su nota, su confianza y sus avisos— para poder
 * contestar «¿cuáles son esas cinco entregas ingeridas?». Duplicar la consulta
 * sería duplicar también el filtro de visibilidad, que es lo último que
 * conviene tener escrito dos veces.
 */
export async function queuePage(
  ctx: AppContext,
  user: TokenPayload,
  filter: QueuePageFilter,
): Promise<QueueResponse> {
  const { sql } = ctx;
  const offset = (filter.page - 1) * filter.pageSize;
  const { ai } = await getSettings(ctx);

  // Un profesor sólo ve las entregas de sus cursos. No es sólo un permiso:
  // son trabajos de alumnos concretos y enseñárselos a otro docente es un
  // asunto de protección de datos.
  const visible = await visibleActivityIds(ctx, user);

  // Lista blanca: el orden viene de la query, así que nunca se interpola texto libre.
  const orderColumn = {
    submittedAt: sql`s.submitted_at`,
    confidence: sql`c.confidence`,
    score: sql`agg.score`,
  }[filter.sort ?? 'submittedAt'];
  const direction = filter.order === 'asc' ? sql`ASC NULLS LAST` : sql`DESC NULLS LAST`;

  const rows = await sql<QueueRow[]>`
    SELECT
      s.*,
      a.slug          AS a_slug,
      a.name          AS a_name,
      a.kind          AS a_kind,
      a.course_name   AS a_course_name,
      a.graded        AS a_graded,
      a.max_score     AS a_max_score,
      c.confidence    AS c_confidence,
      agg.score,
      agg.low_confidence_items,
      COALESCE(jsonb_array_length(t.flags), 0) AS flag_count,
      COALESCE(jsonb_array_length(c.verification->'issues'), 0) AS verification_issue_count,
      COUNT(*) OVER () AS total_count
    FROM submissions s
    JOIN activities a ON a.id = s.activity_id
    LEFT JOIN corrections c ON c.submission_id = s.id
    LEFT JOIN transcriptions t ON t.submission_id = s.id
    LEFT JOIN LATERAL (
      SELECT
        SUM(COALESCE(ci.teacher_points, ci.ai_points))                       AS score,
        COUNT(*) FILTER (WHERE ci.confidence < ${ai.lowConfidenceThreshold}) AS low_confidence_items
      FROM correction_items ci
      WHERE ci.correction_id = c.id
    ) agg ON true
    WHERE TRUE
      ${visible === null ? sql`` : sql`AND s.activity_id = ANY(${visible}::uuid[])`}
      ${filter.status ? sql`AND s.status = ${filter.status}` : sql``}
      ${filter.notStatus ? sql`AND s.status <> ${filter.notStatus}` : sql``}
      ${filter.activityId ? sql`AND s.activity_id = ${filter.activityId}` : sql``}
      ${filter.kind ? sql`AND a.kind = ${filter.kind}` : sql``}
      ${filter.ingestedRunId ? sql`AND s.ingested_run_id = ${filter.ingestedRunId}` : sql``}
      ${filter.batchRunId ? sql`AND s.batch_run_id = ${filter.batchRunId}` : sql``}
      ${
        filter.q
          ? sql`AND (s.student_alias ILIKE ${`%${filter.q}%`} OR s.student_ref ILIKE ${`%${filter.q}%`})`
          : sql``
      }
    ORDER BY ${orderColumn} ${direction}, s.id
    LIMIT ${filter.pageSize} OFFSET ${offset}
  `;

  const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;

  const items: QueueItem[] = rows.map((row) => {
    const maxScore = row.a_max_score === null ? null : Number(row.a_max_score);
    // En una actividad no puntuable no hay nota que enseñar, aunque la
    // consulta agregue cero apartados.
    const score =
      !row.a_graded || row.score === null ? null : Math.round(Number(row.score) * 100) / 100;

    return {
      submission: {
        id: row.id,
        activityId: row.activity_id,
        studentRef: row.student_ref,
        studentAlias: row.student_alias,
        status: row.status,
        batchRunId: row.batch_run_id,
        ingestedRunId: row.ingested_run_id,
        parkedReason: row.parked_reason,
        parkedBy: row.parked_by,
        triageLabel: row.triage_label,
        triageConfidence: row.triage_confidence === null ? null : Number(row.triage_confidence),
        originalFilename: row.original_filename,
        pageCount: row.page_count,
        textContent: row.text_content,
        submittedAt: toIso(row.submitted_at),
        updatedAt: toIso(row.updated_at),
        errorMessage: row.error_message,
        errorSeenAt: row.error_seen_at === null ? null : toIso(row.error_seen_at),
      },
      activity: {
        id: row.activity_id,
        slug: row.a_slug,
        name: row.a_name,
        kind: row.a_kind,
        courseName: row.a_course_name,
        graded: row.a_graded,
        maxScore,
      },
      score,
      maxScore,
      confidence: row.c_confidence === null ? null : Number(row.c_confidence),
      lowConfidence:
        row.c_confidence !== null && Number(row.c_confidence) < ai.lowConfidenceThreshold,
      flagCount: Number(row.flag_count ?? 0),
      lowConfidenceItems: Number(row.low_confidence_items ?? 0),
      verificationIssueCount: Number(row.verification_issue_count ?? 0),
    };
  });

  return {
    items,
    meta: {
      page: filter.page,
      pageSize: filter.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filter.pageSize)),
    },
  };
}
