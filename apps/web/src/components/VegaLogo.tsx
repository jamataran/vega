import vegaIcon from '@/assets/vega-icon.svg';
import { cn } from '@/lib/cn';

interface VegaLogoProps {
  /**
   * Nombre accesible. Se omite cuando el símbolo acompaña al nombre escrito:
   * en ese caso es decorativo y el texto ya identifica el producto.
   */
  label?: string;
  className?: string;
}

/**
 * Símbolo de Vega. Se sirve tal cual desde `src/assets/vega-icon.svg`, copia
 * versionada del maestro `brand/vega-icon.svg`: no se redibuja, no se recolorea
 * por brazos y no lleva contorno, sombra ni animación.
 *
 * Proporción 1:1 y 20 px como tamaño mínimo en interfaz.
 */
export function VegaLogo({ label, className }: VegaLogoProps) {
  return (
    <img
      src={vegaIcon}
      alt={label ?? ''}
      role={label ? undefined : 'presentation'}
      draggable={false}
      className={cn('aspect-square h-6 w-6 shrink-0 select-none', className)}
    />
  );
}
