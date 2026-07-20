import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Search } from 'lucide-react';
import { ACTIVITY_KIND_LABEL } from '@vega/shared';
import type { ActivityKind, DiscoveredActivity, DiscoveredCourse } from '@vega/shared';
import { ApiClientError, api, errorMessage } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/cn';
import { useDebounce } from '@/lib/useDebounce';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { EmptyState, ErrorState } from '@/components/common/Feedback';

/** Radix Select reserva la cadena vacía, así que «todas» viaja con su propio valor. */
const ALL_KINDS = 'all';
type KindFilter = typeof ALL_KINDS | ActivityKind;

/** Las entregas primero: son las que el profesor busca casi siempre. */
const KIND_ORDER: readonly ActivityKind[] = ['assignment', 'forum'];

/** Los rótulos del contrato son singulares; encabezados y filtro piden plural. */
const kindPlural = (kind: ActivityKind) => `${ACTIVITY_KIND_LABEL[kind]}s`;

/** Moodle puede devolver el nombre vacío; el curso sigue siendo elegible. */
const courseLabel = (course: DiscoveredCourse) =>
  course.name || course.shortName || 'Curso sin nombre';

/** Buscar «matematicas» tiene que encontrar «Matemáticas». */
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * RN-13: el recuento es orientativo y no es comparable entre tipos. En una
 * entrega son entregas y en un foro son debates, así que la unidad se nombra.
 */
function pendingLabel(item: DiscoveredActivity): string {
  if (item.kind === 'forum') {
    if (item.pendingCount === 0) return 'Sin debates';
    return `${item.pendingCount} ${item.pendingCount === 1 ? 'debate' : 'debates'}`;
  }
  if (item.pendingCount === 0) return 'Sin entregas pendientes';
  return `${item.pendingCount} ${
    item.pendingCount === 1 ? 'entrega pendiente' : 'entregas pendientes'
  }`;
}

/**
 * Un token que no vale no se arregla reintentando: ese caso lleva a Ajustes y
 * no ofrece reintentar, a diferencia de un Moodle que simplemente no responde.
 */
function LmsErrorState({
  error,
  onRetry,
  onLeave,
}: {
  error: unknown;
  onRetry: () => void;
  onLeave: () => void;
}) {
  if (error instanceof ApiClientError && error.code === 'LMS_AUTH') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Revisa la conexión con Moodle</AlertTitle>
        <AlertDescription className="mt-1 text-muted-foreground">
          {errorMessage(error)} Comprueba la URL y el token en Ajustes.
        </AlertDescription>
        <Button size="sm" variant="outline" className="mt-3" asChild>
          {/* Sin cerrar el diálogo, Ajustes se abriría debajo de él. */}
          <Link to="/ajustes" onClick={onLeave}>
            Ir a Ajustes
          </Link>
        </Button>
      </Alert>
    );
  }
  return <ErrorState title="No se ha podido consultar Moodle" error={error} onRetry={onRetry} />;
}

function RowSkeletons({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full rounded-md" />
      ))}
    </div>
  );
}

/**
 * Alta de actividades desde Moodle, en dos pasos: primero el curso y después
 * sus actividades. Volcar el catálogo entero funciona con siete ejemplos y no
 * con el Moodle de un departamento.
 */
export function DiscoverActivitiesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const hideImportedId = useId();
  const rowIdPrefix = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<'courses' | 'activities' | null>(null);

  const [courseId, setCourseId] = useState<string | null>(null);
  /** Por curso: volver atrás conserva la selección y cambiar de curso no la arrastra. */
  const [selectionByCourse, setSelectionByCourse] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>(ALL_KINDS);
  const [hideImported, setHideImported] = useState(true);
  const debouncedSearch = useDebounce(search, 300);

  /**
   * Cambiar de paso desmonta el botón que tenía el foco y lo deja en `body`, y
   * el título cambia de texto sin que nada lo anuncie. Lo llevamos al título,
   * que es lo primero que hay que leer del paso nuevo. En la apertura no se
   * toca: ahí manda el foco inicial de Radix.
   */
  useEffect(() => {
    if (!open) {
      previousStep.current = null;
      return;
    }
    const step = courseId === null ? 'courses' : 'activities';
    if (previousStep.current !== null && previousStep.current !== step) {
      titleRef.current?.focus();
    }
    previousStep.current = step;
  }, [open, courseId]);

  const coursesQuery = useQuery({
    queryKey: queryKeys.discoverCourses,
    queryFn: ({ signal }) => api.discoverCourses(signal),
    enabled: open,
    staleTime: 0,
  });

  const activitiesQuery = useQuery({
    queryKey: queryKeys.discoverActivities(courseId ?? ''),
    queryFn: ({ signal }) => api.discoverActivities(courseId ?? '', signal),
    enabled: open && courseId !== null,
    staleTime: 0,
  });

  const courses = coursesQuery.data?.items ?? [];
  const course = courses.find((item) => item.moodleCourseId === courseId) ?? null;
  const items = useMemo(() => activitiesQuery.data?.items ?? [], [activitiesQuery.data]);

  const selected = useMemo(
    () => (courseId === null ? [] : (selectionByCourse[courseId] ?? [])),
    [courseId, selectionByCourse],
  );

  const filtered = useMemo(() => {
    const needle = normalize(debouncedSearch.trim());
    return items.filter((item) => {
      if (hideImported && item.alreadyImported) return false;
      if (kindFilter !== ALL_KINDS && item.kind !== kindFilter) return false;
      return needle === '' || normalize(item.name).includes(needle);
    });
  }, [items, debouncedSearch, kindFilter, hideImported]);

  const groups = useMemo(
    () =>
      KIND_ORDER.map(
        (kind) => [kind, filtered.filter((item) => item.kind === kind)] as const,
      ).filter(([, list]) => list.length > 0),
    [filtered],
  );

  /** Las ya importadas no son seleccionables, así que no entran en el denominador. */
  const selectableCount = items.filter((item) => !item.alreadyImported).length;
  const hiddenCount = items.length - filtered.length;

  /**
   * El curso entero está ya en Vega y sólo el conmutador lo esconde. Decirlo así
   * evita el «sin resultados» de quien cree que ha escrito mal la búsqueda.
   */
  const allAlreadyImported =
    filtered.length === 0 &&
    selectableCount === 0 &&
    debouncedSearch.trim() === '' &&
    kindFilter === ALL_KINDS;

  const resetFilters = () => {
    setSearch('');
    setKindFilter(ALL_KINDS);
    setHideImported(false);
  };

  const openCourse = (id: string) => {
    setCourseId(id);
    // Los filtros describen una lista concreta: arrastrarlos a otro curso engaña.
    setSearch('');
    setKindFilter(ALL_KINDS);
    setHideImported(true);
  };

  const backToCourses = () => {
    setCourseId(null);
    setSearch('');
    setKindFilter(ALL_KINDS);
  };

  const resetAll = () => {
    setCourseId(null);
    setSelectionByCourse({});
    setSearch('');
    setKindFilter(ALL_KINDS);
    setHideImported(true);
  };

  const toggle = (moodleRef: string) => {
    if (courseId === null) return;
    setSelectionByCourse((current) => {
      const list = current[courseId] ?? [];
      return {
        ...current,
        [courseId]: list.includes(moodleRef)
          ? list.filter((ref) => ref !== moodleRef)
          : [...list, moodleRef],
      };
    });
  };

  const importMutation = useMutation({
    mutationFn: () =>
      api.importActivities({ moodleCourseId: courseId ?? '', moodleRefs: selected }),
    onSuccess: (response) => {
      // `queryKeys.activities` es prefijo del descubrimiento: cae también su caché.
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities });
      notify.success(
        response.items.length === 1 ? 'Actividad importada' : 'Actividades importadas',
        `${response.items.length} en Vega. Revisa su configuración antes del próximo proceso.`,
      );
      resetAll();
      onOpenChange(false);
    },
    onError: (error) => notify.error('No se han podido importar las actividades', error),
  });

  const onCourses = courseId === null;
  const showFilters =
    !onCourses && !activitiesQuery.isPending && !activitiesQuery.isError && items.length > 0;

  /** El pie no puede prometer una lista completa mientras los filtros esconden actividades. */
  const countLabel = () => {
    if (items.length === 0) return '';
    if (selectableCount === 0) return 'Todas las actividades de este curso ya están en Vega.';
    const base = `${selected.length} de ${selectableCount} seleccionadas`;
    if (hiddenCount === 0) return base;
    return `${base} · ${hiddenCount} ${hiddenCount === 1 ? 'oculta' : 'ocultas'} por el filtro`;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetAll();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] grid-rows-[auto_1fr_auto]">
        <DialogHeader>
          {onCourses ? null : (
            <div>
              <Button variant="ghost" size="sm" className="-ml-3" onClick={backToCourses}>
                <ArrowLeft aria-hidden="true" />
                Volver a cursos
              </Button>
            </div>
          )}

          {/* `tabIndex` sólo para poder recibir el foco al cambiar de paso. */}
          <DialogTitle ref={titleRef} tabIndex={-1} className="focus-visible:ring-offset-popover">
            {onCourses
              ? 'Importar de Moodle'
              : course
                ? courseLabel(course)
                : 'Actividades del curso'}
          </DialogTitle>
          <DialogDescription>
            {onCourses
              ? 'Elige el curso del que quieres traer actividades. Después marcarás cuáles vigila Vega.'
              : 'Se importan con revisión completa: nada llega al alumnado sin que lo valides.'}
          </DialogDescription>

          {/* Anula el hueco que la cabecera reserva al botón de cerrar: los filtros van debajo. */}
          {showFilters ? (
            <div className="-mr-8 mt-1 flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar actividad…"
                    aria-label="Buscar por nombre de la actividad"
                    className="h-10 pl-8"
                  />
                </div>

                <Select
                  value={kindFilter}
                  onValueChange={(value) => setKindFilter(value as KindFilter)}
                >
                  <SelectTrigger aria-label="Filtrar por tipo" className="h-10 max-w-32 text-ui">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_KINDS}>Todas</SelectItem>
                    {KIND_ORDER.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {kindPlural(kind)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={hideImportedId} className="cursor-pointer text-muted-foreground">
                  Ocultar las ya importadas
                </Label>
                <Switch
                  id={hideImportedId}
                  checked={hideImported}
                  onCheckedChange={setHideImported}
                />
              </div>
            </div>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto">
          {onCourses ? (
            coursesQuery.isError ? (
              <LmsErrorState
                error={coursesQuery.error}
                onRetry={() => void coursesQuery.refetch()}
                onLeave={() => onOpenChange(false)}
              />
            ) : coursesQuery.isPending ? (
              <RowSkeletons count={3} />
            ) : courses.length === 0 ? (
              <EmptyState
                title="Tu token no ve ningún curso"
                description="Moodle sólo devuelve los cursos sobre los que el token tiene permiso. Si falta alguno, revisa la URL y el token en Ajustes."
                action={
                  <Button asChild>
                    <Link to="/ajustes" onClick={() => onOpenChange(false)}>
                      Ir a Ajustes
                    </Link>
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {courses.map((item) => {
                  const marked = selectionByCourse[item.moodleCourseId]?.length ?? 0;
                  return (
                    <li key={item.moodleCourseId}>
                      <button
                        type="button"
                        onClick={() => openCourse(item.moodleCourseId)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md border border-border px-3 py-3',
                          'text-left transition-colors hover:border-border-strong',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          'focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-base font-medium">
                            {courseLabel(item)}
                          </span>
                          {item.shortName && item.shortName !== item.name ? (
                            <span className="mt-0.5 block text-ui text-muted-foreground">
                              {item.shortName}
                            </span>
                          ) : null}
                        </span>
                        {marked > 0 ? (
                          <Badge variant="primary" className="shrink-0">
                            {marked} {marked === 1 ? 'marcada' : 'marcadas'}
                          </Badge>
                        ) : null}
                        <ChevronRight
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : activitiesQuery.isError ? (
            <LmsErrorState
              error={activitiesQuery.error}
              onRetry={() => void activitiesQuery.refetch()}
              onLeave={() => onOpenChange(false)}
            />
          ) : activitiesQuery.isPending ? (
            <RowSkeletons count={4} />
          ) : items.length === 0 ? (
            <EmptyState
              title="Este curso no tiene actividades"
              description="Vega sólo puede vigilar entregas y foros, y aquí no hay ninguno."
              action={<Button onClick={backToCourses}>Elegir otro curso</Button>}
            />
          ) : allAlreadyImported ? (
            <EmptyState
              title="Ya están todas en Vega"
              description="Las actividades de este curso están dadas de alta. Desactiva «Ocultar las ya importadas» para verlas."
              action={<Button onClick={backToCourses}>Elegir otro curso</Button>}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Sin resultados"
              description="Ninguna actividad del curso coincide con el filtro."
              action={<Button onClick={resetFilters}>Quitar filtros</Button>}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map(([kind, list]) => (
                <section key={kind}>
                  <h3 className="eyebrow mb-1.5">{kindPlural(kind)}</h3>
                  <ul className="flex flex-col gap-1.5">
                    {list.map((item) => (
                      <li key={item.moodleRef}>
                        {/*
                          `div` y no `label` envolvente: el Checkbox de Radix es
                          un `button`, y la asociación implícita de una etiqueta
                          que lo envuelve no es de fiar. Se asocia a mano con
                          `htmlFor`, que además deja toda la fila como zona
                          pulsable — el objetivo táctil que hace falta en móvil.
                        */}
                        <div
                          className={cn(
                            'flex items-start gap-3 rounded-md border border-border px-3 py-2.5',
                            'transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                            'has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-popover',
                            item.alreadyImported
                              ? 'bg-muted text-muted-foreground'
                              : 'hover:border-border-strong',
                          )}
                        >
                          <Checkbox
                            id={`${rowIdPrefix}-${item.moodleRef}`}
                            // El anillo de foco lo dibuja la fila entera; el de
                            // la casilla sería un segundo anillo dentro del primero.
                            className="mt-0.5 focus-visible:ring-0 focus-visible:ring-offset-0"
                            checked={item.alreadyImported || selected.includes(item.moodleRef)}
                            disabled={item.alreadyImported}
                            onCheckedChange={() => toggle(item.moodleRef)}
                          />
                          <label
                            htmlFor={`${rowIdPrefix}-${item.moodleRef}`}
                            className={cn(
                              'min-w-0 flex-1',
                              item.alreadyImported ? undefined : 'cursor-pointer',
                            )}
                          >
                            <span className="block break-words text-base font-medium">
                              {item.name}
                            </span>
                            <span className="mt-0.5 block text-ui text-muted-foreground">
                              {pendingLabel(item)}
                            </span>
                          </label>
                          {item.alreadyImported ? (
                            <Badge variant="success" className="mt-0.5 shrink-0">
                              Ya importada
                            </Badge>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          {onCourses ? null : (
            <p className="mr-auto self-center text-ui text-muted-foreground" aria-live="polite">
              {countLabel()}
            </p>
          )}
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {onCourses ? null : (
            <Button
              variant="default"
              size="lg"
              disabled={selected.length === 0}
              loading={importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              Importar seleccionadas
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
