import { useMutation } from '@tanstack/react-query';
import { Download, Undo2 } from 'lucide-react';
import { effectiveLatex } from '@vega/shared';
import type { Correction } from '@vega/shared';
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
import { PreviewEditor } from '@/components/PreviewEditor';
import { CorrectionItemCard } from './CorrectionItemCard';

export function CorrectionView({
  correction,
  submissionId,
  feedbackName,
  graded,
  draft,
  readOnly,
  onQuoteOpen,
}: {
  correction: Correction | null;
  submissionId: string;
  /** Nombre de reserva del PDF si el servidor no propone ninguno. */
  feedbackName: string;
  /** Si la actividad se puntúa: sin nota no hay apartados que repartir. */
  graded: boolean;
  draft: CorrectionDraftController;
  readOnly: boolean;
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

            <label className="eyebrow mb-1.5 block" htmlFor="teacher-summary">
              Resumen para el alumno
            </label>
            <AutoTextarea
              id="teacher-summary"
              value={draft.summary ?? ''}
              placeholder={correction.aiSummary || 'Escribe un resumen de la corrección…'}
              disabled={readOnly}
              minRows={3}
              aria-describedby="teacher-summary-hint"
              onChange={(event) =>
                draft.setSummary(event.target.value === '' ? null : event.target.value)
              }
            />
            <p id="teacher-summary-hint" className="mt-1.5 text-ui text-muted-foreground">
              {draft.summary === null
                ? 'Se enviará el resumen de la IA. Escribe aquí para sustituirlo.'
                : 'Has reescrito el resumen.'}
            </p>
          </section>
        </Card>

        {graded
          ? draft.items.map((item) => (
              <CorrectionItemCard
                key={item.id}
                item={item}
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
          <Alert variant="info"><AlertTitle>Notas para el profesor</AlertTitle><AlertDescription className="mt-1">{correction.teacherNotes}</AlertDescription></Alert>
        ) : null}

        <Card asChild>
          <section className="p-4">
            <PreviewEditor
              label="Documento de corrección"
              mode="latex"
              value={latexValue}
              minHeight="16rem"
              disabled={readOnly}
              onChange={(value) => draft.setLatex(value)}
              hint={
                usingAiLatex
                  ? 'Propuesta de la IA. Edítala para reescribir lo que verá el alumno.'
                  : 'Has reescrito el documento: se publicará tu versión.'
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
