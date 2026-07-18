import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <Inbox className="size-8 text-border-strong" aria-hidden="true" />
      <p className="mt-4 font-display text-base font-semibold">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-base text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'No se ha podido cargar',
  error,
  onRetry,
  className,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={className}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="mt-1 text-muted-foreground">
        {errorMessage(error)}
      </AlertDescription>
      {onRetry ? (
        <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
    </Alert>
  );
}

/** Cabecera de pantalla. El rótulo nombra la sección; el título, el objeto. */
export function PageHeader({
  eyebrow,
  title,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 className="mt-1 truncate font-display text-title font-semibold">{title}</h1>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children ? (
        <div className="mt-2 text-base text-muted-foreground">{children}</div>
      ) : null}
    </header>
  );
}

/** Bloque con borde fino y título discreto. La jerarquía la dan el aire y el contraste. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card asChild>
      <section className={cn('p-4', className)}>
        {title || actions ? (
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              {title ? <h2 className="eyebrow">{title}</h2> : null}
              {description ? (
                <p className="mt-1 text-ui text-muted-foreground">{description}</p>
              ) : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        {children}
      </section>
    </Card>
  );
}
