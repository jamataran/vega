import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import { MAX_FILE_CONTENT_BYTES, UPLOAD_CHUNK_BYTES, isTextFile } from '@vega/shared';
import type { ActivityFile } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

/** Tamaños en la unidad que se entiende de un vistazo. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

const encoder = new TextEncoder();

/**
 * Trozo que empieza en `from` y no pasa de `maxBytes` **en UTF-8**.
 *
 * Cortar por número de caracteres no vale: en un `.tex` con acentos y símbolos
 * matemáticos un carácter puede ocupar hasta cuatro bytes, y el trozo se saldría
 * del límite del proxy justo en los ficheros que más falta hacen. Se avanza a
 * tientas y se retrocede hasta caber, respetando los pares subrogados para no
 * partir un carácter por la mitad.
 */
function sliceByBytes(text: string, from: number, maxBytes: number): string {
  let end = Math.min(text.length, from + maxBytes);
  // No partir un par subrogado (emoji, símbolos fuera del plano básico).
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end -= 1;

  while (end > from + 1 && encoder.encode(text.slice(from, end)).length > maxBytes) {
    // Sobra: recortamos proporcionalmente en vez de carácter a carácter, que
    // sobre un fichero grande serían miles de vueltas.
    const excess = encoder.encode(text.slice(from, end)).length - maxBytes;
    end -= Math.max(1, Math.ceil(excess / 4));
    if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end -= 1;
  }
  return text.slice(from, Math.max(end, from + 1));
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Ficheros de contexto de la actividad: el enunciado en LaTeX, el material
 * sobre el que preguntan los alumnos, los criterios del departamento.
 *
 * Sólo los de texto (`.tex`, `.md`, `.txt`) llegan al modelo: se leen aquí y su
 * contenido viaja con el contexto. Un binario se guarda como referencia del
 * profesor y **se dice** que no se usa al corregir, en vez de dejar creer que
 * sí. Es la diferencia entre adjuntar y que sirva de algo.
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
  const [progress, setProgress] = useState<{
    filename: string;
    sent: number;
    total: number;
  } | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.activity(activityId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.activities });
  };

  const add = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_FILE_CONTENT_BYTES) {
        throw new Error(
          `El fichero ocupa ${formatBytes(file.size)} y el máximo son ${formatBytes(MAX_FILE_CONTENT_BYTES)}.`,
        );
      }

      const isText = isTextFile(file.name);
      const { file: created } = await api.beginActivityFileUpload(activityId, {
        filename: file.name,
        mimeType: file.type === '' ? 'text/plain' : file.type,
        sizeBytes: file.size,
        hasContent: isText,
      });

      // Un binario no tiene contenido que mandar: nace ya cerrado.
      if (!isText) return created;

      // Troceado porque el proxy de delante y el `bodyLimit` de Fastify acotan
      // el cuerpo de cada petición. Se trocea sobre el texto ya decodificado, y
      // se mide en bytes UTF-8: un `.tex` con acentos y símbolos matemáticos
      // ocupa más de un byte por carácter y trocear por longitud se pasaría.
      const text = await file.text();
      let index = 0;
      let cursor = 0;
      while (cursor < text.length) {
        const chunk = sliceByBytes(text, cursor, UPLOAD_CHUNK_BYTES);
        await api.appendActivityFileChunk(activityId, created.id, { index, content: chunk });
        cursor += chunk.length;
        index += 1;
        setProgress({ filename: file.name, sent: cursor, total: text.length });
      }

      return (await api.completeActivityFileUpload(activityId, created.id)).file;
    },
    onSuccess: (file) => {
      refresh();
      notify.success(
        'Fichero añadido',
        file.hasContent
          ? `${file.filename} · se enviará al modelo con el contexto`
          : `${file.filename} · queda como referencia, pero no llega al modelo`,
      );
    },
    onError: (error) => notify.error('No se ha podido añadir el fichero', error),
    onSettled: () => setProgress(null),
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
          Sin ficheros adjuntos. Sube el enunciado o el material en{' '}
          <code className="font-mono">.tex</code> o <code className="font-mono">.md</code> para que
          Vega lo tenga delante al corregir.
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
              <Badge variant={file.hasContent ? 'success' : 'quiet'} className="shrink-0">
                {file.hasContent ? 'Se usa al corregir' : 'Sólo referencia'}
              </Badge>
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

      {progress ? (
        <div aria-live="polite">
          <p className="mb-1.5 text-ui text-muted-foreground">
            Subiendo {progress.filename} —{' '}
            {Math.round((progress.sent / Math.max(progress.total, 1)) * 100)} %
          </p>
          <Progress value={(progress.sent / Math.max(progress.total, 1)) * 100} />
        </div>
      ) : null}

      <div>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          // Sin restringir a texto: un PDF o un escaneo se puede adjuntar como
          // referencia del profesor, y el propio componente ya distingue lo que
          // llega al modelo de lo que no. Filtrarlos aquí prometía menos de lo
          // que la pantalla hace.
          accept=".tex,.md,.markdown,.txt,.pdf,image/*,application/x-tex,text/markdown,text/plain,application/pdf"
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
