import { useMemo } from 'react';
import katex from 'katex';
import type { TranscriptionFlagKind } from '@vega/shared';
import { cn } from '@/lib/cn';

/**
 * Un fragmento de LaTeX ya renderizado. `throwOnError: false` deja que KaTeX
 * pinte en rojo la fórmula rota en lugar de tumbar la transcripción entera:
 * el profesor necesita ver el resto de la página igualmente.
 */
export function Latex({
  tex,
  display = false,
  className,
}: {
  tex: string;
  display?: boolean;
  className?: string;
}) {
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        output: 'html',
      }),
    [tex, display],
  );

  const Tag = display ? 'div' : 'span';
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ── Tokenizado de una página de transcripción ───────────────────────────────

export type LatexSegment =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string; display: boolean }
  | { kind: 'bold'; value: string }
  | { kind: 'flag'; value: TranscriptionFlagKind };

// El orden importa: `$$…$$` antes que `$…$`, y la negrita al final para que no
// se coma los dobles asteriscos que pudiera haber dentro de una fórmula.
const TOKEN =
  /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]*?\$|\[ILEGIBLE\]|\[DUDA\]|\*\*[^*\n]+\*\*)/g;

function classify(token: string): LatexSegment {
  if (token === '[ILEGIBLE]') return { kind: 'flag', value: 'ILEGIBLE' };
  if (token === '[DUDA]') return { kind: 'flag', value: 'DUDA' };
  if (token.startsWith('$$')) return { kind: 'math', value: token.slice(2, -2), display: true };
  if (token.startsWith('\\[')) return { kind: 'math', value: token.slice(2, -2), display: true };
  if (token.startsWith('\\(')) return { kind: 'math', value: token.slice(2, -2), display: false };
  if (token.startsWith('**')) return { kind: 'bold', value: token.slice(2, -2) };
  return { kind: 'math', value: token.slice(1, -1), display: false };
}

/** Separa texto, fórmulas y marcas del OCR conservando el orden original. */
export function tokenizeLatex(source: string): LatexSegment[] {
  const segments: LatexSegment[] = [];
  let lastIndex = 0;
  TOKEN.lastIndex = 0;

  let match = TOKEN.exec(source);
  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: source.slice(lastIndex, match.index) });
    }
    segments.push(classify(match[0]));
    lastIndex = match.index + match[0].length;
    match = TOKEN.exec(source);
  }
  if (lastIndex < source.length) {
    segments.push({ kind: 'text', value: source.slice(lastIndex) });
  }
  return segments;
}

/**
 * Texto con fórmulas intercaladas: enunciados, feedback, notas del profesor.
 * No interpreta marcas del OCR — para eso está `TranscriptionText`.
 */
export function MathText({ children, className }: { children: string; className?: string }) {
  const segments = useMemo(() => tokenizeLatex(children), [children]);
  return (
    <span className={cn('whitespace-pre-wrap', className)}>
      {segments.map((segment, index) =>
        segment.kind === 'math' ? (
          <Latex key={index} tex={segment.value} display={segment.display} />
        ) : segment.kind === 'bold' ? (
          <strong key={index} className="font-semibold text-foreground">
            {segment.value}
          </strong>
        ) : segment.kind === 'flag' ? (
          <span key={index} className="font-mono text-warning-ink">
            [{segment.value}]
          </span>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </span>
  );
}
