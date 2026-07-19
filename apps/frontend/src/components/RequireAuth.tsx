import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { USER_ROLE_LABEL } from '@vega/shared';
import { useAuth } from '@/lib/auth';
import { BRAND_NAME } from '@/lib/brand';
import { VegaLogo } from '@/components/VegaLogo';
import { Card } from '@/components/ui/card';

/** Mientras se valida el token guardado. Sobria: ni spinner ni salto de layout. */
function SessionSplash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3" role="status">
      <VegaLogo className="size-8" />
      <p className="text-ui text-muted-foreground">Abriendo {BRAND_NAME}…</p>
    </div>
  );
}

export function RequireAuth() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <SessionSplash />;
  if (!user) {
    // Guardamos el destino para volver a él justo después de identificarse.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

export function RequireAdmin() {
  const { user } = useAuth();
  if (!user) return null;

  if (user.role !== 'admin') {
    return (
      <Card className="flex flex-col items-center px-6 py-12 text-center">
        <Lock className="size-8 text-border-strong" aria-hidden="true" />
        <h1 className="mt-4 font-display text-title font-semibold">
          Esta sección es de administración
        </h1>
        <p className="mt-2 max-w-sm text-base text-muted-foreground">
          Tu cuenta tiene el rol {USER_ROLE_LABEL[user.role].toLowerCase()}. Pide a un{' '}
          {USER_ROLE_LABEL.admin.toLowerCase()} que haga el cambio o que amplíe tus permisos.
        </p>
      </Card>
    );
  }
  return <Outlet />;
}
