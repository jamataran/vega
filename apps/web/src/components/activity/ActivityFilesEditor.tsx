import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import type { ActivityFile } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';

/** Tamaños en la unidad que se entiende de un vistazo. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Ficheros de contexto de la actividad: enunciado, solución escaneada,
 * criterios del departamento. Acompañan al contexto Markdown en lo que recibe
 * la IA.
 */
export function ActivityFilesEditor({
  activityId,
  files,
}: {
  activityId: string;
  files: readonly ActivityFile[];
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.activity(activityId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.activities });
  };

  const add = useMutation({
    mutationFn: (file: File) =>
      api.addActivityFile(activityId, {
        filename: file.name,
        mimeType: file.type === '' ? 'application/octet-stream' : file.type,
        sizeBytes: file.size,
      }),
    onSuccess: (response) => {
      refresh();
      notify.success('Fichero añadido', response.file.filename);
    },
    onError: (error) => notify.error('No se ha podido añadir el fichero', error),
  });

  const remove = useMutation({
    mutationFn: (fileId: string) => api.removeActivityFile(activityId, fileId),
    onMutate: (fileId: string) => setPendingId(fileId),
    onSettled: () => setPendingId(null),
    onSuccess: () => {
      refresh();
      notify.success('Fichero eliminado');
    },
    onError: (error) => notify.error('No se ha podido eliminar el fichero', error),
  });

  const download = useMutation({
    mutationFn: (file: ActivityFile) =>
      api.downloadActivityFile(activityId, file.id, file.filename),
    onError: (error) => notify.error('No se ha podido descargar el fichero', error),
  });

  return (
    <div className="flex flex-col gap-3">
      {files.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-ui text-muted-foreground">
          Sin ficheros adjuntos.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
            >
              <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base">{file.filename}</p>
                <p className="mt-0.5 truncate text-ui text-muted-foreground">
                  {formatBytes(file.sizeBytes)}
                  <span className="px-1.5 text-border-strong">·</span>
                  {formatDateTime(file.uploadedAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Descargar ${file.filename}`}
                onClick={() => download.mutate(file)}
              >
                <Download aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Eliminar ${file.filename}`}
                loading={remove.isPending && pendingId === file.id}
                onClick={() => remove.mutate(file.id)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          aria-label="Elegir fichero para adjuntar"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) add.mutate(file);
            // Permite volver a elegir el mismo fichero si la primera vez falló.
            event.target.value = '';
          }}
        />
        <Button size="sm" loading={add.isPending} onClick={() => inputRef.current?.click()}>
          <Paperclip aria-hidden="true" />
          Añadir fichero
        </Button>
      </div>
    </div>
  );
}
