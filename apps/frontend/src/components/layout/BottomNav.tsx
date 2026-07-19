import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { countOf, useQueueCounts } from '@/hooks/useQueueCounts';
import { PRIMARY_NAV } from './navigation';

/**
 * Barra inferior: es la navegación real del producto. Va abajo porque el
 * profesor corrige de noche, con una mano, y el pulgar no llega arriba.
 */
export function BottomNav() {
  const { data: counts } = useQueueCounts();
  const pending = countOf(counts, 'graded');

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-safe md:hidden"
    >
      <ul className="grid grid-cols-4">
        {PRIMARY_NAV.map(({ to, label, Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'relative flex h-14 flex-col items-center justify-center gap-1 transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-primary"
                    />
                  ) : null}
                  <span className="relative">
                    <Icon className="size-[22px]" aria-hidden="true" />
                    {/* Único acento de la navegación: hay trabajo esperando. */}
                    {to === '/' && pending > 0 ? (
                      <span
                        className="absolute -right-2 -top-1 min-w-[1.1rem] rounded-full bg-primary px-1 text-center text-micro font-semibold leading-[1.1rem] text-primary-foreground"
                        aria-label={`${pending} entregas por revisar`}
                      >
                        {pending > 99 ? '99+' : pending}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-micro font-medium normal-case tracking-normal">
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
