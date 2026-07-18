import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ' +
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none ' +
    'disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Una sola acción primaria por vista. Color plano, nunca el degradado.
        default: 'bg-primary font-semibold text-primary-foreground hover:bg-primary-hover',
        outline: 'border border-border bg-card hover:border-border-strong hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        destructive:
          'border border-destructive/40 bg-destructive-soft text-destructive-ink hover:border-destructive/70',
        link: 'text-primary-ink underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4 text-base',
        sm: 'h-9 rounded-sm px-3 text-ui',
        lg: 'h-12 px-5 text-base',
        icon: 'h-10 w-10 shrink-0',
      },
    },
    defaultVariants: {
      variant: 'outline',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Muestra un indicador y bloquea el botón mientras dura la operación. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </Comp>
  );
});

export { Button, buttonVariants };
