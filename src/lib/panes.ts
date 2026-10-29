// Panes: up to two documents side by side in a Window (spec #35).
//
// Each Pane has its own view, its own Back/Forward history and its own
// talk/Board split; `lastUsed` is the Pane the side panel, the Command Palette
// and Back follow. Every transition goes through `panesReducer`, kept free of
// React so it is tested once (`test:unit`) — the `src/lib/split.ts` precedent.
import { DEFAULT_RATIO, splitFits } from "./split";

/** Which face of a Composition is showing (PLAN §22.2). */
export type DocTab = "talk" | "split" | "board";

export type View =
  | { kind: "home" }
  | { kind: "doc"; id: string }
  /** `focus`: the local graph of that document (PLAN §10). */
  | { kind: "graph"; focus?: string }
  | { kind: "library" }
  | { kind: "clippings" }
  | { kind: "map" }
  | { kind: "coverage" }
  | { kind: "timeline" }
  | { kind: "settings" };

export interface Pane {
  view: View;
  back: View[];
  forward: View[];
  /** The face of a Composition showing in this Pane (PLAN §22). */
  docTab: DocTab;
  /** The talk's share of this Pane's width when split (PLAN §22.4). */
  splitRatio: number;
}

export type PaneIndex = 0 | 1;

export interface PanesState {
  panes: [Pane] | [Pane, Pane];
  lastUsed: PaneIndex;
  /** The first Pane's share of the width when two are shown. */
  ratio: number;
}

// `pane`, where an action takes it, names the Pane to act on instead of the
// last-used one, and leaves `lastUsed` alone: a Pane's own Back button, or an
// effect in a Pane that is not the one in use.
export type PaneAction =
  /** Open `view` in the last-used Pane. */
  | { type: "open"; view: View; pane?: PaneIndex }
  /** Open `view` in the other Pane, opening it when there is only one. */
  | { type: "openInOther"; view: View }
  | { type: "back"; pane?: PaneIndex }
  | { type: "forward"; pane?: PaneIndex }
  /** Close a Pane (the last-used one by default); the last Pane stays. */
  | { type: "close"; pane?: PaneIndex }
  | { type: "swap" }
  | { type: "focus"; pane: PaneIndex }
  | { type: "setDocTab"; tab: DocTab; pane?: PaneIndex }
  | { type: "setSplitRatio"; ratio: number; pane?: PaneIndex }
  /** Move the divider between the two Panes. */
  | { type: "setRatio"; ratio: number }
  /** Back to a single Pane on Home, as when a Vault opens. */
  | { type: "reset" }
  /** A layout restored from `restoreLayout`. */
  | { type: "load"; state: PanesState };

/** How many views Back can return through, per Pane. */
export const HISTORY_LIMIT = 50;

const HOME: View = { kind: "home" };

function newPane(view: View): Pane {
  return { view, back: [], forward: [], docTab: "talk", splitRatio: DEFAULT_RATIO };
}

export function initialPanes(): PanesState {
  return { panes: [newPane(HOME)], lastUsed: 0, ratio: DEFAULT_RATIO };
}

function navigate(p: Pane, view: View): Pane {
  return { ...p, view, back: [...p.back.slice(-(HISTORY_LIMIT - 1)), p.view], forward: [] };
}

function update(s: PanesState, i: PaneIndex, f: (p: Pane) => Pane): PanesState {
  const panes = s.panes.map((p, j) => (j === i ? f(p) : p)) as PanesState["panes"];
  return { ...s, panes };
}

function target(s: PanesState, a: { pane?: PaneIndex }): PaneIndex {
  return a.pane !== undefined && a.pane < s.panes.length ? a.pane : s.lastUsed;
}

function other_(i: PaneIndex): PaneIndex {
  return i === 0 ? 1 : 0;
}

export function panesReducer(s: PanesState, a: PaneAction): PanesState {
  switch (a.type) {
    case "open":
      return update(s, target(s, a), (p) => navigate(p, a.view));
    case "back":
      return update(s, target(s, a), (p) => {
        if (p.back.length === 0) return p;
        return {
          ...p,
          view: p.back[p.back.length - 1],
          back: p.back.slice(0, -1),
          forward: [...p.forward, p.view],
        };
      });
    case "forward":
      return update(s, target(s, a), (p) => {
        if (p.forward.length === 0) return p;
        return {
          ...p,
          view: p.forward[p.forward.length - 1],
          back: [...p.back, p.view],
          forward: p.forward.slice(0, -1),
        };
      });
    case "openInOther": {
      if (s.panes.length === 1) return { ...s, panes: [s.panes[0], newPane(a.view)], lastUsed: 1 };
      const other = other_(s.lastUsed);
      return { ...update(s, other, (p) => navigate(p, a.view)), lastUsed: other };
    }
    case "focus":
      if (a.pane >= s.panes.length || a.pane === s.lastUsed) return s;
      return { ...s, lastUsed: a.pane };
    case "close": {
      if (s.panes.length === 1) return s;
      const closing = a.pane ?? s.lastUsed;
      return { ...s, panes: [s.panes[other_(closing)]], lastUsed: 0 };
    }
    case "swap":
      if (s.panes.length === 1) return s;
      return { panes: [s.panes[1], s.panes[0]], lastUsed: other_(s.lastUsed), ratio: 1 - s.ratio };
    case "setDocTab":
      return update(s, target(s, a), (p) => (p.docTab === a.tab ? p : { ...p, docTab: a.tab }));
    case "setSplitRatio":
      return update(s, target(s, a), (p) => ({ ...p, splitRatio: a.ratio }));
    case "setRatio":
      return { ...s, ratio: a.ratio };
    case "reset":
      return initialPanes();
    case "load":
      return a.state;
  }
}

/**
 * Which Panes are on screen in `width` CSS pixels. Two Panes need room for
 * the talk/Board split's minimum each (PLAN §22.4); below that only the
 * last-used one shows, and the other stays in state for when there is room.
 */
export function shownPanes(s: PanesState, width: number): PaneIndex[] {
  if (s.panes.length === 2 && splitFits(width)) return [0, 1];
  return [s.lastUsed];
}

/** The last-used Pane: what the side panel, the palette and Back act on. */
export function activePane(s: PanesState): Pane {
  return s.panes[s.lastUsed] ?? s.panes[0];
}

/**
 * The layout kept per Device and per Vault (spec #35): the two Panes' views,
 * the last-used one and the divider. Histories are not kept. A single Pane
 * saves nothing, so the app opens on Home as it always has.
 */
export interface SavedLayout {
  views: [View, View];
  lastUsed: PaneIndex;
  ratio: number;
}

export function savedLayout(s: PanesState): SavedLayout | null {
  if (s.panes.length !== 2) return null;
  return { views: [s.panes[0].view, s.panes[1].view], lastUsed: s.lastUsed, ratio: s.ratio };
}

const SIMPLE_KINDS = ["home", "library", "clippings", "map", "coverage", "timeline", "settings"];

/** A saved view, or Home when it names a document that is gone; null if it is not a view. */
function restoreView(raw: unknown, exists: (id: string) => boolean): View | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as { kind?: unknown; id?: unknown; focus?: unknown };
  if (typeof v.kind !== "string") return null;
  if (SIMPLE_KINDS.includes(v.kind)) return { kind: v.kind } as View;
  if (v.kind === "doc" && typeof v.id === "string") return exists(v.id) ? { kind: "doc", id: v.id } : HOME;
  if (v.kind === "graph") {
    if (v.focus === undefined) return { kind: "graph" };
    return typeof v.focus === "string" && exists(v.focus) ? { kind: "graph", focus: v.focus } : HOME;
  }
  return null;
}

/** Two Panes from a saved layout, or null when `raw` is not one. */
export function restoreLayout(raw: unknown, exists: (id: string) => boolean): PanesState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { views?: unknown; lastUsed?: unknown; ratio?: unknown };
  if (!Array.isArray(r.views) || r.views.length !== 2) return null;
  const a = restoreView(r.views[0], exists);
  const b = restoreView(r.views[1], exists);
  if (!a || !b) return null;
  const ratio = typeof r.ratio === "number" && r.ratio > 0 && r.ratio < 1 ? r.ratio : DEFAULT_RATIO;
  return { panes: [newPane(a), newPane(b)], lastUsed: r.lastUsed === 1 ? 1 : 0, ratio };
}
