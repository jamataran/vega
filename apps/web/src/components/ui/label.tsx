import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const labelVariants = cva(
  'text-ui font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
);

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(function Label({ className, ...props }, ref) {
  return <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />;
});

export { Label };
