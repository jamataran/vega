import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Cifra tipografiada. Para una métrica suelta un número bien puesto se lee más
 * rápido en un móvil que cualquier gráfica; por eso el panel no tiene ninguna.
 * Donde sí hay barras es en el desglose de coste, porque allí lo que se compara
 * es la proporción entre filas — ver `CostBreakdown`.
 */
export function Figure({
  label,
  value,
  note,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="eyebrow">{label}</p>
      <p className="mt-1.5 font-display text-title font-semibold leading-none">{value}</p>
      {note ? <p className="mt-1.5 text-ui text-muted-foreground">{note}</p> : null}
    </div>
  );
}
