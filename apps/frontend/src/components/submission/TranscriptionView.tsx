import { useMemo, useState } from 'react';
import type {
  Transcription,
  TranscriptionFlag,
  TranscriptionFlagKind,
  TranscriptionPage,
} from '@vega/shared';
import { cn } from '@/lib/cn';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { EmptyState } from '@/components/common/Feedback';
import { ConfidenceBadge, LOW_CONFIDENCE } from '@/components/common/status';
import { Latex, tokenizeLatex } from '@/components/Latex';
import { ZoomableImage } from './ZoomableImage';
import { PdfPage } from './PdfPage';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export function TranscriptionView({
  transcription,
  studentLabel,
  originalDocument,
}: {
  transcription: Transcription | null;
  studentLabel: string;
  originalDocument?: PDFDocumentProxy;
}) {
  const [openFlag, setOpenFlag] = useState<TranscriptionFlag | null>(null);

  if (!transcription) {
    return (
      <EmptyState
        title="Todavía no hay transcripción"
        description="El OCR aún no ha procesado esta entrega, o falló al intentarlo."
      />
    );
  }

  const flagCount = transcription.flags.length;

  return (
    <div className="scroll-pane h-full px-4 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <header className="flex flex-wrap items-center gap-2">
          <ConfidenceBadge value={transcription.confidence} label="Confianza del OCR" />
          {flagCount > 0 ? (
            <Badge variant="warning">
              {flagCount} {flagCount === 1 ? 'marca' : 'marcas'}
            </Badge>
          ) : (
            <Badge>Sin marcas</Badge>
          )}
          <span className="font-mono text-ui text-muted-foreground">{transcription.model}</span>
        </header>

        {transcription.confidence < LOW_CONFIDENCE ? (
          <Alert variant="warning" role="status">
            <AlertDescription>
              El OCR no está seguro de esta transcripción. Contrasta con el original antes de
              validar.
            </AlertDescription>
          </Alert>
        ) : null}

        {transcription.discrepancies.map((discrepancy) => (
          <Alert key={discrepancy.page} variant="warning">
            <AlertDescription>
              <strong>Página {discrepancy.page}: las dos lecturas no coinciden.</strong>
              <span className="mt-2 block break-words font-mono text-ui [overflow-wrap:anywhere]">Lectura A: {discrepancy.readingA}</span>
              <span className="mt-1 block break-words font-mono text-ui [overflow-wrap:anywhere]">Lectura B: {discrepancy.readingB}</span>
            </AlertDescription>
          </Alert>
        ))}

        {transcription.pages.map((page) => (
          <PageBlock
            key={page.page}
            page={page}
            flags={transcription.flags.filter((flag) => flag.page === page.page)}
            studentLabel={studentLabel}
            onFlagClick={setOpenFlag}
            originalDocument={originalDocument}
          />
        ))}
      </div>

      <Sheet open={openFlag !== null} onOpenChange={(open) => !open && setOpenFlag(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {openFlag?.kind === 'ILEGIBLE'
                ? 'Fragmento ilegible'
                : openFlag?.kind === 'DISCREPANCIA'
                  ? 'Lecturas discrepantes'
                  : 'Duda de transcripción'}
            </SheetTitle>
            <SheetDescription>
              {openFlag?.kind === 'ILEGIBLE'
                ? 'El OCR no ha podido leer este trozo del manuscrito.'
                : openFlag?.kind === 'DISCREPANCIA'
                  ? 'Las dos lecturas independientes no coinciden. Contrasta este fragmento con el original.'
                  : 'El OCR ha leído algo, pero no está seguro de haberlo entendido bien.'}
            </SheetDescription>
          </SheetHeader>

          {openFlag ? (
            <SheetBody className="flex flex-col gap-4">
              <div>
                <p className="eyebrow mb-1.5">Fragmento</p>
                <p className="rounded-md border border-border bg-muted px-3 py-2 font-mono text-ui">
                  {openFlag.excerpt || '(sin fragmento)'}
                </p>
              </div>
              {openFlag.note ? (
                <div>
                  <p className="eyebrow mb-1.5">Nota del OCR</p>
                  <p className="text-base text-muted-foreground">{openFlag.note}</p>
                </div>
              ) : null}
              <p className="text-ui text-muted-foreground">Página {openFlag.page} del escaneo.</p>
            </SheetBody>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PageBlock({
  page,
  flags,
  studentLabel,
  onFlagClick,
  originalDocument,
}: {
  page: TranscriptionPage;
  flags: readonly TranscriptionFlag[];
  studentLabel: string;
  onFlagClick: (flag: TranscriptionFlag) => void;
  originalDocument?: PDFDocumentProxy;
}) {
  return (
    <Card asChild>
      <section className="overflow-hidden">
        <h2 className="eyebrow border-b border-border px-3 py-2">Página {page.page}</h2>
        <div className="grid gap-4 p-3 md:grid-cols-2">
          {originalDocument ? (
            <PdfPage document={originalDocument} page={page.page} label={`Página ${page.page} escaneada del examen de ${studentLabel}`} />
          ) : (
            <ZoomableImage src={page.imageUrl} alt={`Página ${page.page} escaneada del examen de ${studentLabel}`} />
          )}
          <TranscribedText latex={page.latex} flags={flags} onFlagClick={onFlagClick} />
        </div>
      </section>
    </Card>
  );
}

/**
 * Reparte las marcas del OCR entre sus apariciones en el texto: la n-ésima
 * `[DUDA]` de la página corresponde a la n-ésima marca `DUDA` de esa página.
 */
function TranscribedText({
  latex,
  flags,
  onFlagClick,
}: {
  latex: string;
  flags: readonly TranscriptionFlag[];
  onFlagClick: (flag: TranscriptionFlag) => void;
}) {
  const segments = useMemo(() => tokenizeLatex(latex), [latex]);
  const byKind = useMemo(
    () => ({
      ILEGIBLE: flags.filter((flag) => flag.kind === 'ILEGIBLE'),
      DUDA: flags.filter((flag) => flag.kind === 'DUDA'),
      DISCREPANCIA: flags.filter((flag) => flag.kind === 'DISCREPANCIA'),
    }),
    [flags],
  );

  const used: Record<TranscriptionFlagKind, number> = {
    ILEGIBLE: 0,
    DUDA: 0,
    DISCREPANCIA: 0,
  };

  return (
    <div className="whitespace-pre-wrap break-words font-mono text-ui leading-relaxed text-muted-foreground">
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return <span key={index}>{segment.value}</span>;

        if (segment.kind === 'bold') {
          return (
            <strong key={index} className="font-sans font-semibold text-foreground">
              {segment.value}
            </strong>
          );
        }

        if (segment.kind === 'math') {
          return (
            <Latex
              key={index}
              tex={segment.value}
              display={segment.display}
              className={segment.display ? 'my-1' : 'font-sans text-base text-foreground'}
            />
          );
        }

        const flag = byKind[segment.value][used[segment.value]++];
        const label = `[${segment.value}]`;
        const className = cn(
          'mx-0.5 inline-flex items-center rounded-sm border px-1 font-mono text-ui font-semibold',
          segment.value === 'ILEGIBLE'
            ? 'border-destructive/50 bg-destructive-soft text-destructive-ink'
            : 'border-warning/50 bg-warning-soft text-warning-ink',
        );

        return flag ? (
          <button
            key={index}
            type="button"
            onClick={() => onFlagClick(flag)}
            className={cn(className, 'transition-opacity hover:opacity-80')}
            aria-label={`${segment.value === 'ILEGIBLE' ? 'Fragmento ilegible' : segment.value === 'DISCREPANCIA' ? 'Lecturas discrepantes' : 'Duda'}: ver detalle`}
          >
            {label}
          </button>
        ) : (
          <span key={index} className={className}>
            {label}
          </span>
        );
      })}
    </div>
  );
}
