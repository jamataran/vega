import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/common/Field';

/**
 * Estado de un secreto en el formulario.
 *
 * El API nunca devuelve el valor, sólo si está configurado. Por eso el campo no
 * se rellena con puntos que finjan tener algo: o se deja como está, o se
 * sustituye, o se borra.
 */
export type SecretState =
  | { mode: 'keep' }
  | { mode: 'replace'; value: string }
  | { mode: 'clear' };

export const KEEP: SecretState = { mode: 'keep' };

/**
 * Qué mandar al API: `undefined` no toca el secreto, `null` lo borra y una
 * cadena lo sustituye.
 */
export function secretPatch(state: SecretState): string | null | undefined {
  if (state.mode === 'clear') return null;
  if (state.mode === 'replace') {
    const value = state.value.trim();
    return value === '' ? undefined : value;
  }
  return undefined;
}

export function SecretField({
  label,
  configured,
  state,
  onChange,
  hint,
  autoComplete = 'off',
}: {
  label: string;
  configured: boolean;
  state: SecretState;
  onChange: (next: SecretState) => void;
  hint?: string;
  autoComplete?: string;
}) {
  if (state.mode === 'replace') {
    return (
      <Field
        label={label}
        // No decimos «se guardará cifrada» porque no es verdad: se guarda tal
        // cual, marcada como secreta para que la API no la devuelva nunca.
        // Prometer un cifrado que no existe es peor que no prometer nada.
        hint={hint ?? 'No volverá a mostrarse una vez guardada.'}
        action={
          <Button variant="ghost" size="sm" onClick={() => onChange(KEEP)}>
            Cancelar
          </Button>
        }
      >
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete={autoComplete}
            value={state.value}
            placeholder="Pega aquí el valor nuevo"
            onChange={(event) => onChange({ mode: 'replace', value: event.target.value })}
          />
        )}
      </Field>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-medium">{label}</p>
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={() => onChange({ mode: 'replace', value: '' })}>
            {configured ? 'Sustituir' : 'Configurar'}
          </Button>
          {configured && state.mode !== 'clear' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ mode: 'clear' })}
            >
              Borrar
            </Button>
          ) : null}
          {state.mode === 'clear' ? (
            <Button variant="ghost" size="sm" onClick={() => onChange(KEEP)}>
              Deshacer
            </Button>
          ) : null}
        </div>
      </div>

      {state.mode === 'clear' ? (
        <p className="text-ui text-warning-ink">Se borrará al guardar.</p>
      ) : (
        <div className="flex items-center gap-2">
          <Badge variant={configured ? 'success' : 'warning'}>
            {configured ? 'Configurada' : 'Sin configurar'}
          </Badge>
          <span className="text-ui text-muted-foreground">
            {configured
              ? 'El valor no se muestra nunca; sólo puede sustituirse.'
              : (hint ?? 'Todavía no tiene valor.')}
          </span>
        </div>
      )}
    </div>
  );
}
