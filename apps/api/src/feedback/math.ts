import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import type { LiteElement, LiteNode } from 'mathjax-full/js/adaptors/lite/Element.js';

/**
 * Composición de fórmulas TeX para el PDF de corrección.
 *
 * El PDF lo dibuja `pdf-lib`, que no sabe nada de LaTeX, así que hasta ahora una
 * fracción llegaba al alumno como `(a)/(b)` y una integral como la palabra
 * suelta que quedaba tras borrar la macro. MathJax compone la fórmula a SVG y
 * aquí se traduce ese SVG a los trazos que `pdf-lib` sí sabe pintar.
 *
 * **Por qué no una distribución TeX ni un navegador sin cabeza:** MathJax es
 * JavaScript puro. La imagen del API sigue siendo un Node sin compilador ni
 * Chromium, que es la razón por la que el PDF se genera con `pdf-lib` desde el
 * principio.
 *
 * **Regla de esta traducción: ante la duda, rendirse.** Cualquier cosa que el
 * recorrido no entienda —un elemento nuevo, una transformación con rotación, un
 * comando de trazo desconocido— devuelve `null`, y quien llama vuelve al texto
 * legible de siempre. Un PDF con la fórmula en texto plano es peor que uno bien
 * compuesto, pero un PDF con la fórmula deformada y sin avisar es mucho peor que
 * los dos: lo firma un profesor y lo lee un alumno.
 */

/**
 * Unidades por `em` en la salida de MathJax. Es la escala en la que vienen los
 * trazos, y con ella se pasa de tamaño de fuente en puntos a factor de escala.
 */
export const MATH_UNITS_PER_EM = 1000;

/** Una fórmula ya compuesta, lista para dibujarse. */
export interface MathDrawing {
  /**
   * Trazos SVG en el espacio del documento: origen en la línea base, `y` hacia
   * abajo. Es justo lo que espera `PDFPage.drawSvgPath`, que aplica
   * `translate(x, y) scale(s, -s)`.
   */
  readonly paths: readonly string[];
  /** Anchura, en unidades de MathJax. */
  readonly width: number;
  /** Cuánto sobresale por encima de la línea base. */
  readonly ascent: number;
  /** Cuánto cuelga por debajo. */
  readonly descent: number;
}

/**
 * Transformación afín **diagonal**: `x' = a·x + e`, `y' = d·y + f`.
 *
 * MathJax sólo emite traslaciones y escalas, nunca rotaciones ni sesgos. Basta
 * con esta forma reducida, y que sea reducida es lo que permite transformar los
 * trazos coordenada a coordenada sin implementar un motor de matrices.
 */
interface Affine {
  readonly a: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

const IDENTITY: Affine = { a: 1, d: 1, e: 0, f: 0 };

/** `parent ∘ child`: primero se aplica la del hijo. */
function compose(parent: Affine, child: Affine): Affine {
  return {
    a: parent.a * child.a,
    d: parent.d * child.d,
    e: parent.a * child.e + parent.e,
    f: parent.d * child.f + parent.f,
  };
}

// ── MathJax ─────────────────────────────────────────────────────────────────

type MathDocument = ReturnType<typeof buildDocument>;

function buildDocument() {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  return {
    adaptor,
    html: mathjax.document('', {
      InputJax: new TeX({
        // Todos los paquetes menos `noundefined`, que existe para que una macro
        // desconocida se pinte en rojo en la página en vez de fallar. En una web
        // eso ayuda a depurar; en un PDF que se descarga y se entrega, imprime
        // «Undefined control sequence» sobre el trabajo de un alumno.
        packages: AllPackages.filter((name) => name !== 'noundefined'),
        // Por defecto MathJax **compone el error**: pinta en rojo «Undefined
        // control sequence» y lo devuelve como una fórmula más. Eso acabaría
        // impreso en el PDF que lee un alumno. Que lance es lo que permite
        // detectarlo y caer al texto plano.
        formatError: (_jax: unknown, error: unknown) => {
          throw error;
        },
      }),
      // `fontCache: 'none'` inserta cada glifo como un `<path>` completo en vez
      // de referenciar un `<defs>` compartido. Cuesta unos bytes por fórmula y
      // ahorra tener que resolver `<use>`: cada trazo se lee donde se dibuja.
      OutputJax: new SVG({ fontCache: 'none' }),
    }),
  };
}

let document: MathDocument | undefined;

/**
 * Arrancar MathJax registra manejadores globales y compila su tabla de fuentes:
 * caro, y sólo hace falta si el documento trae alguna fórmula. Se hace una vez
 * por proceso y a la primera que llegue.
 */
function mathDocument(): MathDocument {
  document ??= buildDocument();
  return document;
}

// ── Recorrido del SVG ───────────────────────────────────────────────────────

function isElement(node: LiteNode): node is LiteElement {
  return typeof (node as LiteElement).kind === 'string' && (node as LiteElement).kind !== '#text';
}

/**
 * Traduce un atributo `transform` a su forma afín, o `null` si trae algo que no
 * sea `translate` o `scale`.
 */
function parseTransform(raw: string): Affine | null {
  let result: Affine = IDENTITY;
  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;

  for (const match of raw.matchAll(pattern)) {
    const name = match[1];
    const args = (match[2] ?? '')
      .split(/[\s,]+/)
      .filter((value) => value !== '')
      .map(Number);
    if (args.some((value) => !Number.isFinite(value))) return null;

    if (name === 'translate') {
      const [x = 0, y = 0] = args;
      result = compose(result, { a: 1, d: 1, e: x, f: y });
    } else if (name === 'scale') {
      const [x, y] = args;
      if (x === undefined || !Number.isFinite(x)) return null;
      result = compose(result, { a: x, d: y ?? x, e: 0, f: 0 });
    } else {
      // `matrix`, `rotate`, `skewX`… MathJax no los usa; si algún día lo hace,
      // más vale texto plano que una fórmula girada.
      return null;
    }
  }

  return result;
}

/** Comandos de trazo que emiten las fuentes TeX de MathJax. */
const PATH_COMMANDS = new Set(['M', 'L', 'H', 'V', 'Q', 'T', 'Z']);

/** Cuántos números consume cada comando. */
const PATH_ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, Q: 4, T: 2, Z: 0 };

/**
 * Reescribe un `d` aplicando la transformación y **normalizándolo a `M`, `L`,
 * `Q` y `Z`**.
 *
 * La transformación se puede aplicar coordenada a coordenada porque es
 * diagonal: sin rotación, una recta sigue siendo recta y una cuadrática sigue
 * siendo cuadrática con sus puntos transformados.
 *
 * La normalización, en cambio, no es cosmética: pdf-lib interpreta mal `T` —la
 * cuadrática suave—, porque tras dibujar la curva vuelve a reflejar el punto de
 * control que acaba de calcular y deja guardado el reflejo del reflejo. En un
 * glifo suelto no se nota; las fuentes TeX encadenan seis y siete `T` seguidas
 * para trazar un paréntesis grande o un sumatorio, y el error se acumula hasta
 * deformar el contorno. Resolviendo aquí la reflexión y emitiendo la `Q`
 * explícita, pdf-lib sólo ve comandos que ejecuta bien.
 */
function transformPath(d: string, transform: Affine): string | null {
  // MathJax inserta glifos invisibles —la aplicación de función de `\ln x`, por
  // ejemplo— como un `<path>` con la `d` vacía. Es un trazo que no pinta nada,
  // no un trazo ilegible: tratarlo como error tiraba la fórmula entera.
  if (d.trim() === '') return '';

  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (tokens === null) return null;

  const out: string[] = [];
  const round = (value: number): string => String(Math.round(value * 1000) / 1000);
  const emitX = (x: number): string => round(transform.a * x + transform.e);
  const emitY = (y: number): string => round(transform.d * y + transform.f);

  // Estado del trazo, siempre en coordenadas ORIGINALES: el punto actual, el
  // arranque del subtrazo (a donde vuelve `Z`) y el punto de control de la
  // última cuadrática, que es lo que `T` necesita reflejar.
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let controlX: number | null = null;
  let controlY: number | null = null;

  let command = '';
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) break;

    if (/[A-Za-z]/.test(token)) {
      if (!PATH_COMMANDS.has(token.toUpperCase())) return null;
      command = token;
      index += 1;
      if (command.toUpperCase() === 'Z') {
        out.push('Z');
        cx = startX;
        cy = startY;
        controlX = null;
        controlY = null;
        continue;
      }
    }
    if (command === '') return null;

    const upper = command.toUpperCase();
    const relative = command === command.toLowerCase();
    const arity = PATH_ARITY[upper] ?? 0;

    const args: number[] = [];
    for (let step = 0; step < arity; step += 1) {
      const value = tokens[index];
      if (value === undefined || /[A-Za-z]/.test(value)) return null;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return null;
      args.push(parsed);
      index += 1;
    }

    // Un desplazamiento se suma al punto actual; un absoluto lo sustituye.
    const absX = (value: number): number => (relative ? cx + value : value);
    const absY = (value: number): number => (relative ? cy + value : value);

    switch (upper) {
      case 'M': {
        const x = absX(args[0] as number);
        const y = absY(args[1] as number);
        out.push('M', emitX(x), emitY(y));
        cx = x;
        cy = y;
        startX = x;
        startY = y;
        controlX = null;
        controlY = null;
        // Los pares que siguen a una `M` son `L` implícitas, no más `M`.
        command = relative ? 'l' : 'L';
        break;
      }
      case 'L':
      case 'H':
      case 'V': {
        const x = upper === 'V' ? cx : absX(args[0] as number);
        const y = upper === 'H' ? cy : absY(args[upper === 'V' ? 0 : 1] as number);
        out.push('L', emitX(x), emitY(y));
        cx = x;
        cy = y;
        controlX = null;
        controlY = null;
        break;
      }
      case 'Q': {
        const qx = absX(args[0] as number);
        const qy = absY(args[1] as number);
        const x = absX(args[2] as number);
        const y = absY(args[3] as number);
        out.push('Q', emitX(qx), emitY(qy), emitX(x), emitY(y));
        controlX = qx;
        controlY = qy;
        cx = x;
        cy = y;
        break;
      }
      case 'T': {
        // Sin cuadrática previa, `T` es una cuadrática con el control en el
        // propio punto actual: una recta.
        // La anotación no es adorno: sin ella, TypeScript ve un ciclo entre
        // este punto de control y el que `controlX` guardó en la vuelta anterior.
        const qx: number = controlX === null ? cx : 2 * cx - controlX;
        const qy: number = controlY === null ? cy : 2 * cy - controlY;
        const x = absX(args[0] as number);
        const y = absY(args[1] as number);
        out.push('Q', emitX(qx), emitY(qy), emitX(x), emitY(y));
        controlX = qx;
        controlY = qy;
        cx = x;
        cy = y;
        break;
      }
      default:
        return null;
    }
  }

  return out.join(' ');
}

/** Un `<rect>` transformado, ya como trazo cerrado. */
function rectToPath(element: LiteElement, transform: Affine): string | null {
  const attributes = element.attributes ?? {};
  const x = Number(attributes['x'] ?? 0);
  const y = Number(attributes['y'] ?? 0);
  const width = Number(attributes['width'] ?? 0);
  const height = Number(attributes['height'] ?? 0);
  if ([x, y, width, height].some((value) => !Number.isFinite(value))) return null;
  if (width <= 0 || height <= 0) return '';

  const corners: [number, number][] = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ].map(([cx, cy]) => [transform.a * (cx as number) + transform.e, transform.d * (cy as number) + transform.f]);

  const round = (value: number): string => String(Math.round(value * 1000) / 1000);
  const [first, ...rest] = corners;
  if (first === undefined) return null;
  return `M ${round(first[0])} ${round(first[1])} ${rest
    .map(([cx, cy]) => `L ${round(cx)} ${round(cy)}`)
    .join(' ')} Z`;
}

/** Elementos que sólo agrupan y no dibujan nada por sí mismos. */
const CONTAINER_KINDS = new Set(['g', 'defs', 'style', 'title', 'desc', 'metadata']);

/**
 * Baja por el árbol acumulando transformaciones y quedándose con los trazos.
 * Devuelve `null` en cuanto encuentra algo que no sepa traducir.
 */
function collectPaths(node: LiteElement, transform: Affine, out: string[]): boolean {
  const attributes = node.attributes ?? {};

  const raw = attributes['transform'];
  let local = transform;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = parseTransform(raw);
    if (parsed === null) return false;
    local = compose(transform, parsed);
  }

  if (node.kind === 'path') {
    const d = attributes['d'];
    if (typeof d !== 'string') return false;
    const transformed = transformPath(d, local);
    if (transformed === null) return false;
    if (transformed !== '') out.push(transformed);
    return true;
  }

  if (node.kind === 'rect') {
    const path = rectToPath(node, local);
    if (path === null) return false;
    if (path !== '') out.push(path);
    return true;
  }

  if (!CONTAINER_KINDS.has(node.kind)) return false;

  for (const child of node.children ?? []) {
    if (!isElement(child)) continue;
    if (!collectPaths(child, local, out)) return false;
  }
  return true;
}

/** El primer `<svg>` del árbol que devuelve MathJax. */
function findSvg(node: LiteNode): LiteElement | null {
  if (!isElement(node)) return null;
  if (node.kind === 'svg') return node;
  for (const child of node.children ?? []) {
    const found = findSvg(child);
    if (found !== null) return found;
  }
  return null;
}

// ── API ─────────────────────────────────────────────────────────────────────

/**
 * Compone una fórmula TeX. Devuelve `null` si no se puede componer con garantías
 * —sintaxis que MathJax rechaza, o un SVG con algo que este traductor no cubre—
 * y entonces quien llama debe caer al texto legible.
 */
export function renderMath(tex: string, display: boolean): MathDrawing | null {
  const source = tex.trim();
  if (source === '') return null;

  let svg: LiteElement | null;
  try {
    const { adaptor, html } = mathDocument();
    const container = html.convert(source, { display });
    void adaptor;
    svg = findSvg(container);
  } catch {
    // MathJax lanza con TeX inválido, y una corrección puede traerlo: la
    // escribe un modelo y no un compilador.
    return null;
  }
  if (svg === null) return null;

  const viewBox = (svg.attributes ?? {})['viewBox'];
  if (typeof viewBox !== 'string') return null;
  const [minX, minY, width, height] = viewBox
    .split(/[\s,]+/)
    .filter((value) => value !== '')
    .map(Number);
  if (
    minX === undefined ||
    minY === undefined ||
    width === undefined ||
    height === undefined ||
    [minX, minY, width, height].some((value) => !Number.isFinite(value)) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const paths: string[] = [];
  for (const child of svg.children ?? []) {
    if (!isElement(child)) continue;
    // El origen del recuadro se lleva al cero para que quien dibuje sólo tenga
    // que colocar la línea base; `minY` es negativo porque la caja sube.
    if (!collectPaths(child, { a: 1, d: 1, e: -minX, f: 0 }, paths)) return null;
  }
  if (paths.length === 0) return null;

  return {
    paths,
    width,
    // En el espacio del SVG la línea base es `y = 0`: lo que sube tiene `y`
    // negativa, y por eso el ascenso es `-minY`.
    ascent: -minY,
    descent: height + minY,
  };
}
