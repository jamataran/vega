import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/cn';

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(function Progress({ className, value, ...props }, ref) {
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="size-full flex-1 bg-primary transition-transform duration-150"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});

export { Progress };
