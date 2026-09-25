// Which Tutorial the panel shows, and the Device's progress through each
// (PLAN §24.6, §24.11). Above the Welcome wizard as well as the app, so the
// wizard's Done step can hand a Tutorial to the panel that opens after it.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { finish, goToStep, loadImageMode, loadProgress, resumeAt, saveImageMode, saveProgress, type ImageMode, type Progress } from "./tutorials";

/** A single Tutorial, or the list a view's "?" offers when it has several. */
export type TutorialOpen = { kind: "one"; id: string; step: number; from?: string[] } | { kind: "list"; ids: string[] };

interface TutorialState {
  open: TutorialOpen | null;
  progress: Progress;
  imageMode: ImageMode;
  /** Open one Tutorial where the user left it. `from` is the list to go back to. */
  show: (id: string, total: number, from?: string[]) => void;
  /** Open a view's list; with one entry, open that Tutorial straight away. */
  showList: (ids: string[], total: (id: string) => number) => void;
  step: (id: string, step: number, total: number) => void;
  done: (id: string, total: number) => void;
  close: () => void;
  setImageMode: (m: ImageMode) => void;
}

const Ctx = createContext<TutorialState | null>(null);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<TutorialOpen | null>(null);
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [imageMode, setMode] = useState<ImageMode>(() => loadImageMode());

  const update = useCallback((f: (p: Progress) => Progress) => {
    setProgress((p) => {
      const next = f(p);
      saveProgress(next);
      return next;
    });
  }, []);

  const show = useCallback(
    (id: string, total: number, from?: string[]) => setOpen({ kind: "one", id, step: resumeAt(progress, id, total), from }),
    [progress],
  );
  const showList = useCallback(
    (ids: string[], total: (id: string) => number) => {
      if (ids.length === 1) show(ids[0], total(ids[0]));
      else setOpen({ kind: "list", ids });
    },
    [show],
  );
  const step = useCallback(
    (id: string, n: number, total: number) => {
      update((p) => goToStep(p, id, n, total));
      setOpen((o) => (o?.kind === "one" && o.id === id ? { ...o, step: Math.max(0, Math.min(n, total - 1)) } : o));
    },
    [update],
  );
  const done = useCallback((id: string, total: number) => update((p) => finish(p, id, total)), [update]);
  const close = useCallback(() => setOpen(null), []);
  const setImageMode = useCallback((m: ImageMode) => {
    saveImageMode(m);
    setMode(m);
  }, []);

  const value = useMemo(
    () => ({ open, progress, imageMode, show, showList, step, done, close, setImageMode }),
    [open, progress, imageMode, show, showList, step, done, close, setImageMode],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTutorials(): TutorialState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTutorials outside TutorialProvider");
  return v;
}
