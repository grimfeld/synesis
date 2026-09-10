import { useMemo, useState, type ReactNode } from "react";
import { BookOpenText, ChevronRight, LayoutGrid, Link2Off, MapPin, Plus, Search, Settings, Waypoints } from "lucide-react";
import { cn } from "cn";
import type { DocSummary, DocType } from "@/lib/api";
import { shortcut } from "@/lib/keys";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TypeDot } from "./DocLink";

const ORDER: DocType[] = ["note", "clipping", "composition", "source", "concept", "character", "place"];
const VIEWS = [
  { kind: "coverage", icon: LayoutGrid },
  { kind: "graph", icon: Waypoints },
  { kind: "map", icon: MapPin },
] as const;

export function AppSidebar() {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState<Record<string, boolean>>({ note: true, clipping: false, composition: true, source: false, concept: true, character: false, place: false, scripture: false });
  const byType = useMemo(() => {
    const m = new Map<DocType, DocSummary[]>();
    for (const d of s.docs) m.set(d.type, [...(m.get(d.type) ?? []), d]);
    for (const [, list] of m) list.sort((a, b) => a.title.localeCompare(b.title));
    return m;
  }, [s.docs]);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const active = s.view.kind === "doc" ? s.view.id : null;
  const vaultName = s.info?.root.split(/[\\/]/).filter(Boolean).pop();

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-3 p-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookOpenText className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm leading-tight font-semibold" title={s.info?.root}>
              {vaultName}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">{s.info ? t.documents(s.info.documents) : ""}</div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="flex-1 justify-start font-normal text-muted-foreground" onClick={() => s.setDialog({ kind: "search" })}>
            <Search />
            <span className="flex-1 text-left">{t.search}</span>
            <Kbd>{shortcut("K")}</Kbd>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" aria-label={t.new_doc} onClick={() => s.setDialog({ kind: "new" })}>
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
                  <SidebarMenuButton isActive={s.view.kind === v.kind} onClick={() => s.navigate({ kind: v.kind })}>
                    <v.icon />
                    <span>{t.views[v.kind]}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {ORDER.map((type) => {
          const list = byType.get(type) ?? [];
          return (
            <CollapsibleGroup
              key={type}
              open={!!open[type]}
              onToggle={() => toggle(type)}
              label={t.types_plural[type]}
              count={list.length}
              dot={<TypeDot type={type} />}
              action={
                <SidebarGroupAction className="top-2.5" title={`${t.new} ${t.types[type]}`} onClick={() => s.setDialog({ kind: "new", type })}>
                  <Plus />
                </SidebarGroupAction>
              }
            >
              <SidebarMenu>
                {list.map((d) => (
                  <SidebarMenuItem key={d.id}>
                    <SidebarMenuButton size="sm" className="pl-8" isActive={active === d.id} onClick={() => s.openDoc(d.id)} title={d.path}>
                      <TypeDot type={d.type} className="ml-0.5" />
                      <span>{d.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </CollapsibleGroup>
          );
        })}

        <ScriptureGroup open={!!open.scripture} onToggle={() => toggle("scripture")} openKeys={open} toggleKey={toggle} activeId={active} />
        <Unresolved />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={s.view.kind === "settings"} onClick={() => s.navigate({ kind: "settings" })}>
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

function CollapsibleGroup({ open, onToggle, label, count, dot, action, children }: { open: boolean; onToggle: () => void; label: string; count?: number; dot?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Collapsible open={open} onOpenChange={onToggle} className="group/collapsible">
      <SidebarGroup className="py-1">
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className={cn("w-full gap-2 hover:bg-sidebar-accent hover:text-sidebar-foreground", action && "pr-8")}>
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
            {dot}
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
            {count != null && <span className="font-normal text-muted-foreground/80 tabular-nums">{count}</span>}
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

function ScriptureGroup({ open, onToggle, openKeys, toggleKey, activeId }: { open: boolean; onToggle: () => void; openKeys: Record<string, boolean>; toggleKey: (k: string) => void; activeId: string | null }) {
  const s = useStore();
  const t = useT();
  const scripture = useMemo(() => {
    const books = new Map<number, { book: DocSummary | null; chapters: Map<number, { chapter: DocSummary | null; verses: DocSummary[] }> }>();
    for (const d of s.docs) {
      if (d.book == null || !(d.type === "book" || d.type === "chapter" || d.type === "verse")) continue;
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
    <CollapsibleGroup open={open} onToggle={onToggle} label={t.scripture} count={scripture.length} dot={<TypeDot type="verse" />}>
      <SidebarMenu>
        {scripture.map(([num, b]) => {
          const meta = s.books.find((x) => x.number === num);
          const key = `b${num}`;
          const bookOpen = !!openKeys[key];
          return (
            <SidebarMenuItem key={num}>
              <SidebarMenuButton size="sm" onClick={() => toggleKey(key)} isActive={activeId != null && activeId === b.book?.id}>
                <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", bookOpen && "rotate-90")} />
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
                        <SidebarMenuSubButton size="sm" isActive={activeId != null && activeId === c.chapter?.id} onClick={() => (c.chapter ? s.openDoc(c.chapter.id) : s.openScripture(num, ch))}>
                          <span className="flex-1">
                            {meta?.name} {ch}
                          </span>
                          {c.verses.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{c.verses.length}</span>}
                        </SidebarMenuSubButton>
                        {c.verses.length > 0 && (
                          <div className="flex flex-wrap gap-0.5 py-1 pl-2">
                            {c.verses
                              .sort((x, y) => (x.verse ?? 0) - (y.verse ?? 0))
                              .map((v) => (
                                <Button key={v.id} variant={activeId === v.id ? "secondary" : "ghost"} size="xs" className="h-5 min-w-6 px-1 tabular-nums" onClick={() => s.openDoc(v.id)}>
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

function Unresolved() {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ target: string; count: number }[] | null>(null);
  const load = async () => {
    const { api, namesApi } = await import("@/lib/api");
    const { NameIndex } = await import("@/lib/names");
    const [links, names] = await Promise.all([api.unresolvedLinks(), namesApi.names()]);
    const idx = new NameIndex(names);
    const tagMissing = s.tags.filter((tg) => !idx.has(tg.tag)).map((tg) => ({ target: tg.tag, count: tg.count }));
    const merged = new Map<string, number>();
    for (const x of [...links, ...tagMissing]) merged.set(x.target, Math.max(merged.get(x.target) ?? 0, x.count));
    setItems([...merged.entries()].map(([target, count]) => ({ target, count })).sort((a, b) => b.count - a.count));
  };
  return (
    <CollapsibleGroup
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
        {items?.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">—</div>}
        {items?.map((u) => (
          <SidebarMenuItem key={u.target}>
            <SidebarMenuButton size="sm" className="pl-8" onClick={() => s.setDialog({ kind: "create-link", target: u.target })} title={t.create_page}>
              <span className="text-unresolved">{u.target}</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>{u.count}</SidebarMenuBadge>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </CollapsibleGroup>
  );
}
