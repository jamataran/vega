import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/Feedback';
import { ZoomableImage } from './ZoomableImage';

export function OriginalView({
  scanUrls,
  studentLabel,
}: {
  scanUrls: readonly string[];
  studentLabel: string;
}) {
  const [page, setPage] = useState(0);
  const current = scanUrls[page];

  if (scanUrls.length === 0 || !current) {
    return (
      <EmptyState
        title="Sin páginas escaneadas"
        description="Esta entrega no tiene imágenes asociadas. Revisa el conector de Moodle."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-pane flex-1 px-4 py-4">
        <ZoomableImage
          src={current}
          alt={`Página ${page + 1} del examen de ${studentLabel}`}
          className="mx-auto max-w-3xl"
        />
        <p className="mt-3 text-center text-ui text-muted-foreground">
          Pellizca o toca dos veces para ampliar.
        </p>
      </div>

      {scanUrls.length > 1 ? (
        <nav
          aria-label="Páginas del escaneo"
          className="flex shrink-0 items-center justify-center gap-4 border-t border-border px-4 py-2"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Página anterior"
            disabled={page === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>
          <p className="text-ui text-muted-foreground" aria-live="polite">
            Página {page + 1} de {scanUrls.length}
          </p>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Página siguiente"
            disabled={page === scanUrls.length - 1}
            onClick={() => setPage((value) => Math.min(scanUrls.length - 1, value + 1))}
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
