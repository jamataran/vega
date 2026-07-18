import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LogOut, Moon, Sun } from 'lucide-react';
import { USER_ROLE_LABEL } from '@vega/shared';
import type { User } from '@vega/shared';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import type { ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ADMIN_NAV, SECONDARY_NAV } from './navigation';
import type { NavItem } from './navigation';

function initials(user: User): string {
  return user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'system', label: 'Automático' },
];

/**
 * Selector de tema sobre radios nativos: las flechas del teclado y el anuncio
 * del grupo los da el navegador, no una imitación con ARIA.
 */
function ThemePicker() {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <fieldset>
      <legend className="eyebrow mb-2">Apariencia</legend>
      <div className="flex gap-1 rounded-md border border-border p-1">
        {THEME_OPTIONS.map((option) => {
          const selected = preference === option.value;
          const dark = option.value === 'dark' || (option.value === 'system' && resolved === 'dark');
          return (
            <label
              key={option.value}
              className={cn(
                'flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm',
                'text-ui font-medium transition-colors',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                'has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-popover',
                selected
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <input
                type="radio"
                name="vega-theme"
                value={option.value}
                checked={selected}
                onChange={() => setPreference(option.value)}
                className="sr-only"
              />
              {dark ? (
                <Moon className="size-4" aria-hidden="true" />
              ) : (
                <Sun className="size-4" aria-hidden="true" />
              )}
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Grupo de enlaces del menú. En el móvil es la única puerta a las pantallas que
 * no caben en la barra inferior, así que los destinos van con su rótulo.
 */
function NavGroup({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: readonly NavItem[];
  onNavigate: () => void;
}) {
  return (
    <div>
      <p className="eyebrow mb-2">{title}</p>
      <div className="flex flex-col">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className="flex h-11 items-center gap-3 rounded-sm px-2 text-base transition-colors hover:bg-muted"
          >
            <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export function UserMenu({ user, className }: { user: User; className?: string }) {
  const [open, setOpen] = useState(false);
  const { logout } = useAuth();
  const isAdmin = user.role === 'admin';

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`Cuenta de ${user.name}`}
          className={cn(
            'flex h-9 items-center gap-2 rounded-md border border-border bg-card pl-1 pr-2.5',
            'transition-colors hover:border-border-strong',
            className,
          )}
        >
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-sm bg-muted text-micro font-semibold text-muted-foreground"
          >
            {initials(user)}
          </span>
          <span className="hidden max-w-36 truncate text-ui font-medium sm:inline">
            {user.name}
          </span>
        </button>
      </SheetTrigger>

      <SheetContent>
        <SheetHeader>
          <SheetTitle>{user.name}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-col">
              <span className="truncate">{user.email}</span>
              <span className="mt-0.5 text-ui">{USER_ROLE_LABEL[user.role]}</span>
            </div>
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-5">
          <ThemePicker />

          <NavGroup
            title="Seguimiento"
            items={SECONDARY_NAV}
            onNavigate={() => setOpen(false)}
          />

          {isAdmin ? (
            <NavGroup
              title="Administración"
              items={ADMIN_NAV}
              onNavigate={() => setOpen(false)}
            />
          ) : null}

          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            <LogOut aria-hidden="true" />
            Cerrar sesión
          </Button>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
