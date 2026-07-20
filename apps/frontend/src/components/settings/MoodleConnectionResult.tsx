import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import type { MoodleCheck, MoodleConnectionResponse } from '@vega/shared';
import { cn } from '@/lib/cn';

/**
 * Parte de la comprobación de conexión con Moodle.
 *
 * Se enseña **función por función** y no como un simple «funciona / no
 * funciona» porque el fallo típico no es que el token esté mal, sino que al
 * servicio web le faltan funciones: Moodle no añade ninguna al crear un
 * servicio externo y hay que listarlas a mano. Ver el nombre exacto de la que
 * falla es lo que convierte esto en una lista de cosas que copiar y pegar en el
 * panel de Moodle, en vez de en un callejón sin salida.
 *
 * Lo comparten Ajustes y la ficha de usuario: un administrador prueba tokens
 * ajenos y necesita leer exactamente lo mismo.
 */
/** Se lee en voz alta antes que la etiqueta: el estado es lo que importa. */
const STATUS_LABEL: Record<MoodleCheck['status'], string> = {
  ok: 'Correcto: ',
  failed: 'Falla: ',
  skipped: 'Sin comprobar: ',
};

function CheckIcon({ status }: { status: MoodleCheck['status'] }) {
  const className = 'mt-0.5 size-3.5 shrink-0';
  if (status === 'ok') {
    return <CheckCircle2 className={cn(className, 'text-success-ink')} aria-hidden="true" />;
  }
  if (status === 'failed') {
    return <XCircle className={cn(className, 'text-destructive-ink')} aria-hidden="true" />;
  }
  // Omitida: ni verde ni roja. Marcarla en rojo mandaría a habilitar una
  // función que probablemente ya esté puesta.
  return <MinusCircle className={cn(className, 'text-muted-foreground')} aria-hidden="true" />;
}

export function MoodleConnectionResult({ result }: { result: MoodleConnectionResponse }) {
  return (
    <div className="rounded-md border border-border" aria-live="polite">
      <div className="flex items-start gap-2 px-3 py-2.5">
        {result.ok ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-ink" aria-hidden="true" />
        ) : (
          // `-ink` y no el plano: el valor plano se reserva a rellenos y en modo
          // oscuro no se aclara, quedando por debajo del contraste del resto de
          // indicadores de estado.
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive-ink" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-base">{result.message}</p>
          {result.siteName ? (
            <p className="mt-0.5 text-ui text-muted-foreground">
              {result.siteName} · conectado como {result.username} ·{' '}
              {result.courseCount === 1 ? '1 curso' : `${result.courseCount ?? 0} cursos`}
            </p>
          ) : null}
        </div>
      </div>

      {result.checks.length > 0 ? (
        <ul className="border-t border-border">
          {result.checks.map((check) => (
            <li
              key={check.name}
              className="flex items-start gap-2 border-b border-border px-3 py-2 last:border-b-0"
            >
              <CheckIcon status={check.status} />
              <div className="min-w-0 flex-1">
                <p className="text-ui">
                  <span className="sr-only">{STATUS_LABEL[check.status]}</span>
                  {check.label}{' '}
                  {/* El nombre exacto es lo que hay que buscar en Moodle, así
                      que va en monoespaciada y se puede seleccionar entero. */}
                  <code className="select-all break-all font-mono text-[0.9em] text-muted-foreground">
                    {check.name}
                  </code>
                </p>
                <p
                  className={cn(
                    'mt-0.5 break-words text-ui',
                    check.status === 'failed' ? 'text-destructive-ink' : 'text-muted-foreground',
                  )}
                >
                  {check.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
