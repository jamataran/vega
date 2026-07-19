import { useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Label } from '@/components/ui/label';

interface FieldRenderProps {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  /** El mensaje se asocia al control con `aria-describedby`. */
  error?: string;
  className?: string;
  /** Acción secundaria alineada con la etiqueta (por ejemplo, cambiar de modo). */
  action?: ReactNode;
  children: (props: FieldRenderProps) => ReactNode;
}

/**
 * Etiqueta, control y mensaje como un único bloque. Devuelve al control los
 * atributos que lo enlazan con su etiqueta y con su error, de modo que ningún
 * campo de la aplicación pueda quedarse sin nombre accesible.
 */
export function Field({ label, hint, error, className, action, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {action}
      </div>

      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}

      {error ? (
        <p id={`${id}-error`} className="text-ui text-destructive-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-ui text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
