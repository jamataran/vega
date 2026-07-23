import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Abre el PDF que se ha descargado del API.
 *
 * Recibe el **fichero**, no una URL, y se lo entrega a pdf.js como bytes. Antes
 * se creaba un `blob:` con `URL.createObjectURL` y pdf.js iba a buscarlo por su
 * cuenta; eso fallaba con «Unexpected server response (0)» porque la CSP de la
 * aplicación declara `connect-src 'self'` y ahí un `blob:` no entra. Además
 * abría una carrera: al refrescarse la consulta se revocaba la URL anterior
 * mientras pdf.js seguía leyéndola. Pasando los bytes no hay ni CSP que valga
 * ni URL que revocar.
 */
export function usePdfDocument(file: Blob | undefined): {
  document: PDFDocumentProxy | null;
  loading: boolean;
  error: Error | null;
} {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(file !== undefined);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setDocument(null);
    setError(null);
    if (!file) {
      setLoading(false);
      return;
    }
    let canceled = false;
    let loaded: PDFDocumentProxy | null = null;
    const load = async () => {
      try {
        setLoading(true);
        const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist');
        GlobalWorkerOptions.workerSrc = workerUrl;
        // Una copia nueva en cada intento: pdf.js se queda con el buffer que le
        // pasan —lo transfiere al worker— y reutilizarlo daría un buffer vacío.
        const data = new Uint8Array(await file.arrayBuffer());
        if (canceled) return;
        const task = getDocument({ data });
        loaded = await task.promise;
        if (canceled) {
          void loaded.destroy();
          loaded = null;
        } else {
          setDocument(loaded);
        }
      } catch (cause) {
        if (!canceled) setError(cause instanceof Error ? cause : new Error('PDF no válido'));
      } finally {
        if (!canceled) setLoading(false);
      }
    };
    void load();
    return () => {
      canceled = true;
      if (loaded) void loaded.destroy();
    };
  }, [file]);

  return { document, loading, error };
}

/** Una página del original; todas las vistas reutilizan el mismo documento PDF. */
export function PdfPage({ document, page, label }: { document: PDFDocumentProxy; page: number; label: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    let canceled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    const render = async () => {
      try {
        setLoading(true);
        setError(null);
        const pdfPage = await document.getPage(Math.min(Math.max(page, 1), document.numPages));
        const base = pdfPage.getViewport({ scale: 1 });
        const cssWidth = Math.min(Math.max(host.clientWidth, 280), 900);
        const viewport = pdfPage.getViewport({ scale: (cssWidth / base.width) * window.devicePixelRatio });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / window.devicePixelRatio}px`;
        canvas.style.height = `${viewport.height / window.devicePixelRatio}px`;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas no disponible');
        renderTask = pdfPage.render({ canvasContext: context, viewport });
        await renderTask.promise;
        if (!canceled) setLoading(false);
      } catch (cause) {
        if (!canceled && cause instanceof Error && cause.name !== 'RenderingCancelledException') {
          setError('No se ha podido mostrar esta página del original.');
          setLoading(false);
        }
      }
    };
    void render();
    return () => {
      canceled = true;
      renderTask?.cancel();
    };
  }, [document, page, visible]);

  return (
    <div ref={hostRef} className="w-full">
      {loading ? <Skeleton className="h-96 w-full rounded-md" /> : null}
      {error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive-soft p-3 text-ui text-destructive-ink">{error}</p> : null}
      <canvas ref={canvasRef} role="img" aria-label={label} className={loading || error ? 'hidden' : 'mx-auto max-w-full rounded-md border border-border'} />
    </div>
  );
}
