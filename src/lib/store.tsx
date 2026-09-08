// App-wide state: settings, the open vault, document summaries, navigation.
// The engine owns the truth; this is a mirror kept fresh by events.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type BookMeta, type ChangedPayload, type DocSummary, type DocType, type DocumentPayload, type Frontmatter, type Lang, type PassageInfo, type Settings, type TagCount, type VaultInfo } from "./api";

export type View =
  | { kind: "doc"; id: string }
  | { kind: "graph" }
  | { kind: "map" }
  | { kind: "coverage" }
  | { kind: "settings" };

export type Dialog =
  | { kind: "new"; type?: DocType; title?: string; body?: string }
  | { kind: "quick" }
  | { kind: "search" }
  | { kind: "create-link"; target: string }
  | { kind: "delete"; id: string }
  | { kind: "rename"; id: string };

interface Store {
  settings: Settings | null;
  lang: Lang;
  info: VaultInfo | null;
  docs: DocSummary[];
  docsById: Map<string, DocSummary>;
  books: BookMeta[];
  tags: TagCount[];
  view: View;
  dialog: Dialog | null;
  changeTick: number;
  lastChange: ChangedPayload | null;
  sidebarOpen: boolean;
  panelOpen: boolean;
  openVault: (path?: string) => Promise<void>;
  closeVault: () => Promise<void>;
  refresh: () => Promise<void>;
  navigate: (v: View) => void;
  back: () => void;
  openDoc: (id: string) => void;
  openLink: (target: string) => Promise<void>;
  openPassage: (p: PassageInfo) => Promise<void>;
  openScripture: (book: number, chapter?: number, verse?: number) => Promise<void>;
  createDoc: (type: DocType, title: string, fields?: Frontmatter, body?: string, open?: boolean) => Promise<DocumentPayload>;
  setDialog: (d: Dialog | null) => void;
  setLang: (l: Lang) => Promise<void>;
  setSidebarOpen: (b: boolean) => void;
  setPanelOpen: (b: boolean) => void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("store missing");
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [view, setView] = useState<View>({ kind: "coverage" });
  const [, setHistory] = useState<View[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [changeTick, setChangeTick] = useState(0);
  const [lastChange, setLastChange] = useState<ChangedPayload | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 900);
  const [panelOpen, setPanelOpen] = useState(window.innerWidth >= 1100);
  const viewRef = useRef(view);
  viewRef.current = view;

  const lang: Lang = settings?.lang ?? "en";

  const refresh = useCallback(async () => {
    const [d, t, i] = await Promise.all([api.listDocuments(), api.tags(), api.vaultInfo()]);
    setDocs(d);
    setTags(t);
    setInfo(i);
  }, []);

  const openVault = useCallback(
    async (path?: string) => {
      const i = await api.openVault(path);
      setInfo(i);
      setSettings(await api.getSettings());
      setBooks(await api.books());
      await refresh();
      setView({ kind: "coverage" });
      setHistory([]);
    },
    [refresh],
  );

  const closeVault = useCallback(async () => {
    await api.closeVault();
    setInfo(null);
    setDocs([]);
    setSettings(await api.getSettings());
  }, []);

  // Boot: load settings, reopen the last vault.
  useEffect(() => {
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
    api.onVaultChanged((p) => {
      setLastChange(p);
      setChangeTick((n) => n + 1);
      refresh().catch(console.error);
    }).then((u) => (un = u));
    return () => un?.();
  }, [refresh]);

  const navigate = useCallback((v: View) => {
    setHistory((h) => [...h.slice(-49), viewRef.current]);
    setView(v);
    if (window.innerWidth < 900) setSidebarOpen(false);
  }, []);

  const back = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      setView(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  const openDoc = useCallback((id: string) => navigate({ kind: "doc", id }), [navigate]);

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
    async (type: DocType, title: string, fields?: Frontmatter, body?: string, open = true) => {
      const d = await api.createDocument(type, title, fields, body);
      await refresh();
      if (open) openDoc(d.summary.id);
      return d;
    },
    [openDoc, refresh],
  );

  const setLang = useCallback(async (l: Lang) => {
    await api.setLanguage(l);
    setSettings(await api.getSettings());
    setBooks(await api.books());
    setChangeTick((n) => n + 1);
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
    view,
    dialog,
    changeTick,
    lastChange,
    sidebarOpen,
    panelOpen,
    openVault,
    closeVault,
    refresh,
    navigate,
    back,
    openDoc,
    openLink,
    openPassage,
    openScripture,
    createDoc,
    setDialog,
    setLang,
    setSidebarOpen,
    setPanelOpen,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
