import { Undo2 } from 'lucide-react';
import { effectivePoints } from '@vega/shared';
import type { CorrectionItem } from '@vega/shared';
import { cn } from '@/lib/cn';
import { formatPoints } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AutoTextarea } from '@/components/ui/textarea';
import { ConfidenceBadge } from '@/components/common/status';
import { MathText } from '@/components/Latex';
import { ScoreStepper } from './ScoreStepper';

interface CorrectionItemCardProps {
  item: CorrectionItem;
  readOnly: boolean;
  onPointsChange: (points: number) => void;
  onFeedbackChange: (feedback: string | null) => void;
  onRestore: () => void;
}

export function CorrectionItemCard({
  item,
  readOnly,
  onPointsChange,
  onFeedbackChange,
  onRestore,
}: CorrectionItemCardProps) {
  const edited = item.teacherPoints !== null;
  const value = effectivePoints(item);

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
          <button
            type="button"
            onClick={onRestore}
            className={cn(
              'mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border',
              'text-ui text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground',
            )}
          >
            <Undo2 className="size-4" aria-hidden="true" />
            Restaurar la propuesta de la IA ({formatPoints(item.aiPoints)})
          </button>
        ) : null}

        <div className="mt-4">
          <label className="eyebrow mb-1.5 block" htmlFor={`feedback-${item.id}`}>
            Feedback para el alumno
          </label>
          <AutoTextarea
            id={`feedback-${item.id}`}
            value={item.teacherFeedback ?? ''}
            placeholder={item.aiFeedback || 'Escribe el feedback de este apartado…'}
            disabled={readOnly}
            aria-describedby={`feedback-${item.id}-hint`}
            onChange={(event) =>
              onFeedbackChange(event.target.value === '' ? null : event.target.value)
            }
          />
          <p id={`feedback-${item.id}-hint`} className="mt-1.5 text-ui text-muted-foreground">
            {item.teacherFeedback === null
              ? 'Se enviará el feedback de la IA. Escribe aquí para sustituirlo.'
              : 'Has reescrito el feedback de este apartado.'}
          </p>

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
