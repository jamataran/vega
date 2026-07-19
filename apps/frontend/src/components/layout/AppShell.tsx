import { Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { BRAND_NAME } from '@/lib/brand';
import { VegaLogo } from '@/components/VegaLogo';
import { BottomNav } from './BottomNav';
import { SideNav } from './SideNav';
import { UserMenu } from './UserMenu';

/**
 * Armazón de la aplicación: barra inferior en el móvil, lateral fijo a partir
 * de `md`. La pantalla de entrega no usa este armazón — necesita el borde
 * inferior entero para su barra de acciones.
 */
export function AppShell() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="min-h-dvh">
      <SideNav user={user} />

      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-background px-4">
          <div className="flex items-center gap-2.5 md:invisible">
            <VegaLogo className="size-5" />
            <span className="truncate font-display text-base font-semibold">{BRAND_NAME}</span>
          </div>
          <UserMenu user={user} />
        </header>

        <main className="mx-auto w-full max-w-4xl px-4 pb-28 pt-5 md:pb-12">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
