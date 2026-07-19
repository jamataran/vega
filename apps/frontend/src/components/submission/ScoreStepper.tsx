import type { KeyboardEvent, ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDelta, formatPoints } from '@/lib/format';

/** El reparto de puntos de la academia se mueve siempre en cuartos de punto. */
export const STEP = 0.25;

function quantize(value: number, maxPoints: number): number {
  const stepped = Math.round(value / STEP) * STEP;
  const clamped = Math.min(maxPoints, Math.max(0, stepped));
  return Math.round(clamped * 100) / 100;
}

interface ScoreStepperProps {
  value: number;
  /** Lo que propuso la IA: es la referencia contra la que se calibra. */
  aiValue: number;
  maxPoints: number;
  edited: boolean;
  onChange: (value: number) => void;
  disabled?: boolean;
  label: string;
}

/**
 * Control de puntuación de un apartado.
 *
 * La barra inferior es la idea central de la pantalla: la IA deja una marca fija
 * (su propuesta) y el profesor la mueve. Así se ve de un vistazo si esta
 * corrección se ha respetado o se ha reescrito, que es justo lo que el panel
 * mide después como desviación media.
 */
export function ScoreStepper({
  value,
  aiValue,
  maxPoints,
  edited,
  onChange,
  disabled = false,
  label,
}: ScoreStepperProps) {
  const delta = Math.round((value - aiValue) * 100) / 100;
  const ratio = maxPoints > 0 ? Math.min(1, value / maxPoints) : 0;
  const aiRatio = maxPoints > 0 ? Math.min(1, aiValue / maxPoints) : 0;

  const nudge = (amount: number) => {
    if (disabled) return;
    onChange(quantize(value + amount, maxPoints));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const actions: Record<string, () => void> = {
      ArrowUp: () => nudge(STEP),
      ArrowRight: () => nudge(STEP),
      ArrowDown: () => nudge(-STEP),
      ArrowLeft: () => nudge(-STEP),
      PageUp: () => nudge(STEP * 4),
      PageDown: () => nudge(-STEP * 4),
      Home: () => onChange(0),
      End: () => onChange(quantize(maxPoints, maxPoints)),
    };
    const action = actions[event.key];
    if (!action || disabled) return;
    event.preventDefault();
    action();
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <StepButton
          label={`Restar ${formatPoints(STEP)} puntos a ${label}`}
          onClick={() => nudge(-STEP)}
          disabled={disabled || value <= 0}
        >
          <Minus className="size-5" aria-hidden="true" />
        </StepButton>

        <div
          role="spinbutton"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={maxPoints}
          aria-valuetext={`${formatPoints(value)} de ${formatPoints(maxPoints)} puntos`}
          aria-disabled={disabled || undefined}
          onKeyDown={onKeyDown}
          className="flex flex-1 flex-col items-center rounded-sm py-1"
        >
          <div className="flex items-baseline gap-1">
            <span className="font-display text-score font-semibold">{formatPoints(value)}</span>
            <span className="text-base text-muted-foreground">/ {formatPoints(maxPoints)}</span>
          </div>
          <span
            className={cn(
              'mt-0.5 font-display text-micro font-semibold uppercase',
              edited ? 'text-primary-ink' : 'text-muted-foreground',
            )}
          >
            {edited ? `Profesor · ${formatDelta(delta)}` : 'Propuesta de la IA'}
          </span>
        </div>

        <StepButton
          label={`Sumar ${formatPoints(STEP)} puntos a ${label}`}
          onClick={() => nudge(STEP)}
          disabled={disabled || value >= maxPoints}
        >
          <Plus className="size-5" aria-hidden="true" />
        </StepButton>
      </div>

      {/* Raíl de calibración: relleno = nota actual, muesca = propuesta de la IA. */}
      <div className="relative mt-3 h-1 rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-[width] duration-150',
            edited ? 'bg-primary' : 'bg-border-strong',
          )}
          style={{ width: `${ratio * 100}%` }}
        />
        {edited ? (
          <span
            className="absolute -top-1 h-3 w-px bg-muted-foreground"
            style={{ left: `${aiRatio * 100}%` }}
            title={`La IA proponía ${formatPoints(aiValue)}`}
          />
        ) : null}
      </div>
    </div>
  );
}

function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-md border border-border',
        'bg-card text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground',
        'active:bg-muted disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}
