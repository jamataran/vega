import { useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AUTONOMY_MODE_HELP, AUTONOMY_MODE_LABEL, AutonomyMode } from '@vega/shared';
import type { Activity, PointsAllocation, UpdateActivityRequest } from '@vega/shared';
import { ApiClientError, api, fieldError } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { EmptyState, ErrorState, PageHeader, Section } from '@/components/common/Feedback';
import { ActivityKindBadge } from '@/components/common/status';
import { Field } from '@/components/common/Field';
import { PreviewEditor } from '@/components/PreviewEditor';
import { PointsAllocationEditor } from '@/components/activity/PointsAllocationEditor';
import { ActivityFilesEditor } from '@/components/activity/ActivityFilesEditor';
import { DeleteActivity } from '@/components/activity/DeleteActivity';

/**
 * La nota máxima vive como texto en el formulario: el campo puede estar vacío
 * mientras se escribe, y vacío no es lo mismo que cero.
 */
interface FormState {
  name: string;
  enabled: boolean;
  graded: boolean;
  maxScore: string;
  referenceSolution: string;
  pointsAllocation: PointsAllocation[];
  autonomy: AutonomyMode;
}

function fromActivity(activity: Activity): FormState {
  return {
    name: activity.name,
    enabled: activity.enabled,
    graded: activity.graded,
    maxScore: activity.maxScore === null ? '' : String(activity.maxScore),
    referenceSolution: activity.referenceSolution ?? '',
    pointsAllocation: activity.pointsAllocation.map((row) => ({ ...row })),
    autonomy: activity.autonomy,
  };
}

/** `''` es "sin nota máxima"; cualquier otra cosa, el número que se haya escrito. */
function parseMaxScore(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ActivityDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const enabledId = useId();
  const gradedId = useId();

  const query = useQuery({
    queryKey: queryKeys.activity(id),
    queryFn: ({ signal }) => api.activity(id, signal),
    enabled: id !== '',
  });
  const activity = query.data?.activity ?? null;

  const [form, setForm] = useState<FormState | null>(null);
  const syncedFor = useRef<string | null>(null);

  useEffect(() => {
    if (activity && syncedFor.current !== activity.id) {
      syncedFor.current = activity.id;
      setForm(fromActivity(activity));
    }
  }, [activity]);

  const mutation = useMutation({
    mutationFn: (body: UpdateActivityRequest) => api.updateActivity(id, body),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.activity(id), response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities });
      syncedFor.current = null;
      notify.success('Actividad guardada');
    },
    onError: (error) => notify.error('No se ha podido guardar la actividad', error),
  });

  // ── Contexto de nivel actividad ───────────────────────────────────────────
  const contextsQuery = useQuery({
    queryKey: queryKeys.contexts,
    queryFn: ({ signal }) => api.contexts(signal),
  });

  const storedContext = activity
    ? (contextsQuery.data?.items.find(
        (item) => item.level === 'activity' && item.key === activity.slug,
      ) ?? null)
    : null;
  const [contextDraft, setContextDraft] = useState<string | null>(null);
  const contextValue = contextDraft ?? storedContext?.content ?? '';
  const contextDirty = contextValue !== (storedContext?.content ?? '');

  const contextMutation = useMutation({
    mutationFn: () =>
      api.updateContext('activity', activity?.slug ?? '', { content: contextValue }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contexts });
      setContextDraft(null);
      notify.success('Contexto de la actividad guardado');
    },
    onError: (error) => notify.error('No se ha podido guardar el contexto', error),
  });

  const notFound =
    id === '' ||
    (query.error instanceof ApiClientError && query.error.code === 'NOT_FOUND');

  if (notFound) {
    return (
      <EmptyState
        title="Esta actividad no existe"
        description="Puede que se haya eliminado desde Moodle."
        action={
          <Button asChild variant="link">
            <Link to="/actividades">Volver a las actividades</Link>
          </Button>
        }
      />
    );
  }

  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  if (query.isPending || !form || !activity) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    );
  }

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const maxScoreError = fieldError(mutation.error, 'maxScore');
  // El tipo no se edita (viene de Moodle), así que sale de la actividad y no
  // del formulario.
  const isForum = activity.kind === 'forum';

  const onSubmit = () => {
    const maxScore = parseMaxScore(form.maxScore);
    const body: UpdateActivityRequest = {
      name: form.name,
      enabled: form.enabled,
      graded: form.graded,
      maxScore,
      // Sin nota no hay reparto que enviar.
      pointsAllocation: form.graded ? form.pointsAllocation : [],
      referenceSolution: form.referenceSolution.trim() === '' ? null : form.referenceSolution,
      autonomy: form.autonomy,
    };
    mutation.mutate(body);
  };

  return (
    <div className="pb-4">
      <PageHeader eyebrow={activity.courseName} title={activity.name}>
        <span className="flex flex-wrap items-center gap-2">
          <ActivityKindBadge kind={activity.kind} />
          <span className="font-mono text-ui">{activity.slug}</span>
          {activity.moodleRef ? (
            <>
              <span className="text-border-strong">·</span>
              <span className="text-ui">
                Moodle <span className="font-mono">{activity.moodleRef}</span>
              </span>
            </>
          ) : null}
        </span>
      </PageHeader>

      <div className="flex flex-col gap-3">
        <Section title="Identidad">
          <div className="flex flex-col gap-4">
            <Field label="Nombre">
              {(field) => (
                <Input
                  {...field}
                  value={form.name}
                  onChange={(event) => update('name', event.target.value)}
                />
              )}
            </Field>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor={enabledId} className="text-base">
                  Actividad activa
                </Label>
                <p id={`${enabledId}-hint`} className="mt-0.5 text-ui text-muted-foreground">
                  Las actividades inactivas no entran en los procesos de corrección.
                </p>
              </div>
              <Switch
                id={enabledId}
                checked={form.enabled}
                onCheckedChange={(checked) => update('enabled', checked)}
                aria-describedby={`${enabledId}-hint`}
              />
            </div>
          </div>
        </Section>

        <Section title="Puntuación">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor={gradedId} className="text-base">
                  Se puntúa
                </Label>
                <p id={`${gradedId}-hint`} className="mt-0.5 text-ui text-muted-foreground">
                  Si la desactivas, Vega publica sólo feedback cualitativo, sin nota ni apartados.
                </p>
              </div>
              <Switch
                id={gradedId}
                checked={form.graded}
                onCheckedChange={(checked) => update('graded', checked)}
                aria-describedby={`${gradedId}-hint`}
              />
            </div>

            {form.graded ? (
              <Field
                label="Nota máxima"
                error={maxScoreError}
                hint="Obligatoria en una actividad puntuable."
              >
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    min={0.25}
                    step={0.25}
                    inputMode="decimal"
                    value={form.maxScore}
                    placeholder="10"
                    className="max-w-32"
                    onChange={(event) => update('maxScore', event.target.value)}
                  />
                )}
              </Field>
            ) : null}
          </div>
        </Section>

        {form.graded ? (
          <Section
            title="Reparto de puntos"
            description="Cuánto vale cada apartado. La IA lo usa como rúbrica."
          >
            <PointsAllocationEditor
              rows={form.pointsAllocation}
              maxScore={parseMaxScore(form.maxScore)}
              onChange={(rows) => update('pointsAllocation', rows)}
            />
          </Section>
        ) : null}

        <Section
          title="Autonomía"
          description="Cuánta intervención tuya exige esta actividad antes de publicar."
        >
          <div className="flex flex-col gap-3">
            <Field label="Modo de autonomía" hint={AUTONOMY_MODE_HELP[form.autonomy]}>
              {({ id: fieldId, ...aria }) => (
                <Select
                  value={form.autonomy}
                  onValueChange={(next) => {
                    const parsed = AutonomyMode.safeParse(next);
                    if (parsed.success) update('autonomy', parsed.data);
                  }}
                >
                  <SelectTrigger id={fieldId} {...aria}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AutonomyMode.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {AUTONOMY_MODE_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            {form.autonomy === 'autonomous' ? (
              <Alert variant="warning">
                <AlertDescription>
                  En este modo Vega publica el feedback en Moodle sin que nadie lo revise. Actívalo
                  sólo cuando lleves tiempo validando sin cambiar nada.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        </Section>

        {/*
          El mismo campo con dos papeles. En una entrega es la solución contra la
          que se contrasta lo que escribe el alumno; en un foro no hay nada que
          contrastar, es el material sobre el que preguntan. Llamarlo por su
          nombre en cada caso evita que el profesor crea que está redactando la
          respuesta que Vega va a copiar.
        */}
        <Section title={isForum ? 'Material asociado' : 'Solución de referencia'}>
          <PreviewEditor
            label={isForum ? 'Material del profesor' : 'Solución del profesor'}
            mode="latex"
            value={form.referenceSolution}
            onChange={(value) => update('referenceSolution', value)}
            placeholder={
              isForum
                ? 'El tema sobre el que preguntan: $\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$…'
                : "La derivada es $f'(x) = 2x + 3$…"
            }
            hint={
              isForum
                ? 'Texto o LaTeX. Orienta lo que Vega responde; no reparte puntos ni produce nota.'
                : 'Texto o LaTeX. Escribe las fórmulas entre $…$ para verlas renderizadas.'
            }
          />
        </Section>
      </div>

      {/* Guardar al alcance del pulgar y siempre visible sobre la navegación. */}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+3.5rem)] z-10 mt-4 md:bottom-4">
        <Button
          variant="default"
          size="lg"
          className="w-full"
          loading={mutation.isPending}
          onClick={onSubmit}
        >
          Guardar actividad
        </Button>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <Section
          title="Contexto de esta actividad"
          description="El nivel más específico: manda sobre el contexto global y el del tipo de actividad."
        >
          {contextsQuery.isError ? (
            <ErrorState
              error={contextsQuery.error}
              onRetry={() => void contextsQuery.refetch()}
            />
          ) : contextsQuery.isPending ? (
            <Skeleton className="h-40 w-full rounded-md" />
          ) : (
            <div className="flex flex-col gap-4">
              <PreviewEditor
                label="Indicaciones específicas"
                mode="markdown"
                value={contextValue}
                minHeight="12rem"
                placeholder={
                  '- Penaliza 0,25 si no simplifica el resultado\n- Acepta el método de sustitución'
                }
                onChange={setContextDraft}
                hint={
                  storedContext
                    ? `Última edición: ${formatDateTime(storedContext.updatedAt)}`
                    : 'Esta actividad todavía no tiene contexto propio.'
                }
              />

              <div className="flex items-center justify-between gap-3">
                <p className="text-ui text-muted-foreground" aria-live="polite">
                  {contextDirty ? 'Cambios sin guardar' : 'Todo guardado'}
                </p>
                <Button
                  size="lg"
                  disabled={!contextDirty}
                  loading={contextMutation.isPending}
                  onClick={() => contextMutation.mutate()}
                >
                  Guardar contexto
                </Button>
              </div>
            </div>
          )}
        </Section>

        <Section
          title="Ficheros de contexto"
          description="El enunciado o el material en .tex o .md viajan al modelo al corregir. Otros formatos se guardan como referencia tuya."
        >
          <ActivityFilesEditor activityId={activity.id} files={activity.files} />
        </Section>

        <DeleteActivity activity={activity} />
      </div>
    </div>
  );
}
