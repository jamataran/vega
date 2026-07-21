import { PDFDocument } from 'pdf-lib';

/**
 * Cuántas páginas tiene lo que ha entregado el alumno.
 *
 * Importa más de lo que parece: el número de páginas es lo que decide cuántas
 * llamadas de visión hace la transcripción, y por tanto lo que se paga. Contar
 * de menos deja media entrega sin corregir en silencio; contar de más gasta
 * tokens en folios que no existen.
 *
 * Se cuenta al ingerir, no al corregir, porque es la única ocasión en la que los
 * bytes están delante y porque un fichero ilegible debe detectarse antes de
 * llegar al motor (HU-08, RN-7 y RN-8).
 */

export type PageCountFailure = 'not-a-pdf' | 'unsupported' | 'empty';

export interface PageCountResult {
  readonly pages: number;
  /** `null` si se ha podido contar; si no, por qué no. */
  readonly failure: PageCountFailure | null;
  /** Mensaje en español listo para `submissions.error_message`. */
  readonly message: string | null;
}

/** Formatos de imagen que la API de visión acepta como página suelta. */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export async function countPages(
  bytes: Uint8Array,
  mediaType: string,
  filename: string,
): Promise<PageCountResult> {
  if (bytes.byteLength === 0) {
    return {
      pages: 0,
      failure: 'empty',
      message: `El fichero entregado ("${filename}") está vacío.`,
    };
  }

  const type = mediaType.split(';')[0]?.trim().toLowerCase() ?? '';

  // Una imagen suelta es una página y no hay nada que analizar.
  if (IMAGE_TYPES.has(type)) return { pages: 1, failure: null, message: null };

  if (type !== 'application/pdf' && !filename.toLowerCase().endsWith('.pdf')) {
    return {
      pages: 0,
      failure: 'unsupported',
      message:
        `El fichero entregado ("${filename}") es de tipo ${mediaType || 'desconocido'}, ` +
        'y Vega sólo sabe leer PDF e imágenes. Corrígelo a mano o pide al alumno que lo reenvíe.',
    };
  }

  try {
    // `updateMetadata: false` evita que pdf-lib toque el documento sólo por
    // abrirlo; aquí no se escribe nada, sólo se cuenta.
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const pages = document.getPageCount();
    if (pages === 0) {
      return {
        pages: 0,
        failure: 'empty',
        message: `El PDF entregado ("${filename}") no tiene ninguna página.`,
      };
    }
    return { pages, failure: null, message: null };
  } catch (error) {
    return {
      pages: 0,
      failure: 'not-a-pdf',
      message:
        `No se ha podido leer el PDF entregado ("${filename}"): ${(error as Error).message}. ` +
        'La entrega queda registrada para que no desaparezca, pero no se puede corregir.',
    };
  }
}
