import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Field } from '@/components/common/Field';
import { AutoTextarea, Textarea } from '@/components/ui/textarea';
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
  /**
   * Arranca en vista previa. En la corrección se lee mucho más de lo que se
   * escribe, y con el LaTeX en crudo no se ve si la fórmula sale bien.
   */
  defaultPreview?: boolean;
  /** El editor crece con el contenido en lugar de tener scroll propio. */
  autoGrow?: boolean;
  minRows?: number;
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
  minHeight,
  disabled = false,
  defaultPreview = false,
  autoGrow = false,
  minRows = 2,
}: PreviewEditorProps) {
  const [preview, setPreview] = useState(defaultPreview);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // Sólo enfocamos cuando el profesor pide escribir; nunca al montar, o la
  // pantalla saltaría al primer campo editable de la corrección.
  const focusOnWrite = useRef(false);

  useEffect(() => {
    if (preview || !focusOnWrite.current) return;
    focusOnWrite.current = false;
    editorRef.current?.focus();
  }, [preview]);

  // El editor que crece con el contenido no reserva una caja vacía; el de
  // tamaño fijo sí, para que la vista previa no descoloque el resto al alternar.
  const boxMinHeight = minHeight ?? (autoGrow ? undefined : '12rem');

  return (
    <Field
      label={label}
      hint={hint}
      action={
        <div
          className="flex shrink-0 rounded-md border border-border p-0.5"
          role="group"
          aria-label={`Modo de ${label}`}
        >
          {[
            { key: true, text: 'Vista previa' },
            { key: false, text: 'Escribir' },
          ].map((option) => (
            <button
              key={String(option.key)}
              type="button"
              aria-pressed={preview === option.key}
              onClick={() => {
                focusOnWrite.current = !option.key;
                setPreview(option.key);
              }}
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
            aria-describedby={aria['aria-describedby']}
            className={cn(
              'overflow-x-auto rounded-md border border-border bg-card px-3 py-2.5',
              boxMinHeight ? undefined : 'min-h-11',
            )}
            style={{ minHeight: boxMinHeight }}
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
        ) : autoGrow ? (
          <AutoTextarea
            ref={editorRef}
            id={id}
            {...aria}
            value={value}
            minRows={minRows}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={mode === 'markdown'}
            style={{ minHeight: boxMinHeight }}
          />
        ) : (
          <Textarea
            ref={editorRef}
            id={id}
            {...aria}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={mode === 'markdown'}
            style={{ minHeight: boxMinHeight }}
            className="font-mono text-ui"
          />
        )
      }
    </Field>
  );
}
