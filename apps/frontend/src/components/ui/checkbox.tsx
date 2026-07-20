import * as React from 'react';
import * as CheckboxPrimitives from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Casilla de selección.
 *
 * Existe porque la alternativa era un `input type="checkbox"` nativo, cuya forma
 * la dibuja el sistema operativo: en el mismo diálogo de alta de actividades
 * convivía con un `Switch` de Radix y no compartían radio, borde ni anillo de
 * foco. Los controles de una misma pantalla tienen que parecer del mismo
 * sistema.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitives.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitives.Root
      ref={ref}
      className={cn(
        'peer size-5 shrink-0 rounded-sm border border-border-strong bg-card',
        'transition-colors focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'data-[state=checked]:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitives.Indicator className="flex items-center justify-center text-current">
        <Check className="size-4" strokeWidth={3} aria-hidden="true" />
      </CheckboxPrimitives.Indicator>
    </CheckboxPrimitives.Root>
  );
});

export { Checkbox };
