import { Check } from 'lucide-react';
import type { SubmissionStatus } from '@vega/shared';
import { formatScore } from '@/lib/format';
import { Button } from '@/components/ui/button';

interface ActionBarProps {
  total: number;
  /** `null` en actividades que no se puntúan: entonces no hay nota que enseñar. */
  maxScore: number | null;
  status: SubmissionStatus;
  /** Incluye el reintento tras un fallo al publicar una corrección validada. */
  canPublish: boolean;
  dirty: boolean;
  saving: boolean;
  working: boolean;
  onSave: () => void;
  onValidate: () => void;
  onPublish: () => void;
}

/**
 * Barra fija inferior. Es el único sitio de la pantalla donde se decide algo,
 * y por eso nunca se mueve: la nota a la izquierda, la acción bajo el pulgar.
 */
export function ActionBar({
  total,
  maxScore,
  status,
  canPublish,
  dirty,
  saving,
  working,
  onSave,
  onValidate,
  onPublish,
}: ActionBarProps) {
  const published = status === 'published';

  return (
    <div className="shrink-0 border-t border-border bg-card pb-safe">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2.5">
        {maxScore === null ? (
          <div className="min-w-0">
            <p className="eyebrow">Sin nota</p>
            <p className="text-ui leading-tight text-muted-foreground">Sólo feedback</p>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="eyebrow">Nota total</p>
            <p className="flex items-baseline gap-1 leading-none">
              <span className="font-display text-score font-semibold">{formatScore(total)}</span>
              <span className="text-base text-muted-foreground">/ {formatScore(maxScore)}</span>
            </p>
          </div>
        )}

        <div className="flex flex-1 items-center justify-end gap-2">
          {published ? (
            <p className="flex items-center gap-1.5 text-ui font-medium text-success-ink">
              <Check className="size-4" aria-hidden="true" />
              Publicada
            </p>
          ) : canPublish ? (
            <Button size="lg" onClick={onPublish} disabled={working}>
              Publicar
            </Button>
          ) : status === 'graded' ? (
            <>
              <Button
                size="lg"
                variant="outline"
                onClick={onSave}
                disabled={!dirty || working}
                loading={saving}
              >
                Guardar
              </Button>
              <Button size="lg" onClick={onValidate} disabled={working}>
                Validar
              </Button>
            </>
          ) : (
            <p className="text-ui text-muted-foreground">
              {status === 'error' ? 'Reprocesa para volver a corregir' : 'Sin acciones de corrección'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
