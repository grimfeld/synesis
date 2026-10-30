// App-wide state: settings, the open vault, document summaries, navigation.
// The engine owns the truth; this is a mirror kept fresh by events.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  type BookMeta,
  type ChangedPayload,
  type DocSummary,
  type DocType,
  type DocumentPayload,
  type Frontmatter,
  type Lang,
  type PassageInfo,
  type PropertySchema,
  type PropertyType,
  type Settings,
  type SyncMethod,
  type TagCount,
  type VaultInfo,
} from "./api";
import { NO_FILTERS, type Filters } from "./timeline";
import { COLOR_BY, NO_MAP_FILTERS, type ColorBy, type CustomKind, type MapFilters } from "./map";
import { RELOAD_EVERYTHING } from "./query";
import {
  activePane,
  initialPanes,
  panesReducer,
  otherPane,
  restoreLayout,
  savedLayout,
  type ModifierClick,
  type PaneIndex,
  type DocTab,
  type PaneAction,
  type PanesState,
  type View,
} from "./panes";
import { flushPending } from "./pending";
import { closeOtherWindows, isSecondaryWindow, windowStart } from "./windows";
import { live } from "./live";
import {
  clampSize,
  DEFAULT_SIZE,
  newTimer,
  type TimerState,
} from "./delivery";

export type { DocTab, View } from "./panes";
export { otherPane } from "./panes";

/** The Delivery view: which Composition is being given (PLAN §23). */
export interface Delivery {
  id: string;
}

export type Dialog =
  | {
      kind: "new";
      type?: DocType;
      title?: string;
      body?: string;
      fields?: Record<string, string>;
    }
  | { kind: "quick" }
  | { kind: "search"; query?: string }
  | { kind: "goto-passage" }
  | { kind: "sync" }
  | { kind: "pairing-request"; node: string; name: string; platform: string }
  | { kind: "create-link"; target: string }
  | {
      kind: "version";
      id: string;
      frontier: string;
      label: string;
      /** Absent in Reading mode: the Version is read, not restored. */
      onRestore?: (text: string) => void;
    }
  | {
      kind: "set-location";
      id: string;
      onPick: (lat: number, lon: number, modernName: string | null) => void;
    }
  | { kind: "delete"; id: string }
  /** A multi-document write the user should see the extent of before it runs. */
  | {
      kind: "confirm";
      title: string;
      body: string;
      /** Named so the blast radius is visible, not just counted. */
      items: string[];
      confirmLabel: string;
      onConfirm: () => void;
    };

const SOURCE_MODE_KEY = "synesis.sourceMode";
const READING_MODE_KEY = "synesis.readingMode";
const DELIVERY_SIZE_KEY = "synesis.deliverySize";
/** The Pane layout, per Device (localStorage) and per Vault (its root). */
const PANES_KEY = (root: string) => `synesis.panes:${root}`;
/**
 * A secondary Window (issue #51) shares the Vault the main Window opened and
 * keeps its Panes to itself: it neither restores nor saves the Vault's layout.
 */
const SECONDARY_WINDOW = isSecondaryWindow();


interface Store {
  settings: Settings | null;
  lang: Lang;
  info: VaultInfo | null;
  docs: DocSummary[];
  docsById: Map<string, DocSummary>;
  books: BookMeta[];
  tags: TagCount[];
  /** Property schema of the open vault (built-ins until a vault is open). */
  schema: PropertySchema;
  announceChanged: (ids: string[]) => Promise<void>;
  /** The Vault's custom Place kinds (PLAN §27.4); the built-ins ship in `map.ts`. */
  placeKinds: CustomKind[];
  setPlaceKinds: (kinds: CustomKind[]) => Promise<void>;
  /** The Window's Panes (spec #35). `view`, Back and the split follow `lastUsed`. */
  panes: PanesState;
  dispatchPanes: (a: PaneAction) => void;
  /**
   * Whether two Panes fit side by side right now (spec #35). Never on a
   * phone; set by the Pane layout, which measures the room it has.
   */
  twoPanesFit: boolean;
  setTwoPanesFit: (b: boolean) => void;
  /** Open a view in the other Pane, or in this one where two do not fit. */
  openInOther: (v: View) => void;
  /** The view in the last-used Pane. */
  view: View;
  canBack: boolean;
  canForward: boolean;
  dialog: Dialog | null;
  changeTick: number;
  lastChange: ChangedPayload | null;
  sidebarOpen: boolean;
  panelOpen: boolean;
  sourceMode: boolean;
  /**
   * Reading mode: the Device's lock on every Writing (PLAN §23.3-5). Kept in
   * `localStorage`, so each Device keeps its own.
   */
  readingMode: boolean;
  /** The Delivery view, when it is open (PLAN §23.7). */
  delivery: Delivery | null;
  /** The Delivery view's text size, in CSS pixels, per Device (§23.11). */
  deliverySize: number;
  /** The Delivery view's timer. Lives here so leaving the view keeps it (§23.10). */
  deliveryTimer: TimerState;
  /** The Timeline's filters (PLAN §17.5): here, not in the view, so that a
   *  round-trip to a Hub and back does not lose them. */
  timelineFilters: Filters;
  setTimelineFilters: (f: Filters) => void;
  mapFilters: MapFilters;
  setMapFilters: (f: MapFilters) => void;
  /**
   * Which face of a Composition is showing: the talk, the Board, or both side
   * by side (PLAN §22). Store state rather than a route, so Back to a
   * Composition returns to the same face (PLAN §17.9).
   */
  docTab: DocTab;
  /** The talk's share of the width when split. Session-only (PLAN §22.4). */
  splitRatio: number;
  openVault: (path?: string) => Promise<void>;
  /** The engine already opened a vault (pairing join): mirror it into the store without reopening. */
  attachVault: () => Promise<void>;
  closeVault: () => Promise<void>;
  /**
   * Before the engine changes the Vault (open, close, leave, move): every
   * other Window saves and closes, then every document here saves and lets
   * go, so no save lands in the next Vault. Not in a secondary Window, which
   * cannot change the Vault (spec #35).
   */
  releaseVault: () => Promise<void>;
  /** A secondary Window (spec #35): it shows the main Window's Vault and cannot change it. */
  secondaryWindow: boolean;
  refresh: () => Promise<unknown>;
  navigate: (v: View) => void;
  back: () => void;
  forward: () => void;
  /** `other`: in the other Pane (Cmd/Ctrl-click, spec #35). */
  openDoc: (id: string, other?: boolean) => void;
  openLink: (target: string, other?: boolean) => Promise<void>;
  /** A click handler opening `id`: in the other Pane on Cmd/Ctrl-click (spec #35). */
  openDocOnClick: (id: string) => (e: ModifierClick) => void;
  /** A click handler following a link: in the other Pane on Cmd/Ctrl-click. */
  openLinkOnClick: (target: string) => (e: ModifierClick) => void;
  openPassage: (p: PassageInfo) => Promise<void>;
  openScripture: (
    book: number,
    chapter?: number,
    verse?: number,
  ) => Promise<void>;
  createDoc: (
    type: DocType,
    title: string,
    fields?: Frontmatter,
    body?: string,
    open?: boolean,
  ) => Promise<DocumentPayload>;
  /**
   * "Duplicate as new Composition" (PLAN §14.8): copy the talk and its Board
   * under `title`, announce it the way `createDoc` does, and open the copy.
   */
  duplicateComposition: (id: string, title: string) => Promise<DocumentPayload>;
  setDialog: (d: Dialog | null) => void;
  setLang: (l: Lang) => Promise<void>;
  setSyncMethod: (m: SyncMethod | null) => Promise<void>;
  setSidebarOpen: (b: boolean) => void;
  setPanelOpen: (b: boolean) => void;
  setSourceMode: (b: boolean) => void;
  setReadingMode: (b: boolean) => void;
  openDelivery: (id: string) => void;
  closeDelivery: () => void;
  setDeliverySize: (px: number) => void;
  setDeliveryTimer: (t: TimerState) => void;
  setDocTab: (tab: DocTab) => void;
  setSplitRatio: (r: number) => void;
  /**
   * A Board was saved. Candidates and Board refs depend on it, and with the
   * talk beside the Board they are on screen while it changes (PLAN §22.8).
   */
  announceBoardSaved: () => void;
  /** Declare or change a Property name's type, vault-wide. */
  setPropertyType: (name: string, t: PropertyType) => Promise<void>;
}

const BUILTIN_SCHEMA: PropertySchema = {
  types: {
    aliases: "list",
    born: "date",
    characters: "list",
    cover: "text",
    created: "calendar",
    date: "calendar",
    died: "date",
    duration: "number",
    end: "date",
    kind: "text",
    lat: "number",
    locator: "text",
    lon: "number",
    modern_name: "text",
    occasion: "text",
    parent: "link",
    place: "link",
    places: "list",
    source: "link",
    start: "date",
    url: "text",
  },
};

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("store missing");
  return s;
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, b: boolean) {
  try {
    localStorage.setItem(key, b ? "1" : "0");
  } catch {
    /* preference only */
  }
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readDeliverySize(): number {
  try {
    const n = Number(localStorage.getItem(DELIVERY_SIZE_KEY));
    return n ? clampSize(n) : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
}

function readSourceMode(): boolean {
  try {
    return localStorage.getItem(SOURCE_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [panes, dispatchPanes] = useReducer(panesReducer, undefined, initialPanes);
  const pane = activePane(panes);
  const [twoPanesFit, setTwoPanesFit] = useState(false);
  // The Vault whose layout the Panes show: nothing is saved between a reset
  // and the restore, or switching Vaults would wipe the one being left.
  const layoutFor = useRef<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [changeTick, setChangeTick] = useState(0);
  const [lastChange, setLastChange] = useState<ChangedPayload | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 900);
  const [timelineFilters, setTimelineFiltersState] =
    useState<Filters>(NO_FILTERS);
  const [mapFilters, setMapFiltersState] =
    useState<MapFilters>(NO_MAP_FILTERS);
  const [panelOpen, setPanelOpen] = useState(window.innerWidth >= 1100);
  const [sourceMode, setSourceModeState] = useState(readSourceMode);
  const [readingMode, setReadingModeState] = useState(() =>
    readFlag(READING_MODE_KEY),
  );
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [deliverySize, setDeliverySizeState] = useState(readDeliverySize);
  const [deliveryTimer, setDeliveryTimerState] = useState<TimerState>(
    () => newTimer(null),
  );
  // The talk/Board split belongs to each Pane (spec #35).
  const setDocTab = useCallback((tab: DocTab) => dispatchPanes({ type: "setDocTab", tab }), []);
  const setSplitRatio = useCallback((ratio: number) => dispatchPanes({ type: "setSplitRatio", ratio }), []);
  const booted = useRef(false);

  const lang: Lang = settings?.lang ?? "en";

  const [schema, setSchema] = useState<PropertySchema>(BUILTIN_SCHEMA);
  const [placeKinds, setPlaceKindsState] = useState<CustomKind[]>([]);

  const refresh = useCallback(async () => {
    const [d, t, i, sc, pk] = await Promise.all([
      api.listDocuments(),
      api.tags(),
      api.vaultInfo(),
      api.propertySchema(),
      api.placeKinds().catch(() => [] as CustomKind[]),
    ]);
    setDocs(d);
    setTags(t);
    setInfo(i);
    setSchema(sc);
    setPlaceKindsState(pk);
    return { docs: d, info: i };
  }, []);

  const setPlaceKinds = useCallback(async (kinds: CustomKind[]) => {
    await api.setPlaceKinds(kinds);
    setPlaceKindsState(await api.placeKinds());
  }, []);

  const setPropertyType = useCallback(async (name: string, t: PropertyType) => {
    setSchema(await api.setPropertyType(name, t));
  }, []);

  const releaseVault = useCallback(async () => {
    if (SECONDARY_WINDOW) throw new Error("the Vault is changed in the main Window");
    await closeOtherWindows();
    await flushPending();
    await live.suspend();
  }, []);

  const openVault = useCallback(
    async (path?: string) => {
      await releaseVault();
      await api.openVault(path);
      const [settings, books] = await Promise.all([
        api.getSettings(),
        api.books(),
      ]);
      // Navigation resets first: once `info` is set the shell renders and the user may click.
      layoutFor.current = null;
      dispatchPanes({ type: "reset" });
      setSettings(settings);
      setBooks(books);
      const { docs, info } = await refresh();
      // Two Panes left open come back as they were (spec #35); one Pane opens on Home.
      const ids = new Set(docs.map((d) => d.id));
      const restored = restoreLayout(readJson(PANES_KEY(info.root)), (id) => ids.has(id));
      if (restored) dispatchPanes({ type: "load", state: restored });
      layoutFor.current = info.root;
    },
    [refresh, releaseVault],
  );

  const attachVault = useCallback(async () => {
    const [i, settings, books] = await Promise.all([api.vaultInfo(), api.getSettings(), api.books()]);
    layoutFor.current = null;
    dispatchPanes({ type: "reset" });
    setSettings(settings);
    setBooks(books);
    await refresh();
    setInfo(i);
    layoutFor.current = i.root;
  }, [refresh]);

  const closeVault = useCallback(async () => {
    await releaseVault();
    await api.closeVault();
    setInfo(null);
    setDocs([]);
    setSettings(await api.getSettings());
  }, [releaseVault]);

  // A save refreshes the lists (titles, tags, counts).
  useEffect(() => live.onSaved(() => void refresh().catch(console.error)), [refresh]);

  // Boot: load settings, reopen the last vault.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const s = await api.getSettings();
      setSettings(s);
      if (SECONDARY_WINDOW) {
        // The engine already holds the Vault: show it, on the document this
        // Window was opened for.
        try {
          await attachVault();
          const start = await windowStart();
          if (start) dispatchPanes({ type: "open", view: { kind: "doc", id: start } });
        } catch (e) {
          console.error("attach failed", e);
        }
        return;
      }
      if (s.vault_path) {
        try {
          await openVault(s.vault_path);
        } catch (e) {
          console.error("reopen failed", e);
        }
      }
    })();
  }, [openVault, attachVault]);

  // External changes.
  useEffect(() => {
    let un: (() => void) | undefined;
    api
      .onVaultChanged((p) => {
        setLastChange(p);
        setChangeTick((n) => n + 1);
        refresh().catch(console.error);
      })
      .then((u) => (un = u));
    return () => un?.();
  }, [refresh]);

  // A Paired Device sent its Property schema (ADR 0016).
  useEffect(() => {
    let un: (() => void) | undefined;
    api
      .onConfigChanged((names) => {
        if (names.includes("properties.json")) api.propertySchema().then(setSchema).catch(console.error);
        if (names.includes("place-kinds.json")) api.placeKinds().then(setPlaceKindsState).catch(console.error);
      })
      .then((u) => (un = u))
      .catch(() => {});
    return () => un?.();
  }, []);

  const navigate = useCallback((v: View) => {
    dispatchPanes({ type: "open", view: v });
    if (window.innerWidth < 900) setSidebarOpen(false);
  }, []);

  const back = useCallback(() => dispatchPanes({ type: "back" }), []);
  const forward = useCallback(() => dispatchPanes({ type: "forward" }), []);

  // On a phone, or wherever two Panes do not fit, "the other Pane" is this one:
  // a Cmd/Ctrl-click opens as a plain click would (spec #35).
  const openInOther = useCallback(
    (v: View) => {
      if (!twoPanesFit) return navigate(v);
      dispatchPanes({ type: "openInOther", view: v });
    },
    [navigate, twoPanesFit],
  );

  const openDoc = useCallback(
    (id: string, other = false) => (other ? openInOther : navigate)({ kind: "doc", id }),
    [navigate, openInOther],
  );

  const openLink = useCallback(
    async (target: string, other = false) => {
      const d = await api.resolveLink(target);
      if (d) openDoc(d.id, other);
      else setDialog({ kind: "create-link", target });
    },
    [openDoc],
  );

  const openScripture = useCallback(
    async (book: number, chapter?: number, verse?: number) => {
      const d = await api.ensureScripturePage(book, chapter, verse);
      await refresh();
      openDoc(d.id);
    },
    [openDoc, refresh],
  );

  const openPassage = useCallback(
    async (p: PassageInfo) => {
      if (p.unit === "book") return openScripture(p.book);
      if (p.unit === "chapter") return openScripture(p.book, p.start_chapter);
      return openScripture(p.book, p.start_chapter, p.start_verse ?? 1);
    },
    [openScripture],
  );

  const createDoc = useCallback(
    async (
      type: DocType,
      title: string,
      fields?: Frontmatter,
      body?: string,
      open = true,
    ) => {
      const d = await api.createDocument(type, title, fields, body);
      await refresh();
      // A new document changes what other pages show — a parent Source's
      // Contains list, a reading trail, the Library — and none of those are
      // derived from `docs`, so they need telling. Announced the same way the
      // engine announces a change from disk, so a query that cares about this
      // type refetches and the rest are left alone.
      setLastChange({ changed: [d.summary], removed: [] });
      setChangeTick((n) => n + 1);
      if (open) openDoc(d.summary.id);
      return d;
    },
    [openDoc, refresh],
  );

  const duplicateComposition = useCallback(
    async (id: string, title: string) => {
      // The editor and the Board save on a debounce; the copy is read from
      // disk, so whatever is still waiting lands first.
      await flushPending();
      const d = await api.duplicateComposition(id, title);
      await refresh();
      // A new Composition, announced like any other new document, so Home's
      // "in progress" list and the Candidates of what it shares refetch.
      setLastChange({ changed: [d.summary], removed: [] });
      setChangeTick((n) => n + 1);
      openDoc(d.summary.id);
      return d;
    },
    [openDoc, refresh],
  );

  /**
   * Tell the queries that these documents were rewritten by a batch the app
   * ran itself (filling in Place kinds, PLAN §27.13). The engine's own event
   * does not reach the dev bridge or the web build, where events are stubbed.
   */
  const announceChanged = useCallback(async (ids: string[]) => {
    const fresh = await api.listDocuments();
    setDocs(fresh);
    const byId = new Map(fresh.map((d) => [d.id, d]));
    setLastChange({ changed: ids.map((id) => byId.get(id)).filter((d): d is DocSummary => !!d), removed: [] });
    setChangeTick((n) => n + 1);
  }, []);

  const announceBoardSaved = useCallback(() => {
    // A Board is not a document: the Composition's own text and mtime are
    // untouched, so naming it in `changed` would read as an edit to its text
    // and could reload the editor. An empty change reaches exactly the queries
    // that depend on anything (`deps: { any: true }`), which is where Board
    // refs show up — the Candidates panel. The engine's own event would not
    // reach the dev bridge or the web build, where events are stubbed.
    setLastChange({ changed: [], removed: [] });
  }, []);

  const setLang = useCallback(async (l: Lang) => {
    await api.setLanguage(l);
    setSettings(await api.getSettings());
    setBooks(await api.books());
    // The engine renders Passage displays and Book names in the Device's
    // language, so every answer it has already given is now in the wrong one.
    // Nothing in the vault changed, so this is the one case that asks every
    // query to look again.
    setLastChange({ changed: [], removed: [RELOAD_EVERYTHING] });
    setChangeTick((n) => n + 1);
  }, []);

  const setSyncMethod = useCallback(async (m: SyncMethod | null) => {
    await api.setSyncMethod(m);
    setSettings(await api.getSettings());
  }, []);

  // The type chips and the viewport cull are preferences, so they come back from
  // settings; the Tag, Property and search filters deliberately start empty.
  // Seeded once, not on every settings change: a later refresh carries the value
  // this session started with and would undo the filter the user just set.
  const seededFilters = useRef(false);
  useEffect(() => {
    if (!settings || seededFilters.current) return;
    seededFilters.current = true;
    setTimelineFiltersState((f) => ({
      ...f,
      hiddenTypes: settings.timeline_hidden_types ?? [],
      inView: settings.timeline_in_view ?? true,
    }));
    // The Map splits the same way (PLAN §19.13): Books and mentioned-ness are
    // preferences, Tag chips and the search start empty.
    setMapFiltersState((f) => ({
      ...f,
      books: settings.map_books ?? [],
      mentionedOnly: settings.map_mentioned_only ?? false,
      colorBy: COLOR_BY.includes(settings.map_color_by as ColorBy)
        ? (settings.map_color_by as ColorBy)
        : "kind",
    }));
  }, [settings]);

  const setTimelineFilters = useCallback((f: Filters) => {
    setTimelineFiltersState((prev) => {
      if (
        prev.inView !== f.inView ||
        prev.hiddenTypes.join() !== f.hiddenTypes.join()
      )
        api.setTimelineFilters(f.hiddenTypes, f.inView).catch(console.error);
      return f;
    });
  }, []);

  const setMapFilters = useCallback((f: MapFilters) => {
    setMapFiltersState((prev) => {
      if (
        prev.mentionedOnly !== f.mentionedOnly ||
        prev.books.join() !== f.books.join() ||
        prev.colorBy !== f.colorBy
      )
        api.setMapFilters(f.books, f.mentionedOnly, f.colorBy).catch(console.error);
      return f;
    });
  }, []);

  const setReadingMode = useCallback((b: boolean) => {
    setReadingModeState(b);
    writeFlag(READING_MODE_KEY, b);
  }, []);

  // The Delivery view opens on the face that was showing (§23.12), and the
  // timer belongs to the Composition it was started for: opening another
  // Composition's view starts a fresh one, re-opening the same keeps it.
  const openDelivery = useCallback((id: string) => {
    setDelivery({ id });
    setDeliveryTimerState((t) => (t.for === id ? t : newTimer(id)));
  }, []);
  const closeDelivery = useCallback(() => setDelivery(null), []);
  const setDeliverySize = useCallback((px: number) => {
    const n = clampSize(px);
    setDeliverySizeState(n);
    try {
      localStorage.setItem(DELIVERY_SIZE_KEY, String(n));
    } catch {
      /* preference only */
    }
  }, []);
  const setDeliveryTimer = useCallback((t: TimerState) => {
    setDeliveryTimerState(t);
  }, []);

  const setSourceMode = useCallback((b: boolean) => {
    setSourceModeState(b);
    try {
      localStorage.setItem(SOURCE_MODE_KEY, b ? "1" : "0");
    } catch {
      /* preference only */
    }
  }, []);

  // Keep the layout for the next time this Vault opens on this Device.
  const vaultRoot = info?.root;
  useEffect(() => {
    if (SECONDARY_WINDOW || !vaultRoot || layoutFor.current !== vaultRoot) return;
    const saved = savedLayout(panes);
    try {
      if (saved) localStorage.setItem(PANES_KEY(vaultRoot), JSON.stringify(saved));
      else localStorage.removeItem(PANES_KEY(vaultRoot));
    } catch {
      /* preference only */
    }
  }, [panes, vaultRoot]);

  const openDocOnClick = useCallback(
    (id: string) => (e: ModifierClick) => openDoc(id, otherPane(e)),
    [openDoc],
  );
  const openLinkOnClick = useCallback(
    (target: string) => (e: ModifierClick) => void openLink(target, otherPane(e)).catch(console.error),
    [openLink],
  );

  const docsById = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);

  const value: Store = {
    settings,
    lang,
    info,
    docs,
    docsById,
    books,
    tags,
    schema,
    placeKinds,
    setPlaceKinds,
    announceChanged,
    panes,
    dispatchPanes,
    twoPanesFit,
    setTwoPanesFit,
    openInOther,
    view: pane.view,
    canBack: pane.back.length > 0,
    canForward: pane.forward.length > 0,
    dialog,
    changeTick,
    lastChange,
    sidebarOpen,
    timelineFilters,
    mapFilters,
    panelOpen,
    sourceMode,
    readingMode,
    delivery,
    deliverySize,
    deliveryTimer,
    docTab: pane.docTab,
    splitRatio: pane.splitRatio,
    openVault,
    attachVault,
    closeVault,
    releaseVault,
    secondaryWindow: SECONDARY_WINDOW,
    refresh,
    navigate,
    back,
    forward,
    openDoc,
    openLink,
    openDocOnClick,
    openLinkOnClick,
    openPassage,
    openScripture,
    createDoc,
    duplicateComposition,
    setDialog,
    setLang,
    setSyncMethod,
    setSidebarOpen,
    setTimelineFilters,
    setMapFilters,
    setPanelOpen,
    setSourceMode,
    setReadingMode,
    openDelivery,
    closeDelivery,
    setDeliverySize,
    setDeliveryTimer,
    setDocTab,
    setSplitRatio,
    announceBoardSaved,
    setPropertyType,
  };
  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

/** Which Pane a subtree is drawn in, and how it stands (spec #35). */
export interface PaneInfo {
  index: PaneIndex;
  /** The last-used Pane: the side panel, the palette and Back follow it. */
  active: boolean;
  /** Two Panes are on screen. */
  two: boolean;
}

const PaneContext = createContext<PaneInfo>({ index: 0, active: true, two: false });

export function usePane(): PaneInfo {
  return useContext(PaneContext);
}

/**
 * Draw `children` as Pane `index`: within it the store's view, history and
 * talk/Board split are that Pane's, and its Back, Forward and split act on it.
 * Everything else, navigation included, follows the last-used Pane, which a
 * press or a key inside the Pane makes this one.
 */
export function PaneScope({ index, two, children }: { index: PaneIndex; two: boolean; children: ReactNode }) {
  const s = useStore();
  const p = s.panes.panes[index] ?? activePane(s.panes);
  const { dispatchPanes } = s;
  const scoped: Store = {
    ...s,
    view: p.view,
    canBack: p.back.length > 0,
    canForward: p.forward.length > 0,
    docTab: p.docTab,
    splitRatio: p.splitRatio,
    back: () => dispatchPanes({ type: "back", pane: index }),
    forward: () => dispatchPanes({ type: "forward", pane: index }),
    setDocTab: (tab) => dispatchPanes({ type: "setDocTab", tab, pane: index }),
    setSplitRatio: (ratio) => dispatchPanes({ type: "setSplitRatio", ratio, pane: index }),
  };
  const info = useMemo(() => ({ index, active: s.panes.lastUsed === index, two }), [index, s.panes.lastUsed, two]);
  return (
    <StoreContext.Provider value={scoped}>
      <PaneContext.Provider value={info}>{children}</PaneContext.Provider>
    </StoreContext.Provider>
  );
}
