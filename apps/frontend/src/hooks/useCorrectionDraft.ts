import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { totalScore } from '@vega/shared';
import type { Correction, CorrectionItem, SaveCorrectionRequest } from '@vega/shared';

interface DraftEntry {
  teacherPoints: number | null;
  teacherFeedback: string | null;
}

interface CorrectionDraft {
  items: Record<string, DraftEntry>;
  teacherSummary: string | null;
  /** LaTeX reescrito por el profesor. `null` deja el que propone la IA. */
  teacherLatex: string | null;
}

function fromCorrection(correction: Correction | null): CorrectionDraft {
  const items: Record<string, DraftEntry> = {};
  for (const item of correction?.items ?? []) {
    items[item.id] = { teacherPoints: item.teacherPoints, teacherFeedback: item.teacherFeedback };
  }
  return {
    items,
    teacherSummary: correction?.teacherSummary ?? null,
    teacherLatex: correction?.teacherLatex ?? null,
  };
}

/**
 * Estado local de la corrección que el profesor está tocando.
 *
 * Vive fuera de TanStack Query a propósito: el total tiene que recalcularse en
 * el mismo fotograma en que se pulsa el stepper, sin esperar a la red. El
 * guardado sincroniza después, de forma optimista.
 */
export function useCorrectionDraft(correction: Correction | null) {
  const [draft, setDraft] = useState<CorrectionDraft>(() => fromCorrection(correction));
  const syncedFor = useRef<string | null>(null);

  // Sólo resembramos el borrador al cambiar de corrección: un refetch de fondo
  // no debe borrar lo que el profesor lleva escrito.
  useEffect(() => {
    if (!correction) return;
    if (syncedFor.current !== correction.id) {
      syncedFor.current = correction.id;
      setDraft(fromCorrection(correction));
    }
  }, [correction]);

  const resync = useCallback((next: Correction) => {
    syncedFor.current = next.id;
    setDraft(fromCorrection(next));
  }, []);

  const setPoints = useCallback((itemId: string, points: number | null) => {
    setDraft((current) => ({
      ...current,
      items: {
        ...current.items,
        [itemId]: {
          teacherPoints: points,
          teacherFeedback: current.items[itemId]?.teacherFeedback ?? null,
        },
      },
    }));
  }, []);

  const setFeedback = useCallback((itemId: string, feedback: string | null) => {
    setDraft((current) => ({
      ...current,
      items: {
        ...current.items,
        [itemId]: {
          teacherPoints: current.items[itemId]?.teacherPoints ?? null,
          teacherFeedback: feedback,
        },
      },
    }));
  }, []);

  /** Devuelve el apartado a lo que propuso la IA. */
  const restoreItem = useCallback((itemId: string) => {
    setDraft((current) => ({
      ...current,
      items: { ...current.items, [itemId]: { teacherPoints: null, teacherFeedback: null } },
    }));
  }, []);

  const setSummary = useCallback((summary: string | null) => {
    setDraft((current) => ({ ...current, teacherSummary: summary }));
  }, []);

  /** Devuelve el comentario global a la propuesta de la IA. */
  const restoreSummary = useCallback(() => {
    setDraft((current) => ({ ...current, teacherSummary: null }));
  }, []);

  const setLatex = useCallback((latex: string | null) => {
    setDraft((current) => ({ ...current, teacherLatex: latex }));
  }, []);

  /** Devuelve el documento de corrección al que redactó la IA. */
  const restoreLatex = useCallback(() => {
    setDraft((current) => ({ ...current, teacherLatex: null }));
  }, []);

  /** Los apartados con el criterio del profesor ya aplicado, ordenados. */
  const items: CorrectionItem[] = useMemo(() => {
    const source = correction?.items ?? [];
    return source
      .map((item) => {
        const entry = draft.items[item.id];
        return entry
          ? { ...item, teacherPoints: entry.teacherPoints, teacherFeedback: entry.teacherFeedback }
          : item;
      })
      .sort((a, b) => a.position - b.position);
  }, [correction, draft]);

  const total = useMemo(() => totalScore(items), [items]);

  const dirty = useMemo(() => {
    if (!correction) return false;
    if (draft.teacherSummary !== correction.teacherSummary) return true;
    if (draft.teacherLatex !== correction.teacherLatex) return true;
    return correction.items.some((item) => {
      const entry = draft.items[item.id];
      if (!entry) return false;
      return (
        entry.teacherPoints !== item.teacherPoints ||
        entry.teacherFeedback !== item.teacherFeedback
      );
    });
  }, [correction, draft]);

  /** Cuántos apartados ha tocado el profesor: el resumen honesto de la sesión. */
  const editedCount = useMemo(
    () =>
      items.filter((item) => item.teacherPoints !== null || item.teacherFeedback !== null).length,
    [items],
  );

  const buildRequest = useCallback(
    (): SaveCorrectionRequest => ({
      items: items.map((item) => ({
        id: item.id,
        teacherPoints: item.teacherPoints,
        teacherFeedback: item.teacherFeedback,
      })),
      teacherSummary: draft.teacherSummary,
      teacherLatex: draft.teacherLatex,
    }),
    [items, draft.teacherSummary, draft.teacherLatex],
  );

  /** La corrección tal y como quedaría si el guardado sale bien. */
  const optimisticCorrection = useMemo(
    (): Correction | null =>
      correction
        ? {
            ...correction,
            items,
            teacherSummary: draft.teacherSummary,
            teacherLatex: draft.teacherLatex,
          }
        : null,
    [correction, items, draft.teacherSummary, draft.teacherLatex],
  );

  return {
    summary: draft.teacherSummary,
    latex: draft.teacherLatex,
    items,
    total,
    dirty,
    editedCount,
    setPoints,
    setFeedback,
    restoreItem,
    setSummary,
    restoreSummary,
    setLatex,
    restoreLatex,
    buildRequest,
    optimisticCorrection,
    resync,
  };
}

export type CorrectionDraftController = ReturnType<typeof useCorrectionDraft>;
