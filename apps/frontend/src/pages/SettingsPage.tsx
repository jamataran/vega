import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type {
  AnthropicConnectionResponse,
  AppSettings,
  HealthResponse,
  UpdateSettingsRequest,
} from '@vega/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { formatDateTime, formatUptime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ErrorState, PageHeader, Section } from '@/components/common/Feedback';
import { Field } from '@/components/common/Field';
import { AnthropicConnectionResult } from '@/components/settings/AnthropicConnectionResult';
import { MoodleConnectionCard } from '@/components/settings/MoodleConnectionCard';
import { KEEP, SecretField, secretPatch } from '@/components/settings/SecretField';
import type { SecretState } from '@/components/settings/SecretField';

type Provider = AppSettings['anthropic']['provider'];
type Connector = AppSettings['moodle']['connector'];
type SectionId = 'anthropic' | 'moodle' | 'smtp' | 'schedule';

const PROVIDER_LABEL: Record<Provider, string> = {
  mock: 'Simulado — no consume tokens',
  anthropic: 'Anthropic',
};

const CONNECTOR_LABEL: Record<Connector, string> = {
  mock: 'Simulado — datos de prueba',
  filesystem: 'Sistema de ficheros',
  moodle3: 'Moodle 3',
};

interface FormState {
  provider: Provider;
  transcriptionModel: string;
  gradingModel: string;
  maxTokens: string;
  apiKey: SecretState;

  moodleBaseUrl: string;
  moodleConnector: Connector;

  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpFrom: string;
  smtpPassword: SecretState;

  scheduleEnabled: boolean;
  everyMinutes: string;
}

function fromSettings(settings: AppSettings): FormState {
  return {
    provider: settings.anthropic.provider,
    transcriptionModel: settings.anthropic.transcriptionModel,
    gradingModel: settings.anthropic.gradingModel,
    maxTokens: String(settings.anthropic.maxTokens),
    apiKey: KEEP,

    moodleBaseUrl: settings.moodle.baseUrl,
    moodleConnector: settings.moodle.connector,

    smtpHost: settings.smtp.host,
    smtpPort: String(settings.smtp.port),
    smtpUser: settings.smtp.user,
    smtpFrom: settings.smtp.from,
    smtpPassword: KEEP,

    scheduleEnabled: settings.schedule.enabled,
    everyMinutes: String(settings.schedule.everyMinutes),
  };
}

/** Entero dentro de rango, o `null` si lo escrito no vale. */
function parseInteger(raw: string, min: number): number | null {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : null;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-base text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-base">{value}</dd>
    </div>
  );
}

/**
 * Estado del despliegue. Lo ven todos los roles: saber si se está en el entorno
 * simulado o en producción importa antes de validar una nota, no sólo a quien
 * administra.
 */
function SystemStatus({
  healthQuery,
}: {
  healthQuery: UseQueryResult<HealthResponse>;
}) {
  const health = healthQuery.data;
  return (
    <Section
      title="Estado del sistema"
      actions={
        <Button
          size="sm"
          onClick={() => void healthQuery.refetch()}
          loading={healthQuery.isFetching}
        >
          <RefreshCw aria-hidden="true" />
          Comprobar
        </Button>
      }
    >
      {healthQuery.isError ? (
        <ErrorState
          title="El API no responde"
          error={healthQuery.error}
          onRetry={() => void healthQuery.refetch()}
        />
      ) : !health ? (
        <Skeleton className="h-40 w-full rounded-md" />
      ) : (
        <>
          <Badge variant={health.status === 'ok' ? 'success' : 'warning'}>
            {health.status === 'ok' ? 'Todo correcto' : 'Degradado'}
          </Badge>
          <dl className="mt-3 divide-y divide-border">
            <Row
              label="Base de datos"
              value={
                <span
                  className={cn(
                    health.database === 'up' ? 'text-success-ink' : 'text-destructive-ink',
                  )}
                >
                  {health.database === 'up' ? 'Conectada' : 'Caída'}
                </span>
              }
            />
            <Row
              label="Proveedor de IA"
              value={<span className="font-mono text-ui">{health.aiProvider}</span>}
            />
            <Row
              label="Conector LMS"
              value={<span className="font-mono text-ui">{health.lmsConnector}</span>}
            />
            <Row
              label="Versión"
              value={<span className="font-mono text-ui">{health.version}</span>}
            />
            <Row label="En marcha desde hace" value={formatUptime(health.uptimeSeconds)} />
          </dl>
        </>
      )}
    </Section>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const scheduleId = useId();
  const [saving, setSaving] = useState<SectionId | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // `GET /api/settings` es sólo de administración: pedirlo como profesor
  // devolvería 403 y pintaría un error en una pantalla que para él funciona.
  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => api.settings(signal),
    enabled: isAdmin,
  });

  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => api.health(signal),
    staleTime: 15_000,
  });

  const settings = settingsQuery.data?.settings ?? null;
  const [form, setForm] = useState<FormState | null>(null);
  const [anthropicTest, setAnthropicTest] = useState<AnthropicConnectionResponse | null>(null);
  const synced = useRef(false);

  useEffect(() => {
    if (settings && !synced.current) {
      synced.current = true;
      setForm(fromSettings(settings));
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (body: UpdateSettingsRequest) => api.updateSettings(body),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.settings, response);
      // Los secretos vuelven a su estado neutro: ya no hay nada sin aplicar.
      setForm((current) =>
        current ? { ...current, apiKey: KEEP, smtpPassword: KEEP } : current,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.health });
      notify.success('Ajustes guardados');
    },
    onError: (error) => notify.error('No se han podido guardar los ajustes', error),
    onSettled: () => setSaving(null),
  });

  // Prueba la conexión con Anthropic contra la configuración ya guardada. Como
  // en la de Moodle, una clave inválida llega con `ok: false` en el cuerpo, no
  // como error: se enseña en el mismo sitio donde se pega la clave.
  const testAnthropic = useMutation({
    mutationFn: () => api.testAnthropicConnection(),
    onSuccess: setAnthropicTest,
    onError: (error) => notify.error('No se ha podido probar la conexión', error),
  });

  // Un profesor no administra nada, pero sí tiene que poder pegar su token de
  // Moodle y ver en qué entorno está. Es su pantalla, más corta.
  if (!isAdmin) {
    return (
      <div className="pb-4">
        <PageHeader eyebrow="Tu cuenta" title="Ajustes">
          Tu conexión con Moodle y el estado de la instalación.
        </PageHeader>
        <div className="flex flex-col gap-3">
          <MoodleConnectionCard configured={user?.moodleTokenConfigured ?? false} />
          <SystemStatus healthQuery={healthQuery} />
        </div>
      </div>
    );
  }

  if (settingsQuery.isError) {
    return (
      <>
        <PageHeader eyebrow="Administración" title="Ajustes" />
        <ErrorState error={settingsQuery.error} onRetry={() => void settingsQuery.refetch()} />
      </>
    );
  }

  if (settingsQuery.isPending || !form || !settings) {
    return (
      <>
        <PageHeader eyebrow="Administración" title="Ajustes" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-56 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </>
    );
  }

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const save = (section: SectionId, body: UpdateSettingsRequest) => {
    setSaving(section);
    mutation.mutate(body);
  };

  const maxTokens = parseInteger(form.maxTokens, 1);
  const smtpPort = parseInteger(form.smtpPort, 0);
  const everyMinutes = parseInteger(form.everyMinutes, 1);

  // La prueba usa la configuración GUARDADA. Con cambios sin aplicar probaría la
  // anterior, así que se desactiva hasta guardar.
  const anthropicDirty =
    form.provider !== settings.anthropic.provider ||
    form.transcriptionModel !== settings.anthropic.transcriptionModel ||
    form.gradingModel !== settings.anthropic.gradingModel ||
    maxTokens !== settings.anthropic.maxTokens ||
    secretPatch(form.apiKey) !== undefined;

  // Con el proveedor «Anthropic» y sin clave guardada, probar sólo repetiría el
  // aviso que ya da el propio campo de la clave. El simulado sí se puede probar.
  const anthropicNeedsKey =
    settings.anthropic.provider === 'anthropic' && !settings.anthropic.apiKeyConfigured;

  const health = healthQuery.data;

  return (
    <div className="pb-4">
      <PageHeader eyebrow="Administración" title="Ajustes">
        La configuración de la aplicación manda sobre el fichero de entorno. Los secretos se
        escriben, nunca se leen.
      </PageHeader>

      <div className="flex flex-col gap-3">
        {/* Primero lo suyo, aunque administre: un admin también da de alta
            actividades y también necesita su propio token. */}
        <MoodleConnectionCard configured={user?.moodleTokenConfigured ?? false} />

        {/* ── Anthropic ─────────────────────────────────────────────────── */}
        <Section
          title="Anthropic"
          description="El proveedor de IA y los modelos con los que se transcribe y se corrige."
        >
          <div className="flex flex-col gap-4">
            <Field label="Proveedor">
              {({ id, ...aria }) => (
                <Select
                  value={form.provider}
                  onValueChange={(next) =>
                    update('provider', next === 'anthropic' ? 'anthropic' : 'mock')
                  }
                >
                  <SelectTrigger id={id} {...aria}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['mock', 'anthropic'] as const).map((option) => (
                      <SelectItem key={option} value={option}>
                        {PROVIDER_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Modelo de transcripción">
                {(field) => (
                  <Input
                    {...field}
                    value={form.transcriptionModel}
                    className="font-mono text-ui"
                    onChange={(event) => update('transcriptionModel', event.target.value)}
                  />
                )}
              </Field>
              <Field label="Modelo de corrección">
                {(field) => (
                  <Input
                    {...field}
                    value={form.gradingModel}
                    className="font-mono text-ui"
                    onChange={(event) => update('gradingModel', event.target.value)}
                  />
                )}
              </Field>
            </div>

            <Field
              label="Tokens máximos por respuesta"
              error={maxTokens === null ? 'Escribe un número entero mayor que cero.' : undefined}
            >
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  min={1}
                  step={256}
                  inputMode="numeric"
                  value={form.maxTokens}
                  className="max-w-40"
                  onChange={(event) => update('maxTokens', event.target.value)}
                />
              )}
            </Field>

            <SecretField
              label="Clave de API"
              configured={settings.anthropic.apiKeyConfigured}
              state={form.apiKey}
              onChange={(next) => update('apiKey', next)}
              hint="Sin clave, sólo funciona el proveedor simulado."
              autoComplete="new-password"
            />

            {anthropicTest ? <AnthropicConnectionResult result={anthropicTest} /> : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="lg"
                // Con cambios sin guardar, probar la configuración anterior
                // daría un resultado que no habla de lo que hay en pantalla; sin
                // clave con proveedor Anthropic, no hay nada que probar todavía.
                disabled={anthropicDirty || anthropicNeedsKey}
                loading={testAnthropic.isPending}
                onClick={() => testAnthropic.mutate()}
              >
                Probar conexión
              </Button>
              <Button
                variant="default"
                size="lg"
                disabled={maxTokens === null}
                loading={saving === 'anthropic'}
                onClick={() => {
                  if (maxTokens === null) return;
                  // Lo guardado invalida cualquier prueba anterior.
                  setAnthropicTest(null);
                  save('anthropic', {
                    anthropic: {
                      provider: form.provider,
                      transcriptionModel: form.transcriptionModel,
                      gradingModel: form.gradingModel,
                      maxTokens,
                      apiKey: secretPatch(form.apiKey),
                    },
                  });
                }}
              >
                Guardar Anthropic
              </Button>
            </div>
          </div>
        </Section>

        {/* ── Moodle ────────────────────────────────────────────────────── */}
        <Section title="Moodle" description="De dónde salen las actividades y las entregas.">
          <div className="flex flex-col gap-4">
            <Field label="URL de Moodle" hint="Por ejemplo, https://aula.tucentro.es">
              {(field) => (
                <Input
                  {...field}
                  type="url"
                  inputMode="url"
                  value={form.moodleBaseUrl}
                  placeholder="https://aula.tucentro.es"
                  onChange={(event) => update('moodleBaseUrl', event.target.value)}
                />
              )}
            </Field>

            <Field label="Conector">
              {({ id, ...aria }) => (
                <Select
                  value={form.moodleConnector}
                  onValueChange={(next) => {
                    if (next === 'mock' || next === 'filesystem' || next === 'moodle3') {
                      update('moodleConnector', next);
                    }
                  }}
                >
                  <SelectTrigger id={id} {...aria}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['mock', 'filesystem', 'moodle3'] as const).map((option) => (
                      <SelectItem key={option} value={option}>
                        {CONNECTOR_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <p className="text-ui text-muted-foreground">
              El token no se configura aquí: es personal de cada profesor y decide qué cursos ve.
              Cada uno pone el suyo en «Mi conexión con Moodle».
            </p>

            <div className="flex justify-end">
              <Button
                variant="default"
                size="lg"
                loading={saving === 'moodle'}
                onClick={() =>
                  save('moodle', {
                    moodle: {
                      baseUrl: form.moodleBaseUrl,
                      connector: form.moodleConnector,
                    },
                  })
                }
              >
                Guardar Moodle
              </Button>
            </div>
          </div>
        </Section>

        {/* ── SMTP ──────────────────────────────────────────────────────── */}
        <Section title="Correo" description="El servidor con el que Vega envía avisos.">
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <Field label="Servidor">
                {(field) => (
                  <Input
                    {...field}
                    value={form.smtpHost}
                    placeholder="smtp.tucentro.es"
                    onChange={(event) => update('smtpHost', event.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Puerto"
                error={smtpPort === null ? 'Número no válido.' : undefined}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={form.smtpPort}
                    onChange={(event) => update('smtpPort', event.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Usuario">
                {(field) => (
                  <Input
                    {...field}
                    autoComplete="off"
                    value={form.smtpUser}
                    onChange={(event) => update('smtpUser', event.target.value)}
                  />
                )}
              </Field>
              <Field label="Remitente">
                {(field) => (
                  <Input
                    {...field}
                    type="email"
                    inputMode="email"
                    value={form.smtpFrom}
                    placeholder="vega@tucentro.es"
                    onChange={(event) => update('smtpFrom', event.target.value)}
                  />
                )}
              </Field>
            </div>

            <SecretField
              label="Contraseña"
              configured={settings.smtp.passwordConfigured}
              state={form.smtpPassword}
              onChange={(next) => update('smtpPassword', next)}
              autoComplete="new-password"
            />

            <div className="flex justify-end">
              <Button
                variant="default"
                size="lg"
                disabled={smtpPort === null}
                loading={saving === 'smtp'}
                onClick={() => {
                  if (smtpPort === null) return;
                  save('smtp', {
                    smtp: {
                      host: form.smtpHost,
                      port: smtpPort,
                      user: form.smtpUser,
                      from: form.smtpFrom,
                      password: secretPatch(form.smtpPassword),
                    },
                  });
                }}
              >
                Guardar correo
              </Button>
            </div>
          </div>
        </Section>

        {/* ── Planificación ─────────────────────────────────────────────── */}
        <Section
          title="Planificación"
          description="Cada cuánto corre solo el proceso de corrección."
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor={scheduleId} className="text-base">
                  Proceso automático
                </Label>
                <p id={`${scheduleId}-hint`} className="mt-0.5 text-ui text-muted-foreground">
                  Si lo desactivas, sólo se corrige cuando alguien fuerza un proceso.
                </p>
              </div>
              <Switch
                id={scheduleId}
                checked={form.scheduleEnabled}
                onCheckedChange={(checked) => update('scheduleEnabled', checked)}
                aria-describedby={`${scheduleId}-hint`}
              />
            </div>

            <Field
              label="Cada cuántos minutos"
              error={everyMinutes === null ? 'Escribe un número entero de minutos.' : undefined}
            >
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={form.everyMinutes}
                  className="max-w-40"
                  onChange={(event) => update('everyMinutes', event.target.value)}
                />
              )}
            </Field>

            <dl className="divide-y divide-border">
              <Row
                label="Último proceso"
                value={
                  settings.schedule.lastRunAt
                    ? formatDateTime(settings.schedule.lastRunAt)
                    : 'Todavía ninguno'
                }
              />
              <Row
                label="Siguiente previsto"
                value={
                  settings.schedule.nextRunAt
                    ? formatDateTime(settings.schedule.nextRunAt)
                    : 'Sin planificar'
                }
              />
            </dl>

            <div className="flex justify-end">
              <Button
                variant="default"
                size="lg"
                disabled={everyMinutes === null}
                loading={saving === 'schedule'}
                onClick={() => {
                  if (everyMinutes === null) return;
                  save('schedule', {
                    schedule: { enabled: form.scheduleEnabled, everyMinutes },
                  });
                }}
              >
                Guardar planificación
              </Button>
            </div>
          </div>
        </Section>

        <SystemStatus healthQuery={healthQuery} />
      </div>
    </div>
  );
}
