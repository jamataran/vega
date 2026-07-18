import * as React from 'react';
import { cn } from '@/lib/cn';

const textareaClassName =
  'flex w-full rounded-md border border-input bg-card px-3 py-2.5 text-base leading-relaxed ' +
  'text-foreground transition-colors placeholder:text-muted-foreground hover:border-border-strong ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} className={cn(textareaClassName, 'min-h-20 resize-y', className)} {...props} />
  );
});

export interface AutoTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  value: string;
  minRows?: number;
}

/**
 * Textarea que crece con el contenido: escribir feedback en el móvil dentro de
 * una caja de tres líneas con scroll propio es exactamente lo que no queremos.
 */
const AutoTextarea = React.forwardRef<HTMLTextAreaElement, AutoTextareaProps>(function AutoTextarea(
  { value, minRows = 2, className, ...props },
  forwardedRef,
) {
  const innerRef = React.useRef<HTMLTextAreaElement>(null);
  React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement);

  React.useLayoutEffect(() => {
    const element = innerRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={innerRef}
      value={value}
      rows={minRows}
      className={cn(textareaClassName, 'resize-none overflow-hidden', className)}
      {...props}
    />
  );
});

export { Textarea, AutoTextarea };
