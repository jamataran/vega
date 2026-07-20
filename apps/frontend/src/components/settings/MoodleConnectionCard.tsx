import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MeResponse, MoodleConnectionResponse } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/common/Feedback';
import { MoodleConnectionResult } from '@/components/settings/MoodleConnectionResult';
import { KEEP, SecretField, secretPatch } from '@/components/settings/SecretField';
import type { SecretState } from '@/components/settings/SecretField';

/**
 * El token de Moodle de quien está usando la aplicación.
 *
 * Está aquí y no en la sección de administración porque **es suyo**: Moodle
 * emite el token por usuario y `core_enrol_get_users_courses` devuelve los
 * cursos de su dueño. Un token compartido enseñaría a cada profesor los cursos
 * de todo el claustro, y nadie podría dar de alta sus propias actividades sin
 * pedírselo a un administrador.
 */
export function MoodleConnectionCard({ configured }: { configured: boolean }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<SecretState>(KEEP);
  const [result, setResult] = useState<MoodleConnectionResponse | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (): Promise<MeResponse> => {
      const patch = secretPatch(token);
      if (patch === undefined) throw new Error('No hay ningún cambio que guardar.');
      return api.updateMyMoodleToken({ token: patch });
    },
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.me, response);
      setToken(KEEP);
      // Lo guardado invalida cualquier prueba anterior: el resultado que se
      // estuviera enseñando ya no habla de este token.
      setResult(null);
      notify.success('Token guardado');
    },
    onError: (error) => notify.error('No se ha podido guardar el token', error),
  });

  const testMutation = useMutation({
    mutationFn: () => api.testMyMoodleConnection(),
    onSuccess: setResult,
    onError: (error) => notify.error('No se ha podido probar la conexión', error),
  });

  const hasPendingChange = secretPatch(token) !== undefined;

  return (
    <Section
      title="Mi conexión con Moodle"
      description="Tu token personal. Determina qué cursos y actividades puedes dar de alta en Vega."
    >
      <div className="flex flex-col gap-4">
        <SecretField
          label="Mi token de Moodle"
          configured={configured}
          state={token}
          onChange={setToken}
          hint="Lo obtienes en Moodle, en tu perfil, dentro de «Preferencias → Claves de seguridad»."
        />

        <p className="text-ui text-muted-foreground">
          El servicio web de Moodle necesita tener habilitadas las funciones{' '}
          <code className="font-mono text-[0.9em]">core_webservice_get_site_info</code>,{' '}
          <code className="font-mono text-[0.9em]">core_enrol_get_users_courses</code>,{' '}
          <code className="font-mono text-[0.9em]">mod_assign_get_assignments</code> y{' '}
          <code className="font-mono text-[0.9em]">mod_forum_get_forums_by_courses</code>.
        </p>

        {result ? <MoodleConnectionResult result={result} /> : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="default"
            size="lg"
            disabled={!hasPendingChange}
            loading={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            Guardar token
          </Button>
          <Button
            variant="outline"
            size="lg"
            // Probar sin token guardado sólo devolvería el mismo error que ya
            // cuenta el propio campo.
            disabled={!configured || hasPendingChange}
            loading={testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            Probar conexión
          </Button>
        </div>
      </div>
    </Section>
  );
}
