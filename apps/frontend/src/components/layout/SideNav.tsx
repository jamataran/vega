import { NavLink } from 'react-router-dom';
import type { User } from '@vega/shared';
import { cn } from '@/lib/cn';
import { BRAND_NAME } from '@/lib/brand';
import { VegaLogo } from '@/components/VegaLogo';
import { countOf, useQueueCounts } from '@/hooks/useQueueCounts';
import { ADMIN_NAV, PRIMARY_NAV, SECONDARY_NAV } from './navigation';
import type { NavItem } from './navigation';

function NavRow({ item, badge }: { item: NavItem; badge?: number }) {
  const { to, label, Icon, end } = item;
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex h-10 items-center gap-3 rounded-sm px-2.5 text-base transition-colors',
          isActive
            ? 'bg-muted font-medium text-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )
      }
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate">{label}</span>
      {badge && badge > 0 ? (
        <span className="rounded-sm bg-primary px-1.5 text-micro font-semibold leading-5 text-primary-foreground">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </NavLink>
  );
}

/** A partir de `md` la navegación pasa a un lateral fijo y libera el borde inferior. */
export function SideNav({ user }: { user: User }) {
  const { data: counts } = useQueueCounts();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <VegaLogo className="size-5" />
        <span className="truncate font-display text-base font-semibold">{BRAND_NAME}</span>
      </div>

      <nav aria-label="Navegación principal" className="flex flex-1 flex-col gap-0.5 p-3">
        {PRIMARY_NAV.map((item) => (
          <NavRow
            key={item.to}
            item={item}
            badge={item.to === '/' ? countOf(counts, 'graded') : undefined}
          />
        ))}

        <p className="eyebrow mb-1 mt-6 px-2.5">Seguimiento</p>
        {SECONDARY_NAV.map((item) => (
          <NavRow key={item.to} item={item} />
        ))}

        {user.role === 'admin' ? (
          <>
            <p className="eyebrow mb-1 mt-6 px-2.5">Administración</p>
            {ADMIN_NAV.map((item) => (
              <NavRow key={item.to} item={item} />
            ))}
          </>
        ) : null}
      </nav>
    </aside>
  );
}
