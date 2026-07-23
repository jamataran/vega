import { eq } from 'drizzle-orm';
import type { ActivityKind, AppSettings, UpdateSettingsRequest } from '@vega/shared';
import { schema } from '../db/client.js';
import type { AppContext } from '../context.js';

/**
 * Ajustes editables desde la aplicación.
 *
 * Viven en `app_settings` (clave/valor) y **mandan sobre el `.env`**: el
 * fichero de entorno es sólo el valor de arranque de una instalación nueva.
 * Así el administrador cambia el modelo o la frecuencia del proceso sin
 * redesplegar el contenedor.
 *
 * Los secretos se marcan con `is_secret` y NUNCA salen por la API: sólo se
 * informa de si están configurados.
 */

// `moodle.token` ya no está aquí: el token de Moodle es de cada usuario
// (`users.moodle_token`), porque decide qué cursos ve. Ver `lms/factory.ts`.
const SECRET_KEYS = new Set(['anthropic.apiKey', 'smtp.password']);

type SettingsMap = Map<string, { value: string; isSecret: boolean }>;

async function readAll(ctx: AppContext): Promise<SettingsMap> {
  const rows = await ctx.db.select().from(schema.appSettings);
  return new Map(rows.map((row) => [row.key, { value: row.value, isSecret: row.isSecret }]));
}

const str = (map: SettingsMap, key: string, fallback: string): string =>
  map.get(key)?.value ?? fallback;

const int = (map: SettingsMap, key: string, fallback: number): number => {
  const raw = map.get(key)?.value;
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const decimal = (map: SettingsMap, key: string, fallback: number): number => {
  const raw = map.get(key)?.value;
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (map: SettingsMap, key: string, fallback: boolean): boolean => {
  const raw = map.get(key)?.value;
  return raw === undefined || raw === '' ? fallback : raw === 'true';
};

const configured = (map: SettingsMap, key: string): boolean => (map.get(key)?.value ?? '') !== '';

/**
 * La planificación es por tipo de actividad: los foros piden cadencia corta y
 * las entregas pueden ir espaciadas. Las claves antiguas (`schedule.enabled`,
 * `schedule.everyMinutes`, `schedule.lastRunAt`) sirven de respaldo para que
 * una instalación anterior conserve su comportamiento sin tocar nada.
 */
function scheduleSlot(
  map: SettingsMap,
  kind: ActivityKind,
  defaultMinutes: number,
): AppSettings['schedule'][ActivityKind] {
  const enabled = bool(map, `schedule.${kind}.enabled`, bool(map, 'schedule.enabled', false));
  const everyMinutes = int(
    map,
    `schedule.${kind}.everyMinutes`,
    int(map, 'schedule.everyMinutes', defaultMinutes),
  );
  const lastRunRaw = str(map, `schedule.${kind}.lastRunAt`, str(map, 'schedule.lastRunAt', ''));
  const lastRunAt = lastRunRaw === '' ? null : lastRunRaw;
  return {
    enabled,
    everyMinutes,
    lastRunAt,
    nextRunAt:
      enabled && lastRunAt !== null
        ? new Date(new Date(lastRunAt).getTime() + everyMinutes * 60_000).toISOString()
        : null,
  };
}

export async function getSettings(ctx: AppContext): Promise<AppSettings> {
  const map = await readAll(ctx);
  const { config } = ctx;

  const legacyReadingModel = str(
    map,
    'anthropic.transcriptionModel',
    config.AI_MODEL_TRANSCRIPTION,
  );
  const readingModel = str(map, 'anthropic.readingModel', legacyReadingModel);

  return {
    anthropic: {
      // El `.env` cuenta como configurado: es lo que usa una instalación nueva.
      apiKeyConfigured: configured(map, 'anthropic.apiKey') || Boolean(config.ANTHROPIC_API_KEY),
      transcriptionModel: readingModel,
      readingModel,
      gradingModel: str(map, 'anthropic.gradingModel', config.AI_MODEL_GRADING),
      verifyModel: str(map, 'anthropic.verifyModel', 'claude-sonnet-5'),
      triageModel: str(map, 'anthropic.triageModel', 'claude-haiku-4-5'),
      maxTokens: int(map, 'anthropic.maxTokens', 8192),
      provider: str(map, 'anthropic.provider', config.AI_PROVIDER) as 'mock' | 'anthropic',
    },
    ai: {
      transport: str(map, 'ai.transport', 'sync') as 'batch' | 'sync',
      verify: bool(map, 'ai.verify', true),
      explanations: bool(map, 'ai.explanations', true),
      lowConfidenceThreshold: decimal(map, 'ai.lowConfidenceThreshold', 0.75),
      pagesPerChunk: int(map, 'ai.pagesPerChunk', 4),
      logRetentionDays: int(map, 'ai.logRetentionDays', 180),
    },
    ingest: {
      // Sin límite por defecto: una instalación nueva no debe descartar en
      // silencio entregas que su profesorado sí quiere corregir. Quien conecta
      // un curso con historial lo pone a lo que le sirva.
      maxAgeDays: Math.max(0, int(map, 'ingest.maxAgeDays', 0)),
    },
    moodle: {
      baseUrl: str(map, 'moodle.baseUrl', config.MOODLE_BASE_URL ?? ''),
      connector: str(map, 'moodle.connector', config.LMS_CONNECTOR) as
        | 'mock'
        | 'filesystem'
        | 'moodle3',
    },
    smtp: {
      host: str(map, 'smtp.host', ''),
      port: int(map, 'smtp.port', 587),
      user: str(map, 'smtp.user', ''),
      passwordConfigured: configured(map, 'smtp.password'),
      from: str(map, 'smtp.from', ''),
    },
    schedule: {
      // Sin claves guardadas, una hora para entregas y un cuarto de hora para
      // foros: una duda no debería esperar a la cadencia del lote pesado.
      assignment: scheduleSlot(map, 'assignment', 60),
      forum: scheduleSlot(map, 'forum', 15),
    },
    branding: { name: str(map, 'branding.name', config.BRAND_NAME) },
  };
}

/**
 * Aplana `{ anthropic: { apiKey } }` a `anthropic.apiKey`, saltando lo no
 * enviado. Recorre en profundidad porque `schedule` anida un nivel más
 * (`schedule.assignment.enabled`).
 */
function flatten(patch: UpdateSettingsRequest): Map<string, string | null> {
  const flat = new Map<string, string | null>();
  const walk = (prefix: string, values: Record<string, unknown>): void => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const key = prefix === '' ? name : `${prefix}.${name}`;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        walk(key, value as Record<string, unknown>);
      } else {
        flat.set(key, value === null ? null : String(value));
      }
    }
  };
  walk('', patch as Record<string, unknown>);
  return flat;
}

export async function updateSettings(
  ctx: AppContext,
  patch: UpdateSettingsRequest,
  userId: string,
): Promise<AppSettings> {
  const flat = flatten(patch);

  await ctx.db.transaction(async (tx) => {
    for (const [key, value] of flat) {
      // `null` en un secreto lo borra; en el resto guarda cadena vacía.
      const stored = value ?? '';
      await tx
        .insert(schema.appSettings)
        .values({ key, value: stored, isSecret: SECRET_KEYS.has(key), updatedBy: userId })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: stored, updatedBy: userId, updatedAt: new Date() },
        });
    }
  });

  return getSettings(ctx);
}

/** Deja constancia de cuándo corrió el proceso de un tipo, para calcular el siguiente. */
export async function markScheduleRun(
  ctx: AppContext,
  kind: ActivityKind,
  when: Date,
): Promise<void> {
  await ctx.db
    .insert(schema.appSettings)
    .values({ key: `schedule.${kind}.lastRunAt`, value: when.toISOString() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: when.toISOString(), updatedAt: new Date() },
    });
}

/** Lee un secreto para uso interno. Nunca debe cruzar la frontera HTTP. */
export async function readSecret(ctx: AppContext, key: string): Promise<string | undefined> {
  const [row] = await ctx.db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .limit(1);
  const value = row?.value ?? '';
  return value === '' ? undefined : value;
}
