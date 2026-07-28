import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, RotateCcw, Send } from 'lucide-react';
import { ACTIVITY_KIND_LABEL } from '@vega/shared';
import type { QueueItem } from '@vega/shared';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { notify } from '@/lib/notify';
import { queryKeys } from '@/lib/queryKeys';
import { formatRelativeTime, formatScore } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Prioridad de la fila. El espinazo de color es el único adorno de la lista y
 * dice exactamente una cosa: cuánto te reclama esta entrega. Nunca va solo —
 * las etiquetas de debajo explican con texto lo mismo que insinúa el color.
 */
function spineClass(item: QueueItem): string {
  // Un fallo ya visto sigue siendo un fallo, pero ha dejado de reclamar: pintarlo
  // en rojo junto a los que nadie ha mirado vuelve inútil el color.
  if (item.submission.status === 'error') {
    return item.submission.errorSeenAt === null ? 'bg-destructive' : 'bg-border-strong';
  }
  if (needsAttention(item)) return 'bg-warning';
  if (item.submission.status === 'validated') return 'bg-success';
  return 'bg-border-strong';
}

function needsAttention(item: QueueItem): boolean {
  return (
    item.lowConfidence ||
    item.flagCount > 0 ||
    item.lowConfidenceItems > 0 ||
    item.verificationIssueCount > 0
  );
}

function plural(count: number, singular: string, plural_: string): string {
  return `${count} ${count === 1 ? singular : plural_}`;
}

export function QueueRow({ item }: { item: QueueItem }) {
  const { submission, activity } = item;
  const name = submission.studentAlias ?? submission.studentRef;
  // Una actividad no puntuable no enseña nota: no hay nada que enseñar, ni un
  // guion sobre diez que sugiera que falta algo.
  const showsScore = activity.graded && item.score !== null && item.maxScore !== null;

  return (
    <li className="overflow-hidden rounded-md border border-border bg-card">
      <Link
        to={`/entrega/${submission.id}`}
        className="relative flex gap-3 py-3 pl-4 pr-3 transition-colors hover:bg-muted"
      >
        <span
          aria-hidden="true"
          className={cn('absolute inset-y-2 left-0 w-0.5 rounded-full', spineClass(item))}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-base font-medium">
              {name}
              {submission.studentAlias === null ? (
                <span className="sr-only"> (referencia interna, sin alias)</span>
              ) : null}
            </p>
            {showsScore && item.score !== null && item.maxScore !== null ? (
              <p className="shrink-0 font-display text-base font-semibold">
                {formatScore(item.score)}
                <span className="text-muted-foreground"> / {formatScore(item.maxScore)}</span>
              </p>
            ) : activity.graded ? (
              <p className="shrink-0 text-ui text-muted-foreground">Sin corregir</p>
            ) : null}
          </div>

          <p className="mt-0.5 truncate text-ui text-muted-foreground">
            {activity.name}
            <span className="px-1.5 text-border-strong">·</span>
            {ACTIVITY_KIND_LABEL[activity.kind]}
            <span className="px-1.5 text-border-strong">·</span>
            {formatRelativeTime(submission.submittedAt)}
          </p>

          {submission.status === 'error' && submission.errorMessage ? (
            <p
              className={cn(
                'mt-2 line-clamp-2 text-ui',
                submission.errorSeenAt === null ? 'text-destructive-ink' : 'text-muted-foreground',
              )}
            >
              {submission.errorMessage}
            </p>
          ) : submission.status === 'parked' ? (
            <p className="mt-2 text-ui text-muted-foreground">
              {submission.parkedReason ?? 'Descartada, sin motivo anotado.'}{' '}
              <span className="whitespace-nowrap">· {formatRelativeTime(submission.updatedAt)}</span>
            </p>
          ) : (
            <AttentionSignals item={item} />
          )}
        </div>
      </Link>

      <QueueRowActions item={item} />
    </li>
  );
}

/**
 * Lo que se puede hacer con la entrega sin abrirla.
 *
 * Van **fuera** del enlace y no dentro: un botón anidado en un `<a>` no es
 * pulsable con teclado sin trucos y activa la navegación al soltar el ratón.
 * Y son las tres decisiones que en las pruebas obligaban a entrar en la ficha
 * para nada: dar un fallo por visto, devolver algo a la cola y cerrar a mano lo
 * que ya se entregó por otro camino.
 */
function QueueRowActions({ item }: { item: QueueItem }) {
  const queryClient = useQueryClient();
  const isAdmin = useAuth().user?.role === 'admin';
  const { submission } = item;
  // Las dos acciones que no tienen vuelta atrás piden confirmación; dar un
  // fallo por visto se deshace con el mismo botón y no la necesita.
  const [confirming, setConfirming] = useState<'requeue' | 'published' | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.queueRoot });

  const seeError = useMutation({
    mutationFn: (seen: boolean) => api.seeError(submission.id, seen),
    onSuccess: (_, seen) => {
      void refresh();
      notify.success(
        seen ? 'Fallo dado por visto' : 'Fallo devuelto a lo pendiente',
        seen
          ? 'Sigue en Errores, pero deja de contar como trabajo por hacer.'
          : 'Vuelve a contar en la pestaña de errores.',
      );
    },
    onError: (error) => notify.error('No se ha podido cambiar la marca', error),
  });

  const requeue = useMutation({
    mutationFn: () => api.discardCorrection(submission.id),
    onSuccess: () => {
      setConfirming(null);
      void refresh();
      notify.success(
        'Devuelta a pendientes',
        'La corregirá el siguiente proceso, de cero.',
      );
    },
    onError: (error) => notify.error('No se ha podido devolver a la cola', error),
  });

  const markPublished = useMutation({
    mutationFn: () => api.markPublished(submission.id),
    onSuccess: () => {
      setConfirming(null);
      void refresh();
      notify.success(
        'Marcada como publicada',
        'Vega no ha enviado nada a Moodle: queda registrada como entregada por ti.',
      );
    },
    onError: (error) => notify.error('No se ha podido marcar como publicada', error),
  });

  const busy = seeError.isPending || requeue.isPending || markPublished.isPending;

  const actions = [];

  if (submission.status === 'error') {
    actions.push(
      submission.errorSeenAt === null ? (
        <Button
          key="see"
          size="sm"
          variant="ghost"
          loading={seeError.isPending}
          disabled={busy}
          onClick={() => seeError.mutate(true)}
        >
          <Eye aria-hidden="true" />
          Marcar como visto
        </Button>
      ) : (
        <Button
          key="unsee"
          size="sm"
          variant="ghost"
          loading={seeError.isPending}
          disabled={busy}
          onClick={() => seeError.mutate(false)}
        >
          <Check aria-hidden="true" />
          Deshacer «visto»
        </Button>
      ),
    );
  }

  // Resucitar lo que el sistema descartó o lo que se rompió cuesta dinero
  // cuando vuelva a pasar por el motor, así que es cosa de administración. El
  // botón se esconde en vez de fallar con un 403 después de pulsarlo.
  if (isAdmin && (submission.status === 'parked' || submission.status === 'error')) {
    actions.push(
      <Button
        key="requeue"
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => setConfirming('requeue')}
      >
        <RotateCcw aria-hidden="true" />
        Devolver a pendientes
      </Button>,
    );
  }

  if (submission.status === 'validated') {
    actions.push(
      <Button
        key="published"
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => setConfirming('published')}
      >
        <Send aria-hidden="true" />
        Dar por entregada
      </Button>,
    );
  }

  if (actions.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1">
        {actions}
      </div>

      <Sheet open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {confirming === 'requeue'
                ? '¿Devolver esta entrega a pendientes?'
                : '¿Darla por entregada?'}
            </SheetTitle>
            <SheetDescription>
              {confirming === 'requeue'
                ? 'Se borra lo que hubiera de corrección y transcripción. La entrega vuelve a la cola y se corregirá de cero en el siguiente proceso, con el coste que eso supone.'
                : 'Vega no envía nada a Moodle: sólo deja de pedir una publicación que ya has hecho por tu cuenta. La corrección queda cerrada y no se podrá modificar.'}
            </SheetDescription>
          </SheetHeader>
          <SheetFooter>
            <Button variant="ghost" size="lg" disabled={busy} onClick={() => setConfirming(null)}>
              Cancelar
            </Button>
            {confirming === 'requeue' ? (
              <Button
                variant="destructive"
                size="lg"
                loading={requeue.isPending}
                onClick={() => requeue.mutate()}
              >
                Devolver a pendientes
              </Button>
            ) : (
              <Button
                variant="default"
                size="lg"
                loading={markPublished.isPending}
                onClick={() => markPublished.mutate()}
              >
                Darla por entregada
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function AttentionSignals({ item }: { item: QueueItem }) {
  const lowConfidence = item.lowConfidence;
  if (!lowConfidence && item.flagCount === 0 && item.lowConfidenceItems === 0 && item.verificationIssueCount === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {lowConfidence && item.confidence !== null ? (
        <li>
          <Badge variant="warning" title="La IA no está segura de esta corrección">
            Confianza {Math.round(item.confidence * 100)} %
          </Badge>
        </li>
      ) : null}
      {item.flagCount > 0 ? (
        <li>
          <Badge variant="warning" title="Marcas [ILEGIBLE] o [DUDA] en la transcripción">
            {plural(item.flagCount, 'marca', 'marcas')}
          </Badge>
        </li>
      ) : null}
      {item.lowConfidenceItems > 0 ? (
        <li>
          <Badge title="Apartados que la IA marca con baja confianza">
            {plural(item.lowConfidenceItems, 'apartado dudoso', 'apartados dudosos')}
          </Badge>
        </li>
      ) : null}
      {item.verificationIssueCount > 0 ? (
        <li>
          <Badge variant="warning" title="Avisos de la comprobación mecánica o del verificador">
            {plural(item.verificationIssueCount, 'aviso de verificación', 'avisos de verificación')}
          </Badge>
        </li>
      ) : null}
    </ul>
  );
}

export function QueueRowSkeleton() {
  return (
    <li className="rounded-md border border-border bg-card py-3 pl-4 pr-3">
      <div className="flex items-baseline justify-between gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="mt-2.5 h-3 w-48" />
      <Skeleton className="mt-3 h-4 w-24" />
    </li>
  );
}
