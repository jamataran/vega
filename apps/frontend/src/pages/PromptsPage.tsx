import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, PageHeader, Section } from '@/components/common/Feedback';
import { PreviewEditor } from '@/components/PreviewEditor';

const PROMPT_LABEL: Record<string, string> = {
  'global.system': 'Instrucciones globales',
  'transcription.system': 'Transcripción',
  'grading.problem.system': 'Corrección de problemas',
  'grading.topic.system': 'Corrección de temas',
  'triage.system': 'Triaje de foros',
  'forum.answer.simple.system': 'Respuesta sencilla de foro',
  'forum.answer.expert.system': 'Respuesta experta de foro',
  'verify.system': 'Verificación',
  'pd.regulation.system': 'Normativa de programación didáctica',
};

/**
 * Qué hace cada prompt y cuándo se ejecuta. Se enseña junto al selector para
 * que no haya que adivinarlo por el nombre de la clave.
 */
const PROMPT_HELP: Record<string, string> = {
  'global.system':
    'Se antepone a todas las llamadas del motor (transcripción, corrección, triaje, foro y verificación). Es el sitio para reglas comunes: idioma, tono, coma decimal…',
  'transcription.system':
    'Convierte el manuscrito escaneado en texto LaTeX. Se ejecuta dos veces por entrega (lecturas A y B, que luego se comparan). No ve la solución ni el reparto de puntos: quien transcribe no debe saber la respuesta.',
  'grading.problem.system':
    'Corrige entregas de tipo problema, apartado por apartado, contra la solución de referencia y el reparto de puntos. Cada descuento exige una cita literal del trabajo del alumno.',
  'grading.topic.system':
    'Corrige entregas de tipo tema (desarrollo escrito largo). Se aplica cuando la plantilla de la actividad es de tema; si no, se usa el de problemas.',
  'triage.system':
    'Clasifica cada mensaje de foro sin contexto de la materia: errata, consulta administrativa, no es una duda, duda sencilla o duda difícil. Las tres primeras se aparcan solas si la confianza es alta; las dudas pasan a responderse.',
  'forum.answer.simple.system':
    'Responde las dudas clasificadas como sencillas, con el modelo de verificación (más barato). Si la propia respuesta detecta que la duda era más difícil de lo que parecía, escala a la ruta experta.',
  'forum.answer.expert.system':
    'Responde las dudas difíciles (o escaladas) con el modelo de corrección, el más capaz.',
  'verify.system':
    'Audita cada corrección ya propuesta: coherencia entre citas, descuentos, nota y feedback. No ve la solución de referencia, sólo el trabajo y la propuesta. Se puede apagar en Ajustes; la verificación mecánica de citas nunca se apaga.',
  'pd.regulation.system':
    'Reservado para la corrección de programaciones didácticas contra normativa. Esa funcionalidad aún no está activa; el prompt no se usa en ninguna llamada.',
};

/** Orden de presentación: el flujo real del motor, no el alfabético de la BD. */
const PROMPT_ORDER = [
  'global.system',
  'transcription.system',
  'grading.problem.system',
  'grading.topic.system',
  'triage.system',
  'forum.answer.simple.system',
  'forum.answer.expert.system',
  'verify.system',
  'pd.regulation.system',
];

function promptOrder(key: string): number {
  const index = PROMPT_ORDER.indexOf(key);
  return index === -1 ? PROMPT_ORDER.length : index;
}

export function PromptsPage() {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: queryKeys.prompts,
    queryFn: ({ signal }) => api.prompts(signal),
  });
  const prompts = useMemo(
    () => [...(query.data?.items ?? [])].sort((a, b) => promptOrder(a.key) - promptOrder(b.key)),
    [query.data],
  );
  const selected = prompts.find((prompt) => prompt.key === selectedKey) ?? prompts[0] ?? null;
  const value = selected ? (drafts[selected.key] ?? selected.content) : '';
  const dirty = selected !== null && value !== selected.content;

  const save = useMutation({
    mutationFn: () =>
      selected
        ? api.updatePrompt(selected.key, {
            content: value,
            expectedVersion: selected.version,
          })
        : Promise.reject(new Error('No hay ningún prompt seleccionado.')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.prompts });
      if (selected) {
        setDrafts((current) => {
          const next = { ...current };
          delete next[selected.key];
          return next;
        });
      }
      notify.success('Prompt activado');
    },
    onError: (error) => notify.error('No se ha podido activar el prompt', error),
  });

  const restore = useMutation({
    mutationFn: () =>
      selected
        ? api.restorePrompt(selected.key, selected.version)
        : Promise.reject(new Error('No hay ningún prompt seleccionado.')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.prompts });
      if (selected) {
        setDrafts((current) => {
          const next = { ...current };
          delete next[selected.key];
          return next;
        });
      }
      notify.success('Valor predeterminado restaurado como nueva versión');
    },
    onError: (error) => notify.error('No se ha podido restaurar el prompt', error),
  });

  return (
    <div>
      <PageHeader eyebrow="Administración" title="Prompts del motor">
        Las instrucciones globales de cada operación del motor: cómo se transcribe, corrige,
        clasifica y verifica. Viven en la base de datos; cada guardado crea una versión nueva y la
        siguiente ejecución usa la activa. La materia y los criterios de corrección no van aquí:
        van en «Contextos».
      </PageHeader>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <Skeleton className="h-80 w-full rounded-lg" />
      ) : !selected ? (
        <EmptyState
          title="No hay prompts registrados"
          description="No se han podido cargar las instrucciones predeterminadas. Vuelve a intentarlo y, si continúa, consulta el registro del sistema."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Section title="Prompt activo">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <label className="flex flex-1 flex-col gap-1.5 text-ui font-medium">
                  Operación
                  <Select value={selected.key} onValueChange={setSelectedKey}>
                    <SelectTrigger
                      className="max-w-xl"
                      aria-label="Prompt del sistema"
                      aria-describedby="prompt-help"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {prompts.map((prompt) => (
                        <SelectItem key={prompt.key} value={prompt.key}>
                          {PROMPT_LABEL[prompt.key] ?? prompt.key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <div className="flex items-center gap-2 text-ui text-muted-foreground">
                  <Badge variant="outline">v{selected.version}</Badge>
                  <span>{formatDateTime(selected.updatedAt)}</span>
                </div>
              </div>

              {PROMPT_HELP[selected.key] ? (
                <p id="prompt-help" className="text-ui text-muted-foreground">
                  {PROMPT_HELP[selected.key]}
                </p>
              ) : null}

              <PreviewEditor
                label="Instrucciones"
                mode="markdown"
                value={value}
                minHeight="22rem"
                onChange={(next) =>
                  setDrafts((current) => ({ ...current, [selected.key]: next }))
                }
                hint="El contenido se aplica a llamadas nuevas; no modifica correcciones anteriores."
              />

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  variant="outline"
                  loading={restore.isPending}
                  disabled={save.isPending}
                  onClick={() => restore.mutate()}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Restaurar valor predeterminado
                </Button>
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                  <span className="text-ui text-muted-foreground" aria-live="polite">
                    {dirty ? 'Cambios sin activar' : 'Versión activa sin cambios'}
                  </span>
                  <Button
                    size="lg"
                    disabled={!dirty || restore.isPending}
                    loading={save.isPending}
                    onClick={() => save.mutate()}
                  >
                    Activar nueva versión
                  </Button>
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Comparación"
            description="La versión anterior se conserva para explicar qué instrucciones se aplicaron."
          >
            {selected.previousContent === null ? (
              <p className="text-base text-muted-foreground">
                Esta es la primera versión; todavía no hay una anterior con la que comparar.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                <TextSnapshot label={`Anterior · v${selected.version - 1}`}>
                  {selected.previousContent}
                </TextSnapshot>
                <TextSnapshot label={dirty ? 'Borrador' : `Activa · v${selected.version}`}>
                  {value}
                </TextSnapshot>
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function TextSnapshot({ label, children }: { label: string; children: string }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1.5">{label}</p>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-3 font-mono text-ui text-muted-foreground">
        {children}
      </pre>
    </div>
  );
}
