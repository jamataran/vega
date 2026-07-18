import { useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Field } from '@/components/common/Field';
import { Textarea } from '@/components/ui/textarea';
import { Markdown } from './Markdown';
import { MathText } from './Latex';

interface PreviewEditorProps {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** `latex` renderiza el texto tal cual con las fórmulas resueltas; `markdown`, el bloque completo. */
  mode: 'markdown' | 'latex';
  placeholder?: string;
  minHeight?: string;
  disabled?: boolean;
}

/**
 * Editor con vista previa. Alterna en lugar de partir la pantalla porque a
 * 375 px dos columnas no dejan escribir en ninguna de las dos.
 */
export function PreviewEditor({
  label,
  hint,
  value,
  onChange,
  mode,
  placeholder,
  minHeight = '12rem',
  disabled = false,
}: PreviewEditorProps) {
  const [preview, setPreview] = useState(false);

  return (
    <Field
      label={label}
      hint={hint}
      action={
        <div
          className="flex rounded-md border border-border p-0.5"
          role="group"
          aria-label={`Modo de ${label}`}
        >
          {[
            { key: false, text: 'Escribir' },
            { key: true, text: 'Vista previa' },
          ].map((option) => (
            <button
              key={String(option.key)}
              type="button"
              aria-pressed={preview === option.key}
              onClick={() => setPreview(option.key)}
              className={cn(
                'h-7 rounded-sm px-2 text-ui transition-colors',
                preview === option.key
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.text}
            </button>
          ))}
        </div>
      }
    >
      {({ id, ...aria }) =>
        preview ? (
          <div
            id={id}
            tabIndex={0}
            role="region"
            // La vista previa no es un control etiquetable, así que se nombra
            // ella misma en lugar de depender del `for` de la etiqueta.
            aria-label={`${label}: vista previa`}
            className="overflow-x-auto rounded-md border border-border bg-card px-3 py-2.5"
            style={{ minHeight }}
          >
            {value.trim() === '' ? (
              <p className="text-base italic text-muted-foreground">Sin contenido.</p>
            ) : mode === 'markdown' ? (
              <Markdown>{value}</Markdown>
            ) : (
              <div className="whitespace-pre-wrap text-base leading-relaxed">
                <MathText>{value}</MathText>
              </div>
            )}
          </div>
        ) : (
          <Textarea
            id={id}
            {...aria}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={mode === 'markdown'}
            style={{ minHeight }}
            className="font-mono text-ui"
          />
        )
      }
    </Field>
  );
}
