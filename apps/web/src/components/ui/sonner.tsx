import { Toaster as Sonner } from 'sonner';
import type { ToasterProps } from 'sonner';
import { useTheme } from '@/lib/theme';

/**
 * Avisos de la aplicación. Se anclan sobre la barra inferior en el móvil para
 * no tapar la navegación, y en la esquina a partir de `md`.
 */
function Toaster({ ...props }: ToasterProps) {
  const { resolved } = useTheme();

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      position="bottom-center"
      offset="calc(env(safe-area-inset-bottom, 0px) + 5.5rem)"
      mobileOffset="calc(env(safe-area-inset-bottom, 0px) + 5.5rem)"
      toastOptions={{
        classNames: {
          toast:
            'group toast rounded-lg border border-border bg-popover text-popover-foreground shadow-raised',
          title: 'text-ui font-semibold',
          description: 'group-[.toast]:text-ui group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          error: 'group-[.toaster]:border-destructive/50',
          success: 'group-[.toaster]:border-success/50',
          closeButton: 'group-[.toast]:border-border group-[.toast]:bg-popover',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
