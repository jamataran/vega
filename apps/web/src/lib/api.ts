import { z } from 'zod';
import {
  ActivityFileListResponse,
  ActivityFileResponse,
  ActivityListResponse,
  ActivityResponse,
  ApiError,
  BatchRunListResponse,
  ContextListResponse,
  ContextResponse,
  CorrectionResponse,
  DiscoverActivitiesResponse,
  HealthResponse,
  ImportActivitiesResponse,
  LoginResponse,
  MeResponse,
  OverviewResponse,
  QueueCounts,
  QueueResponse,
  ResolvedContextResponse,
  SettingsResponse,
  SubmissionDetail,
  SubmissionResponse,
  TriggerBatchResponse,
  UserListResponse,
  UserResponse,
  routes,
} from '@vega/shared';
import type {
  ActivityKind,
  ContextLevel,
  CreateUserRequest,
  ImportActivitiesRequest,
  LoginRequest,
  SaveCorrectionRequest,
  SubmissionStatus,
  UpdateActivityRequest,
  UpdateContextRequest,
  UpdateSettingsRequest,
  UpdateUserRequest,
} from '@vega/shared';

const TOKEN_KEY = 'vega.token';

/** El contrato no exporta el tipo del código de error por separado; lo derivamos. */
export type ApiErrorCode = ApiError['error']['code'];

/**
 * Alta de un fichero de contexto. El API todavía no almacena el binario: recibe
 * los metadatos en JSON y devuelve el registro creado (ver `activities.ts`).
 */
export interface UploadActivityFileRequest {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

// ── Token ───────────────────────────────────────────────────────────────────

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* modo privado o almacenamiento lleno: la sesión durará lo que la pestaña */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nada que limpiar */
  }
}

/** Avisamos a la capa de sesión cuando el servidor rechaza el token. */
type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

// ── Error ───────────────────────────────────────────────────────────────────

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { status?: number; fields?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = options.status ?? 0;
    this.fields = options.fields ?? {};
  }
}

/** Mensaje presentable para cualquier fallo, venga de donde venga. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Ha ocurrido un error inesperado.';
}

/**
 * Mensaje que corresponde a un campo concreto del formulario. El API devuelve
 * `fields` en los 422, y así el error se enseña donde se origina y no sólo en
 * un aviso flotante.
 */
export function fieldError(error: unknown, field: string): string | undefined {
  return error instanceof ApiClientError ? error.fields[field] : undefined;
}

// ── Cliente ─────────────────────────────────────────────────────────────────

type QueryValue = string | number | boolean | undefined | null;

interface RequestOptions<S extends z.ZodTypeAny> {
  schema: S;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function handleUnauthorized(path: string): void {
  clearToken();
  for (const listener of unauthorizedListeners) listener();
  // En el propio login un 401 significa "credenciales incorrectas": no redirigimos.
  if (path !== routes.login && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

/** Traduce una respuesta de error del API a `ApiClientError`. */
function toClientError(status: number, raw: unknown): ApiClientError {
  const parsed = ApiError.safeParse(raw);
  if (parsed.success) {
    const { code, message, fields } = parsed.data.error;
    return new ApiClientError(code, message, { status, fields });
  }
  return new ApiClientError('INTERNAL', `Error ${status} del servidor.`, { status });
}

async function request<S extends z.ZodTypeAny>(
  path: string,
  options: RequestOptions<S>,
): Promise<z.infer<S>> {
  const { schema, method = 'GET', body, query, signal } = options;
  const headers = authHeaders({ Accept: 'application/json' });
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiClientError('INTERNAL', 'No se ha podido contactar con el servidor.');
  }

  if (response.status === 401) handleUnauthorized(path);

  const raw: unknown = await response.json().catch(() => null);

  if (!response.ok) throw toClientError(response.status, raw);

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiClientError('INTERNAL', 'La respuesta del servidor no tiene el formato esperado.', {
      status: response.status,
    });
  }
  return parsed.data as z.infer<S>;
}

/** Operaciones que responden 204: no hay cuerpo que validar. */
async function requestEmpty(
  path: string,
  method: 'POST' | 'DELETE' | 'PATCH' = 'DELETE',
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, { method, headers: authHeaders() });
  } catch {
    throw new ApiClientError('INTERNAL', 'No se ha podido contactar con el servidor.');
  }

  if (response.status === 401) handleUnauthorized(path);
  if (response.ok) return;

  const raw: unknown = await response.json().catch(() => null);
  throw toClientError(response.status, raw);
}

/** Nombre que propone el servidor en `Content-Disposition`, si lo propone. */
function filenameFromDisposition(response: Response): string | null {
  const header = response.headers.get('Content-Disposition');
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}

/**
 * Descarga un fichero protegido por el token.
 *
 * No sirve un `<a href>` normal: estas rutas exigen `Authorization`, así que
 * traemos el binario y se lo entregamos al navegador desde memoria.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, { headers: authHeaders() });
  } catch {
    throw new ApiClientError('INTERNAL', 'No se ha podido contactar con el servidor.');
  }

  if (response.status === 401) handleUnauthorized(path);

  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => null);
    throw toClientError(response.status, raw);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameFromDisposition(response) ?? fallbackName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ── Parámetros de la cola ───────────────────────────────────────────────────

/** Alias de tipo (no interfaz) para que sea asignable a `Record<string, QueryValue>`. */
export type QueueParams = {
  status?: SubmissionStatus;
  activityId?: string;
  kind?: ActivityKind;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: 'submittedAt' | 'confidence' | 'score';
  order?: 'asc' | 'desc';
};

// ── Superficie del API ──────────────────────────────────────────────────────

export const api = {
  health: (signal?: AbortSignal) => request(routes.health, { schema: HealthResponse, signal }),

  login: (body: LoginRequest) =>
    request(routes.login, { schema: LoginResponse, method: 'POST', body }),

  me: (signal?: AbortSignal) => request(routes.me, { schema: MeResponse, signal }),

  queue: (params: QueueParams, signal?: AbortSignal) =>
    request(routes.queue, { schema: QueueResponse, query: { ...params }, signal }),

  queueCounts: (signal?: AbortSignal) =>
    request(routes.queueCounts, { schema: QueueCounts, signal }),

  submission: (id: string, signal?: AbortSignal) =>
    request(routes.submission(id), { schema: SubmissionDetail, signal }),

  saveCorrection: (id: string, body: SaveCorrectionRequest) =>
    request(routes.saveCorrection(id), { schema: CorrectionResponse, method: 'PATCH', body }),

  /** Validar guarda y fija la corrección: comparte cuerpo con el guardado. */
  validate: (id: string, body: SaveCorrectionRequest) =>
    request(routes.validate(id), { schema: CorrectionResponse, method: 'POST', body }),

  publish: (id: string) =>
    request(routes.publish(id), { schema: CorrectionResponse, method: 'POST' }),

  reprocess: (id: string) =>
    request(routes.reprocess(id), { schema: SubmissionResponse, method: 'POST' }),

  downloadFeedback: (id: string, fallbackName: string) =>
    downloadFile(routes.feedbackFile(id), fallbackName),

  // ── Actividades ───────────────────────────────────────────────────────────

  activities: (signal?: AbortSignal) =>
    request(routes.activities, { schema: ActivityListResponse, signal }),

  activity: (id: string, signal?: AbortSignal) =>
    request(routes.activity(id), { schema: ActivityResponse, signal }),

  updateActivity: (id: string, body: UpdateActivityRequest) =>
    request(routes.activity(id), { schema: ActivityResponse, method: 'PATCH', body }),

  discoverActivities: (signal?: AbortSignal) =>
    request(routes.discoverActivities, { schema: DiscoverActivitiesResponse, signal }),

  importActivities: (body: ImportActivitiesRequest) =>
    request(routes.importActivities, { schema: ImportActivitiesResponse, method: 'POST', body }),

  activityFiles: (id: string, signal?: AbortSignal) =>
    request(routes.activityFiles(id), { schema: ActivityFileListResponse, signal }),

  addActivityFile: (id: string, body: UploadActivityFileRequest) =>
    request(routes.activityFiles(id), { schema: ActivityFileResponse, method: 'POST', body }),

  removeActivityFile: (activityId: string, fileId: string) =>
    requestEmpty(routes.activityFile(activityId, fileId), 'DELETE'),

  downloadActivityFile: (activityId: string, fileId: string, fallbackName: string) =>
    downloadFile(routes.activityFile(activityId, fileId), fallbackName),

  // ── Contextos ─────────────────────────────────────────────────────────────

  contexts: (signal?: AbortSignal) =>
    request(routes.contexts, { schema: ContextListResponse, signal }),

  updateContext: (level: ContextLevel, key: string, body: UpdateContextRequest) =>
    request(routes.context(level, key), { schema: ContextResponse, method: 'PUT', body }),

  resolvedContext: (activityId: string, signal?: AbortSignal) =>
    request(routes.resolvedContext(activityId), { schema: ResolvedContextResponse, signal }),

  // ── Usuarios ──────────────────────────────────────────────────────────────

  users: (signal?: AbortSignal) => request(routes.users, { schema: UserListResponse, signal }),

  createUser: (body: CreateUserRequest) =>
    request(routes.users, { schema: UserResponse, method: 'POST', body }),

  updateUser: (id: string, body: UpdateUserRequest) =>
    request(routes.user(id), { schema: UserResponse, method: 'PATCH', body }),

  // ── Ajustes ───────────────────────────────────────────────────────────────

  settings: (signal?: AbortSignal) => request(routes.settings, { schema: SettingsResponse, signal }),

  updateSettings: (body: UpdateSettingsRequest) =>
    request(routes.settings, { schema: SettingsResponse, method: 'PATCH', body }),

  // ── Panel y procesos ──────────────────────────────────────────────────────

  overview: (signal?: AbortSignal) => request(routes.overview, { schema: OverviewResponse, signal }),

  batchRuns: (signal?: AbortSignal) =>
    request(routes.batchRuns, { schema: BatchRunListResponse, signal }),

  triggerBatch: () =>
    request(routes.triggerBatch, { schema: TriggerBatchResponse, method: 'POST' }),
};
