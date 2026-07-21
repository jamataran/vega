import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Info, Lock } from 'lucide-react';
import { ACTIVITY_KIND_LABEL, hasStudentFile } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { formatScore } from '@/lib/format';
import { useCorrectionDraft } from '@/hooks/useCorrectionDraft';
import { useCorrectionMutations } from '@/hooks/useCorrectionMutations';
import { useNextInQueue } from '@/hooks/useNextInQueue';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorState } from '@/components/common/Feedback';
import { StatusBadge } from '@/components/common/status';
import { SwipeDeck } from '@/components/submission/SwipeDeck';
import { OriginalView } from '@/components/submission/OriginalView';
import { StudentTextView } from '@/components/submission/StudentTextView';
import { TranscriptionView } from '@/components/submission/TranscriptionView';
import { CorrectionView } from '@/components/submission/CorrectionView';
import { ActionBar } from '@/components/submission/ActionBar';

type ViewId = 'original' | 'transcription' | 'submission' | 'correction';

/**
 * Las vistas dependen del tipo de actividad: una entrega trae fichero del
 * alumno y pasa por transcripción; un foro sólo trae texto, así que no hay
 * original que ampliar ni transcripción que comparar.
 */
const FILE_VIEWS: readonly { value: ViewId; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'transcription', label: 'Transcripción' },
  { value: 'correction', label: 'Corrección' },
];

const TEXT_VIEWS: readonly { value: ViewId; label: string }[] = [
  { value: 'submission', label: 'Entrega' },
  { value: 'correction', label: 'Corrección' },
];

/* Los paneles los pinta `SwipeDeck`, no Radix: el carrusel necesita los tres
   montados a la vez para que el gesto no parpadee. Las pestañas apuntan a esos
   identificadores para que la relación pestaña ↔ panel siga siendo correcta. */
const tabId = (value: ViewId) => `submission-tab-${value}`;
const panelId = (value: ViewId) => `submission-panel-${value}`;

export function SubmissionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [view, setView] = useState<ViewId>('correction');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [validatedOpen, setValidatedOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: queryKeys.submission(id),
    queryFn: ({ signal }) => api.submission(id, signal),
    enabled: id !== '',
  });

  const detail = detailQuery.data ?? null;
  const draft = useCorrectionDraft(detail?.correction ?? null);
  const { save, validate, publish } = useCorrectionMutations(id);
  const next = useNextInQueue(id);

  const views = detail && !hasStudentFile(detail.activity.kind) ? TEXT_VIEWS : FILE_VIEWS;
  const index = views.findIndex((item) => item.value === view);

  // Flechas del teclado para cambiar de vista, salvo mientras se escribe.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      const current = views.findIndex((item) => item.value === view);
      if (event.key === 'ArrowRight' && current < views.length - 1) {
        setView(views[current + 1]?.value ?? view);
      } else if (event.key === 'ArrowLeft' && current > 0) {
        setView(views[current - 1]?.value ?? view);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, views]);

  const studentLabel = detail
    ? (detail.submission.studentAlias ?? detail.submission.studentRef)
    : '';
  const readOnly = detail?.submission.status === 'published';
  const working = save.isPending || validate.isPending || publish.isPending;

  const panels = useMemo(() => {
    if (!detail) return [];
    const content: Record<ViewId, ReactNode> = {
      original: <OriginalView scanUrls={detail.scanUrls} studentLabel={studentLabel} />,
      transcription: (
        <TranscriptionView transcription={detail.transcription} studentLabel={studentLabel} />
      ),
      submission: (
        <StudentTextView
          textContent={detail.submission.textContent}
          studentLabel={studentLabel}
        />
      ),
      correction: (
        <CorrectionView
          correction={detail.correction}
          submissionId={detail.submission.id}
          feedbackName={`${detail.activity.slug}-${detail.submission.studentRef}.pdf`}
          graded={detail.activity.graded}
          draft={draft}
          readOnly={readOnly ?? false}
        />
      ),
    };
    return views.map((item) => ({ id: item.value, content: content[item.value] }));
  }, [detail, draft, studentLabel, readOnly, views]);

  if (detailQuery.isError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <ErrorState
          title="No se ha podido abrir la entrega"
          error={detailQuery.error}
          onRetry={() => void detailQuery.refetch()}
        />
        <Button asChild variant="link" className="mt-4 px-0">
          <Link to="/">Volver a la cola</Link>
        </Button>
      </div>
    );
  }

  if (detailQuery.isPending || !detail) return <SubmissionSkeleton />;

  // Sin actividad puntuable no hay nota: ni total, ni denominador, ni "—/10".
  const maxScore = detail.activity.graded
    ? (detail.correction?.maxScore ?? detail.activity.maxScore)
    : null;

  const runSave = async () => {
    try {
      const response = await save.mutateAsync({
        request: draft.buildRequest(),
        optimistic: draft.optimisticCorrection,
      });
      draft.resync(response.correction);
    } catch {
      // El aviso de error ya lo ha mostrado la mutación.
    }
  };

  const runValidate = async () => {
    try {
      const response = await validate.mutateAsync({
        request: draft.buildRequest(),
        optimistic: draft.optimisticCorrection,
      });
      draft.resync(response.correction);
      setConfirmOpen(false);
      setValidatedOpen(true);
    } catch {
      setConfirmOpen(false);
    }
  };

  const runPublish = async () => {
    try {
      await publish.mutateAsync();
      setValidatedOpen(false);
    } catch {
      /* avisado por la mutación */
    }
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Volver a la cola"
            onClick={() => navigate('/')}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-base font-semibold leading-tight">
              {studentLabel}
            </h1>
            <p className="truncate text-ui text-muted-foreground">
              {detail.activity.name}
              <span className="px-1.5 text-border-strong">·</span>
              {ACTIVITY_KIND_LABEL[detail.activity.kind]}
            </p>
          </div>
          <StatusBadge status={detail.submission.status} className="shrink-0" />
        </div>

        <Tabs
          value={view}
          onValueChange={(value) => setView(value as ViewId)}
          className="mx-auto max-w-3xl px-3 pb-2"
        >
          <TabsList aria-label="Vistas de la entrega">
            {views.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                id={tabId(item.value)}
                aria-controls={panelId(item.value)}
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {readOnly ? (
          <p className="flex items-center justify-center gap-2 border-t border-border bg-muted px-4 py-2 text-ui text-muted-foreground">
            <Lock className="size-4 shrink-0" aria-hidden="true" />
            Publicada en Moodle: esta corrección ya no se puede modificar.
          </p>
        ) : null}

        {/*
          Publicar son dos operaciones —la nota y el PDF de corrección— y hay
          conectores que no admiten la segunda. No es un fallo, pero callarlo
          dejaría creer que el alumno ha recibido un PDF que nunca salió.
        */}
        {detail.correction?.publishNotice ? (
          <p className="flex items-start justify-center gap-2 border-t border-border bg-muted px-4 py-2 text-ui text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {detail.correction.publishNotice}
          </p>
        ) : null}
      </header>

      <SwipeDeck
        panels={panels}
        index={index < 0 ? 0 : index}
        onIndexChange={(nextIndex) => setView(views[nextIndex]?.value ?? view)}
        idPrefix="submission"
        className="min-h-0 flex-1"
      />

      <ActionBar
        total={draft.total}
        maxScore={maxScore}
        status={detail.submission.status}
        dirty={draft.dirty}
        saving={save.isPending}
        working={working}
        onSave={() => void runSave()}
        onValidate={() => setConfirmOpen(true)}
        onPublish={() => void runPublish()}
      />

      <Sheet open={confirmOpen} onOpenChange={(open) => !open && setConfirmOpen(false)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>¿Validar esta corrección?</SheetTitle>
            <SheetDescription>
              {maxScore === null
                ? `Darás por buena la corrección de ${studentLabel}. Todavía no se publica nada en Moodle.`
                : `Fijarás ${formatScore(draft.total)} de ${formatScore(maxScore)} como nota de ${studentLabel}. Todavía no se publica nada en Moodle.`}
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            <dl className="flex flex-col gap-1.5 rounded-md border border-border bg-muted px-3 py-2.5 text-ui">
              {maxScore === null ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Documento de corrección</dt>
                  <dd>{draft.latex === null ? 'De la IA' : 'Reescrito por ti'}</dd>
                </div>
              ) : (
                <>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Apartados corregidos</dt>
                    <dd>{draft.items.length}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Cambiados por ti</dt>
                    <dd>{draft.editedCount}</dd>
                  </div>
                </>
              )}
            </dl>
          </SheetBody>

          <SheetFooter>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => setConfirmOpen(false)}
              disabled={validate.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="default"
              size="lg"
              onClick={() => void runValidate()}
              loading={validate.isPending}
            >
              Validar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={validatedOpen} onOpenChange={(open) => !open && setValidatedOpen(false)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Corrección validada</SheetTitle>
            <SheetDescription>
              {maxScore === null
                ? `Corrección de ${studentLabel} lista. Publícala cuando quieras.`
                : `${studentLabel}: ${formatScore(draft.total)} de ${formatScore(maxScore)}. Publícala cuando quieras.`}
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              loading={publish.isPending}
              onClick={() => void runPublish()}
            >
              Publicar ahora en Moodle
            </Button>
            {next ? (
              <p className="mt-3 text-ui text-muted-foreground">
                Siguiente en la cola:{' '}
                <span className="text-foreground">
                  {next.submission.studentAlias ?? next.submission.studentRef}
                </span>{' '}
                ({next.activity.name}).
              </p>
            ) : (
              <p className="mt-3 text-ui text-muted-foreground">No queda nada más por revisar.</p>
            )}
          </SheetBody>

          <SheetFooter>
            <Button variant="ghost" size="lg" onClick={() => setValidatedOpen(false)}>
              Seguir aquí
            </Button>
            {next ? (
              <Button
                variant="default"
                size="lg"
                onClick={() => {
                  setValidatedOpen(false);
                  navigate(`/entrega/${next.submission.id}`, { replace: true });
                }}
              >
                Siguiente entrega
              </Button>
            ) : (
              <Button variant="default" size="lg" onClick={() => navigate('/')}>
                Volver a la cola
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SubmissionSkeleton() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="shrink-0 border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Skeleton className="size-6 rounded-sm" />
          <div className="flex-1">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="mx-auto max-w-3xl px-4 pb-3">
          <Skeleton className="h-8 w-64" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl flex-1 space-y-3 px-4 py-4">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>

      <div className="shrink-0 border-t border-border bg-card px-4 py-3">
        <Skeleton className="h-11 w-full rounded-md" />
      </div>
    </div>
  );
}
