import { Undo2 } from 'lucide-react';
import { effectivePoints } from '@vega/shared';
import type { CorrectionItem } from '@vega/shared';
import { cn } from '@/lib/cn';
import { formatPoints } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AutoTextarea } from '@/components/ui/textarea';
import { ConfidenceBadge } from '@/components/common/status';
import { MathText } from '@/components/Latex';
import { ScoreStepper } from './ScoreStepper';

interface CorrectionItemCardProps {
  item: CorrectionItem;
  readOnly: boolean;
  published: boolean;
  /** Si este desglose viaja a Moodle o sólo sirve para la revisión interna. */
  publishesToMoodle: boolean;
  onQuoteOpen: (page: number) => void;
  onPointsChange: (points: number) => void;
  onFeedbackChange: (feedback: string | null) => void;
  onRestore: () => void;
}

export function CorrectionItemCard({
  item,
  readOnly,
  published,
  publishesToMoodle,
  onQuoteOpen,
  onPointsChange,
  onFeedbackChange,
  onRestore,
}: CorrectionItemCardProps) {
  const edited = item.teacherPoints !== null || item.teacherFeedback !== null;
  const value = effectivePoints(item);
  const feedback = item.teacherFeedback ?? item.aiFeedback;

  return (
    <Card asChild>
      <article className={cn('p-4 transition-colors', edited && 'border-primary/40')}>
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-ui font-semibold">
                {item.label}
              </span>
              <span className="text-ui text-muted-foreground">
                {formatPoints(item.maxPoints)} pts
              </span>
            </div>
            {item.statement ? (
              <p className="mt-2 text-base text-muted-foreground">
                <MathText>{item.statement}</MathText>
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            <ConfidenceBadge value={item.confidence} />
            {item.alternativeMethod ? (
              <Badge title="La IA ha aceptado un método distinto al de la solución de referencia">
                Método alternativo
              </Badge>
            ) : null}
          </div>
        </header>

        <div className="mt-4">
          <ScoreStepper
            label={`Puntuación del apartado ${item.label}`}
            value={value}
            aiValue={item.aiPoints}
            maxPoints={item.maxPoints}
            edited={edited}
            disabled={readOnly}
            onChange={onPointsChange}
          />
        </div>

        {edited && !readOnly ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRestore}
            aria-label={`Restaurar la puntuación y el feedback del apartado ${item.label} a la propuesta de la IA`}
            className="mt-3 w-full text-muted-foreground"
          >
            <Undo2 className="size-4" aria-hidden="true" />
            Restaurar propuesta de la IA
          </Button>
        ) : null}

        <div className="mt-4">
          <label className="eyebrow mb-1.5 block" htmlFor={`feedback-${item.id}`}>
            {publishesToMoodle ? 'Feedback del apartado en Moodle' : 'Feedback interno del apartado'}
          </label>
          <AutoTextarea
            id={`feedback-${item.id}`}
            value={feedback}
            placeholder="Escribe el feedback de este apartado…"
            disabled={readOnly}
            aria-describedby={`feedback-${item.id}-hint`}
            onChange={(event) => onFeedbackChange(event.target.value)}
          />
          <p id={`feedback-${item.id}-hint`} className="mt-1.5 text-ui text-muted-foreground">
            {publishesToMoodle
              ? published
                ? item.teacherFeedback === null
                  ? 'Se publicó la propuesta de la IA.'
                  : 'Se publicó la versión revisada por el profesor.'
                : readOnly
                  ? item.teacherFeedback === null
                    ? 'Propuesta de la IA validada. Se publicará al confirmar la publicación.'
                    : 'Versión del profesor validada. Se publicará al confirmar la publicación.'
                : item.teacherFeedback === null
                  ? 'Se publicará esta propuesta de la IA. Puedes revisarla antes de validar.'
                  : 'Has revisado este feedback. Se publicará tu versión.'
              : item.teacherFeedback === null
                ? 'Propuesta de la IA para la revisión interna. No se publica en el foro.'
                : 'Versión revisada para uso interno. No se publica en el foro.'}
          </p>

          {item.aiQuote ? (
            <blockquote className="mt-3 rounded-md border border-border bg-muted px-3 py-2 text-ui text-muted-foreground">
              <p className="eyebrow mb-1">Cita usada para el descuento</p>
              <MathText>{item.aiQuote}</MathText>
              {item.aiQuotePage ? (
                <button type="button" className="mt-2 block text-primary underline underline-offset-2" onClick={() => onQuoteOpen(item.aiQuotePage!)}>
                  Abrir la página {item.aiQuotePage} del original
                </button>
              ) : null}
            </blockquote>
          ) : null}

          {item.teacherFeedback !== null && item.aiFeedback ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-ui text-muted-foreground transition-colors hover:text-foreground">
                Ver lo que proponía la IA
              </summary>
              <p className="mt-2 border-l-2 border-border pl-3 text-ui text-muted-foreground">
                <MathText>{item.aiFeedback}</MathText>
              </p>
            </details>
          ) : null}
        </div>
      </article>
    </Card>
  );
}
