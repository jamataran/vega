import { Children, useMemo } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';
import { Latex, tokenizeLatex } from './Latex';

/**
 * Markdown de los contextos de corrección y de las indicaciones de la actividad.
 *
 * `react-markdown` construye nodos de React y nunca HTML en crudo, así que el
 * contenido que escribe el profesor no puede inyectar marcado.
 *
 * Las fórmulas siguen la convención documentada en `@vega/shared`: `$$…$$` en
 * bloque y `$…$` en línea, resueltas con el mismo KaTeX que el resto de la
 * aplicación. El tokenizado se aplica al texto ya procesado por remark, de modo
 * que dentro de un bloque de código las fórmulas se quedan literales.
 */

/** Sustituye las cadenas sueltas del árbol por su versión con fórmulas resueltas. */
function withMath(children: ReactNode, keyPrefix = 'm'): ReactNode {
  if (typeof children === 'string') return renderMath(children, keyPrefix);
  if (Array.isArray(children)) {
    return Children.map(children, (child, index) =>
      typeof child === 'string' ? renderMath(child, `${keyPrefix}-${index}`) : child,
    );
  }
  return children;
}

function renderMath(source: string, keyPrefix: string): ReactNode {
  const segments = tokenizeLatex(source);
  if (segments.length === 1 && segments[0]?.kind === 'text') return source;

  return segments.map((segment, index) => {
    const key = `${keyPrefix}-${index}`;
    if (segment.kind === 'math') {
      return <Latex key={key} tex={segment.value} display={segment.display} />;
    }
    if (segment.kind === 'bold') {
      return (
        <strong key={key} className="font-semibold">
          {segment.value}
        </strong>
      );
    }
    if (segment.kind === 'flag') {
      // Marcas del OCR: se señalan, no se ocultan.
      return (
        <span key={key} className="font-mono text-warning-ink">
          [{segment.value}]
        </span>
      );
    }
    return <span key={key}>{segment.value}</span>;
  });
}

const components: Components = {
  h1: ({ children }) => (
    <h2 className="mt-2 font-display text-title font-semibold first:mt-0">{withMath(children)}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-2 font-display text-base font-semibold first:mt-0">{withMath(children)}</h3>
  ),
  h3: ({ children }) => <h4 className="eyebrow mt-2 first:mt-0">{withMath(children)}</h4>,
  h4: ({ children }) => <h5 className="eyebrow mt-2 first:mt-0">{withMath(children)}</h5>,
  p: ({ children }) => <p>{withMath(children)}</p>,
  strong: ({ children }) => <strong className="font-semibold">{withMath(children)}</strong>,
  em: ({ children }) => <em className="italic">{withMath(children)}</em>,
  ul: ({ children }) => (
    <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>
  ),
  li: ({ children }) => <li>{withMath(children)}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border-strong pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary-ink underline underline-offset-2"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="border-border" />,
  code: ({ className, children, ...props }) => {
    // Sin `className` de lenguaje es código en línea; con él, un bloque cercado.
    const isBlock = typeof className === 'string' && className.includes('language-');
    if (isBlock) {
      return (
        <code className={cn('font-mono text-ui', className)} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-ui" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-ui">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-ui">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
  th: ({ children }) => (
    <th className="px-2 py-1.5 text-left font-semibold text-foreground">{withMath(children)}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-2 py-1.5 align-top">{withMath(children)}</td>
  ),
  input: ({ checked, type }) =>
    // Casillas de las listas de tareas de GFM: informativas, nunca editables.
    type === 'checkbox' ? (
      <input type="checkbox" checked={checked} readOnly disabled className="mr-1.5 align-middle" />
    ) : null,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  const empty = useMemo(() => children.trim() === '', [children]);

  if (empty) {
    return <p className={cn('text-base italic text-muted-foreground', className)}>Sin contenido.</p>;
  }

  return (
    <div className={cn('flex flex-col gap-3 text-base leading-relaxed', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
