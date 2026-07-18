import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LoginRequest } from '@vega/shared';
import { ApiClientError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BRAND_NAME } from '@/lib/brand';
import { VegaLogo } from '@/components/VegaLogo';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/common/Field';

/** Cuentas del seed de desarrollo. El API real las rechazará en producción. */
const DEV_ACCOUNTS = [
  { email: 'profe@vega.test', password: 'vega1234', role: 'Profesor' },
  { email: 'admin@vega.test', password: 'vega1234', role: 'Administrador' },
];

export function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const state = location.state as { from?: string } | null;
  const destination = state?.from ?? '/';

  if (!isLoading && user) return <Navigate to={destination} replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = LoginRequest.safeParse({ email, password });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        email: fields.email?.[0] ?? '',
        password: fields.password?.[0] ?? '',
      });
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      await login(parsed.data);
      navigate(destination, { replace: true });
    } catch (error) {
      if (error instanceof ApiClientError && Object.keys(error.fields).length > 0) {
        setFieldErrors(error.fields);
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-5 pb-8 pt-14 md:justify-center md:pt-8">
      <div className="flex flex-1 flex-col justify-center md:flex-none">
        <VegaLogo className="size-9" />
        <h1 className="mt-5 font-display text-title font-semibold">{BRAND_NAME}</h1>
        {/* Único sitio de la aplicación donde aparece la línea de marca. */}
        <p className="mt-1.5 text-base text-muted-foreground">IA que corrige. Tú que enseñas.</p>
      </div>

      {/* El formulario vive en la mitad inferior: es donde llega el pulgar. */}
      <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-4" noValidate>
        <Field label="Correo electrónico" error={fieldErrors.email || undefined}>
          {(field) => (
            <Input
              {...field}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          )}
        </Field>

        <Field label="Contraseña" error={fieldErrors.password || undefined}>
          {(field) => (
            <Input
              {...field}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          )}
        </Field>

        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Button type="submit" size="lg" className="mt-1 w-full" loading={submitting}>
          Entrar
        </Button>
      </form>

      <div className="mt-8 rounded-md border border-dashed border-border px-3.5 py-3">
        <p className="eyebrow">Sólo en desarrollo</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {DEV_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <button
                type="button"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(account.password);
                  setFieldErrors({});
                }}
                className="flex w-full items-baseline justify-between gap-3 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-muted"
              >
                <span className="font-mono text-ui">{account.email}</span>
                <span className="font-mono text-ui text-muted-foreground">{account.password}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 px-1 text-ui text-muted-foreground">
          Toca una cuenta para rellenar el formulario.
        </p>
      </div>
    </div>
  );
}
