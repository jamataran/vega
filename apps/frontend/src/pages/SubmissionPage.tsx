import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Info, Lock, RefreshCw, SkipForward, Trash2 } from 'lucide-react';
import { ACTIVITY_KIND_LABEL, hasStudentFile, studentLabel as labelOf } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { formatScore } from '@/lib/format';
import { notify } from '@/lib/notify';
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
import { AutoTextarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorState } from '@/components/common/Feedback';
import { StatusBadge } from '@/components/common/status';
import { SwipeDeck } from '@/components/submission/SwipeDeck';
import { OriginalView } from '@/components/submission/OriginalView';
import { StudentTextView } from '@/components/submission/StudentTextView';
import { TranscriptionView } from '@/components/submission/TranscriptionView';
import { CorrectionView } from '@/components/submission/CorrectionView';
import { ActionBar } from '@/components/submission/ActionBar';
import { usePdfDocument } from '@/components/submission/PdfPage';

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

/**
 * Nombres oficiales de las comunidades, para las claves que llegan del sistema
 * de origen (`Enum::name`, en mayúsculas y sin acentos).
 *
 * Existe el mapa —y no una transformación automática— porque en español los
 * acentos y los artículos son parte del nombre: «Andalucia» y «Castilla la
 * Mancha» están mal escritos, y esto se le enseña al profesor en la pantalla en
 * la que decide una nota. Lo que no esté en el mapa se formatea lo mejor
 * posible, de modo que una comunidad nueva no rompa nada.
 */
const COMMUNITY_LABEL: Readonly<Record<string, string>> = {
  ANDALUCIA: 'Andalucía',
  ARAGON: 'Aragón',
  ASTURIAS: 'Asturias',
  BALEARES: 'Illes Balears',
  ILLES_BALEARS: 'Illes Balears',
  CANARIAS: 'Canarias',
  CANTABRIA: 'Cantabria',
  CASTILLA_LA_MANCHA: 'Castilla-La Mancha',
  CASTILLA_Y_LEON: 'Castilla y León',
  CATALUNA: 'Cataluña',
  CATALUNYA: 'Cataluña',
  CEUTA: 'Ceuta',
  COMUNIDAD_VALENCIANA: 'Comunitat Valenciana',
  EXTREMADURA: 'Extremadura',
  GALICIA: 'Galicia',
  LA_RIOJA: 'La Rioja',
  MADRID: 'Comunidad de Madrid',
  MELILLA: 'Melilla',
  MURCIA: 'Región de Murcia',
  NAVARRA: 'Comunidad Foral de Navarra',
  PAIS_VASCO: 'País Vasco',
};

/**
 * Las comunidades llegan en una sola cadena y pueden ser **varias separadas por
 * coma**: un opositor se presenta en más de una, y todas condicionan el criterio
 * de corrección.
 */
function formatCommunities(raw: string): string {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .map((value) => {
      const known = COMMUNITY_LABEL[value.toUpperCase()];
      if (known !== undefined) return known;
      const soft = value.replace(/_/g, ' ').toLowerCase();
      return soft.charAt(0).toUpperCase() + soft.slice(1);
    })
    .join(' · ');
}

export function SubmissionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [view, setView] = useState<ViewId>('correction');
  const [originalPage, setOriginalPage] = useState(0);
  const [originalUrl, setOriginalUrl] = useState<string | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [validatedOpen, setValidatedOpen] = useState(false);
  const [parkOpen, setParkOpen] = useState(false);
  const [parkReason, setParkReason] = useState('');
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: queryKeys.submission(id),
    queryFn: ({ signal }) => api.submission(id, signal),
    enabled: id !== '',
  });

  const detail = detailQuery.data ?? null;
  const protectedOriginal = detail?.scanUrls[0]?.includes('/original') ?? false;
  const originalQuery = useQuery({
    queryKey: ['submission', id, 'original'],
    queryFn: ({ signal }) => api.original(id, signal),
    enabled: id !== '' && protectedOriginal,
  });
  useEffect(() => {
    if (!originalQuery.data) {
      setOriginalUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(originalQuery.data);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [originalQuery.data]);
  const originalPdf = usePdfDocument(originalUrl);
  const draft = useCorrectionDraft(detail?.correction ?? null);
  const { save, validate, publish } = useCorrectionMutations(id);
  const next = useNextInQueue(id);
  const park = useMutation({
    mutationFn: (reason: string) => api.park(id, { reason }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.queueRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.submission(id) }),
      ]);
      notify.success('Entrega omitida', 'Queda aparcada y fuera de la revisión activa.');
      navigate('/');
    },
    onError: (error) => notify.error('No se ha podido omitir la entrega', error),
  });
  const reprocess = useMutation({
    mutationFn: (scope: 'full' | 'grade_only') => api.reprocess(id, { scope }),
    onSuccess: async (_, scope) => {
      setReprocessOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.queueRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.submission(id) }),
      ]);
      notify.success(
        'Reproceso iniciado',
        scope === 'grade_only' || detail?.activity.kind === 'forum'
          ? 'La nueva corrección ya está en marcha.'
          : 'La nueva lectura y corrección ya están en marcha.',
      );
      navigate('/procesos');
    },
    onError: (error) => notify.error('No se ha podido iniciar el reproceso', error),
  });

  const discard = useMutation({
    mutationFn: () => api.discardCorrection(id),
    onSuccess: async () => {
      setDiscardOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.queueRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.submission(id) }),
      ]);
      notify.success(
        'Propuesta descartada',
        'La entrega vuelve a Pendientes y la corregirá el siguiente proceso.',
      );
      navigate('/');
    },
    onError: (error) => notify.error('No se ha podido descartar la propuesta', error),
  });

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

  const studentLabel = detail ? labelOf(detail.submission, detail.student) : '';
  const status = detail?.submission.status;
  const validated = status === 'validated';
  const published = status === 'published';
  const publicationRetry = status === 'error' && detail?.correction?.validatedAt != null;
  const readOnly = status !== 'graded';
  const canReprocess = !publicationRetry && (status === 'graded' || status === 'parked' || status === 'error');
  // Mismo alcance que reprocesar, y por la misma razón: lo que no se puede
  // volver a corregir tampoco se puede tirar. La diferencia está en el momento
  // en que se gasta —reprocesar llama al modelo ya; descartar espera al
  // siguiente proceso—, no en qué entregas lo admiten.
  const canDiscard = canReprocess;
  const canPark = !publicationRetry && (status === 'graded' || status === 'error');
  const working =
    save.isPending ||
    validate.isPending ||
    publish.isPending ||
    park.isPending ||
    reprocess.isPending ||
    discard.isPending;

  const panels = useMemo(() => {
    if (!detail) return [];
    const protectedOriginalFeedback = protectedOriginal && !originalPdf.document
      ? originalQuery.isError || originalPdf.error
        ? <div className="mx-auto max-w-lg p-4"><ErrorState title="No se ha podido abrir el original" error={originalQuery.error ?? originalPdf.error} onRetry={() => void originalQuery.refetch()} /></div>
        : <div className="mx-auto w-full max-w-3xl p-4"><Skeleton className="h-96 w-full rounded-md" /></div>
      : null;
    const content: Record<ViewId, ReactNode> = {
      original: protectedOriginalFeedback ?? <OriginalView scanUrls={detail.scanUrls} studentLabel={studentLabel} originalDocument={originalPdf.document ?? undefined} page={originalPage} onPageChange={setOriginalPage} totalPages={detail.submission.pageCount} />,
      transcription: (
        protectedOriginalFeedback ?? <TranscriptionView transcription={detail.transcription} studentLabel={studentLabel} originalDocument={originalPdf.document ?? undefined} />
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
          activityKind={detail.activity.kind}
          graded={detail.activity.graded}
          draft={draft}
          readOnly={readOnly ?? false}
          published={published}
          onQuoteOpen={(page) => {
            setOriginalPage(Math.max(0, page - 1));
            setView('original');
            requestAnimationFrame(() => document.getElementById(tabId('original'))?.focus());
          }}
        />
      ),
    };
    return views.map((item) => ({ id: item.value, content: content[item.value] }));
  }, [detail, draft, studentLabel, readOnly, views, originalPage, originalPdf.document, originalPdf.error, originalQuery.error, originalQuery.isError, protectedOriginal]);

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
              {/*
                La comunidad se enseña porque **cambia el criterio de
                corrección**: el tribunal no es el mismo en dos comunidades. Que
                el profesor la vea aquí es lo que le permite juzgar si la
                propuesta parte de la referencia correcta.
              */}
              {detail.student?.community ? (
                <>
                  <span className="px-1.5 text-border-strong">·</span>
                  {formatCommunities(detail.student.community)}
                </>
              ) : null}
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

        {canPark || canReprocess || canDiscard ? (
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border px-3 py-2">
            {canPark ? (
              <Button size="sm" variant="ghost" onClick={() => setParkOpen(true)}>
                <SkipForward aria-hidden="true" />
                Omitir
              </Button>
            ) : null}
            {canDiscard ? (
              <Button size="sm" variant="ghost" onClick={() => setDiscardOpen(true)}>
                <Trash2 aria-hidden="true" />
                Descartar propuesta
              </Button>
            ) : null}
            {canReprocess ? (
              <Button size="sm" variant="ghost" onClick={() => setReprocessOpen(true)}>
                <RefreshCw aria-hidden="true" />
                Volver a procesar
              </Button>
            ) : null}
          </div>
        ) : null}

        {validated || published || publicationRetry ? (
          <p className="flex items-center justify-center gap-2 border-t border-border bg-muted px-4 py-2 text-ui text-muted-foreground">
            <Lock className="size-4 shrink-0" aria-hidden="true" />
            {published
              ? 'Publicada en Moodle: esta corrección ya no se puede modificar.'
              : publicationRetry
                ? 'La corrección sigue validada. La publicación falló; puedes volver a intentarla.'
                : 'Validada por el profesorado: la corrección queda fijada hasta publicarla.'}
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
        canPublish={validated || publicationRetry}
        dirty={draft.dirty}
        saving={save.isPending}
        working={working}
        onSave={() => void runSave()}
        onValidate={() => setConfirmOpen(true)}
        onPublish={() => void runPublish()}
      />

      <Sheet open={parkOpen} onOpenChange={(open) => !open && setParkOpen(false)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>¿Omitir esta entrega?</SheetTitle>
            <SheetDescription>
              Saldrá de la revisión activa, pero quedará aparcada con el motivo y podrás localizarla después.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <label className="eyebrow mb-1.5 block" htmlFor="park-reason">Motivo</label>
            <AutoTextarea
              id="park-reason"
              value={parkReason}
              minRows={3}
              autoFocus
              placeholder="Por ejemplo, el archivo no corresponde a esta actividad."
              onChange={(event) => setParkReason(event.target.value)}
            />
          </SheetBody>
          <SheetFooter>
            <Button variant="ghost" size="lg" disabled={park.isPending} onClick={() => setParkOpen(false)}>Cancelar</Button>
            <Button size="lg" disabled={parkReason.trim() === ''} loading={park.isPending} onClick={() => park.mutate(parkReason.trim())}>Omitir entrega</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={reprocessOpen} onOpenChange={(open) => !open && setReprocessOpen(false)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Volver a procesar</SheetTitle>
            <SheetDescription>
              El nuevo proceso empieza ahora y sustituirá el borrador actual cuando termine.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-2">
            {!hasStudentFile(detail.activity.kind) ? (
              <Button variant="outline" size="lg" disabled={reprocess.isPending} onClick={() => reprocess.mutate('grade_only')}>
                Volver a corregir
              </Button>
            ) : detail.transcription ? (
              <Button variant="outline" size="lg" disabled={reprocess.isPending} onClick={() => reprocess.mutate('grade_only')}>
                Sólo corrección
              </Button>
            ) : null}
            {hasStudentFile(detail.activity.kind) ? (
              <Button variant="outline" size="lg" disabled={reprocess.isPending} onClick={() => reprocess.mutate('full')}>
                Lectura y corrección
              </Button>
            ) : null}
          </SheetBody>
          <SheetFooter>
            <Button variant="ghost" size="lg" disabled={reprocess.isPending} onClick={() => setReprocessOpen(false)}>Cancelar</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={discardOpen} onOpenChange={(open) => !open && setDiscardOpen(false)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>¿Descartar lo que propuso la IA?</SheetTitle>
            <SheetDescription>
              Se borran la corrección propuesta{detail.transcription ? ', la transcripción' : ''} y
              tus cambios sin validar sobre esta entrega. Vuelve a Pendientes y la corregirá de cero
              el siguiente proceso.
            </SheetDescription>
          </SheetHeader>
          <SheetFooter>
            <Button
              variant="ghost"
              size="lg"
              disabled={discard.isPending}
              onClick={() => setDiscardOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="lg"
              loading={discard.isPending}
              onClick={() => discard.mutate()}
            >
              Descartar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

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
