import { useMutation } from '@tanstack/react-query';
import { Download, Undo2 } from 'lucide-react';
import { effectiveLatex } from '@vega/shared';
import type { ActivityKind, Correction } from '@vega/shared';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { formatPreciseEurosFromCents, formatTokens } from '@/lib/format';
import type { CorrectionDraftController } from '@/hooks/useCorrectionDraft';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AutoTextarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/common/Feedback';
import { ConfidenceBadge } from '@/components/common/status';
import { Markdown } from '@/components/Markdown';
import { PreviewEditor } from '@/components/PreviewEditor';
import { CorrectionItemCard } from './CorrectionItemCard';

export function CorrectionView({
  correction,
  submissionId,
  feedbackName,
  activityKind,
  graded,
  draft,
  readOnly,
  published,
  onQuoteOpen,
}: {
  correction: Correction | null;
  submissionId: string;
  /** Nombre de reserva del PDF si el servidor no propone ninguno. */
  feedbackName: string;
  /** Determina qué campos publica realmente el conector de Moodle. */
  activityKind: ActivityKind;
  /** Si la actividad se puntúa: sin nota no hay apartados que repartir. */
  graded: boolean;
  draft: CorrectionDraftController;
  readOnly: boolean;
  /** La corrección ya salió de Vega hacia Moodle. */
  published: boolean;
  onQuoteOpen: (page: number) => void;
}) {
  const download = useMutation({
    mutationFn: () => api.downloadFeedback(submissionId, feedbackName),
    onError: (error) => notify.error('No se ha podido descargar el feedback', error),
  });

  if (!correction) {
    return (
      <EmptyState
        title="Todavía no hay corrección"
        description="La IA aún no ha corregido esta entrega. Aparecerá aquí en cuanto termine el proceso."
      />
    );
  }

  const latexValue = draft.latex ?? correction.aiLatex;
  const usingAiLatex = draft.latex === null;
  const latexSaved = effectiveLatex(correction) === latexValue;
  const summaryValue = draft.summary ?? correction.aiSummary;
  const usingAiSummary = draft.summary === null;
  const publishesAsForumReply = activityKind === 'forum';

  return (
    <div className="scroll-pane h-full px-4 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {correction.publishedAutomatically ? (
          <Alert variant="info">
            <AlertTitle>Publicada sin revisión docente</AlertTitle>
            <AlertDescription className="mt-1">
              Se publicó automáticamente: ningún profesor la revisó antes de que llegara al alumno.
            </AlertDescription>
          </Alert>
        ) : null}

        <Alert variant="info" role="note">
          <AlertTitle>
            {publishesAsForumReply
              ? published
                ? 'Respuesta publicada en Moodle'
                : 'Respuesta que se publicará en Moodle'
              : published
                ? 'Contenido publicado en Moodle'
                : 'Contenido para Moodle'}
          </AlertTitle>
          <AlertDescription className="mt-1">
            {publishesAsForumReply
              ? published
                ? 'Moodle recibió el contenido de «Respuesta en Moodle» como contestación en el foro. El resumen, el desglose, el PDF y las notas para el profesor no se enviaron.'
                : 'Moodle recibirá el contenido de «Respuesta en Moodle» como contestación en el foro. El resumen, el desglose, el PDF y las notas para el profesor no se envían.'
              : graded
                ? published
                  ? 'Moodle recibió el comentario global, el feedback y la puntuación de cada apartado, y la nota total. El PDF se descarga aparte desde Vega y las notas para el profesor no se enviaron.'
                  : 'Moodle recibirá el comentario global, el feedback y la puntuación de cada apartado, y la nota total. El PDF se descarga aparte desde Vega y las notas para el profesor no se envían.'
                : published
                  ? 'Moodle recibió el comentario global. El PDF se descarga aparte desde Vega y las notas para el profesor no se enviaron.'
                  : 'Moodle recibirá el comentario global. El PDF se descarga aparte desde Vega y las notas para el profesor no se envían.'}
          </AlertDescription>
        </Alert>

        <Card asChild>
          <section className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <ConfidenceBadge value={correction.confidence} label="Confianza" />
              {graded ? (
                draft.editedCount > 0 ? (
                  <Badge variant="primary">
                    {draft.editedCount}{' '}
                    {draft.editedCount === 1 ? 'apartado tuyo' : 'apartados tuyos'}
                  </Badge>
                ) : (
                  <Badge>Sin cambios sobre la IA</Badge>
                )
              ) : (
                <Badge variant="outline">Actividad sin nota</Badge>
              )}
              <span className="font-mono text-ui text-muted-foreground">{correction.model}</span>
            </div>

            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label className="eyebrow block" htmlFor="teacher-summary">
                {publishesAsForumReply ? 'Resumen interno' : 'Comentario global en Moodle'}
              </label>
              {!readOnly && !usingAiSummary ? (
                <Button size="sm" variant="ghost" onClick={() => draft.restoreSummary()}>
                  <Undo2 aria-hidden="true" />
                  Restaurar propuesta de la IA
                </Button>
              ) : null}
            </div>
            <AutoTextarea
              id="teacher-summary"
              value={summaryValue}
              placeholder="Escribe un comentario global…"
              disabled={readOnly}
              minRows={3}
              aria-describedby="teacher-summary-hint"
              onChange={(event) => draft.setSummary(event.target.value)}
            />
            <p id="teacher-summary-hint" className="mt-1.5 text-ui text-muted-foreground">
              {publishesAsForumReply
                ? usingAiSummary
                  ? 'Propuesta de la IA para la revisión interna. No se publica en el foro.'
                  : 'Resumen revisado para uso interno. No se publica en el foro.'
                : published
                  ? usingAiSummary
                    ? 'Se publicó la propuesta de la IA.'
                    : 'Se publicó la versión revisada por el profesor.'
                  : readOnly
                    ? usingAiSummary
                      ? 'Propuesta de la IA validada. Se publicará al confirmar la publicación.'
                      : 'Versión del profesor validada. Se publicará al confirmar la publicación.'
                  : usingAiSummary
                    ? 'Se publicará esta propuesta de la IA. Puedes revisarla antes de validar.'
                    : 'Has revisado el comentario global. Se publicará tu versión.'}
            </p>
          </section>
        </Card>

        {graded
          ? draft.items.map((item) => (
              <CorrectionItemCard
                key={item.id}
                item={item}
                publishesToMoodle={!publishesAsForumReply}
                published={published}
                onQuoteOpen={onQuoteOpen}
                readOnly={readOnly}
                onPointsChange={(points) => draft.setPoints(item.id, points)}
                onFeedbackChange={(feedback) => draft.setFeedback(item.id, feedback)}
                onRestore={() => draft.restoreItem(item.id)}
              />
            ))
          : null}

        {correction.verification ? (
          <Alert variant={correction.verification.coherent ? 'success' : 'warning'}>
            <AlertTitle>
              {correction.verification.coherent
                ? 'Sin avisos de verificación'
                : `Verificación: ${correction.verification.issues.length} ${correction.verification.issues.length === 1 ? 'aviso' : 'avisos'}`}
            </AlertTitle>
            <AlertDescription className="mt-1">
              {correction.verification.issues.length === 0
                ? 'Las citas, la aritmética y la coherencia de la propuesta no presentan avisos.'
                : <ul className="list-disc space-y-1 pl-5">{correction.verification.issues.map((issue) => (
                    <li key={`${issue.source}-${issue.kind}-${issue.itemLabel ?? ''}`}>{issue.itemLabel ? `${issue.itemLabel}: ` : ''}{issue.detail}</li>
                  ))}</ul>}
            </AlertDescription>
          </Alert>
        ) : null}

        {correction.teacherNotes ? (
          <Alert variant="info" role="note">
            <AlertTitle>Notas para el profesor</AlertTitle>
            <AlertDescription className="mt-1 overflow-x-auto [overflow-wrap:anywhere]">
              <p className="mb-2">Información interna: no se publica ni se incluye en el PDF.</p>
              <Markdown>{correction.teacherNotes}</Markdown>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card asChild>
          <section className="p-4">
            <PreviewEditor
              label={publishesAsForumReply ? 'Respuesta en Moodle' : 'Contenido del PDF de corrección'}
              mode="latex"
              value={latexValue}
              minHeight="16rem"
              disabled={readOnly}
              onChange={(value) => draft.setLatex(value)}
              hint={
                publishesAsForumReply
                  ? published
                    ? usingAiLatex
                      ? 'Se publicó la propuesta de la IA como respuesta en el foro.'
                      : 'Se publicó tu versión como respuesta en el foro.'
                    : usingAiLatex
                      ? 'Propuesta de la IA. Se publicará como respuesta en el foro cuando la valides y publiques.'
                      : 'Has revisado la respuesta. Se publicará tu versión en el foro.'
                  : usingAiLatex
                    ? 'Propuesta de la IA para el PDF descargable. No forma parte del comentario de Moodle.'
                    : 'Has reescrito el contenido del PDF descargable. No forma parte del comentario de Moodle.'
              }
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={readOnly || usingAiLatex}
                onClick={() => draft.restoreLatex()}
              >
                <Undo2 aria-hidden="true" />
                Volver a la propuesta de la IA
              </Button>

              <Button size="sm" loading={download.isPending} onClick={() => download.mutate()}>
                <Download aria-hidden="true" />
                Descargar feedback en PDF
              </Button>
            </div>

            {latexSaved ? null : (
              <p className="mt-2 text-ui text-muted-foreground">
                El PDF se genera con la última versión guardada, no con lo que estés escribiendo
                ahora.
              </p>
            )}
          </section>
        </Card>

        <details className="px-1 py-2">
          <summary className="cursor-pointer text-ui text-muted-foreground transition-colors hover:text-foreground">
            Coste de esta corrección
          </summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-ui text-muted-foreground">
            <dt>Tokens de entrada</dt>
            <dd className="text-right text-foreground">
              {formatTokens(correction.usage.inputTokens)}
            </dd>
            <dt>Tokens en caché</dt>
            <dd className="text-right text-foreground">
              {formatTokens(correction.usage.cachedInputTokens)}
            </dd>
            <dt>Tokens de salida</dt>
            <dd className="text-right text-foreground">
              {formatTokens(correction.usage.outputTokens)}
            </dd>
            <dt>Coste</dt>
            <dd className="text-right text-foreground">
              {formatPreciseEurosFromCents(correction.usage.costCents)}
            </dd>
          </dl>
        </details>
      </div>
    </div>
  );
}
