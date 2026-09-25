// App-wide state: settings, the open vault, document summaries, navigation.
// The engine owns the truth; this is a mirror kept fresh by events.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import { NO_MAP_FILTERS, type MapFilters } from "./map";
import { RELOAD_EVERYTHING } from "./query";

export type View =
  | { kind: "home" }
  | { kind: "doc"; id: string }
  | { kind: "graph" }
  | { kind: "library" }
  | { kind: "clippings" }
  | { kind: "map" }
  | { kind: "coverage" }
  | { kind: "timeline" }
  | { kind: "settings" };

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
      onRestore: (text: string) => void;
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
  view: View;
  canBack: boolean;
  canForward: boolean;
  dialog: Dialog | null;
  changeTick: number;
  lastChange: ChangedPayload | null;
  sidebarOpen: boolean;
  panelOpen: boolean;
  sourceMode: boolean;
  /** The Timeline's filters (PLAN §17.5): here, not in the view, so that a
   *  round-trip to a Hub and back does not lose them. */
  timelineFilters: Filters;
  setTimelineFilters: (f: Filters) => void;
  mapFilters: MapFilters;
  setMapFilters: (f: MapFilters) => void;
  /**
   * Which face of a Composition is showing. Store state rather than a route,
   * so the later split pane can show both at once (PLAN §17.9).
   */
  docTab: "talk" | "board";
  openVault: (path?: string) => Promise<void>;
  /** The engine already opened a vault (pairing join): mirror it into the store without reopening. */
  attachVault: () => Promise<void>;
  closeVault: () => Promise<void>;
  refresh: () => Promise<void>;
  navigate: (v: View) => void;
  back: () => void;
  forward: () => void;
  openDoc: (id: string) => void;
  openLink: (target: string) => Promise<void>;
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
  setDialog: (d: Dialog | null) => void;
  setLang: (l: Lang) => Promise<void>;
  setSyncMethod: (m: SyncMethod | null) => Promise<void>;
  setSidebarOpen: (b: boolean) => void;
  setPanelOpen: (b: boolean) => void;
  setSourceMode: (b: boolean) => void;
  setDocTab: (tab: "talk" | "board") => void;
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
  const [view, setView] = useState<View>({ kind: "home" });
  const [history, setHistory] = useState<{ back: View[]; forward: View[] }>({
    back: [],
    forward: [],
  });
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
  // A Board belongs to the Composition being read, so opening another
  // document starts on its text rather than on the Board of the last one.
  const [docTab, setDocTab] = useState<"talk" | "board">("talk");
  const viewRef = useRef(view);
  viewRef.current = view;
  const booted = useRef(false);

  const lang: Lang = settings?.lang ?? "en";

  const [schema, setSchema] = useState<PropertySchema>(BUILTIN_SCHEMA);

  const refresh = useCallback(async () => {
    const [d, t, i, sc] = await Promise.all([
      api.listDocuments(),
      api.tags(),
      api.vaultInfo(),
      api.propertySchema(),
    ]);
    setDocs(d);
    setTags(t);
    setInfo(i);
    setSchema(sc);
  }, []);

  const setPropertyType = useCallback(async (name: string, t: PropertyType) => {
    setSchema(await api.setPropertyType(name, t));
  }, []);

  const openVault = useCallback(
    async (path?: string) => {
      await api.openVault(path);
      const [settings, books] = await Promise.all([
        api.getSettings(),
        api.books(),
      ]);
      // Navigation resets first: once `info` is set the shell renders and the user may click.
      setView({ kind: "home" });
      setHistory({ back: [], forward: [] });
      setSettings(settings);
      setBooks(books);
      await refresh();
    },
    [refresh],
  );

  const attachVault = useCallback(async () => {
    const [i, settings, books] = await Promise.all([api.vaultInfo(), api.getSettings(), api.books()]);
    setView({ kind: "home" });
    setHistory({ back: [], forward: [] });
    setSettings(settings);
    setBooks(books);
    await refresh();
    setInfo(i);
  }, [refresh]);

  const closeVault = useCallback(async () => {
    await api.closeVault();
    setInfo(null);
    setDocs([]);
    setSettings(await api.getSettings());
  }, []);

  // Boot: load settings, reopen the last vault.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const s = await api.getSettings();
      setSettings(s);
      if (s.vault_path) {
        try {
          await openVault(s.vault_path);
        } catch (e) {
          console.error("reopen failed", e);
        }
      }
    })();
  }, [openVault]);

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
      })
      .then((u) => (un = u))
      .catch(() => {});
    return () => un?.();
  }, []);

  const navigate = useCallback((v: View) => {
    setHistory((h) => ({
      back: [...h.back.slice(-49), viewRef.current],
      forward: [],
    }));
    setView(v);
    if (window.innerWidth < 900) setSidebarOpen(false);
  }, []);

  const back = useCallback(() => {
    setHistory((h) => {
      if (h.back.length === 0) return h;
      const target = h.back[h.back.length - 1];
      setView(target);
      return {
        back: h.back.slice(0, -1),
        forward: [...h.forward, viewRef.current],
      };
    });
  }, []);

  const forward = useCallback(() => {
    setHistory((h) => {
      if (h.forward.length === 0) return h;
      const target = h.forward[h.forward.length - 1];
      setView(target);
      return {
        back: [...h.back, viewRef.current],
        forward: h.forward.slice(0, -1),
      };
    });
  }, []);

  const openDoc = useCallback(
    (id: string) => navigate({ kind: "doc", id }),
    [navigate],
  );

  const openLink = useCallback(
    async (target: string) => {
      const d = await api.resolveLink(target);
      if (d) openDoc(d.id);
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
        prev.books.join() !== f.books.join()
      )
        api.setMapFilters(f.books, f.mentionedOnly).catch(console.error);
      return f;
    });
  }, []);

  const setSourceMode = useCallback((b: boolean) => {
    setSourceModeState(b);
    try {
      localStorage.setItem(SOURCE_MODE_KEY, b ? "1" : "0");
    } catch {
      /* preference only */
    }
  }, []);

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
    view,
    canBack: history.back.length > 0,
    canForward: history.forward.length > 0,
    dialog,
    changeTick,
    lastChange,
    sidebarOpen,
    timelineFilters,
    mapFilters,
    panelOpen,
    sourceMode,
    docTab,
    openVault,
    attachVault,
    closeVault,
    refresh,
    navigate,
    back,
    forward,
    openDoc,
    openLink,
    openPassage,
    openScripture,
    createDoc,
    setDialog,
    setLang,
    setSyncMethod,
    setSidebarOpen,
    setTimelineFilters,
    setMapFilters,
    setPanelOpen,
    setSourceMode,
    setDocTab,
    setPropertyType,
  };
  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}
