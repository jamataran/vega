import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';

const run = promisify(execFile);

/**
 * Normalización del original para el motor.
 *
 * **El problema.** Un simulacro fotografiado con el móvil pesa ~7 MB por folio.
 * Catorce folios son 94 MB, y la API de Anthropic admite 32 MB por petición
 * contando todo el payload: la lectura falla con `413 request_too_large` antes
 * de mirar una sola página. Ocurrió en producción el 23-08-2026 con tres
 * entregas reales.
 *
 * **Por qué esos bytes no compran nada.** La API rasteriza cada página en su
 * lado y la reduce a 2 576 px de lado largo como mucho. Una foto de 12 Mpx y un
 * JPEG de 1 754 px cuestan exactamente los mismos tokens y se leen igual de
 * bien; la diferencia son minutos de subida y un fallo. Rasterizar a 150 ppp
 * deja un A4 en 1 240 × 1 754 px —por debajo de ese tope— y un manuscrito en
 * 150–400 KB por página.
 *
 * **Por qué `pdftoppm` y no una librería.** `sharp` es un módulo nativo, que es
 * justo lo que el ADR 0001 evita; `jpeg-js` es JS puro pero sólo sirve si la
 * página ya es exactamente un JPEG, y los escáneres de iOS producen JPX.
 * Poppler rasteriza cualquier PDF, es un paquete del sistema —no de npm— y el
 * propio ADR 0001 ya contemplaba invocar `pdftoppm` para esto.
 *
 * **Su ausencia degrada, no rompe.** Si el binario no está —imagen antigua,
 * desarrollo local sin poppler— se devuelve `null` y el llamante sigue con el
 * original: el presupuesto de bytes por petición y el original opcional en la
 * corrección hacen el resto. Nunca se rechaza una entrega por esto.
 */

/** A4 en puntos PDF, que es la unidad de `pdf-lib`. */
const A4 = { width: 595.28, height: 841.89 } as const;

/** Resolución de rasterizado. Ver la cabecera: 150 ppp ya satura al modelo. */
const RASTER_DPI = 150;

/** Calidad JPEG. Por encima de 80 el manuscrito no se lee mejor y pesa el doble. */
const JPEG_QUALITY = 80;

/**
 * Tope de la conversión entera. Un PDF de 100 páginas a 150 ppp tarda unos
 * segundos; cinco minutos es el punto en el que algo va mal de verdad y más
 * vale seguir con el original que dejar el lote colgado.
 */
export const NORMALIZE_TIMEOUT_MS = 5 * 60_000;

/** Tipos que la ingesta puede recibir y este módulo sabe normalizar. */
const IMAGENES = new Set(['image/jpeg', 'image/jpg', 'image/png']);

let disponible: Promise<boolean> | undefined;

/**
 * ¿Está `pdftoppm` en el PATH?
 *
 * Se cachea la promesa, no el resultado: así dos entregas simultáneas del mismo
 * lote no lanzan dos procesos para preguntar lo mismo. No se reevalúa en
 * caliente a propósito —un binario no aparece a mitad de un despliegue— y el
 * arranque ya lo registra.
 */
export function pdftoppmAvailable(): Promise<boolean> {
  disponible ??= run('pdftoppm', ['-v'], { timeout: 10_000 })
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      // Sólo se recuerda que **no está**. Un fallo transitorio —el sistema sin
      // descriptores libres, un timeout con la máquina saturada— no puede dejar
      // marcado «no hay poppler» para toda la vida del contenedor y degradar en
      // silencio todas las entregas siguientes.
      if (error.code !== 'ENOENT') disponible = undefined;
      return false;
    });
  return disponible;
}

/** Sólo para las pruebas: olvida lo que se averiguó del entorno. */
export function resetPdftoppmCache(): void {
  disponible = undefined;
}

export interface NormalizeResult {
  readonly bytes: Uint8Array;
  readonly pages: number;
}

export interface NormalizeOptions {
  /**
   * Dónde crear el directorio temporal. Conviene que sea el mismo volumen del
   * almacén: el `/tmp` de un contenedor suele ser pequeño y un original de
   * 94 MB más sus páginas rasterizadas no cabe.
   */
  readonly tmpRoot?: string;
  readonly onWarn?: (message: string, error?: unknown) => void;
  /**
   * Cancelación del lote. Sin ella, «Parar» y el vencimiento del plazo no
   * llegaban al proceso hijo: `pdftoppm` seguía rasterizando cien páginas
   * después de que nadie esperase ya el resultado.
   */
  readonly signal?: AbortSignal;
}

/**
 * Rasteriza el original y lo recompone como un PDF ligero.
 *
 * Devuelve `null` —nunca lanza— si no se puede: sin poppler, con un PDF que
 * poppler no sabe abrir, o si algo falla a mitad. El llamante sigue con el
 * original, que es peor pero no es un fallo.
 */
export async function normalizeForEngine(
  bytes: Uint8Array,
  mediaType: string,
  options: NormalizeOptions = {},
): Promise<NormalizeResult | null> {
  const warn = options.onWarn ?? (() => {});

  if (!(await pdftoppmAvailable())) {
    warn('pdftoppm no está disponible: el original se envía sin normalizar.');
    return null;
  }

  let temporal: string | undefined;
  try {
    // Una imagen suelta se envuelve primero en un PDF de una página: así el
    // resto del camino es uno solo y no dos.
    const pdf = IMAGENES.has(mediaType) ? await imagenComoPdf(bytes, mediaType) : bytes;

    const raiz = options.tmpRoot ?? tmpdir();
    await mkdir(raiz, { recursive: true });
    temporal = await mkdtemp(join(raiz, 'vega-normalize-'));

    const entrada = join(temporal, 'original.pdf');
    await writeFile(entrada, pdf);

    await run(
      'pdftoppm',
      // `-q` calla los avisos de sintaxis. Sin él, un PDF con objetos rotos
      // —los escáneres los generan a diario— emite una línea por objeto, y con
      // el `maxBuffer` de 1 MiB que trae `execFile` por defecto eso mata el
      // proceso y tira una rasterización que ya había terminado bien. El
      // margen de 8 MiB cubre lo que se cuele pese a `-q`.
      ['-q', '-r', String(RASTER_DPI), '-jpeg', '-jpegopt', `quality=${JPEG_QUALITY}`, entrada, join(temporal, 'pagina')],
      { timeout: NORMALIZE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, signal: options.signal },
    );

    // `pdftoppm` numera con relleno variable según el total: `pagina-1.jpg` con
    // nueve páginas, `pagina-01.jpg` con diez. Ordenar por texto pondría la 10
    // antes que la 2, así que se ordena por el número extraído del nombre.
    const generadas = (await readdir(temporal))
      .filter((nombre) => nombre.startsWith('pagina-') && nombre.endsWith('.jpg'))
      .map((nombre) => ({ nombre, indice: Number.parseInt(nombre.slice('pagina-'.length), 10) }))
      .filter((entrada) => Number.isFinite(entrada.indice))
      .sort((a, b) => a.indice - b.indice);

    if (generadas.length === 0) {
      warn('pdftoppm no ha producido ninguna página; se sigue con el original.');
      return null;
    }

    // **El número de páginas tiene que coincidir con el original.** No es una
    // comprobación defensiva: la numeración de páginas atraviesa todo el
    // sistema —el manifiesto del troceado, la evaluación de la lectura, la
    // página que cita cada descuento y el visor, que pagina sobre el original—
    // y si el derivado tuviera una página de más o de menos, la corrección
    // hablaría de una página y el profesor estaría mirando otra. Un
    // desalineamiento silencioso es peor que mandar el original pesado.
    const original = await PDFDocument.load(pdf);
    if (generadas.length !== original.getPageCount()) {
      warn(
        `La normalización ha producido ${generadas.length} páginas y el original tiene ` +
          `${original.getPageCount()}: se sigue con el fichero tal cual para no descuadrar la numeración.`,
      );
      return null;
    }

    const salida = await PDFDocument.create();
    for (const { nombre } of generadas) {
      const jpeg = await readFile(join(temporal, nombre));
      const imagen = await salida.embedJpg(jpeg);
      const pagina = salida.addPage([A4.width, A4.height]);
      // Encajar conservando la proporción: un folio apaisado no debe salir
      // estirado, y el modelo lee la geometría igual que un humano.
      const escala = Math.min(A4.width / imagen.width, A4.height / imagen.height);
      const ancho = imagen.width * escala;
      const alto = imagen.height * escala;
      pagina.drawImage(imagen, {
        x: (A4.width - ancho) / 2,
        y: (A4.height - alto) / 2,
        width: ancho,
        height: alto,
      });
    }

    const normalizado = await salida.save();

    // Rasterizar no siempre encoge. Un PDF **vectorial** —un examen escrito a
    // ordenador, o un enunciado exportado de LaTeX— pesa poco y sale mucho más
    // gordo convertido en fotos: medido, 68 KB se convierten en 2,4 MB. El
    // llamante sólo pide esto cuando el original es pesado, pero comprobarlo
    // aquí cierra el caso raro y evita empeorar la petición justo cuando se
    // intentaba arreglarla.
    if (normalizado.byteLength >= bytes.byteLength) {
      warn(
        `La normalización no reduce el original (${Math.round(bytes.byteLength / 1024)} KB → ` +
          `${Math.round(normalizado.byteLength / 1024)} KB): se sigue con el fichero tal cual.`,
      );
      return null;
    }

    return { bytes: normalizado, pages: generadas.length };
  } catch (error) {
    warn('No se ha podido normalizar el original; se sigue con el fichero tal cual.', error);
    return null;
  } finally {
    if (temporal !== undefined) {
      // El temporal se borra siempre: son decenas de MB por entrega y el
      // volumen del contenedor es el mismo donde viven las entregas.
      await rm(temporal, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** Envuelve una imagen suelta en un PDF de una página A4. */
async function imagenComoPdf(bytes: Uint8Array, mediaType: string): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  const imagen =
    mediaType === 'image/png' ? await documento.embedPng(bytes) : await documento.embedJpg(bytes);
  const pagina = documento.addPage([A4.width, A4.height]);
  const escala = Math.min(A4.width / imagen.width, A4.height / imagen.height);
  const ancho = imagen.width * escala;
  const alto = imagen.height * escala;
  pagina.drawImage(imagen, {
    x: (A4.width - ancho) / 2,
    y: (A4.height - alto) / 2,
    width: ancho,
    height: alto,
  });
  return documento.save();
}
