import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/cn';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;

interface Point {
  x: number;
  y: number;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Escaneo con zoom por pellizco y por doble toque.
 *
 * Mientras la escala es 1 el componente no toca los eventos: así el gesto
 * horizontal llega intacto al carrusel de vistas. En cuanto hay zoom, sí los
 * detiene, porque entonces arrastrar significa mover la imagen.
 */
export function ZoomableImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });

  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; scale: number; offset: Point; mid: Point } | null>(null);
  const pan = useRef<{ start: Point; offset: Point } | null>(null);
  const lastTapAt = useRef(0);

  const zoomed = scale > 1;

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];

    if (points.length === 2 && points[0] && points[1]) {
      event.stopPropagation();
      pan.current = null;
      pinch.current = {
        distance: distance(points[0], points[1]),
        scale,
        offset,
        mid: midpoint(points[0], points[1]),
      };
      return;
    }

    if (zoomed) {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      pan.current = { start: { x: event.clientX, y: event.clientY }, offset };
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const active = pinch.current;
    if (active) {
      const points = [...pointers.current.values()];
      if (points.length < 2 || !points[0] || !points[1]) return;
      event.stopPropagation();
      const ratio = distance(points[0], points[1]) / (active.distance || 1);
      const nextScale = Math.min(MAX_SCALE, Math.max(1, active.scale * ratio));
      const mid = midpoint(points[0], points[1]);
      setScale(nextScale);
      setOffset({
        x: active.offset.x + (mid.x - active.mid.x),
        y: active.offset.y + (mid.y - active.mid.y),
      });
      return;
    }

    const panning = pan.current;
    if (panning) {
      event.stopPropagation();
      setOffset({
        x: panning.offset.x + (event.clientX - panning.start.x),
        y: panning.offset.y + (event.clientY - panning.start.y),
      });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasPanning = pan.current !== null;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) pan.current = null;

    if (scale <= 1.02 && scale !== 1) resetView();

    // Doble toque: alterna entre vista completa y zoom, sin menús.
    const now = event.timeStamp;
    const isTap = !wasPanning || Math.abs(offset.x) + Math.abs(offset.y) < 4;
    if (isTap && now - lastTapAt.current < DOUBLE_TAP_MS) {
      event.stopPropagation();
      if (zoomed) resetView();
      else setScale(DOUBLE_TAP_SCALE);
      lastTapAt.current = 0;
      return;
    }
    lastTapAt.current = now;
  };

  return (
    <div
      className={cn('relative overflow-hidden rounded-md border border-border bg-muted', className)}
      style={{ touchAction: zoomed ? 'none' : 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="w-full select-none"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          transformOrigin: 'center center',
          transition: pinch.current || pan.current ? 'none' : 'transform 180ms cubic-bezier(0.22,0.61,0.36,1)',
        }}
      />

      {zoomed ? (
        <button
          type="button"
          onClick={resetView}
          className="absolute bottom-2 right-2 h-9 rounded-md border border-border bg-card px-3 text-ui font-medium"
        >
          Ajustar
        </button>
      ) : null}
    </div>
  );
}
