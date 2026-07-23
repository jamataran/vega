import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import {
  effectiveLatex,
  effectivePoints,
  hasStudentFile,
  totalScore,
  type Activity,
  type Correction,
  type Submission,
  type Transcription,
} from '@vega/shared';
import { MATH_UNITS_PER_EM, renderMath } from './math.js';
import type { MathDrawing } from './math.js';

/**
 * PDF de feedback: el original del alumno seguido de las páginas de corrección.
 *
 * **Las fórmulas se componen de verdad.** `splitLatexSegments` separa la prosa
 * del TeX y `feedback/math.ts` compone cada fórmula con MathJax; el paginador
 * dibuja las dos cosas sobre la misma línea base. Lo que no es fórmula —los
 * títulos, las listas, el andamiaje del documento— sí se aplana con
 * `latexToReadableText`, que además hace de respaldo cuando una fórmula no se
 * puede componer: se lee peor, pero se lee.
 *
 * No se compila LaTeX entero, y no es lo mismo: un `\\usepackage` no hace nada
 * aquí. Lo que se compone es la parte matemática, que es la que quedaba
 * ilegible al aplanarla.
 *
 * Cuando el fichero original está disponible, sus páginas se incorporan sin
 * reconstruirlas. Si no se puede abrir, la transcripción queda claramente
 * rotulada como tal para no confundirla con el documento entregado.
 *
 * pdf-lib y MathJax son JS puro a propósito: sin dependencias nativas, el
 * contenedor del API sigue siendo una imagen de Node sin compilador ni Chromium.
 */

// ── Geometría ───────────────────────────────────────────────────────────────

const A4 = { width: 595.28, height: 841.89 } as const;
const MARGIN = 56;
const CONTENT_WIDTH = A4.width - MARGIN * 2;

const SIZE = { title: 17, heading: 12, body: 10, meta: 8.5 } as const;
const LEADING = { body: 14, heading: 18, meta: 12 } as const;

const INK = rgb(0.11, 0.16, 0.23);
const MUTED = rgb(0.42, 0.48, 0.56);
const RULE = rgb(0.78, 0.82, 0.87);
const ACCENT = rgb(0.35, 0.28, 0.78);

// ── Saneado de texto ────────────────────────────────────────────────────────

/**
 * Las fuentes estándar de PDF usan WinAnsi, que no tiene ni ∞ ni √ ni ⇒. Si se
 * cuela uno, pdf-lib lanza al guardar y el profesor se encuentra un 500 al
 * descargar. Transliteramos lo habitual en matemáticas y descartamos el resto.
 */
const SYMBOLS: ReadonlyArray<readonly [RegExp, string]> = [
  // Guiones y «menos» que no son el ASCII 0x2D.
  [/[\u2010\u2011\u2012\u2013\u2212\ufe63\uff0d]/g, '-'],
  [/\u2014/g, ' - '],
  // Espacios exóticos (fino, duro, de tabla…) y caracteres de ancho cero.
  [/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' '],
  [/[\u00ad\u200b-\u200d\ufeff]/g, ''],
  [/∞/g, 'infinito'],
  [/√/g, 'raiz'],
  [/≤/g, '<='],
  [/≥/g, '>='],
  [/≠/g, '!='],
  [/[≈≃≅]/g, '~='],
  [/[⇒⟹]/g, '=>'],
  [/[⇔⟺]/g, '<=>'],
  [/[→⟶]/g, '->'],
  [/[←⟵]/g, '<-'],
  [/∫/g, 'int'],
  [/∑/g, 'suma'],
  [/∏/g, 'prod'],
  [/∂/g, 'd'],
  [/∈/g, ' en '],
  [/∉/g, ' no en '],
  [/∪/g, ' U '],
  [/∩/g, ' n '],
  [/∅/g, 'vacio'],
  [/∀/g, 'para todo '],
  [/∃/g, 'existe '],
  [/±/g, '+-'],
  [/⋅/g, '.'],
  [/[×✕]/g, 'x'],
  [/…/g, '...'],
  [/[‘’′]/g, "'"],
  [/[“”]/g, '"'],
  [/α/g, 'alfa'],
  [/β/g, 'beta'],
  [/γ/g, 'gamma'],
  [/δ/g, 'delta'],
  [/ε/g, 'epsilon'],
  [/θ/g, 'theta'],
  [/λ/g, 'lambda'],
  [/μ/g, 'mu'],
  [/π/g, 'pi'],
  [/σ/g, 'sigma'],
  [/φ/g, 'phi'],
  [/ω/g, 'omega'],
  [/⁰/g, '^0'],
  [/⁴/g, '^4'],
  [/⁵/g, '^5'],
  [/⁻/g, '^-'],
];

/** Deja sólo lo que WinAnsi sabe pintar: ASCII imprimible y Latin-1 alto. */
function toWinAnsi(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SYMBOLS) {
    out = out.replace(pattern, replacement);
  }
  // Subíndices: ₀…₉ ocupan un bloque contiguo desde U+2080.
  out = out.replace(/[₀-₉]/g, (char) => `_${(char.codePointAt(0) ?? 0) - 0x2080}`);
  return [...out]
    .map((char) => {
      if (char === '\n') return char;
      const code = char.codePointAt(0) ?? 0;
      if (code >= 32 && code <= 126) return char;
      if (code >= 161 && code <= 255) return char;
      return '?';
    })
    .join('');
}

/** Macros matemáticas frecuentes → su lectura en texto plano. */
const MATH_MACROS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\\(approx|simeq|cong)(?![a-zA-Z])/g, '~='],
  [/\\neq(?![a-zA-Z])/g, '!='],
  [/\\(leq|le)(?![a-zA-Z])/g, '<='],
  [/\\(geq|ge)(?![a-zA-Z])/g, '>='],
  [/\\pm(?![a-zA-Z])/g, '+-'],
  [/\\mp(?![a-zA-Z])/g, '-+'],
  [/\\cdot(?![a-zA-Z])/g, '.'],
  [/\\times(?![a-zA-Z])/g, 'x'],
  [/\\infty(?![a-zA-Z])/g, 'infinito'],
  [/\\(Longrightarrow|Rightarrow|rightarrow|implies)(?![a-zA-Z])/g, '=>'],
  [/\\(Longleftrightarrow|Leftrightarrow|iff)(?![a-zA-Z])/g, '<=>'],
  [/\\to(?![a-zA-Z])/g, '->'],
  [/\\in(?![a-zA-Z])/g, 'en'],
  [/\\notin(?![a-zA-Z])/g, 'no en'],
  [/\\cup(?![a-zA-Z])/g, 'U'],
  [/\\cap(?![a-zA-Z])/g, 'n'],
  [/\\lim(?![a-zA-Z])/g, 'lim'],
  [/\\int(?![a-zA-Z])/g, 'int'],
  [/\\sum(?![a-zA-Z])/g, 'suma'],
  [/\\(sin|sen)(?![a-zA-Z])/g, 'sen'],
  [/\\cos(?![a-zA-Z])/g, 'cos'],
  [/\\tan(?![a-zA-Z])/g, 'tg'],
  [/\\ln(?![a-zA-Z])/g, 'ln'],
  [/\\log(?![a-zA-Z])/g, 'log'],
  [/\\pi(?![a-zA-Z])/g, 'pi'],
  [/\\alpha(?![a-zA-Z])/g, 'alfa'],
  [/\\beta(?![a-zA-Z])/g, 'beta'],
  [/\\delta(?![a-zA-Z])/g, 'delta'],
  [/\\(varepsilon|epsilon)(?![a-zA-Z])/g, 'epsilon'],
];

// ── Separación de prosa y fórmula ───────────────────────────────────────────

/**
 * Un trozo del documento: prosa, o una fórmula que hay que componer.
 *
 * `display` es la fórmula que va en su propio renglón y centrada (`\[…\]`,
 * `equation`, `align`…); `inline`, la que viaja dentro de una frase (`$…$`).
 * La distinción no es cosmética: MathJax compone distinto —los límites de un
 * sumatorio van encima en display y al lado en línea— y el paginador también.
 */
export interface LatexSegment {
  readonly kind: 'text' | 'inline' | 'display';
  readonly value: string;
}

/** Entornos que TeX compone como fórmula suelta. */
const DISPLAY_ENVIRONMENTS = [
  'equation',
  'align',
  'gather',
  'multline',
  'displaymath',
  'eqnarray',
  'alignat',
  'flalign',
] as const;

/**
 * Parte el LaTeX en prosa y fórmulas **sin tocar el contenido de ninguna**.
 *
 * Va antes que cualquier limpieza porque la limpieza destruye justo lo que
 * MathJax necesita: `latexToReadableText` borra `$`, deshace `\frac` y se lleva
 * por delante las macros que no conoce. Separar primero es lo que permite darle
 * a cada trozo el tratamiento que le toca.
 */
export function splitLatexSegments(latex: string): readonly LatexSegment[] {
  const segments: LatexSegment[] = [];
  let text = '';
  let index = 0;

  const flushText = (): void => {
    if (text !== '') segments.push({ kind: 'text', value: text });
    text = '';
  };
  const pushMath = (kind: 'inline' | 'display', value: string): void => {
    flushText();
    if (value.trim() !== '') segments.push({ kind, value });
  };

  /** Delimitadores por pares, del más largo al más corto: `$$` antes que `$`. */
  const FENCES = [
    { open: '$$', close: '$$', kind: 'display' },
    { open: '\\[', close: '\\]', kind: 'display' },
    { open: '\\(', close: '\\)', kind: 'inline' },
    { open: '$', close: '$', kind: 'inline' },
  ] as const;

  while (index < latex.length) {
    const rest = latex.slice(index);

    // Un dólar escapado es un dólar, no el principio de una fórmula.
    if (rest.startsWith('\\$')) {
      text += '\\$';
      index += 2;
      continue;
    }

    const environment = DISPLAY_ENVIRONMENTS.find(
      (name) => rest.startsWith(`\\begin{${name}}`) || rest.startsWith(`\\begin{${name}*}`),
    );
    if (environment !== undefined) {
      const closing = rest.startsWith(`\\begin{${environment}*}`)
        ? `\\end{${environment}*}`
        : `\\end{${environment}}`;
      const end = rest.indexOf(closing);
      if (end !== -1) {
        // El entorno viaja entero, con su `\begin` y su `\end`: es lo que
        // MathJax necesita para alinear las filas de un `align`.
        pushMath('display', rest.slice(0, end + closing.length));
        index += end + closing.length;
        continue;
      }
    }

    const fence = FENCES.find((candidate) => rest.startsWith(candidate.open));
    if (fence !== undefined) {
      const end = findClosing(rest, fence.open, fence.close);
      if (end !== -1) {
        pushMath(fence.kind, rest.slice(fence.open.length, end));
        index += end + fence.close.length;
        continue;
      }
    }

    // Delimitador sin pareja: es un símbolo del texto, no una fórmula a medias.
    text += rest[0];
    index += 1;
  }

  flushText();
  return segments;
}

/** Posición del cierre, saltándose lo que vaya escapado con `\`. */
function findClosing(rest: string, open: string, close: string): number {
  for (let position = open.length; position < rest.length; position += 1) {
    if (rest[position] === '\\' && !rest.startsWith(close, position)) {
      position += 1;
      continue;
    }
    if (rest.startsWith(close, position)) return position;
  }
  return -1;
}

/**
 * Convierte el LaTeX de la corrección en algo que se pueda leer sin compilar.
 *
 * Es el **respaldo**: lo que se usa cuando la fórmula no se puede componer y
 * para la prosa que rodea a las que sí. No es un intérprete de LaTeX ni pretende
 * serlo: quita el andamiaje del documento, traduce las macros matemáticas más
 * frecuentes y deja el resto de la fórmula tal cual, que es como la lee un
 * profesor de matemáticas. Cualquier comando que no conozca se sustituye por un
 * espacio, nunca por nada: si se borrase a secas, `\pm\sqrt{66}` acabaría pegado
 * como una sola palabra.
 */
export function latexToReadableText(latex: string): string {
  let out = latex
    // Andamiaje del documento: no aporta nada al leer.
    .replace(/\\(documentclass|usepackage|geometry)(\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\(begin|end)\{document\}/g, '')
    .replace(/\\maketitle/g, '')
    // Títulos: los dejamos como línea propia, que el paginador ya destaca.
    .replace(/\\(section|subsection|subsubsection)\*?\{([^}]*)\}/g, '\n\n$2\n')
    .replace(/\\(title|author|date)\{([^}]*)\}/g, '$2\n')
    // Énfasis y texto dentro de fórmula: fuera el comando, dentro el texto.
    .replace(/\\(textbf|textit|emph|texttt|underline|mathbf)\{([^{}]*)\}/g, '$2')
    .replace(/\\(text|mathrm|operatorname|mbox)\{([^{}]*)\}/g, '$2')
    // Listas.
    .replace(/\\begin\{(itemize|enumerate|description)\}/g, '')
    .replace(/\\end\{(itemize|enumerate|description)\}/g, '')
    .replace(/\\item\s*/g, '\n  - ')
    // Entornos matemáticos y delimitadores: se conserva el contenido.
    .replace(/\\(begin|end)\{(equation|align|gather|displaymath|quote)\*?\}/g, '\n')
    .replace(/\\\[|\\\]/g, '\n')
    .replace(/\$\$?/g, '');

  // Índices y exponentes primero: `x^{2}` pasa a `x^2` y así deja de haber
  // llaves dentro de las fracciones, que si no nunca llegarían a casar.
  for (let pass = 0; pass < 3; pass += 1) {
    out = out.replace(/\^\{([^{}]*)\}/g, '^$1').replace(/_\{([^{}]*)\}/g, '_$1');
  }

  // Fracciones y raíces, de dentro hacia fuera: varias pasadas resuelven los
  // casos anidados sin necesidad de un analizador de verdad. El espacio inicial
  // de `raiz` no es cosmético: separa la macro anterior (`\pm\sqrt{66}`).
  for (let pass = 0; pass < 3; pass += 1) {
    out = out
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, ' raiz($1)');
  }

  for (const [pattern, replacement] of MATH_MACROS) out = out.replace(pattern, replacement);

  return (
    out
      .replace(/\\\\/g, '\n')
      // Cualquier comando restante desaparece, pero deja el espacio: si no,
      // dos palabras separadas por una macro se pegarían.
      .replace(/\\[a-zA-Z]+\*?/g, ' ')
      .replace(/\\[^a-zA-Z]/g, ' ')
      .replace(/[{}]/g, '')
      // Espaciado: como mucho una línea en blanco entre bloques.
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

// ── Paginador ───────────────────────────────────────────────────────────────

interface Cursor {
  page: PDFPage;
  y: number;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** Parte una línea larga en varias que quepan en el ancho útil. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== '') lines.push(current);

    // Una "palabra" más ancha que la caja (una fórmula larga sin espacios) hay
    // que trocearla por caracteres o se saldría del papel.
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      let chunk = '';
      for (const char of word) {
        if (font.widthOfTextAtSize(chunk + char, size) > maxWidth && chunk !== '') {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      current = chunk;
    } else {
      current = word;
    }
  }

  if (current !== '') lines.push(current);
  return lines;
}

/**
 * Reparto vertical aproximado de una fuente estándar respecto a su cuerpo. No
 * se pide a la fuente porque las métricas de pdf-lib no separan ascenso de
 * descenso, y para decidir el alto de una línea con esto basta.
 */
const ASCENT_RATIO = 0.75;
const DESCENT_RATIO = 0.25;

/** Aire alrededor de una fórmula suelta, en puntos. */
const DISPLAY_MATH_MARGIN = 6;

/** Una pieza de una línea: o palabra que se escribe, o fórmula que se dibuja. */
type Piece = {
  readonly width: number;
  readonly ascent: number;
  readonly descent: number;
  readonly spaceBefore: number;
} & (
  | { readonly kind: 'word'; readonly text: string }
  | { readonly kind: 'math'; readonly drawing: MathDrawing }
);

function wordPiece(text: string, font: PDFFont, size: number, spaceWidth: number): Piece {
  return {
    kind: 'word',
    text,
    width: font.widthOfTextAtSize(text, size),
    ascent: size * ASCENT_RATIO,
    descent: size * DESCENT_RATIO,
    spaceBefore: spaceWidth,
  };
}

/** Trocea por caracteres lo que no quepa entero: una URL, un identificador largo. */
function splitOverlongWord(
  word: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): readonly string[] {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
  const chunks: string[] = [];
  let chunk = '';
  for (const char of word) {
    if (chunk !== '' && font.widthOfTextAtSize(chunk + char, size) > maxWidth) {
      chunks.push(chunk);
      chunk = char;
    } else {
      chunk += char;
    }
  }
  if (chunk !== '') chunks.push(chunk);
  return chunks;
}

export class PdfWriter {
  readonly #doc: PDFDocument;
  readonly #fonts: Fonts;
  #cursor: Cursor;

  constructor(doc: PDFDocument, fonts: Fonts) {
    this.#doc = doc;
    this.#fonts = fonts;
    this.#cursor = { page: doc.addPage([A4.width, A4.height]), y: A4.height - MARGIN };
  }

  get doc(): PDFDocument {
    return this.#doc;
  }

  newPage(): void {
    this.#cursor = { page: this.#doc.addPage([A4.width, A4.height]), y: A4.height - MARGIN };
  }

  /** Reserva espacio; si no cabe, salta de página. */
  #ensure(height: number): void {
    if (this.#cursor.y - height < MARGIN) this.newPage();
  }

  space(height: number): void {
    this.#cursor.y -= height;
  }

  rule(): void {
    this.#ensure(10);
    this.#cursor.page.drawLine({
      start: { x: MARGIN, y: this.#cursor.y },
      end: { x: A4.width - MARGIN, y: this.#cursor.y },
      thickness: 0.75,
      color: RULE,
    });
    this.#cursor.y -= 12;
  }

  text(
    raw: string,
    options: {
      size?: number;
      leading?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      indent?: number;
    } = {},
  ): void {
    const size = options.size ?? SIZE.body;
    const leading = options.leading ?? LEADING.body;
    const font = options.bold === true ? this.#fonts.bold : this.#fonts.regular;
    const color = options.color ?? INK;
    const indent = options.indent ?? 0;
    const width = CONTENT_WIDTH - indent;

    // Los saltos del texto original mandan; dentro de cada uno, ajuste al ancho.
    for (const paragraph of toWinAnsi(raw).split('\n')) {
      for (const line of wrap(paragraph, font, size, width)) {
        this.#ensure(leading);
        this.#cursor.page.drawText(line, {
          x: MARGIN + indent,
          y: this.#cursor.y - size,
          size,
          font,
          color,
        });
        this.#cursor.y -= leading;
      }
    }
  }

  /**
   * Igual que `text`, pero componiendo las fórmulas en vez de aplanarlas.
   *
   * El ajuste de línea deja de ser «palabras que caben» para ser «piezas que
   * caben»: una palabra se mide con la fuente y una fórmula con la caja que
   * devuelve MathJax. La línea base es común a las dos, que es lo que hace que
   * un `$x^2$` se asiente sobre el mismo renglón que el texto que lo rodea en
   * vez de flotar.
   */
  richText(
    latex: string,
    options: {
      size?: number;
      leading?: number;
      color?: ReturnType<typeof rgb>;
      indent?: number;
    } = {},
  ): void {
    const size = options.size ?? SIZE.body;
    const leading = options.leading ?? LEADING.body;
    const color = options.color ?? INK;
    const indent = options.indent ?? 0;
    const width = CONTENT_WIDTH - indent;
    const font = this.#fonts.regular;
    /** De unidades de MathJax a puntos del PDF. */
    const unit = size / MATH_UNITS_PER_EM;

    let line: Piece[] = [];
    let lineWidth = 0;

    const flushLine = (): void => {
      if (line.length === 0) return;
      // La altura la manda la pieza más alta: una fracción ocupa el doble que
      // una minúscula y solaparía la línea de arriba si el paso fuera fijo.
      const ascent = Math.max(size * ASCENT_RATIO, ...line.map((piece) => piece.ascent));
      const descent = Math.max(size * DESCENT_RATIO, ...line.map((piece) => piece.descent));
      const height = Math.max(leading, ascent + descent + 2);
      this.#ensure(height);
      const baseline = this.#cursor.y - ascent;

      let x = MARGIN + indent;
      for (const piece of line) {
        x += piece.spaceBefore;
        if (piece.kind === 'word') {
          this.#cursor.page.drawText(piece.text, { x, y: baseline, size, font, color });
        } else {
          for (const path of piece.drawing.paths) {
            this.#cursor.page.drawSvgPath(path, { x, y: baseline, scale: unit, color });
          }
        }
        x += piece.width;
      }

      this.#cursor.y -= height;
      line = [];
      lineWidth = 0;
    };

    const place = (piece: Piece): void => {
      const spaceBefore = line.length === 0 ? 0 : piece.spaceBefore;
      if (line.length > 0 && lineWidth + spaceBefore + piece.width > width) flushLine();
      const adjusted = line.length === 0 ? { ...piece, spaceBefore: 0 } : piece;
      line.push(adjusted);
      lineWidth += adjusted.spaceBefore + adjusted.width;
    };

    const spaceWidth = font.widthOfTextAtSize(' ', size);

    /**
     * Si entre la pieza anterior y la siguiente había un blanco en el LaTeX.
     *
     * Se mira el origen y no se pone un hueco fijo porque las dos formas
     * aparecen: `la ecuación $ax^2$` lleva espacio y `el $n$-ésimo` no. Un
     * hueco constante junta la primera o separa la segunda, y ambas cosas se
     * leen mal.
     */
    let pendingSpace = false;
    const gap = (): number => (pendingSpace ? spaceWidth : 0);

    for (const segment of splitLatexSegments(latex)) {
      if (segment.kind === 'display') {
        flushLine();
        pendingSpace = false;
        const drawing = renderMath(segment.value, true);
        if (drawing === null) {
          this.text(latexToReadableText(segment.value), { size, leading, color, indent });
        } else {
          this.#drawDisplayMath(drawing, size, color);
        }
        continue;
      }

      if (segment.kind === 'inline') {
        const drawing = renderMath(segment.value, false);
        if (drawing !== null && drawing.width * unit <= width) {
          place({
            kind: 'math',
            drawing,
            width: drawing.width * unit,
            ascent: drawing.ascent * unit,
            descent: drawing.descent * unit,
            spaceBefore: gap(),
          });
        } else {
          // Sin composición posible —o más ancha que la caja—, la fórmula sigue
          // siendo texto: peor compuesta, pero legible y dentro del papel.
          for (const word of latexToReadableText(segment.value).split(/\s+/)) {
            if (word === '') continue;
            place({ ...wordPiece(word, font, size, spaceWidth), spaceBefore: gap() });
            pendingSpace = true;
          }
        }
        // Que haya blanco tras la fórmula lo dice el trozo de prosa siguiente.
        pendingSpace = false;
        continue;
      }

      if (/^\s/.test(segment.value)) pendingSpace = true;
      // La prosa conserva sus saltos: son los que separan párrafos y viñetas.
      const paragraphs = toWinAnsi(latexToReadableText(segment.value)).split('\n');
      paragraphs.forEach((paragraph, position) => {
        if (position > 0) {
          flushLine();
          pendingSpace = false;
          // Una línea vacía en el original es una separación de bloques: sin
          // ella, el título de un apartado se pega al párrafo de arriba.
          if (paragraph.trim() === '') this.space(leading / 2);
        }
        for (const word of paragraph.split(/\s+/)) {
          if (word === '') continue;
          for (const chunk of splitOverlongWord(word, font, size, width)) {
            place({ ...wordPiece(chunk, font, size, spaceWidth), spaceBefore: gap() });
            pendingSpace = true;
          }
        }
      });
      pendingSpace = /\s$/.test(segment.value);
    }

    flushLine();
  }

  /** Una fórmula suelta: su propio renglón, centrada y con aire alrededor. */
  #drawDisplayMath(drawing: MathDrawing, size: number, color: ReturnType<typeof rgb>): void {
    // Una fórmula de display puede no caber a lo ancho —una ecuación larga, una
    // matriz—; se reduce lo justo en vez de salirse del papel.
    const natural = size / MATH_UNITS_PER_EM;
    const scale = Math.min(natural, CONTENT_WIDTH / drawing.width);
    const ascent = drawing.ascent * scale;
    const descent = drawing.descent * scale;
    const height = ascent + descent + DISPLAY_MATH_MARGIN * 2;

    this.#ensure(height);
    const baseline = this.#cursor.y - DISPLAY_MATH_MARGIN - ascent;
    const x = MARGIN + Math.max(0, (CONTENT_WIDTH - drawing.width * scale) / 2);
    for (const path of drawing.paths) {
      this.#cursor.page.drawSvgPath(path, { x, y: baseline, scale, color });
    }
    this.#cursor.y -= height;
  }

  /** Numera las páginas al final, cuando ya se sabe cuántas hay. */
  paginate(label: string): void {
    const pages = this.#doc.getPages();
    pages.forEach((page, index) => {
      page.drawText(toWinAnsi(`${label}  ·  ${index + 1} de ${pages.length}`), {
        x: MARGIN,
        y: MARGIN / 2,
        size: SIZE.meta,
        font: this.#fonts.regular,
        color: MUTED,
      });
    });
  }
}

// ── Documento ───────────────────────────────────────────────────────────────

export interface FeedbackPdfInput {
  readonly submission: Submission;
  readonly activity: Activity;
  readonly correction: Correction;
  /** Fichero original descargado del LMS, cuando el almacenamiento lo conserva. */
  readonly originalFile?: FeedbackOriginalFile | null;
  /** Respaldo textual cuando el fichero original no está o no se puede abrir. */
  readonly transcription: Transcription | null;
}

export interface FeedbackOriginalFile {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

/** Nota efectiva, o `null` si la actividad no se puntúa. */
function scoreOf(input: FeedbackPdfInput): number | null {
  if (!input.activity.graded) return null;
  if (input.correction.items.length === 0) return null;
  return totalScore(input.correction.items);
}

function formatNumber(value: number): string {
  return value.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

function renderCover(writer: PdfWriter, input: FeedbackPdfInput): void {
  const { activity, submission } = input;

  writer.text('Corrección', { size: SIZE.title, bold: true, leading: 24, color: ACCENT });
  writer.text(activity.name, { size: SIZE.heading, bold: true, leading: LEADING.heading });
  writer.space(4);

  writer.text(`Curso: ${activity.courseName}`, { size: SIZE.meta, color: MUTED, leading: LEADING.meta });
  writer.text(`Alumno: ${submission.studentAlias ?? submission.studentRef}`, {
    size: SIZE.meta,
    color: MUTED,
    leading: LEADING.meta,
  });
  writer.text(`Actividad: ${activity.kind === 'forum' ? 'Foro' : 'Entrega'}`, {
    size: SIZE.meta,
    color: MUTED,
    leading: LEADING.meta,
  });
  writer.text(`Entregado: ${new Date(submission.submittedAt).toLocaleString('es-ES')}`, {
    size: SIZE.meta,
    color: MUTED,
    leading: LEADING.meta,
  });

  const score = scoreOf(input);
  if (score !== null && activity.maxScore !== null) {
    writer.space(8);
    writer.text(`Nota: ${formatNumber(score)} / ${formatNumber(activity.maxScore)}`, {
      size: SIZE.heading,
      bold: true,
      leading: LEADING.heading,
      color: ACCENT,
    });
  } else {
    writer.space(8);
    writer.text('Actividad no puntuable: sólo feedback cualitativo.', {
      size: SIZE.meta,
      color: MUTED,
      leading: LEADING.meta,
    });
  }

  writer.space(6);
  writer.rule();
}

/** Pinta la transcripción sólo como respaldo, nunca como si fuera el original. */
function renderTranscribedOriginal(writer: PdfWriter, input: FeedbackPdfInput): void {
  const { activity, submission, transcription } = input;
  if (!hasStudentFile(activity.kind)) return;

  const pages = transcription?.pages ?? [];

  writer.newPage();
  writer.text('Transcripción del original', {
    size: SIZE.heading,
    bold: true,
    leading: LEADING.heading,
  });
  writer.text(
    `Representación textual del documento entregado${
      submission.originalFilename === null ? '' : ` (${submission.originalFilename})`
    }. No sustituye al fichero original.`,
    { size: SIZE.meta, color: MUTED, leading: LEADING.meta },
  );
  writer.rule();

  if (pages.length === 0) {
    writer.text('No hay una transcripción disponible para incluir en este documento.', {
      size: SIZE.meta,
      color: MUTED,
      leading: LEADING.meta,
    });
    return;
  }

  pages.forEach((page, index) => {
    if (index > 0) writer.newPage();
    writer.text(`Página ${page.page} de ${pages.length}`, {
      size: SIZE.meta,
      color: MUTED,
      leading: LEADING.meta,
    });
    writer.space(4);
    writer.text(latexToReadableText(page.latex));
  });

  const flags = transcription?.flags ?? [];
  if (flags.length > 0) {
    writer.space(10);
    writer.rule();
    writer.text('Marcas de la transcripción', { bold: true, leading: LEADING.heading });
    for (const flag of flags) {
      writer.text(`[${flag.kind}] Página ${flag.page}. ${flag.note}`, {
        size: SIZE.meta,
        color: MUTED,
        leading: LEADING.meta,
      });
    }
  }
}

type OriginalFileKind = 'pdf' | 'png' | 'jpeg';

/** El contenido manda sobre el MIME: algunos LMS descargan todo como octet-stream. */
function originalFileKind(file: FeedbackOriginalFile): OriginalFileKind | null {
  const { bytes } = file;
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return 'pdf';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }

  switch (file.mediaType.split(';', 1)[0]?.trim().toLowerCase()) {
    case 'application/pdf':
      return 'pdf';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpeg';
    default:
      return null;
  }
}

function appendImagePage(doc: PDFDocument, image: PDFImage): void {
  const page = doc.addPage([A4.width, A4.height]);
  const maxWidth = A4.width - MARGIN * 2;
  const maxHeight = A4.height - MARGIN * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;

  page.drawImage(image, {
    x: (A4.width - width) / 2,
    y: (A4.height - height) / 2,
    width,
    height,
  });
}

/**
 * Añade el fichero original tal cual. Un fichero corrupto o con MIME incorrecto
 * no debe impedir descargar el feedback: en ese caso el llamador usa el
 * respaldo textual.
 */
async function appendOriginalFile(writer: PdfWriter, file: FeedbackOriginalFile): Promise<boolean> {
  if (file.bytes.length === 0) return false;

  try {
    switch (originalFileKind(file)) {
      case 'pdf': {
        const source = await PDFDocument.load(file.bytes);
        const indices = source.getPageIndices();
        if (indices.length === 0) return false;
        const pages = await writer.doc.copyPages(source, indices);
        for (const page of pages) writer.doc.addPage(page);
        return true;
      }
      case 'png': {
        appendImagePage(writer.doc, await writer.doc.embedPng(file.bytes));
        return true;
      }
      case 'jpeg': {
        appendImagePage(writer.doc, await writer.doc.embedJpg(file.bytes));
        return true;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Las páginas de corrección, con las fórmulas compuestas.
 *
 * El TeX en crudo llega a `richText`, no a `latexToReadableText`: es ahí donde
 * se separa la prosa de la fórmula y donde cada una recibe su tratamiento. El
 * texto plano sigue existiendo como respaldo dentro de `richText`, para las
 * fórmulas que no se puedan componer.
 *
 * **Todos los apartados salen, también los que no tienen feedback**: un
 * desglose con huecos es la única forma de que el alumno vea que un apartado se
 * puntuó y con cuánto, aunque nadie escribiera nada sobre él.
 */
function renderCorrectionPages(writer: PdfWriter, input: FeedbackPdfInput): void {
  const { activity, correction } = input;

  writer.newPage();
  writer.text('Corrección', { size: SIZE.heading, bold: true, leading: LEADING.heading });
  writer.rule();

  const body = effectiveLatex(correction);
  if (body.trim() === '') {
    writer.text('La corrección no tiene contenido redactado.');
  } else {
    writer.richText(body);
  }

  // Desglose por apartados: sólo tiene sentido si la actividad se puntúa.
  if (activity.graded && correction.items.length > 0) {
    writer.space(12);
    writer.rule();
    writer.text('Desglose por apartados', { bold: true, leading: LEADING.heading });
    writer.space(4);

    for (const item of correction.items) {
      writer.text(
        `${item.label} — ${formatNumber(effectivePoints(item))} / ${formatNumber(item.maxPoints)}`,
        { bold: true, leading: LEADING.body },
      );
      const feedback = item.teacherFeedback ?? item.aiFeedback;
      if (feedback.trim() === '') {
        writer.text('Sin comentarios sobre este apartado.', {
          indent: 14,
          color: MUTED,
          size: SIZE.meta,
          leading: LEADING.meta,
        });
      } else {
        writer.richText(feedback, { indent: 14 });
      }
      writer.space(6);
    }
  }

  const summary = correction.teacherSummary ?? correction.aiSummary;
  if (summary.trim() !== '') {
    writer.space(6);
    writer.rule();
    writer.text('Comentario global', { bold: true, leading: LEADING.heading });
    writer.richText(summary);
  }
}

/** Genera el PDF completo: original del alumno + páginas de corrección. */
export async function buildFeedbackPdf(input: FeedbackPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  doc.setTitle(`Corrección · ${input.activity.name}`);
  doc.setSubject(input.activity.courseName);
  doc.setCreator('Vega');
  doc.setProducer('Vega');

  const writer = new PdfWriter(doc, fonts);
  renderCover(writer, input);
  const includesStudentFile = hasStudentFile(input.activity.kind);
  const originalEmbedded =
    !includesStudentFile || input.originalFile === null || input.originalFile === undefined
      ? false
      : await appendOriginalFile(writer, input.originalFile);
  if (includesStudentFile && !originalEmbedded) {
    renderTranscribedOriginal(writer, input);
  }
  renderCorrectionPages(writer, input);
  writer.paginate(
    `Vega · ${input.submission.studentAlias ?? input.submission.studentRef} · ${input.activity.name}`,
  );

  return doc.save();
}

/** Nombre sugerido para la descarga. */
export function feedbackFilename(input: Pick<FeedbackPdfInput, 'activity' | 'submission'>): string {
  const safe = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  return `correccion-${safe(input.activity.slug)}-${safe(input.submission.studentRef)}.pdf`;
}
