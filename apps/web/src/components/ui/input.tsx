import * as React from 'react';
import { cn } from '@/lib/cn';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type, ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base text-foreground',
          'transition-colors placeholder:text-muted-foreground hover:border-border-strong',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50 read-only:text-muted-foreground',
          'file:border-0 file:bg-transparent file:text-ui file:font-medium',
          'aria-[invalid=true]:border-destructive',
          className,
        )}
        {...props}
      />
    );
  },
);

export { Input };
