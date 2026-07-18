import * as React from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(function SheetOverlay({ className, ...props }, ref) {
  return (
    <SheetPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 bg-foreground/40 data-[state=open]:animate-in data-[state=closed]:animate-out ' +
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
});

const sheetVariants = cva(
  'fixed z-50 gap-4 border-border bg-popover text-popover-foreground transition ease-in-out ' +
    'data-[state=open]:animate-in data-[state=closed]:animate-out ' +
    'data-[state=closed]:duration-200 data-[state=open]:duration-300',
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
        // En el móvil las decisiones se toman donde llega el pulgar, no en un
        // diálogo centrado. Sustituye a `window.confirm` en toda la aplicación.
        bottom:
          'inset-x-0 bottom-0 mx-auto max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-xl border pb-safe ' +
          'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom ' +
          'md:bottom-6 md:rounded-xl md:shadow-raised',
        left: 'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
        right:
          'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
      },
    },
    defaultVariants: {
      side: 'bottom',
    },
  },
);

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(function SheetContent({ side = 'bottom', className, children, ...props }, ref) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
        {side === 'bottom' ? (
          <div className="flex justify-center pt-2.5 md:hidden">
            <span aria-hidden="true" className="h-1 w-9 rounded-full bg-border-strong" />
          </div>
        ) : null}
        {children}
        <SheetPrimitive.Close
          className={cn(
            'absolute right-4 top-4 rounded-sm p-1 text-muted-foreground transition-colors',
            'hover:text-foreground focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
          )}
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Cerrar</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});

function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-2 px-5 pb-4 pt-4 pr-10', className)} {...props} />;
}

function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(function SheetTitle({ className, ...props }, ref) {
  return (
    <SheetPrimitive.Title
      ref={ref}
      className={cn('font-display text-title font-semibold leading-tight', className)}
      {...props}
    />
  );
});

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(function SheetDescription({ className, ...props }, ref) {
  return (
    <SheetPrimitive.Description
      ref={ref}
      className={cn('text-base text-muted-foreground', className)}
      {...props}
    />
  );
});

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
