import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/Feedback';
import { PdfPage } from './PdfPage';
import { ZoomableImage } from './ZoomableImage';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export function OriginalView({
  scanUrls,
  studentLabel,
  originalDocument,
  page,
  onPageChange,
  totalPages,
}: {
  scanUrls: readonly string[];
  studentLabel: string;
  originalDocument?: PDFDocumentProxy;
  page: number;
  onPageChange: (page: number) => void;
  totalPages: number;
}) {
  const current = scanUrls[page];

  if (!originalDocument && (scanUrls.length === 0 || !current)) {
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
        {originalDocument ? (
          <PdfPage document={originalDocument} page={page + 1} label={`Página ${page + 1} del examen de ${studentLabel}`} />
        ) : (
          <ZoomableImage src={current!} alt={`Página ${page + 1} del examen de ${studentLabel}`} className="mx-auto max-w-3xl" />
        )}
        <p className="mt-3 text-center text-ui text-muted-foreground">
          Usa los controles inferiores para cambiar de página.
        </p>
      </div>

      {totalPages > 1 ? (
        <nav
          aria-label="Páginas del escaneo"
          className="flex shrink-0 items-center justify-center gap-4 border-t border-border px-4 py-2"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Página anterior"
            disabled={page === 0}
            onClick={() => onPageChange(Math.max(0, page - 1))}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>
          <p className="text-ui text-muted-foreground" aria-live="polite">
            Página {page + 1} de {totalPages}
          </p>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Página siguiente"
            disabled={page === totalPages - 1}
            onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
