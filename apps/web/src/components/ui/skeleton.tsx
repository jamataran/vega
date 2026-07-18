import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Los esqueletos reproducen la forma del contenido que viene. Preferimos esto a
 * un spinner a pantalla completa: el profesor ya sabe qué va a aparecer.
 */
function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-shimmer rounded-sm bg-muted',
        'bg-[linear-gradient(90deg,transparent_0%,rgb(var(--border-strong)/0.35)_50%,transparent_100%)]',
        'bg-[length:220%_100%]',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
