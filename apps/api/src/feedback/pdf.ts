import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
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

/**
 * PDF de feedback: el original del alumno seguido de las páginas de corrección.
 *
 * ESTAMOS MOCKEANDO EL LATEX. No se compila LaTeX de verdad (eso pediría una
 * distribución TeX completa o un servicio aparte): se vuelca
 * `effectiveLatex(correction)` como texto legible y paginado, quitándole los
 * comandos que sólo estorban al leer. Cuando haya compilación real, lo único
 * que cambia es `renderCorrectionPages`.
 *
 * El "original del alumno" también es simulado: con el conector mock no hay
 * PDF descargado del LMS, así que se reconstruye a partir de la transcripción,
 * página a página y etiquetado como reproducción. Con un conector real habrá
 * que embeber el PDF de verdad con `PDFDocument.copyPages`.
 *
 * pdf-lib es JS puro a propósito: sin dependencias nativas, el contenedor del
 * API sigue siendo una imagen de Node sin compilador.
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

/**
 * Convierte el LaTeX de la corrección en algo que se pueda leer sin compilar.
 *
 * No es un intérprete de LaTeX ni pretende serlo: quita el andamiaje del
 * documento, traduce las macros matemáticas más frecuentes y deja el resto de
 * la fórmula tal cual, que es como la lee un profesor de matemáticas. Cualquier
 * comando que no conozca se sustituye por un espacio, nunca por nada: si se
 * borrase a secas, `\pm\sqrt{66}` acabaría pegado como una sola palabra.
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
  /** Sólo en actividades con fichero; es de donde se reconstruye el original. */
  readonly transcription: Transcription | null;
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

/**
 * Reproducción del original del alumno. MOCK: no hay PDF descargado, así que se
 * pinta la transcripción (o el texto del foro) como sustituto, etiquetado para
 * que nadie lo confunda con el escaneo real.
 */
function renderOriginal(writer: PdfWriter, input: FeedbackPdfInput): void {
  const { activity, submission, transcription } = input;
  if (!hasStudentFile(activity.kind)) return;

  const pages = transcription?.pages ?? [];
  if (pages.length === 0) return;

  writer.newPage();
  writer.text('Original del alumno', { size: SIZE.heading, bold: true, leading: LEADING.heading });
  writer.text(
    `Reproducción del documento entregado${
      submission.originalFilename === null ? '' : ` (${submission.originalFilename})`
    }. El escaneo original se sirve desde Vega; aquí se incluye su transcripción.`,
    { size: SIZE.meta, color: MUTED, leading: LEADING.meta },
  );
  writer.rule();

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

function renderCorrectionPages(writer: PdfWriter, input: FeedbackPdfInput): void {
  const { activity, correction } = input;

  writer.newPage();
  writer.text('Corrección', { size: SIZE.heading, bold: true, leading: LEADING.heading });
  writer.rule();

  const body = latexToReadableText(effectiveLatex(correction));
  writer.text(body === '' ? 'La corrección no tiene contenido redactado.' : body);

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
      if (feedback !== '') writer.text(feedback, { indent: 14 });
      writer.space(6);
    }
  }

  const summary = correction.teacherSummary ?? correction.aiSummary;
  if (summary !== '') {
    writer.space(6);
    writer.rule();
    writer.text('Comentario global', { bold: true, leading: LEADING.heading });
    writer.text(summary);
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
  renderOriginal(writer, input);
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
