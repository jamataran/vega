import * as React from 'react';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-base ' +
    '[&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:size-4 [&>svg+div]:translate-y-[-1px] ' +
    '[&>svg~*]:pl-6',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-card-foreground [&>svg]:text-muted-foreground',
        info: 'border-info/40 bg-info-soft text-info-ink [&>svg]:text-info-ink',
        success: 'border-success/40 bg-success-soft text-success-ink [&>svg]:text-success-ink',
        warning: 'border-warning/40 bg-warning-soft text-warning-ink [&>svg]:text-warning-ink',
        destructive:
          'border-destructive/40 bg-destructive-soft text-destructive-ink [&>svg]:text-destructive-ink',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(function Alert({ className, variant, role = 'alert', ...props }, ref) {
  return (
    <div ref={ref} role={role} className={cn(alertVariants({ variant }), className)} {...props} />
  );
});

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  function AlertTitle({ className, ...props }, ref) {
    return (
      <div ref={ref} className={cn('font-display font-semibold leading-snug', className)} {...props} />
    );
  },
);

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function AlertDescription({ className, ...props }, ref) {
  return <div ref={ref} className={cn('text-ui [&_p]:leading-relaxed', className)} {...props} />;
});

export { Alert, AlertTitle, AlertDescription };
