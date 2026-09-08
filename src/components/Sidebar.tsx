import { useMemo, useState } from "react";
import { CREATABLE_TYPES, type DocSummary, type DocType } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { DocLink, TypeDot } from "./DocLink";

const ORDER: DocType[] = ["note", "clipping", "composition", "source", "concept", "character", "place"];

export function Sidebar() {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState<Record<string, boolean>>({ note: true, clipping: false, composition: true, source: false, concept: true, character: false, place: false, scripture: false });
  const byType = useMemo(() => {
    const m = new Map<DocType, DocSummary[]>();
    for (const d of s.docs) m.set(d.type, [...(m.get(d.type) ?? []), d]);
    for (const [, list] of m) list.sort((a, b) => a.title.localeCompare(b.title));
    return m;
  }, [s.docs]);
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
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const active = s.view.kind === "doc" ? s.view.id : null;

  const NavBtn = ({ kind, label, icon }: { kind: "coverage" | "graph" | "map" | "settings"; label: string; icon: string }) => (
    <button className={`btn btn-ghost btn-sm flex-1 ${s.view.kind === kind ? "font-semibold" : ""}`} style={s.view.kind === kind ? { background: "var(--bg-3)" } : undefined} onClick={() => s.navigate({ kind })} title={label}>
      <span className="mr-1">{icon}</span>
      <span className="hidden xl:inline">{label}</span>
    </button>
  );

  return (
    <aside className="thin-scroll flex w-64 shrink-0 flex-col overflow-y-auto border-r" style={{ borderColor: "var(--border)", background: "var(--bg-2)" }}>
      <div className="sticky top-0 z-10 border-b p-2" style={{ background: "var(--bg-2)", borderColor: "var(--border)" }}>
        <div className="mb-2 flex items-center gap-1">
          <button className="btn btn-ghost btn-sm" onClick={() => s.setSidebarOpen(false)} title="Hide">
            ☰
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-semibold" title={s.info?.root}>
            {s.info?.root.split("/").pop()}
          </div>
        </div>
        <div className="mb-2 flex gap-1">
          <button className="btn flex-1" onClick={() => s.setDialog({ kind: "search" })}>
            🔍 {t.search}
          </button>
          <button className="btn btn-primary" onClick={() => s.setDialog({ kind: "new" })} title="⌘N">
            + {t.new}
          </button>
        </div>
        <div className="flex gap-1">
          <NavBtn kind="coverage" label={t.views.coverage} icon="▦" />
          <NavBtn kind="graph" label={t.views.graph} icon="◉" />
          <NavBtn kind="map" label={t.views.map} icon="⌖" />
          <NavBtn kind="settings" label={t.views.settings} icon="⚙" />
        </div>
      </div>
      <div className="p-1">
        {ORDER.map((type) => {
          const list = byType.get(type) ?? [];
          return (
            <div key={type} className="mb-1">
              <button className="panel-title flex w-full items-center justify-between rounded px-2 py-1 row-hover" onClick={() => toggle(type)}>
                <span className="flex items-center">
                  <TypeDot type={type} />
                  {t.types_plural[type]}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-normal">{list.length}</span>
                  <span
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      s.setDialog({ kind: "new", type });
                    }}
                    title={`${t.new} ${t.types[type]}`}
                  >
                    +
                  </span>
                </span>
              </button>
              {open[type] && (
                <ul>
                  {list.map((d) => (
                    <li key={d.id}>
                      <DocLink doc={d} className={active === d.id ? "font-semibold" : ""} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <div className="mb-1">
          <button className="panel-title flex w-full items-center justify-between rounded px-2 py-1 row-hover" onClick={() => toggle("scripture")}>
            <span className="flex items-center">
              <TypeDot type="verse" />
              {t.scripture}
            </span>
            <span className="font-normal">{scripture.length}</span>
          </button>
          {open.scripture && (
            <ul>
              {scripture.map(([num, b]) => {
                const meta = s.books.find((x) => x.number === num);
                const key = `b${num}`;
                return (
                  <li key={num}>
                    <button className="row-hover flex w-full items-center rounded px-2 py-1 text-left" onClick={() => toggle(key)}>
                      <span className="muted mr-1 w-3 text-xs">{open[key] ? "▾" : "▸"}</span>
                      <span className="flex-1 truncate" onClick={(e) => { if (b.book) { e.stopPropagation(); s.openDoc(b.book.id); } }}>
                        {meta?.name ?? num}
                      </span>
                      <span className="muted text-xs">{b.chapters.size}</span>
                    </button>
                    {open[key] && (
                      <ul className="ml-4">
                        {[...b.chapters.entries()]
                          .sort((x, y) => x[0] - y[0])
                          .map(([ch, c]) => (
                            <li key={ch}>
                              <button className="row-hover flex w-full items-center rounded px-2 py-0.5 text-left text-sm" onClick={() => (c.chapter ? s.openDoc(c.chapter.id) : s.openScripture(num, ch))}>
                                <span className="flex-1">{meta?.name} {ch}</span>
                                {c.verses.length > 0 && <span className="muted text-xs">{c.verses.length}</span>}
                              </button>
                              {c.verses.length > 0 && (
                                <div className="ml-3 flex flex-wrap gap-1 pb-1">
                                  {c.verses
                                    .sort((x, y) => (x.verse ?? 0) - (y.verse ?? 0))
                                    .map((v) => (
                                      <button key={v.id} className={`btn btn-ghost btn-sm ${active === v.id ? "font-semibold" : ""}`} onClick={() => s.openDoc(v.id)}>
                                        {v.verse}
                                      </button>
                                    ))}
                                </div>
                              )}
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <Unresolved />
      </div>
      <div className="muted mt-auto p-3 text-xs">{CREATABLE_TYPES.length && s.info ? t.documents(s.info.documents) : ""}</div>
    </aside>
  );
}

function Unresolved() {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ target: string; count: number }[]>([]);
  const load = async () => {
    const { api } = await import("@/lib/api");
    const { namesApi } = await import("@/lib/api");
    const { NameIndex } = await import("@/lib/names");
    const [links, names] = await Promise.all([api.unresolvedLinks(), namesApi.names()]);
    const idx = new NameIndex(names);
    const tagMissing = s.tags.filter((tg) => !idx.has(tg.tag)).map((tg) => ({ target: tg.tag, count: tg.count }));
    const merged = new Map<string, number>();
    for (const x of [...links, ...tagMissing]) merged.set(x.target, Math.max(merged.get(x.target) ?? 0, x.count));
    setItems([...merged.entries()].map(([target, count]) => ({ target, count })).sort((a, b) => b.count - a.count));
  };
  return (
    <div className="mb-1">
      <button
        className="panel-title flex w-full items-center justify-between rounded px-2 py-1 row-hover"
        onClick={() => {
          setOpen(!open);
          if (!open) load().catch(console.error);
        }}
      >
        <span>{t.unresolved}</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul>
          {items.map((u) => (
            <li key={u.target}>
              <button className="row-hover flex w-full items-center rounded px-2 py-1 text-left text-sm" onClick={() => s.setDialog({ kind: "create-link", target: u.target })}>
                <span className="min-w-0 flex-1 truncate" style={{ color: "var(--unresolved)" }}>
                  {u.target}
                </span>
                <span className="muted text-xs">{u.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
