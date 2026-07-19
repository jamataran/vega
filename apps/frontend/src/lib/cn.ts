import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * La escala tipográfica de Vega no usa los nombres de Tailwind (`text-sm`,
 * `text-lg`…). Sin declararlos, tailwind-merge tomaría `text-ui` por un color
 * y lo anularía al encontrar `text-muted-foreground` en la misma cadena.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'ui', 'base', 'title', 'score'] }],
    },
  },
});

/**
 * Une clases condicionales y resuelve los conflictos de Tailwind, de modo que
 * la clase que pasa quien usa el componente gana sobre la del propio
 * componente. Es el `cn` que esperan las primitivas de shadcn/ui.
 */
export function cn(...values: ClassValue[]): string {
  return twMerge(clsx(values));
}
