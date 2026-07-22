import { z } from 'zod';
import {
  Activity,
  ActivityFile,
  AppSettings,
  BatchRun,
  Correction,
  DiscoveredCourse,
  GradingContext,
  Id,
  IsoDate,
  PointsAllocation,
  Student,
  Submission,
  Transcription,
  UsageMetrics,
  User,
} from './domain.js';
import { ActivityKind, AutonomyMode, ContextLevel, SubmissionStatus, UserRole } from './enums.js';

/**
 * Contrato HTTP entre `apps/api` y `apps/frontend`.
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
  /**
   * El LMS ha rechazado la credencial. Es un problema de configuración, no de
   * sesión, y por eso **no es `UNAUTHORIZED`**: el cliente cierra la sesión al
   * recibir un 401, y echar al profesor de Vega porque su token de Moodle ha
   * caducado sería absurdo. La UI lleva a Ajustes y no ofrece reintentar.
   */
  'LMS_AUTH',
  /** El LMS no responde. Se puede reintentar sin cambiar nada. */
  'LMS_UNAVAILABLE',
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
  /**
   * Ficha del alumno. `null` en entregas sembradas o cuando el LMS no deja leer
   * perfiles. **Es lo que Vega guarda, no lo que el modelo ve**: al prompt sólo
   * viaja el recorte de `studentContextFor()`.
   */
  student: Student.nullable(),
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
  /** Con prefijo de tipo: `assign-42`, `forum-42`. Ver `Activity.moodleRef`. */
  moodleRef: z.string(),
  name: z.string(),
  kind: ActivityKind,
  /** Curso del que cuelga, para poder filtrar en origen. */
  moodleCourseId: z.string(),
  courseName: z.string(),
  /**
   * Lo que el LMS reporta pendiente ahora mismo, **orientativo**: en una
   * entrega son entregas y en un foro son debates, así que los dos números no
   * son comparables y ninguna decisión del sistema depende de ellos.
   */
  pendingCount: z.number().int().min(0),
  /** `true` si ya está dada de alta en Vega. */
  alreadyImported: z.boolean(),
});
export type DiscoveredActivity = z.infer<typeof DiscoveredActivity>;

export const DiscoverActivitiesResponse = z.object({ items: z.array(DiscoveredActivity) });
export type DiscoverActivitiesResponse = z.infer<typeof DiscoverActivitiesResponse>;

/** Query de `GET /api/activities/discover`: el curso es obligatorio. */
export const DiscoverActivitiesQuery = z.object({
  moodleCourseId: z.string().min(1, 'Elige primero un curso'),
});
export type DiscoverActivitiesQuery = z.infer<typeof DiscoverActivitiesQuery>;

/** Cursos que el token del profesor ve en Moodle. */
export const DiscoverCoursesResponse = z.object({ items: z.array(DiscoveredCourse) });
export type DiscoverCoursesResponse = z.infer<typeof DiscoverCoursesResponse>;

export const ImportActivitiesRequest = z.object({
  /** Curso del que se importan. Se crea en Vega si aún no existe. */
  moodleCourseId: z.string().min(1),
  moodleRefs: z.array(z.string()).min(1, 'Selecciona al menos una actividad'),
});
export type ImportActivitiesRequest = z.infer<typeof ImportActivitiesRequest>;

export const ImportActivitiesResponse = z.object({ items: z.array(Activity) });
export type ImportActivitiesResponse = z.infer<typeof ImportActivitiesResponse>;

/**
 * Lo que se ha destruido al borrar una actividad.
 *
 * Se devuelve para poder decirlo después —«se han borrado 12 entregas»— en vez
 * de un «hecho» que no permite comprobar si se borró lo que se creía.
 *
 * **El borrado es sólo dentro de Vega.** No se llama al LMS en ningún momento:
 * la actividad sigue en Moodle, y las notas que ya se hubieran publicado siguen
 * publicadas allí. Borrar aquí no retira nada de lo que el alumnado ya ha visto.
 */
export const DeleteActivityResponse = z.object({
  submissions: z.number().int().min(0),
  corrections: z.number().int().min(0),
  /** De las anteriores, cuántas llegaron a publicarse en el LMS. */
  published: z.number().int().min(0),
});
export type DeleteActivityResponse = z.infer<typeof DeleteActivityResponse>;

export const ActivityFileListResponse = z.object({ items: z.array(ActivityFile) });
export type ActivityFileListResponse = z.infer<typeof ActivityFileListResponse>;

export const ActivityFileResponse = z.object({ file: ActivityFile });
export type ActivityFileResponse = z.infer<typeof ActivityFileResponse>;

/** Tope del contenido guardado por fichero, sumando todos sus trozos. */
export const MAX_FILE_CONTENT_BYTES = 4 * 1024 * 1024;

/**
 * Tamaño de cada trozo de subida.
 *
 * La subida va **troceada**, y no por capricho: entre el navegador y Vega hay un
 * proxy inverso —Cloudflare en el despliegue real— con su propio tope de cuerpo
 * de petición, y Fastify trae además un `bodyLimit` de 1 MiB por defecto. Un
 * fichero mediano mandado de una vez se rechazaría con un 413 que no depende de
 * Vega y que el profesor no puede arreglar. 256 KiB entra con holgura en
 * cualquiera de los dos.
 */
export const UPLOAD_CHUNK_BYTES = 256 * 1024;

/**
 * Comienzo de una subida.
 *
 * El contenido no viaja aquí: esta llamada sólo reserva el fichero y devuelve
 * su identificador, y los trozos van después. Los ficheros que llegan al modelo
 * son `.tex` y `.md`, que ya son texto, así que se manda texto en JSON y no
 * `multipart/form-data`.
 */
export const BeginActivityFileUploadRequest = z.object({
  filename: z.string().min(1, 'El fichero necesita un nombre'),
  mimeType: z.string().min(1).default('text/plain'),
  /**
   * Tamaño anunciado, para rechazar lo que no cabe **antes** de subir nada en
   * vez de al llegar al último trozo.
   */
  sizeBytes: z.number().int().min(0).max(MAX_FILE_CONTENT_BYTES, 'El fichero es demasiado grande'),
  /**
   * `false` en binarios: se registra el fichero como referencia del profesor,
   * sin trozos y sin contenido, y no forma parte del contexto.
   */
  hasContent: z.boolean(),
});
export type BeginActivityFileUploadRequest = z.infer<typeof BeginActivityFileUploadRequest>;

/** Un trozo. El orden lo impone `index`, no el orden de llegada. */
export const AppendActivityFileChunkRequest = z.object({
  index: z.number().int().min(0),
  content: z.string().max(UPLOAD_CHUNK_BYTES * 2, 'El trozo es demasiado grande'),
});
export type AppendActivityFileChunkRequest = z.infer<typeof AppendActivityFileChunkRequest>;

/** Acuse de un trozo: cuánto lleva recibido el servidor. */
export const AppendActivityFileChunkResponse = z.object({
  receivedBytes: z.number().int().min(0),
});
export type AppendActivityFileChunkResponse = z.infer<typeof AppendActivityFileChunkResponse>;

/** Contenido de un fichero de contexto, para verlo o editarlo sin descargarlo. */
export const ActivityFileContentResponse = z.object({
  file: ActivityFile,
  content: z.string().nullable(),
});
export type ActivityFileContentResponse = z.infer<typeof ActivityFileContentResponse>;

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
  /**
   * Token de Moodle, opcional, en el momento del alta.
   *
   * Sin esto, un profesor recién creado entra en Vega y no puede hacer **nada**
   * —sin token no ve ningún curso— hasta que alguien vuelva a su ficha. Como es
   * el administrador quien lo emite en Moodle, dejarlo en el mismo formulario
   * ahorra el viaje de vuelta.
   */
  moodleToken: z.string().min(1).nullable().optional(),
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

// ── Credencial de Moodle de cada usuario ────────────────────────────────────

/**
 * El token de Moodle es **de cada profesor, no de la instalación**.
 *
 * `core_enrol_get_users_courses` devuelve los cursos que ve *ese* token, así que
 * la credencial decide qué cursos ofrece la aplicación. Un token compartido
 * enseñaría a todo el claustro los cursos de todo el claustro. La URL y el
 * conector sí son de instalación y los pone el administrador en Ajustes.
 */
export const UpdateMoodleTokenRequest = z.object({
  /** `null` borra el token guardado. */
  token: z.string().min(1, 'Pega el token que te da Moodle').nullable(),
});
export type UpdateMoodleTokenRequest = z.infer<typeof UpdateMoodleTokenRequest>;

/**
 * Una función del servicio web, comprobada por separado.
 *
 * Se prueban **una a una y no se para en la primera que falle**: Moodle no
 * añade ninguna función al crear un servicio externo, hay que listarlas a mano,
 * y lo normal es que falten varias. Parar en la primera obligaría a ir
 * arreglando de una en una, con un viaje al panel de Moodle por cada una.
 */
export const MoodleCheck = z.object({
  /** Nombre exacto de la función, para poder buscarlo en Moodle. */
  name: z.string(),
  /** Para qué la usa Vega, en cristiano. */
  label: z.string(),
  /**
   * `skipped` no es `failed`: hay comprobaciones que dependen de otra —listar
   * cursos necesita el id de usuario que devuelve `get_site_info`— y darlas por
   * fallidas mandaría al profesor a habilitar funciones que quizá ya están.
   */
  status: z.enum(['ok', 'failed', 'skipped']),
  /** Qué ha pasado: el error de Moodle, o qué se ha obtenido si fue bien. */
  detail: z.string(),
  /**
   * `false` en las que todavía no usa ninguna pantalla —ingesta y publicación,
   * que llegan en hitos posteriores—. Se comprueban igual, porque es mejor
   * enterarse al configurar que la primera noche que corra el proceso.
   */
  required: z.boolean(),
});
export type MoodleCheck = z.infer<typeof MoodleCheck>;

/**
 * Resultado de probar la conexión con Moodle con el token del usuario.
 *
 * No es 200/500: un token inválido es una respuesta legítima de esta ruta, y el
 * profesor necesita leer *por qué* falla. Por eso el fallo viaja en el cuerpo.
 */
export const MoodleConnectionResponse = z.object({
  /** `true` sólo si pasan **todas** las funciones imprescindibles. */
  ok: z.boolean(),
  /** Qué ha fallado, en un lenguaje que lleve a la solución. */
  message: z.string(),
  /** Sólo si se pudo identificar: con qué Moodle y como quién. */
  siteName: z.string().nullable(),
  username: z.string().nullable(),
  /** Cursos que ese token alcanza. Es la señal de que el token sirve de algo. */
  courseCount: z.number().int().min(0).nullable(),
  /** Una entrada por función probada, en el orden en que se necesitan. */
  checks: z.array(MoodleCheck),
});
export type MoodleConnectionResponse = z.infer<typeof MoodleConnectionResponse>;

// ── Prueba de conexión con Anthropic (sólo administrador) ───────────────────

/**
 * Resultado de probar la conexión con Anthropic con la clave y el modelo
 * configurados.
 *
 * Como la prueba de Moodle, **no es 200/500**: una clave inválida es una
 * respuesta legítima de esta ruta, y el administrador necesita leer *por qué*
 * falla en el mismo sitio donde acaba de pegarla. Por eso el fallo viaja en el
 * cuerpo con `ok: false`.
 */
export const AnthropicConnectionResponse = z.object({
  /** `true` sólo si la llamada de prueba a Anthropic ha respondido. */
  ok: z.boolean(),
  /** Qué ha pasado, en un lenguaje que lleve a la solución. */
  message: z.string(),
  /** Con qué proveedor se ha probado: el simulado no consume tokens. */
  provider: z.enum(['mock', 'anthropic']),
  /** Modelo con el que se ha probado, o `null` si no se llegó a llamar. */
  model: z.string().nullable(),
  /** Consumo de la prueba. `null` en el proveedor simulado. */
  usage: UsageMetrics.nullable(),
});
export type AnthropicConnectionResponse = z.infer<typeof AnthropicConnectionResponse>;

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

// ── Panel: desglose de coste ────────────────────────────────────────────────

/**
 * Ventana temporal del desglose. Presets en vez de fechas libres: la pregunta
 * real es «¿cuánto llevo este mes?», no «¿cuánto gasté un martes concreto?».
 */
export const CostPeriod = z.enum(['this_month', 'last_30_days', 'this_quarter', 'all_time']);
export type CostPeriod = z.infer<typeof CostPeriod>;

/** Eje por el que se desglosa el gasto del periodo. */
export const CostDimension = z.enum(['activity_kind', 'course', 'activity']);
export type CostDimension = z.infer<typeof CostDimension>;

export const CostGroup = z.object({
  /** Clave estable de la fila: el `ActivityKind`, el nombre del curso o el id. */
  key: z.string().min(1),
  label: z.string().min(1),
  /** Sólo con dimensión `activity`: deja abrir su ficha desde el panel. */
  activityId: Id.nullable(),
  /** `null` al agrupar por curso, donde conviven entregas y foros. */
  kind: ActivityKind.nullable(),
  costCents: z.number().min(0),
  corrections: z.number().int().min(0),
  avgCostCents: z.number().min(0),
});
export type CostGroup = z.infer<typeof CostGroup>;

export const CostBreakdownResponse = z.object({
  period: CostPeriod,
  /** Extremos reales de la ventana, para rotularla sin recalcularla en el front. */
  from: IsoDate,
  to: IsoDate,
  dimension: CostDimension,
  usage: UsageMetrics,
  corrections: z.number().int().min(0),
  avgCostCents: z.number().min(0),
  /**
   * Ordenados de más caro a más barato: la primera fila es la que hay que
   * mirar. Sólo entran actividades con gasto en la ventana.
   */
  groups: z.array(CostGroup),
});
export type CostBreakdownResponse = z.infer<typeof CostBreakdownResponse>;

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
  /** Cursos que ve el token del profesor. Primer paso del alta de actividades. */
  discoverCourses: '/api/courses/discover',
  discoverActivities: '/api/activities/discover',
  importActivities: '/api/activities/import',
  activityFiles: (id: string) => `/api/activities/${id}/files`,
  activityFile: (activityId: string, fileId: string) =>
    `/api/activities/${activityId}/files/${fileId}`,
  activityFileContent: (activityId: string, fileId: string) =>
    `/api/activities/${activityId}/files/${fileId}/content`,
  /** Subida troceada: reservar con `activityFiles`, mandar trozos, cerrar. */
  activityFileChunk: (activityId: string, fileId: string) =>
    `/api/activities/${activityId}/files/${fileId}/chunk`,
  activityFileComplete: (activityId: string, fileId: string) =>
    `/api/activities/${activityId}/files/${fileId}/complete`,

  contexts: '/api/contexts',
  context: (level: ContextLevel, key: string) => `/api/contexts/${level}/${key}`,
  resolvedContext: (activityId: string) => `/api/contexts/resolved/${activityId}`,

  users: '/api/users',
  user: (id: string) => `/api/users/${id}`,
  /**
   * Token de Moodle de otro usuario, sólo administración.
   *
   * Existe porque en Moodle un administrador **sí** puede emitir tokens a
   * nombre de otro, y esperar a que cada profesor navegue hasta sus claves de
   * seguridad es la diferencia entre desplegar Vega en una tarde y no
   * desplegarla. Se escribe, nunca se lee: tampoco un administrador ve el valor.
   */
  userMoodleToken: (id: string) => `/api/users/${id}/moodle-token`,
  testUserMoodleConnection: (id: string) => `/api/users/${id}/moodle-token/test`,

  settings: '/api/settings',
  /** Prueba la conexión con Anthropic con la clave y el modelo configurados. Sólo admin. */
  testAnthropicConnection: '/api/settings/anthropic/test',
  /** Token de Moodle del usuario en sesión. Cualquier rol; sólo el suyo. */
  myMoodleToken: '/api/auth/me/moodle-token',
  testMyMoodleConnection: '/api/auth/me/moodle-token/test',

  overview: '/api/stats/overview',
  costBreakdown: '/api/stats/cost',
  batchRuns: '/api/batch/runs',
  triggerBatch: '/api/batch/run',
} as const;
