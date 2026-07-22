import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIVITY_KIND_LABEL, ActivityKind } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorState, PageHeader, Section } from '@/components/common/Feedback';
import { Field } from '@/components/common/Field';
import { PreviewEditor } from '@/components/PreviewEditor';
import { Markdown } from '@/components/Markdown';

/**
 * Los dos niveles generales del contexto. El tercero, el de la actividad, vive
 * en su propia ficha: allí es donde el profesor tiene delante el enunciado, el
 * reparto de puntos y la solución de referencia.
 */
type EditableLevel = 'global' | 'activity_kind';

const LEVEL_TAB: Record<EditableLevel, string> = {
  global: 'Global',
  activity_kind: 'Por tipo',
};

const LEVEL_TITLE: Record<EditableLevel, string> = {
  global: 'Contexto global',
  activity_kind: 'Contexto por tipo de actividad',
};

const LEVEL_HINT: Record<EditableLevel, string> = {
  global: 'Se aplica a todas las correcciones, sea cual sea la actividad.',
  activity_kind:
    'Se suma a las instrucciones globales. Lo que vale para una entrega no vale para un foro.',
};

export function ContextPage() {
  const queryClient = useQueryClient();

  const [level, setLevel] = useState<EditableLevel>('global');
  const [kind, setKind] = useState<ActivityKind>('assignment');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);
  const [resolvedPick, setResolvedPick] = useState('');

  const contextsQuery = useQuery({
    queryKey: queryKeys.contexts,
    queryFn: ({ signal }) => api.contexts(signal),
  });
  const activitiesQuery = useQuery({
    queryKey: queryKeys.activities,
    queryFn: ({ signal }) => api.activities(signal),
    staleTime: 5 * 60 * 1000,
  });

  const activities = useMemo(() => activitiesQuery.data?.items ?? [], [activitiesQuery.data]);

  const selectedKey = level === 'global' ? 'global' : kind;
  const draftId = `${level}:${selectedKey}`;

  const stored = contextsQuery.data?.items.find(
    (item) => item.level === level && item.key === selectedKey,
  );
  const serverContent = stored?.content ?? '';
  const value = drafts[draftId] ?? serverContent;
  const dirty = value !== serverContent;

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateContext(level, selectedKey, {
        content: value,
        expectedVersion: stored?.activeVersion ?? 1,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contexts });
      setDrafts((current) => {
        const next = { ...current };
        delete next[draftId];
        return next;
      });
      notify.success('Contexto guardado');
    },
    onError: (error) => notify.error('No se ha podido guardar el contexto', error),
  });

  const resolvedQuery = useQuery({
    queryKey: queryKeys.resolvedContext(resolvedFor ?? ''),
    queryFn: ({ signal }) => api.resolvedContext(resolvedFor ?? '', signal),
    enabled: resolvedFor !== null,
  });

  return (
    <div>
      <PageHeader eyebrow="Corrección" title="Contexto">
        Los criterios que recibe el motor. Se acumulan de lo general a lo concreto; el contexto de
        cada actividad se edita en su ficha.
      </PageHeader>

      <Tabs
        value={level}
        onValueChange={(next) => setLevel(next === 'activity_kind' ? 'activity_kind' : 'global')}
        activationMode="manual"
        className="mb-3"
      >
        <TabsList aria-label="Nivel del contexto">
          {(['global', 'activity_kind'] as const).map((option) => (
            <TabsTrigger key={option} value={option}>
              {LEVEL_TAB[option]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {contextsQuery.isError ? (
        <ErrorState error={contextsQuery.error} onRetry={() => void contextsQuery.refetch()} />
      ) : contextsQuery.isPending ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : (
        <div className="flex flex-col gap-3">
          <Section title={LEVEL_TITLE[level]} description={LEVEL_HINT[level]}>
            <div className="flex flex-col gap-4">
              {level === 'activity_kind' ? (
                <Field label="Tipo de actividad">
                  {({ id, ...aria }) => (
                    <Select
                      value={kind}
                      onValueChange={(next) => {
                        const parsed = ActivityKind.safeParse(next);
                        if (parsed.success) setKind(parsed.data);
                      }}
                    >
                      <SelectTrigger id={id} {...aria} className="max-w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ActivityKind.options.map((option) => (
                          <SelectItem key={option} value={option}>
                            {ACTIVITY_KIND_LABEL[option]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              ) : null}

              <PreviewEditor
                label="Contenido"
                mode="markdown"
                value={value}
                minHeight="16rem"
                placeholder={
                  '## Criterios\n\n- Valora el procedimiento por encima del resultado\n- Acepta $\\pi$ sin aproximar'
                }
                onChange={(next) => setDrafts((current) => ({ ...current, [draftId]: next }))}
                hint={
                  stored
                    ? `Última edición: ${formatDateTime(stored.updatedAt)}`
                    : 'Este nivel todavía no tiene contenido.'
                }
              />

              <div className="flex items-center justify-between gap-3">
                <p className="text-ui text-muted-foreground" aria-live="polite">
                  {dirty ? 'Cambios sin guardar' : 'Todo guardado'}
                </p>
                <Button
                  variant="default"
                  size="lg"
                  disabled={!dirty}
                  loading={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  Guardar contexto
                </Button>
              </div>
            </div>
          </Section>

          <Section
            title="Contexto efectivo"
            description="Lo que se enviaría al modelo para una actividad concreta, con los cinco niveles ya resueltos."
          >
            {activitiesQuery.isError ? (
              <ErrorState
                title="No se han podido cargar las actividades"
                error={activitiesQuery.error}
                onRetry={() => void activitiesQuery.refetch()}
              />
            ) : activities.length === 0 && !activitiesQuery.isPending ? (
              <p className="text-base text-muted-foreground">
                Importa alguna actividad para poder ver su contexto resuelto.
              </p>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field label="Actividad" className="flex-1">
                  {({ id, ...aria }) => (
                    <Select
                      value={resolvedPick}
                      onValueChange={setResolvedPick}
                      disabled={activitiesQuery.isPending}
                    >
                      <SelectTrigger id={id} {...aria}>
                        <SelectValue placeholder="Elige una actividad…" />
                      </SelectTrigger>
                      <SelectContent>
                        {activities.map((activity) => (
                          <SelectItem key={activity.id} value={activity.id}>
                            {activity.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Button
                  size="lg"
                  disabled={resolvedPick === ''}
                  onClick={() => setResolvedFor(resolvedPick)}
                >
                  Ver contexto efectivo
                </Button>
              </div>
            )}
          </Section>
        </div>
      )}

      <Sheet open={resolvedFor !== null} onOpenChange={(open) => !open && setResolvedFor(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Contexto efectivo</SheetTitle>
            <SheetDescription>
              {activities.find((activity) => activity.id === resolvedFor)?.name}
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            {resolvedQuery.isError ? (
              <ErrorState error={resolvedQuery.error} />
            ) : resolvedQuery.data ? (
              <div className="max-h-[60vh] overflow-y-auto">
                <p className="eyebrow mb-2">Enviado al modelo</p>
                <div className="rounded-md border border-border bg-muted px-3 py-2.5">
                  <Markdown>{resolvedQuery.data.merged}</Markdown>
                </div>
                {resolvedQuery.data.files.length > 0 ? (
                  <>
                    <p className="eyebrow mb-2 mt-4">Ficheros que acompañan</p>
                    <ul className="flex flex-col gap-1">
                      {resolvedQuery.data.files.map((file) => (
                        <li key={file.id} className="truncate text-ui text-muted-foreground">
                          {file.filename}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : (
              <Skeleton className="h-40 w-full rounded-md" />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
