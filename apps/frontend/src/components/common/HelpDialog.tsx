import { useState, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Ayuda de una pantalla, a un toque y fuera del camino.
 *
 * Existe para que la explicación del modelo mental —qué es un nivel de
 * contexto, qué hace un proceso, qué significa cada estado— no tenga que
 * ocupar sitio en la propia pantalla, y sobre todo para que no acabe dentro de
 * un campo editable: lo que se escribe en el contexto viaja al modelo tal cual,
 * así que documentar ahí el funcionamiento de Vega es pagar tokens por
 * explicarle a la IA cómo está montada la aplicación.
 */
export function HelpDialog({
  label,
  title,
  description,
  children,
}: {
  /** Texto del botón. Sin él sólo se ve el icono, con su etiqueta accesible. */
  label?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={label ? 'outline' : 'ghost'}
        size={label ? 'sm' : 'icon'}
        className="shrink-0"
        aria-label={label ? undefined : `Ayuda: ${title}`}
        onClick={() => setOpen(true)}
      >
        <HelpCircle aria-hidden="true" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="flex flex-col gap-4">{children}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Una entrada de la ayuda: el término y qué significa. Lista de definición de
 * verdad, no dos párrafos seguidos, para que un lector de pantalla anuncie el
 * término antes que su explicación.
 */
export function HelpTerms({ items }: { items: readonly { term: string; text: ReactNode }[] }) {
  return (
    <dl className="flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.term}>
          <dt className="text-base font-medium">{item.term}</dt>
          <dd className="mt-0.5 text-ui text-muted-foreground">{item.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Bloque de la ayuda con su propio encabezado, cuando hay más de un tema. */
export function HelpBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="eyebrow mb-2">{title}</h3>
      {children}
    </section>
  );
}
