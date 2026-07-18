import * as React from 'react';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-display text-micro ' +
    'font-semibold uppercase transition-colors',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-secondary-foreground',
        outline: 'border-border text-muted-foreground',
        primary: 'border-primary/40 bg-primary-soft text-primary-ink',
        success: 'border-success/40 bg-success-soft text-success-ink',
        warning: 'border-warning/40 bg-warning-soft text-warning-ink',
        destructive: 'border-destructive/40 bg-destructive-soft text-destructive-ink',
        info: 'border-info/40 bg-info-soft text-info-ink',
        quiet: 'border-transparent bg-transparent text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
