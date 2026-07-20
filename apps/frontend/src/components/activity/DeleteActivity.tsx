import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { Activity } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Section } from '@/components/common/Feedback';
import { Field } from '@/components/common/Field';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * Dar de baja una actividad de Vega.
 *
 * Dos cosas que la pantalla tiene que dejar dichas, porque son justo las que se
 * dan por supuestas al revés:
 *
 * 1. **No se borra nada de Moodle.** La actividad sigue allí y las notas que ya
 *    se hubieran publicado siguen publicadas: esto no las retira.
 * 2. **Sí se borra todo lo de Vega**, incluidas correcciones ya validadas, y no
 *    hay papelera.
 *
 * Por eso se pide escribir el nombre de la actividad: no es burocracia, es que
 * un botón de confirmar se pulsa por inercia y esto no tiene vuelta atrás.
 */
export function DeleteActivity({ activity }: { activity: Activity }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  // Se cuenta lo que hay antes de enseñar el aviso: decir «se borrarán 12
  // entregas» pesa mucho más que un «esta acción es irreversible».
  const totals = useQuery({
    queryKey: [...queryKeys.activity(activity.id), 'deletion-preview'],
    queryFn: async ({ signal }) => {
      const [all, published] = await Promise.all([
        api.queue({ activityId: activity.id, page: 1, pageSize: 1 }, signal),
        api.queue({ activityId: activity.id, status: 'published', page: 1, pageSize: 1 }, signal),
      ]);
      return { submissions: all.meta.total, published: published.meta.total };
    },
    enabled: open,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteActivity(activity.id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities });
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueRoot });
      notify.success(
        'Actividad dada de baja',
        result.submissions === 0
          ? `«${activity.name}» ya no está en Vega.`
          : `«${activity.name}» y ${result.submissions} ${
              result.submissions === 1 ? 'entrega' : 'entregas'
            } ya no están en Vega.`,
      );
      void navigate('/actividades');
    },
    onError: (error) => notify.error('No se ha podido dar de baja la actividad', error),
  });

  const confirmed = typed.trim() === activity.name.trim();
  const counts = totals.data;

  return (
    <Section
      title="Dar de baja"
      description="Quita la actividad de Vega. En Moodle no se toca nada."
    >
      <Button
        variant="destructive"
        onClick={() => {
          setTyped('');
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" />
        Dar de baja esta actividad
      </Button>

      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) setTyped('');
          setOpen(next);
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Dar de baja «{activity.name}»</SheetTitle>
            <SheetDescription>Esto no se puede deshacer.</SheetDescription>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-4">
            <Alert variant="warning">
              <AlertTitle>Se borrará de Vega</AlertTitle>
              <AlertDescription className="mt-1">
                {totals.isPending ? (
                  'Contando lo que hay…'
                ) : counts === undefined ? (
                  'No se ha podido contar qué hay guardado. Al continuar se borrará igualmente.'
                ) : counts.submissions === 0 ? (
                  'La actividad y su configuración. No tiene ninguna entrega guardada.'
                ) : (
                  <>
                    La actividad, su configuración y{' '}
                    <strong>
                      {counts.submissions}{' '}
                      {counts.submissions === 1 ? 'entrega' : 'entregas'}
                    </strong>{' '}
                    con sus transcripciones y correcciones, incluidas las que ya hayas validado.
                    {counts.published > 0 ? (
                      <>
                        {' '}
                        <strong>
                          {counts.published}{' '}
                          {counts.published === 1
                            ? 'está publicada'
                            : 'están publicadas'}{' '}
                          en Moodle.
                        </strong>
                      </>
                    ) : null}
                  </>
                )}
              </AlertDescription>
            </Alert>

            <Alert variant="info">
              <AlertTitle>En Moodle no se toca nada</AlertTitle>
              <AlertDescription className="mt-1">
                La actividad sigue en Moodle. Las notas y el feedback que ya se hayan publicado
                siguen publicados: darla de baja aquí no los retira ni avisa al alumnado.
              </AlertDescription>
            </Alert>

            <p className="text-ui text-muted-foreground">
              Si sólo quieres que Vega deje de procesarla, no hace falta borrarla: desactívala con
              el conmutador de «Actividad activa» y conservarás todo lo corregido.
            </p>

            <Field
              label="Escribe el nombre de la actividad para confirmar"
              hint={activity.name}
            >
              {(field) => (
                <Input
                  {...field}
                  value={typed}
                  autoComplete="off"
                  onChange={(event) => setTyped(event.target.value)}
                />
              )}
            </Field>
          </SheetBody>

          <SheetFooter>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => setOpen(false)}
              disabled={remove.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="lg"
              disabled={!confirmed}
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Dar de baja
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Section>
  );
}
