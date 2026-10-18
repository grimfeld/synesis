import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BookOpenText,
  CalendarRange,
  ChevronRight,
  Hash,
  House,
  LayoutGrid,
  CopyX,
  Link2Off,
  MapPin,
  Plus,
  Quote,
  Search,
  Settings,
  LibraryBig,
  Waypoints,
} from "lucide-react";
import { cn } from "cn";
import {
  api,
  type AmbiguousTitle,
  type DocSummary,
  type DocType,
  type LibraryEntry,
} from "@/lib/api";
import {
  ancestorsOf,
  sourceFolders,
  UNSHELVED,
  type SourceFolder,
  type SourceNode,
} from "@/lib/library";
import { useQuery } from "@/lib/useQuery";
import { shortcut } from "@/lib/keys";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Kbd } from "@/components/ui/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TypeDot } from "./DocLink";

// Clipping is absent deliberately: it has no title to list, and it belongs to
// its Source rather than to a folder of its own (ADR 0013). Clippings are
// reached from their Source's Hub, the Clippings view, the Graph or search.
const ORDER: DocType[] = [
  "note",
  "composition",
  "source",
  "concept",
  "character",
  "place",
  "event",
];
const VIEWS = [
  { kind: "home", icon: House },
  { kind: "timeline", icon: CalendarRange },
  { kind: "coverage", icon: LayoutGrid },
  { kind: "graph", icon: Waypoints },
  { kind: "library", icon: LibraryBig },
  { kind: "clippings", icon: Quote },
  { kind: "map", icon: MapPin },
] as const;

export function AppSidebar() {
  const s = useStore();
  const t = useT();
  const [tab, setTab] = useState("documents");
  const { isMobile, setOpenMobile } = useSidebar();
  // On mobile the sidebar is a sheet over the page: close it once a pick changed the view.
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [s.view, isMobile, setOpenMobile]);
  const vaultName = s.info?.root.split(/[\\/]/).filter(Boolean).pop();

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-3 p-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookOpenText className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-sm leading-tight font-semibold"
              title={s.info?.root}
            >
              {vaultName}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {s.info ? t.documents(s.info.documents) : ""}
            </div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button
            data-testid="sidebar-search"
            variant="outline"
            size="sm"
            className="flex-1 justify-start font-normal text-muted-foreground"
            onClick={() => s.setDialog({ kind: "search" })}
          >
            <Search />
            <span className="flex-1 text-left">{t.search}</span>
            <Kbd>{shortcut("K")}</Kbd>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="sidebar-new"
                size="icon-sm"
                aria-label={t.new_doc}
                onClick={() => s.setDialog({ kind: "new" })}
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t.new_doc} <Kbd>{shortcut("N")}</Kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </SidebarHeader>

      <SidebarContent className="thin-scroll gap-0">
        <SidebarGroup className="py-1">
          <SidebarGroupLabel>{t.views_label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {VIEWS.map((v) => (
                <SidebarMenuItem key={v.kind}>
                  <SidebarMenuButton
                    data-testid={`nav-${v.kind}`}
                    isActive={s.view.kind === v.kind}
                    onClick={() => s.navigate({ kind: v.kind })}
                  >
                    <v.icon />
                    <span>{t.views[v.kind]}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Tabs value={tab} onValueChange={setTab} className="gap-0">
          <div className="px-3 pt-1 pb-1">
            <TabsList className="w-full">
              <TabsTrigger value="documents" className="flex-1 text-xs">
                {t.documents_tab}
              </TabsTrigger>
              <TabsTrigger value="tags" className="flex-1 text-xs">
                {t.tags_tab}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="documents">
            <DocumentsTab />
          </TabsContent>
          <TabsContent value="tags">
            <TagsTab />
          </TabsContent>
        </Tabs>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="nav-settings"
              isActive={s.view.kind === "settings"}
              onClick={() => s.navigate({ kind: "settings" })}
            >
              <Settings />
              <span>{t.views.settings}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function DocumentsTab() {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState<Record<string, boolean>>({
    note: true,
    composition: true,
    source: false,
    concept: true,
    character: false,
    place: false,
    event: false,
    scripture: false,
  });
  const byType = useMemo(() => {
    const m = new Map<DocType, DocSummary[]>();
    for (const d of s.docs) m.set(d.type, [...(m.get(d.type) ?? []), d]);
    for (const [, list] of m)
      list.sort((a, b) => a.title.localeCompare(b.title));
    return m;
  }, [s.docs]);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const active = s.view.kind === "doc" ? s.view.id : null;
  // Opening a Source from anywhere shows it here (§28.6): its group unfolds,
  // and the tree inside unfolds the rest of the way.
  const activeIsSource = !!active && byType.get("source")?.some((d) => d.id === active);
  useEffect(() => {
    if (activeIsSource) setOpen((o) => (o.source ? o : { ...o, source: true }));
  }, [active, activeIsSource]);
  return (
    <>
      {ORDER.map((type) => {
        const list = byType.get(type) ?? [];
        return (
          <CollapsibleGroup
            key={type}
            testId={`group-${type}`}
            open={!!open[type]}
            onToggle={() => toggle(type)}
            label={t.types_plural[type]}
            count={list.length}
            dot={<TypeDot type={type} />}
            action={
              <SidebarGroupAction
                className="top-2.5"
                title={t.new_type[type]}
                onClick={() => s.setDialog({ kind: "new", type })}
              >
                <Plus />
              </SidebarGroupAction>
            }
          >
            {type === "source" ? (
              <SourceTree activeId={active} />
            ) : (
            <SidebarMenu>
              {list.map((d) => (
                <SidebarMenuItem key={d.id}>
                  <SidebarMenuButton
                    data-testid="doc-item"
                    size="sm"
                    className="pl-8"
                    isActive={active === d.id}
                    onClick={() => s.openDoc(d.id)}
                    title={d.path}
                  >
                    <TypeDot type={d.type} className="ml-0.5" />
                    <span>{d.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            )}
          </CollapsibleGroup>
        );
      })}
      <ScriptureGroup
        open={!!open.scripture}
        onToggle={() => toggle("scripture")}
        openKeys={open}
        toggleKey={toggle}
        activeId={active}
      />
      <Unresolved />
      <AmbiguousTitles />
    </>
  );
}

/**
 * The Sources, on the Library's Shelves (PLAN §28.5–6): a folder per kind
 * that has any, then Unshelved, and each Source's parts beneath it. A parent
 * is a Source too, so its row opens it and only its chevron folds it.
 */
function SourceTree({ activeId }: { activeId: string | null }) {
  const t = useT();
  const { data } = useQuery<LibraryEntry[]>({
    key: ["sidebar-sources"],
    deps: { types: ["source"] },
    fetch: () => api.library(),
    quiet: true,
  });
  const entries = useMemo(() => data ?? [], [data]);
  const folders = useMemo(() => sourceFolders(entries), [entries]);
  // Everything starts folded; what is open is remembered per row.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  // Unfold the way to the open Source, so its row is always in sight.
  // Only adds: whatever else the reader unfolded stays as it was.
  useEffect(() => {
    if (!activeId) return;
    const folder = folders.find((f) => f.nodes.some((n) => holds(n, activeId)));
    if (!folder) return;
    const want = [`f:${folder.id}`, ...ancestorsOf(entries, activeId).map((a) => `s:${a.id}`)];
    setOpen((o) => (want.every((k) => o.has(k)) ? o : new Set([...o, ...want])));
  }, [activeId, entries, folders]);
  return (
    <SidebarMenu>
      {folders.map((f: SourceFolder) => {
        const key = `f:${f.id}`;
        const isOpen = open.has(key);
        return (
          <SidebarMenuItem key={f.id}>
            <SidebarMenuButton
              data-testid="source-folder"
              data-shelf={f.id}
              size="sm"
              className="pl-6"
              aria-expanded={isOpen}
              onClick={() => toggle(key)}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform",
                  isOpen && "rotate-90",
                )}
              />
              <span>{f.id === UNSHELVED ? t.shelf_unshelved : t.shelf_folders[f.id]}</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>{f.nodes.length}</SidebarMenuBadge>
            {isOpen && (
              <ul className="flex min-w-0 flex-col gap-0.5 py-0.5">
                {f.nodes.map((n) => (
                  <SourceRow key={n.entry.id} node={n} depth={1} open={open} toggle={toggle} activeId={activeId} />
                ))}
              </ul>
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

function holds(n: SourceNode, id: string): boolean {
  return n.entry.id === id || n.children.some((c) => holds(c, id));
}

function SourceRow({
  node,
  depth,
  open,
  toggle,
  activeId,
}: {
  node: SourceNode;
  depth: number;
  open: ReadonlySet<string>;
  toggle: (k: string) => void;
  activeId: string | null;
}) {
  const s = useStore();
  const t = useT();
  const key = `s:${node.entry.id}`;
  const isOpen = open.has(key);
  const parent = node.children.length > 0;
  return (
    <li className="min-w-0">
      {/* Indented by depth rather than by nested menus, whose borders and
          margins would eat a 16rem rail by the third level. */}
      <div className="flex min-w-0 items-center" style={{ paddingLeft: `${depth * 0.75 + 0.75}rem` }}>
        {parent ? (
          <button
            type="button"
            data-testid="source-node-toggle"
            aria-expanded={isOpen}
            aria-label={isOpen ? t.parts_hide : t.parts_show}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={() => toggle(key)}
          >
            <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <SidebarMenuButton
          data-testid="doc-item"
          size="sm"
          className="min-w-0 flex-1"
          isActive={activeId === node.entry.id}
          onClick={() => s.openDoc(node.entry.id)}
          title={node.entry.title}
        >
          <TypeDot type="source" className="ml-0.5" />
          <span>{node.entry.title}</span>
        </SidebarMenuButton>
      </div>
      {parent && isOpen && (
        <ul className="flex min-w-0 flex-col gap-0.5 pt-0.5">
          {node.children.map((c) => (
            <SourceRow key={c.entry.id} node={c} depth={depth + 1} open={open} toggle={toggle} activeId={activeId} />
          ))}
        </ul>
      )}
    </li>
  );
}

function TagsTab() {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, DocSummary[]>>({});
  const active = s.view.kind === "doc" ? s.view.id : null;
  const toggle = (tag: string) => {
    const next = open === tag ? null : tag;
    setOpen(next);
    if (next && !docs[next])
      api
        .taggedDocuments(next)
        .then((d) => setDocs((x) => ({ ...x, [next]: d })))
        .catch(console.error);
  };
  if (s.tags.length === 0)
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">{t.no_tags}</p>
    );
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupContent>
        <SidebarMenu>
          {s.tags.map((tg) => {
            const isOpen = open === tg.tag;
            return (
              <SidebarMenuItem key={tg.tag}>
                <SidebarMenuButton
                  data-testid="tag-item"
                  size="sm"
                  onClick={() => toggle(tg.tag)}
                  isActive={isOpen}
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 text-muted-foreground transition-transform",
                      isOpen && "rotate-90",
                    )}
                  />
                  <Hash className="size-3.5 text-tag" />
                  <span>{tg.tag}</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>{tg.count}</SidebarMenuBadge>
                {isOpen && (
                  <SidebarMenuSub className="mr-0 pr-0">
                    {(docs[tg.tag] ?? []).map((d) => (
                      <SidebarMenuSubItem key={d.id}>
                        <SidebarMenuSubButton
                          data-testid="tag-doc"
                          size="sm"
                          isActive={active === d.id}
                          onClick={() => s.openDoc(d.id)}
                          title={d.path}
                        >
                          <TypeDot type={d.type} />
                          <span>{d.label}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function CollapsibleGroup({
  open,
  onToggle,
  label,
  count,
  dot,
  action,
  children,
  testId,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  count?: number;
  dot?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onToggle}
      className="group/collapsible"
    >
      <SidebarGroup className="py-1">
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger
            data-testid={testId}
            className={cn(
              "w-full gap-2 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              action && "pr-8",
            )}
          >
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
            {dot}
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
            {count != null && (
              <span className="font-normal text-muted-foreground/80 tabular-nums">
                {count}
              </span>
            )}
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        {action}
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function ScriptureGroup({
  open,
  onToggle,
  openKeys,
  toggleKey,
  activeId,
}: {
  open: boolean;
  onToggle: () => void;
  openKeys: Record<string, boolean>;
  toggleKey: (k: string) => void;
  activeId: string | null;
}) {
  const s = useStore();
  const t = useT();
  const scripture = useMemo(() => {
    const books = new Map<
      number,
      {
        book: DocSummary | null;
        chapters: Map<
          number,
          { chapter: DocSummary | null; verses: DocSummary[] }
        >;
      }
    >();
    for (const d of s.docs) {
      if (
        d.book == null ||
        !(d.type === "book" || d.type === "chapter" || d.type === "verse")
      )
        continue;
      const b = books.get(d.book) ?? { book: null, chapters: new Map() };
      if (d.type === "book") b.book = d;
      else {
        const c = b.chapters.get(d.chapter!) ?? { chapter: null, verses: [] };
        if (d.type === "chapter") c.chapter = d;
        else c.verses.push(d);
        b.chapters.set(d.chapter!, c);
      }
      books.set(d.book, b);
    }
    return [...books.entries()].sort((a, b) => a[0] - b[0]);
  }, [s.docs]);

  return (
    <CollapsibleGroup
      testId="group-scripture"
      open={open}
      onToggle={onToggle}
      label={t.scripture}
      count={scripture.length}
      dot={<TypeDot type="verse" />}
    >
      <SidebarMenu>
        {scripture.map(([num, b]) => {
          const meta = s.books.find((x) => x.number === num);
          const key = `b${num}`;
          const bookOpen = !!openKeys[key];
          return (
            <SidebarMenuItem key={num}>
              <SidebarMenuButton
                data-testid="scripture-book"
                size="sm"
                onClick={() => toggleKey(key)}
                isActive={activeId != null && activeId === b.book?.id}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 text-muted-foreground transition-transform",
                    bookOpen && "rotate-90",
                  )}
                />
                <span
                  className="flex-1"
                  onClick={(e) => {
                    if (b.book) {
                      e.stopPropagation();
                      s.openDoc(b.book.id);
                    }
                  }}
                >
                  {meta?.name ?? num}
                </span>
              </SidebarMenuButton>
              <SidebarMenuBadge>{b.chapters.size}</SidebarMenuBadge>
              {bookOpen && (
                <SidebarMenuSub className="mr-0 pr-0">
                  {[...b.chapters.entries()]
                    .sort((x, y) => x[0] - y[0])
                    .map(([ch, c]) => (
                      <SidebarMenuSubItem key={ch}>
                        <SidebarMenuSubButton
                          size="sm"
                          isActive={
                            activeId != null && activeId === c.chapter?.id
                          }
                          onClick={() =>
                            c.chapter
                              ? s.openDoc(c.chapter.id)
                              : s.openScripture(num, ch)
                          }
                        >
                          <span className="flex-1">
                            {meta?.name} {ch}
                          </span>
                          {c.verses.length > 0 && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {c.verses.length}
                            </span>
                          )}
                        </SidebarMenuSubButton>
                        {c.verses.length > 0 && (
                          <div className="flex flex-wrap gap-0.5 py-1 pl-2">
                            {c.verses
                              .sort((x, y) => (x.verse ?? 0) - (y.verse ?? 0))
                              .map((v) => (
                                <Button
                                  key={v.id}
                                  variant={
                                    activeId === v.id ? "secondary" : "ghost"
                                  }
                                  size="xs"
                                  className="h-5 min-w-6 px-1 tabular-nums"
                                  onClick={() => s.openDoc(v.id)}
                                >
                                  {v.verse}
                                </Button>
                              ))}
                          </div>
                        )}
                      </SidebarMenuSubItem>
                    ))}
                </SidebarMenuSub>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </CollapsibleGroup>
  );
}

/**
 * Titles carried by more than one document.
 *
 * `resolve()` sends such a title to the shortest path without saying so, which
 * is tolerable for a link the user typed and not for one the app offers to
 * insert (ADR 0011). Listed beside unresolved links because both are ways a
 * link can go somewhere the writer did not mean.
 */
function AmbiguousTitles() {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AmbiguousTitle[] | null>(null);
  return (
    <CollapsibleGroup
      testId="group-ambiguous"
      open={open}
      onToggle={() => {
        setOpen(!open);
        if (!open) api.ambiguousTitles().then(setItems).catch(console.error);
      }}
      label={t.ambiguous_titles}
      count={items?.length}
      dot={<CopyX className="size-3.5 text-unresolved" />}
    >
      <SidebarMenu>
        {items?.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">—</div>
        )}
        {items?.map((a) => (
          <SidebarMenuItem key={a.title}>
            <div className="px-2 pt-1 pl-8 text-xs font-medium">{a.title}</div>
            {a.docs.map((dd) => (
              <SidebarMenuButton
                key={dd.id}
                data-testid="ambiguous-item"
                size="sm"
                className="pl-10"
                onClick={() => s.openDoc(dd.id)}
                title={dd.path}
              >
                <span className="truncate text-muted-foreground">
                  {dd.path}
                </span>
              </SidebarMenuButton>
            ))}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </CollapsibleGroup>
  );
}

function Unresolved() {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<
    { target: string; count: number }[] | null
  >(null);
  const load = async () => {
    const { namesApi } = await import("@/lib/api");
    const { NameIndex } = await import("@/lib/names");
    const [links, names] = await Promise.all([
      api.unresolvedLinks(),
      namesApi.names(),
    ]);
    const idx = new NameIndex(names);
    const tagMissing = s.tags
      .filter((tg) => !idx.has(tg.tag))
      .map((tg) => ({ target: tg.tag, count: tg.count }));
    const merged = new Map<string, number>();
    for (const x of [...links, ...tagMissing])
      merged.set(x.target, Math.max(merged.get(x.target) ?? 0, x.count));
    setItems(
      [...merged.entries()]
        .map(([target, count]) => ({ target, count }))
        .sort((a, b) => b.count - a.count),
    );
  };
  return (
    <CollapsibleGroup
      testId="group-unresolved"
      open={open}
      onToggle={() => {
        setOpen(!open);
        if (!open) load().catch(console.error);
      }}
      label={t.unresolved}
      count={items?.length}
      dot={<Link2Off className="size-3.5 text-unresolved" />}
    >
      <SidebarMenu>
        {items?.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">—</div>
        )}
        {items?.map((u) => (
          <SidebarMenuItem key={u.target}>
            <SidebarMenuButton
              data-testid="unresolved-item"
              size="sm"
              className="pl-8"
              onClick={() =>
                s.setDialog({ kind: "create-link", target: u.target })
              }
              title={t.create_page}
            >
              <span className="text-unresolved">{u.target}</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>{u.count}</SidebarMenuBadge>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </CollapsibleGroup>
  );
}
