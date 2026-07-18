import { z } from 'zod';
import {
  Activity,
  ActivityFile,
  AppSettings,
  BatchRun,
  Correction,
  GradingContext,
  Id,
  IsoDate,
  PointsAllocation,
  Submission,
  Transcription,
  UsageMetrics,
  User,
} from './domain.js';
import { ActivityKind, AutonomyMode, ContextLevel, SubmissionStatus, UserRole } from './enums.js';

/**
 * Contrato HTTP entre `apps/api` y `apps/web`.
 *
 * Convención: **toda respuesta es un objeto con una clave nombrada**
 * (`{ activity }`, `{ user }`, `{ items }`…), nunca la entidad pelada. Así se
 * puede añadir metadatos más adelante sin romper al cliente.
 */

// ── Envoltorio de error ─────────────────────────────────────────────────────

export const ApiErrorCode = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UNPROCESSABLE',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    /** Errores de validación por campo, cuando aplica. */
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/** Paginación uniforme para todos los listados. */
export const PageMeta = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type PageMeta = z.infer<typeof PageMeta>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), meta: PageMeta });
}

// ── Salud ───────────────────────────────────────────────────────────────────

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  database: z.enum(['up', 'down']),
  aiProvider: z.string(),
  lmsConnector: z.string(),
  uptimeSeconds: z.number().min(0),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// ── Autenticación ───────────────────────────────────────────────────────────

export const LoginRequest = z.object({
  email: z.string().email('Introduce un correo válido'),
  password: z.string().min(1, 'La contraseña es obligatoria'),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const LoginResponse = z.object({
  token: z.string(),
  expiresAt: IsoDate,
  user: User,
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const MeResponse = z.object({ user: User });
export type MeResponse = z.infer<typeof MeResponse>;

// ── Cola de revisión ────────────────────────────────────────────────────────

/** Fila de la cola: lo justo para pintarla sin traerse la corrección entera. */
export const QueueItem = z.object({
  submission: Submission,
  activity: z.object({
    id: Id,
    slug: z.string(),
    name: z.string(),
    kind: ActivityKind,
    courseName: z.string(),
    graded: z.boolean(),
    maxScore: z.number().nullable(),
  }),
  /** Nota efectiva propuesta. `null` si no hay corrección o no se puntúa. */
  score: z.number().nullable(),
  maxScore: z.number().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  /** Número de marcas [ILEGIBLE]/[DUDA] en la transcripción. */
  flagCount: z.number().int().min(0),
  /** Apartados que la IA marca con baja confianza. */
  lowConfidenceItems: z.number().int().min(0),
});
export type QueueItem = z.infer<typeof QueueItem>;

export const QueueQuery = z.object({
  status: SubmissionStatus.optional(),
  activityId: Id.optional(),
  kind: ActivityKind.optional(),
  /** Búsqueda libre sobre alias o referencia del alumno. */
  q: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sort: z.enum(['submittedAt', 'confidence', 'score']).default('submittedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type QueueQuery = z.infer<typeof QueueQuery>;

export const QueueResponse = paginated(QueueItem);
export type QueueResponse = z.infer<typeof QueueResponse>;

/** Recuento por estado, para las pestañas de la cola. */
export const QueueCounts = z.record(SubmissionStatus, z.number().int().min(0));
export type QueueCounts = z.infer<typeof QueueCounts>;

// ── Detalle de una entrega ──────────────────────────────────────────────────

export const SubmissionDetail = z.object({
  submission: Submission,
  activity: Activity,
  transcription: Transcription.nullable(),
  correction: Correction.nullable(),
  /** URLs de las páginas escaneadas. Vacío en actividades sin fichero. */
  scanUrls: z.array(z.string()),
});
export type SubmissionDetail = z.infer<typeof SubmissionDetail>;

export const SubmissionResponse = z.object({ submission: Submission });
export type SubmissionResponse = z.infer<typeof SubmissionResponse>;

/** Edición de un apartado por parte del profesor. */
export const CorrectionItemPatch = z.object({
  id: Id,
  /** `null` devuelve el apartado a la puntuación propuesta por la IA. */
  teacherPoints: z.number().min(0).nullable(),
  teacherFeedback: z.string().nullable(),
});
export type CorrectionItemPatch = z.infer<typeof CorrectionItemPatch>;

export const SaveCorrectionRequest = z.object({
  items: z.array(CorrectionItemPatch),
  teacherSummary: z.string().nullable(),
  /** LaTeX editado por el profesor. `null` deja el de la IA. */
  teacherLatex: z.string().nullable(),
});
export type SaveCorrectionRequest = z.infer<typeof SaveCorrectionRequest>;

export const CorrectionResponse = z.object({ correction: Correction, submission: Submission });
export type CorrectionResponse = z.infer<typeof CorrectionResponse>;

// ── Actividades ─────────────────────────────────────────────────────────────

export const ActivityListResponse = z.object({ items: z.array(Activity) });
export type ActivityListResponse = z.infer<typeof ActivityListResponse>;

export const ActivityResponse = z.object({ activity: Activity });
export type ActivityResponse = z.infer<typeof ActivityResponse>;

export const UpdateActivityRequest = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  graded: z.boolean().optional(),
  maxScore: z.number().positive().nullable().optional(),
  pointsAllocation: z.array(PointsAllocation).optional(),
  referenceSolution: z.string().nullable().optional(),
  autonomy: AutonomyMode.optional(),
});
export type UpdateActivityRequest = z.infer<typeof UpdateActivityRequest>;

/**
 * Una actividad que existe en Moodle pero que Vega todavía no gestiona. El
 * profesor elige de esta lista a cuáles quiere que reaccione la aplicación.
 */
export const DiscoveredActivity = z.object({
  moodleRef: z.string(),
  name: z.string(),
  kind: ActivityKind,
  courseName: z.string(),
  /** Entregas pendientes que Moodle reporta ahora mismo. */
  pendingCount: z.number().int().min(0),
  /** `true` si ya está dada de alta en Vega. */
  alreadyImported: z.boolean(),
});
export type DiscoveredActivity = z.infer<typeof DiscoveredActivity>;

export const DiscoverActivitiesResponse = z.object({ items: z.array(DiscoveredActivity) });
export type DiscoverActivitiesResponse = z.infer<typeof DiscoverActivitiesResponse>;

export const ImportActivitiesRequest = z.object({
  moodleRefs: z.array(z.string()).min(1, 'Selecciona al menos una actividad'),
});
export type ImportActivitiesRequest = z.infer<typeof ImportActivitiesRequest>;

export const ImportActivitiesResponse = z.object({ items: z.array(Activity) });
export type ImportActivitiesResponse = z.infer<typeof ImportActivitiesResponse>;

export const ActivityFileListResponse = z.object({ items: z.array(ActivityFile) });
export type ActivityFileListResponse = z.infer<typeof ActivityFileListResponse>;

export const ActivityFileResponse = z.object({ file: ActivityFile });
export type ActivityFileResponse = z.infer<typeof ActivityFileResponse>;

// ── Contextos de corrección ─────────────────────────────────────────────────

export const ContextListResponse = z.object({ items: z.array(GradingContext) });
export type ContextListResponse = z.infer<typeof ContextListResponse>;

export const ContextResponse = z.object({ context: GradingContext });
export type ContextResponse = z.infer<typeof ContextResponse>;

export const UpdateContextRequest = z.object({ content: z.string() });
export type UpdateContextRequest = z.infer<typeof UpdateContextRequest>;

/** Contexto efectivo de una actividad: los tres niveles ya resueltos. */
export const ResolvedContextResponse = z.object({
  global: z.string(),
  activityKind: z.string(),
  activity: z.string(),
  /** Lo que realmente se enviaría al modelo. */
  merged: z.string(),
  /** Ficheros que acompañan al contexto. */
  files: z.array(ActivityFile),
});
export type ResolvedContextResponse = z.infer<typeof ResolvedContextResponse>;

// ── Usuarios (sólo administrador) ───────────────────────────────────────────

export const UserListResponse = z.object({ items: z.array(User) });
export type UserListResponse = z.infer<typeof UserListResponse>;

export const UserResponse = z.object({ user: User });
export type UserResponse = z.infer<typeof UserResponse>;

export const CreateUserRequest = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  role: UserRole,
});
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;

export const UpdateUserRequest = z.object({
  name: z.string().min(1).optional(),
  role: UserRole.optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

// ── Ajustes (sólo administrador) ────────────────────────────────────────────

export const SettingsResponse = z.object({ settings: AppSettings });
export type SettingsResponse = z.infer<typeof SettingsResponse>;

/**
 * Los secretos se escriben pero no se leen. Enviar `null` en un secreto lo
 * borra; omitirlo lo deja como está.
 */
export const UpdateSettingsRequest = z.object({
  anthropic: z
    .object({
      apiKey: z.string().nullable().optional(),
      transcriptionModel: z.string().optional(),
      gradingModel: z.string().optional(),
      maxTokens: z.number().int().positive().optional(),
      provider: z.enum(['mock', 'anthropic']).optional(),
    })
    .optional(),
  moodle: z
    .object({
      baseUrl: z.string().optional(),
      token: z.string().nullable().optional(),
      connector: z.enum(['mock', 'filesystem', 'moodle3']).optional(),
    })
    .optional(),
  smtp: z
    .object({
      host: z.string().optional(),
      port: z.number().int().min(0).optional(),
      user: z.string().optional(),
      password: z.string().nullable().optional(),
      from: z.string().optional(),
    })
    .optional(),
  schedule: z
    .object({
      enabled: z.boolean().optional(),
      everyMinutes: z.number().int().positive().optional(),
    })
    .optional(),
  branding: z.object({ name: z.string().min(1).optional() }).optional(),
});
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;

// ── Panel ───────────────────────────────────────────────────────────────────

export const OverviewResponse = z.object({
  counts: QueueCounts,
  gradedLast30Days: z.number().int().min(0),
  usageThisMonth: UsageMetrics,
  /** Coste medio por corrección, en céntimos. */
  avgCostCentsPerCorrection: z.number().min(0),
  /**
   * Desviación media entre la nota propuesta por la IA y la validada por el
   * profesor, en puntos. Positiva = el profesor sube la nota. Es la métrica
   * que dice cuándo el contexto está lo bastante afinado para dar autonomía.
   */
  avgTeacherDeviation: z.number(),
  /** Proporción de correcciones que el profesor no ha tocado, 0–1. */
  untouchedRatio: z.number().min(0).max(1),
  lastBatchRun: BatchRun.nullable(),
});
export type OverviewResponse = z.infer<typeof OverviewResponse>;

// ── Procesos ────────────────────────────────────────────────────────────────

export const BatchRunListResponse = z.object({ items: z.array(BatchRun) });
export type BatchRunListResponse = z.infer<typeof BatchRunListResponse>;

export const TriggerBatchResponse = z.object({ run: BatchRun, queued: z.number().int().min(0) });
export type TriggerBatchResponse = z.infer<typeof TriggerBatchResponse>;

// ── Rutas ───────────────────────────────────────────────────────────────────

/** Fuente única de verdad de las rutas, para que el front no las escriba a mano. */
export const routes = {
  health: '/api/health',

  login: '/api/auth/login',
  me: '/api/auth/me',

  queue: '/api/submissions',
  queueCounts: '/api/submissions/counts',
  submission: (id: string) => `/api/submissions/${id}`,
  saveCorrection: (id: string) => `/api/submissions/${id}/correction`,
  validate: (id: string) => `/api/submissions/${id}/validate`,
  publish: (id: string) => `/api/submissions/${id}/publish`,
  reprocess: (id: string) => `/api/submissions/${id}/reprocess`,
  /** Descarga del PDF de feedback (original + páginas de corrección). */
  feedbackFile: (id: string) => `/api/submissions/${id}/feedback.pdf`,

  activities: '/api/activities',
  activity: (id: string) => `/api/activities/${id}`,
  discoverActivities: '/api/activities/discover',
  importActivities: '/api/activities/import',
  activityFiles: (id: string) => `/api/activities/${id}/files`,
  activityFile: (activityId: string, fileId: string) =>
    `/api/activities/${activityId}/files/${fileId}`,

  contexts: '/api/contexts',
  context: (level: ContextLevel, key: string) => `/api/contexts/${level}/${key}`,
  resolvedContext: (activityId: string) => `/api/contexts/resolved/${activityId}`,

  users: '/api/users',
  user: (id: string) => `/api/users/${id}`,

  settings: '/api/settings',

  overview: '/api/stats/overview',
  batchRuns: '/api/batch/runs',
  triggerBatch: '/api/batch/run',
} as const;
