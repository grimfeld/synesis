import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, namesApi, CREATABLE_TYPES, type DocSummary, type DocType, type Frontmatter, type SearchHit, type NameEntry } from "@/lib/api";
import { NameIndex } from "@/lib/names";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Field, Modal } from "./Modal";
import { TypeDot } from "./DocLink";

export function Dialogs() {
  const s = useStore();
  const d = s.dialog;
  if (!d) return null;
  const close = () => s.setDialog(null);
  switch (d.kind) {
    case "new":
      return <NewDocument type={d.type} title={d.title} body={d.body} onClose={close} />;
    case "quick":
      return <QuickCapture onClose={close} />;
    case "search":
      return <Search onClose={close} />;
    case "create-link":
      return <CreateLink target={d.target} onClose={close} />;
    case "delete":
      return <ConfirmDelete id={d.id} onClose={close} />;
    case "rename":
      return <Rename id={d.id} onClose={close} />;
  }
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
export function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

/** Picker over existing documents of some types, with free text fallback. */
function DocPicker({ types, value, onChange, placeholder }: { types: DocType[]; value: string; onChange: (v: string, doc?: DocSummary) => void; placeholder?: string }) {
  const s = useStore();
  const list = useMemo(() => s.docs.filter((d) => types.includes(d.type)), [s.docs, types]);
  const [focus, setFocus] = useState(false);
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    return list.filter((d) => !q || d.title.toLowerCase().includes(q)).slice(0, 8);
  }, [list, value]);
  return (
    <div className="relative">
      <input className="w-full" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
      {focus && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border shadow-lg" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
          {matches.map((d) => (
            <li key={d.id}>
              <button type="button" className="row-hover flex w-full items-center px-2 py-1 text-left text-sm" onMouseDown={() => onChange(d.title, d)}>
                <TypeDot type={d.type} />
                {d.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewDocument({ type: initial, title: initialTitle, body: initialBody, onClose }: { type?: DocType; title?: string; body?: string; onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const [type, setType] = useState<DocType>(initial ?? "note");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [body, setBody] = useState(initialBody ?? "");
  const [f, setF] = useState<Record<string, string>>({ kind: "article" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const fetchMeta = async () => {
    if (!f.url) return;
    setBusy(true);
    try {
      const existing = await api.findSourceByUrl(f.url);
      if (existing) {
        set("source", existing.title);
        set("source_id", existing.id);
        if (type === "source") setTitle(existing.title);
      } else {
        const m = await api.fetchUrlMetadata(f.url);
        if (type === "source") {
          if (m.title) setTitle(m.title);
          if (m.author) set("author", m.author);
          if (m.date) set("date", m.date);
          if (m.site) set("site", m.site);
        } else {
          if (m.title) set("source", m.title);
          if (m.author) set("author", m.author);
          if (m.date) set("date", m.date);
          if (m.site) set("site", m.site);
          set("source_id", "");
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fields: Frontmatter = {};
      let finalTitle = title.trim();
      if (type === "clipping") {
        // Source: existing by title, or create from URL metadata.
        let sourceTitle = f.source?.trim();
        if (sourceTitle) {
          const existing = f.source_id ? s.docsById.get(f.source_id) : (await api.resolveLink(sourceTitle)) ?? undefined;
          if (existing) sourceTitle = existing.title;
          else {
            const created = await s.createDoc("source", sourceTitle, { kind: f.kind || "article", author: f.author ?? "", url: f.url ?? "", date: f.date ?? "" }, "", false);
            sourceTitle = created.summary.title;
          }
          fields.source = `[[${sourceTitle}]]`;
        }
        if (f.locator) fields.locator = f.locator;
        if (!finalTitle) finalTitle = (sourceTitle ? sourceTitle + " – " : "") + (body.trim().slice(0, 48) || stamp());
      } else if (type === "source") {
        fields.kind = f.kind || "article";
        if (f.author) fields.author = f.author;
        if (f.url) fields.url = f.url;
        if (f.date) fields.date = f.date;
        if (f.parent) fields.parent = `[[${f.parent}]]`;
      } else if (type === "place") {
        if (f.lat) fields.lat = Number(f.lat);
        if (f.lon) fields.lon = Number(f.lon);
      } else if (type === "note") {
        if (f.source) fields.source = `[[${f.source}]]`;
      } else if (type === "composition") {
        if (f.occasion) fields.occasion = f.occasion;
        if (f.date) fields.date = f.date;
      }
      if (!finalTitle) finalTitle = type === "note" ? stamp() : t.untitled;
      await s.createDoc(type, finalTitle, fields, body);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const kinds = Object.keys(t.kinds) as (keyof typeof t.kinds)[];

  return (
    <Modal title={`${t.new} · ${t.types[type]}`} onClose={onClose} wide={type === "clipping"}>
      <form onSubmit={submit}>
        <div className="mb-3 flex flex-wrap gap-1">
          {CREATABLE_TYPES.map((x) => (
            <button type="button" key={x} className={`btn btn-sm ${type === x ? "btn-primary" : ""}`} onClick={() => setType(x)}>
              <TypeDot type={x} />
              {t.types[x]}
            </button>
          ))}
        </div>
        <Field label={t.title}>
          <input ref={titleRef} className="w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === "clipping" || type === "note" ? "(optional)" : ""} />
        </Field>
        {type === "clipping" && (
          <>
            <Field label={t.clipping_text}>
              <textarea className="w-full" rows={6} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
            </Field>
            <Field label={t.clipping_url}>
              <div className="flex gap-2">
                <input className="flex-1" value={f.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="https://" />
                <button type="button" className="btn" onClick={fetchMeta} disabled={busy || !f.url}>
                  {t.fetch_metadata}
                </button>
              </div>
            </Field>
            <Field label={t.source}>
              <DocPicker types={["source"]} value={f.source ?? ""} onChange={(v, d) => { set("source", v); set("source_id", d?.id ?? ""); }} placeholder={t.source_existing + " / " + t.source_new} />
            </Field>
            {!f.source_id && f.source && (
              <div className="mb-3 grid grid-cols-3 gap-2">
                <Field label={t.kind}>
                  <select className="w-full" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {t.kinds[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t.author}>
                  <input className="w-full" value={f.author ?? ""} onChange={(e) => set("author", e.target.value)} />
                </Field>
                <Field label={t.date}>
                  <input className="w-full" value={f.date ?? ""} onChange={(e) => set("date", e.target.value)} placeholder="2026-09-08" />
                </Field>
              </div>
            )}
            <Field label={t.locator}>
              <input className="w-full" value={f.locator ?? ""} onChange={(e) => set("locator", e.target.value)} placeholder="par. 12 · p. 4 · 14:32" />
            </Field>
          </>
        )}
        {type === "source" && (
          <>
            <Field label={t.url}>
              <div className="flex gap-2">
                <input className="flex-1" value={f.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="https://" />
                <button type="button" className="btn" onClick={fetchMeta} disabled={busy || !f.url}>
                  {t.fetch_metadata}
                </button>
              </div>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label={t.kind}>
                <select className="w-full" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {t.kinds[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.author}>
                <input className="w-full" value={f.author ?? ""} onChange={(e) => set("author", e.target.value)} />
              </Field>
              <Field label={t.date}>
                <input className="w-full" value={f.date ?? ""} onChange={(e) => set("date", e.target.value)} />
              </Field>
            </div>
            <Field label={t.parent_source}>
              <DocPicker types={["source"]} value={f.parent ?? ""} onChange={(v) => set("parent", v)} />
            </Field>
          </>
        )}
        {type === "note" && (
          <Field label={t.source}>
            <DocPicker types={["source"]} value={f.source ?? ""} onChange={(v) => set("source", v)} placeholder="(optional)" />
          </Field>
        )}
        {type === "composition" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Occasion">
              <input className="w-full" value={f.occasion ?? ""} onChange={(e) => set("occasion", e.target.value)} />
            </Field>
            <Field label={t.date}>
              <input className="w-full" value={f.date ?? ""} onChange={(e) => set("date", e.target.value)} />
            </Field>
          </div>
        )}
        {type === "place" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label={t.lat}>
              <input className="w-full" value={f.lat ?? ""} onChange={(e) => set("lat", e.target.value)} placeholder="31.7683" />
            </Field>
            <Field label={t.lon}>
              <input className="w-full" value={f.lon ?? ""} onChange={(e) => set("lon", e.target.value)} placeholder="35.2137" />
            </Field>
          </div>
        )}
        {error && <div className="mb-2 text-sm" style={{ color: "var(--danger)" }}>{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t.create}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function QuickCapture({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const [text, setText] = useState("");
  const submit = async () => {
    if (!text.trim()) return onClose();
    await s.createDoc("note", stamp(), {}, text.trim() + "\n");
    onClose();
  };
  return (
    <Modal title={t.quick_capture} onClose={onClose}>
      <p className="muted mb-2 text-sm">{t.quick_capture_hint}</p>
      <textarea
        className="mb-3 w-full"
        rows={6}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      />
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          {t.cancel}
        </button>
        <button className="btn btn-primary" onClick={submit}>
          {t.create} ⌘↵
        </button>
      </div>
    </Modal>
  );
}

function Search({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [names, setNames] = useState<NameIndex>(() => new NameIndex());
  const [sel, setSel] = useState(0);
  useEffect(() => {
    namesApi.names().then((n) => setNames(new NameIndex(n))).catch(console.error);
  }, []);
  useEffect(() => {
    if (!q.trim()) return setHits([]);
    let alive = true;
    const h = window.setTimeout(() => api.search(q, 20).then((r) => alive && setHits(r)).catch(console.error), 120);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [q]);
  const titleHits: NameEntry[] = useMemo(() => (q.trim() ? names.suggest(q, 6) : []), [q, names]);
  const rows: { id: string; title: string; type: DocType; detail: string }[] = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; title: string; type: DocType; detail: string }[] = [];
    for (const n of titleHits) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ id: n.id, title: n.name, type: n.type, detail: n.alias ? "alias" : "" });
    }
    for (const h of hits) {
      if (seen.has(h.doc.id)) continue;
      seen.add(h.doc.id);
      out.push({ id: h.doc.id, title: h.doc.title, type: h.doc.type, detail: h.snippet });
    }
    return out;
  }, [titleHits, hits]);
  useEffect(() => setSel(0), [rows.length]);
  const go = (i: number) => {
    const r = rows[i];
    if (r) {
      s.openDoc(r.id);
      onClose();
    }
  };
  return (
    <Modal onClose={onClose} wide>
      <input
        className="mb-2 w-full text-base"
        autoFocus
        placeholder={t.search_placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((x) => Math.min(rows.length - 1, x + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((x) => Math.max(0, x - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (rows.length) go(sel);
            else if (q.trim()) {
              s.setDialog({ kind: "new", title: q.trim() });
            }
          }
        }}
      />
      <ul className="thin-scroll max-h-[50vh] overflow-auto">
        {rows.map((r, i) => (
          <li key={r.id}>
            <button className="flex w-full items-start rounded px-2 py-1.5 text-left" style={i === sel ? { background: "var(--accent-soft)" } : undefined} onMouseEnter={() => setSel(i)} onClick={() => go(i)}>
              <TypeDot type={r.type} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{r.title}</span>
                {r.detail && <span className="muted ml-2 text-xs" dangerouslySetInnerHTML={{ __html: r.detail.replace(/</g, "&lt;").replace(/\[([^\]]+)\]/g, "<mark>$1</mark>") }} />}
              </span>
            </button>
          </li>
        ))}
        {q.trim() && rows.length === 0 && (
          <li className="muted px-2 py-2 text-sm">
            ↵ {t.create} “{q.trim()}”
          </li>
        )}
      </ul>
    </Modal>
  );
}

function CreateLink({ target, onClose }: { target: string; onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const [type, setType] = useState<DocType>("concept");
  const title = target.replace(/-/g, " ");
  return (
    <Modal title={`${t.create_page} · ${title}`} onClose={onClose}>
      <div className="mb-4 flex flex-wrap gap-1">
        {CREATABLE_TYPES.map((x) => (
          <button key={x} className={`btn btn-sm ${type === x ? "btn-primary" : ""}`} onClick={() => setType(x)}>
            <TypeDot type={x} />
            {t.types[x]}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          {t.cancel}
        </button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await s.createDoc(type, title);
            onClose();
          }}
        >
          {t.create}
        </button>
      </div>
    </Modal>
  );
}

function ConfirmDelete({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const doc = s.docsById.get(id);
  return (
    <Modal onClose={onClose}>
      <p className="mb-4">{t.confirm_delete(doc?.title ?? "")}</p>
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          {t.cancel}
        </button>
        <button
          className="btn btn-danger"
          onClick={async () => {
            await api.deleteDocument(id);
            await s.refresh();
            onClose();
            s.back();
          }}
        >
          {t.delete}
        </button>
      </div>
    </Modal>
  );
}

function Rename({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const doc = s.docsById.get(id);
  const [title, setTitle] = useState(doc?.title ?? "");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim() && title.trim() !== doc?.title) {
      await api.renameDocument(id, title.trim());
      await s.refresh();
      s.navigate({ kind: "doc", id });
    }
    onClose();
  };
  return (
    <Modal title={t.rename} onClose={onClose}>
      <form onSubmit={submit}>
        <input className="mb-3 w-full" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.target.select()} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="btn btn-primary">
            {t.rename}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export async function pickFolder(): Promise<string | null> {
  const dir = await openDialog({ directory: true, multiple: false });
  return typeof dir === "string" ? dir : null;
}
