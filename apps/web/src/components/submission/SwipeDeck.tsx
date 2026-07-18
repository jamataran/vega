import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface DeckPanel {
  id: string;
  content: ReactNode;
}

interface SwipeDeckProps {
  panels: readonly DeckPanel[];
  index: number;
  onIndexChange: (index: number) => void;
  /** Prefijo para enlazar cada panel con su pestaña (`aria-controls`). */
  idPrefix: string;
  className?: string;
}

/** Desplazamiento mínimo para decidir que el gesto es horizontal y no un scroll. */
const AXIS_LOCK_PX = 10;
/** Fracción del ancho que hay que arrastrar para cambiar de panel. */
const COMMIT_RATIO = 0.22;
/** Velocidad (px/ms) que permite cambiar de panel con un gesto corto y rápido. */
const FLICK_VELOCITY = 0.45;
/** Resistencia al arrastrar más allá del primer o del último panel. */
const EDGE_RESISTANCE = 0.32;

/**
 * Carrusel de tres vistas gobernado por eventos de puntero nativos. Sin librería
 * de gestos: el bloqueo de eje deja intacto el scroll vertical de cada panel, que
 * es lo que se rompe con las soluciones genéricas.
 */
export function SwipeDeck({ panels, index, onIndexChange, idPrefix, className }: SwipeDeckProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);

  const pointerId = useRef<number | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);
  const axis = useRef<'none' | 'x' | 'y'>('none');

  const reset = useCallback(() => {
    pointerId.current = null;
    axis.current = 'none';
    setDrag(0);
    setDragging(false);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerId.current = event.pointerId;
    startX.current = event.clientX;
    startY.current = event.clientY;
    startTime.current = event.timeStamp;
    axis.current = 'none';
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    const dx = event.clientX - startX.current;
    const dy = event.clientY - startY.current;

    if (axis.current === 'none') {
      if (Math.abs(dx) > AXIS_LOCK_PX && Math.abs(dx) > Math.abs(dy) * 1.3) {
        axis.current = 'x';
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      } else if (Math.abs(dy) > AXIS_LOCK_PX) {
        // Es un scroll vertical: soltamos el gesto y dejamos hacer al navegador.
        axis.current = 'y';
        pointerId.current = null;
      }
      return;
    }

    if (axis.current !== 'x') return;
    const atStart = index === 0 && dx > 0;
    const atEnd = index === panels.length - 1 && dx < 0;
    setDrag(atStart || atEnd ? dx * EDGE_RESISTANCE : dx);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    if (axis.current === 'x') {
      const width = containerRef.current?.clientWidth ?? 1;
      const elapsed = Math.max(1, event.timeStamp - startTime.current);
      const velocity = Math.abs(drag) / elapsed;
      const committed = Math.abs(drag) > width * COMMIT_RATIO || velocity > FLICK_VELOCITY;

      if (committed) {
        const direction = drag < 0 ? 1 : -1;
        const next = Math.min(panels.length - 1, Math.max(0, index + direction));
        if (next !== index) onIndexChange(next);
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
    reset();
  };

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden', className)}
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
    >
      <div
        className={cn('flex h-full', !dragging && 'transition-transform duration-300 ease-snap')}
        style={{ transform: `translate3d(calc(${-index * 100}% + ${drag}px), 0, 0)` }}
      >
        {panels.map((panel, panelIndex) => {
          const active = panelIndex === index;
          return (
            <section
              key={panel.id}
              id={`${idPrefix}-panel-${panel.id}`}
              role="tabpanel"
              aria-labelledby={`${idPrefix}-tab-${panel.id}`}
              aria-hidden={!active}
              // Los paneles ocultos salen del orden de tabulación, pero siguen
              // pintados mientras dura el gesto para que el arrastre no parpadee.
              className={cn('h-full w-full shrink-0', !active && !dragging && 'invisible')}
            >
              {panel.content}
            </section>
          );
        })}
      </div>
    </div>
  );
}
