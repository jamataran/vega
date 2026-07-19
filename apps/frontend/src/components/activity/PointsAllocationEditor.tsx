import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { PointsAllocation } from '@vega/shared';
import { cn } from '@/lib/cn';
import { formatPoints } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface PointsAllocationEditorProps {
  rows: readonly PointsAllocation[];
  /** `null` mientras la nota máxima no esté puesta: entonces no hay suma que cuadrar. */
  maxScore: number | null;
  onChange: (rows: PointsAllocation[]) => void;
}

/**
 * Reparto de puntos de la actividad. Se reordena con botones y no arrastrando:
 * en el móvil el arrastre compite con el scroll y con el gesto de las vistas.
 */
export function PointsAllocationEditor({ rows, maxScore, onChange }: PointsAllocationEditorProps) {
  const sum = Math.round(rows.reduce((total, row) => total + row.maxPoints, 0) * 100) / 100;
  const matches = maxScore === null || Math.abs(sum - maxScore) < 0.001;

  const update = (index: number, patch: Partial<PointsAllocation>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-ui text-muted-foreground">
          Sin reparto de puntos. La IA repartirá la nota como mejor le parezca.
        </p>
      ) : null}

      {rows.map((row, index) => (
        <Card key={index} className="p-2.5">
          <div className="flex items-center gap-2">
            <Input
              value={row.label}
              onChange={(event) => update(index, { label: event.target.value })}
              aria-label={`Etiqueta del apartado ${index + 1}`}
              placeholder="1a"
              className="h-10 w-20 shrink-0 px-2 text-center font-mono text-ui"
            />
            <Input
              value={row.statement}
              onChange={(event) => update(index, { statement: event.target.value })}
              aria-label={`Enunciado del apartado ${index + 1}`}
              placeholder="Enunciado corto"
              className="h-10 min-w-0 flex-1 px-2.5 text-ui"
            />
          </div>

          <div className="mt-2 flex items-center gap-2">
            <label className="flex items-center gap-2 text-ui text-muted-foreground">
              Puntos
              <Input
                type="number"
                min={0}
                step={0.25}
                value={row.maxPoints}
                onChange={(event) => update(index, { maxPoints: Number(event.target.value) || 0 })}
                aria-label={`Puntos del apartado ${index + 1}`}
                className="h-10 w-20 px-2 text-right text-ui"
              />
            </label>

            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Subir el apartado ${index + 1}`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ChevronDown className="rotate-180" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Bajar el apartado ${index + 1}`}
                disabled={index === rows.length - 1}
                onClick={() => move(index, 1)}
              >
                <ChevronDown aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Quitar el apartado ${index + 1}`}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </div>
        </Card>
      ))}

      <div className="flex items-center justify-between gap-3">
        <Button
          size="sm"
          onClick={() => onChange([...rows, { label: '', statement: '', maxPoints: 0 }])}
        >
          <Plus aria-hidden="true" />
          Añadir apartado
        </Button>

        <p
          className={cn('text-ui', matches ? 'text-muted-foreground' : 'text-warning-ink')}
          role={matches ? undefined : 'status'}
        >
          {maxScore === null
            ? `Suma ${formatPoints(sum)}`
            : `Suma ${formatPoints(sum)} de ${formatPoints(maxScore)}`}
          {matches ? '' : ' — no cuadra'}
        </p>
      </div>
    </div>
  );
}
