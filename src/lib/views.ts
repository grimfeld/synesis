// The view registry (spec #145): every whole-pane view a Pane can be sent to,
// in one place. The sidebar's views list, the "Go to …" Commands and their ids
// in `knownCommandIds`, the kinds a saved Pane layout restores alone and
// `TutorialPlace`'s view kinds all derive from it.
import type { LucideIcon } from "lucide-react";
import { CalendarRange, House, LayoutGrid, LibraryBig, MapPin, Network, Quote, Settings, Waypoints } from "lucide-react";
import type { View } from "./panes";

/** A view a Pane can be sent to by name: every kind but a document, which needs an id. */
export type ViewKind = Exclude<View["kind"], "doc">;

/**
 * The kinds that are nothing but their kind, so a saved layout restores them
 * as they are. A kind that carries data (`graph`'s and `family-tree`'s focus) is restored by hand
 * in `panes.ts`. Computed from `View`, so it cannot fall out of step.
 */
export type SimpleKind = {
  [K in ViewKind]: Exclude<keyof Extract<View, { kind: K }>, "kind"> extends never ? K : never;
}[ViewKind];

export interface ViewEntry<K extends ViewKind = ViewKind> {
  icon: LucideIcon;
  /** Listed among the sidebar's views. Settings has its own place at the foot. */
  sidebar: boolean;
  /** Its place in the sidebar and among the "Go to …" Commands, lowest first. */
  order: number;
  /** Restored from a saved layout by its kind alone (see `SimpleKind`). */
  simple: K extends SimpleKind ? true : false;
}

/**
 * Every navigable view. A new whole-pane view is: a member of the `View`
 * union, an entry here, a case in the App's view switch (`PaneView`), its
 * `t.views.*` strings (en, fr) and its `tutorialsFor` case; the compiler fails
 * on each one left out. Beyond the compiler, it needs a Tutorial (CLAUDE.md →
 * Tutorials) and, when its labels are long, a `locales.cy.ts` case.
 */
export const VIEW_REGISTRY: { [K in ViewKind]: ViewEntry<K> } = {
  home: { icon: House, sidebar: true, order: 0, simple: true },
  timeline: { icon: CalendarRange, sidebar: true, order: 1, simple: true },
  coverage: { icon: LayoutGrid, sidebar: true, order: 2, simple: true },
  graph: { icon: Waypoints, sidebar: true, order: 3, simple: false },
  library: { icon: LibraryBig, sidebar: true, order: 4, simple: true },
  clippings: { icon: Quote, sidebar: true, order: 5, simple: true },
  map: { icon: MapPin, sidebar: true, order: 6, simple: true },
  // Last of the views: added after the others so their places stay put (#154).
  // It carries a focus (#155), so a saved layout restores it by hand, as `graph`.
  "family-tree": { icon: Network, sidebar: true, order: 7, simple: false },
  settings: { icon: Settings, sidebar: false, order: 8, simple: true },
};

/** Every navigable kind, in registry order. */
export const VIEW_KINDS: ViewKind[] = (Object.keys(VIEW_REGISTRY) as ViewKind[]).sort(
  (a, b) => VIEW_REGISTRY[a].order - VIEW_REGISTRY[b].order,
);

/** The kinds listed among the sidebar's views, in order. */
export const SIDEBAR_VIEWS: ViewKind[] = VIEW_KINDS.filter((k) => VIEW_REGISTRY[k].sidebar);

/** The Command id that goes to a view. */
export const navCommandId = (kind: ViewKind): string => `nav.${kind}`;

/** Whether a saved kind is one a layout restores by its kind alone. */
export function isSimpleKind(k: string): k is SimpleKind {
  return Object.hasOwn(VIEW_REGISTRY, k) && VIEW_REGISTRY[k as ViewKind].simple;
}
