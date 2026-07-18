import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Correction, CorrectionResponse, SaveCorrectionRequest, SubmissionDetail } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';

interface SaveVariables {
  request: SaveCorrectionRequest;
  /** Cómo quedaría la corrección; se pinta ya, antes de que responda el API. */
  optimistic: Correction | null;
}

interface RollbackContext {
  previous: SubmissionDetail | undefined;
}

export function useCorrectionMutations(submissionId: string) {
  const queryClient = useQueryClient();
  const detailKey = queryKeys.submission(submissionId);

  const applyResponse = (response: CorrectionResponse) => {
    queryClient.setQueryData<SubmissionDetail>(detailKey, (current) =>
      current
        ? { ...current, correction: response.correction, submission: response.submission }
        : current,
    );
    // La cola muestra nota y estado: hay que refrescarla tras cualquier cambio.
    void queryClient.invalidateQueries({ queryKey: queryKeys.queueRoot });
  };

  const beginOptimistic = async (variables: SaveVariables): Promise<RollbackContext> => {
    await queryClient.cancelQueries({ queryKey: detailKey });
    const previous = queryClient.getQueryData<SubmissionDetail>(detailKey);
    if (previous && variables.optimistic) {
      queryClient.setQueryData<SubmissionDetail>(detailKey, {
        ...previous,
        correction: variables.optimistic,
      });
    }
    return { previous };
  };

  const rollback = (context: RollbackContext | undefined) => {
    if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
  };

  const save = useMutation<CorrectionResponse, unknown, SaveVariables, RollbackContext>({
    mutationFn: (variables) => api.saveCorrection(submissionId, variables.request),
    onMutate: beginOptimistic,
    onError: (error, _variables, context) => {
      rollback(context);
      notify.error('No se han podido guardar los cambios', error);
    },
    onSuccess: (response) => {
      applyResponse(response);
      notify.success('Cambios guardados');
    },
  });

  const validate = useMutation<CorrectionResponse, unknown, SaveVariables, RollbackContext>({
    mutationFn: (variables) => api.validate(submissionId, variables.request),
    onMutate: beginOptimistic,
    onError: (error, _variables, context) => {
      rollback(context);
      notify.error('No se ha podido validar la corrección', error);
    },
    onSuccess: (response) => {
      applyResponse(response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueCounts });
      notify.success('Corrección validada');
    },
  });

  const publish = useMutation<CorrectionResponse, unknown, void>({
    mutationFn: () => api.publish(submissionId),
    onError: (error) => notify.error('No se ha podido publicar la nota', error),
    onSuccess: (response) => {
      applyResponse(response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.queueCounts });
      notify.success('Feedback publicado en Moodle');
    },
  });

  return { save, validate, publish };
}
