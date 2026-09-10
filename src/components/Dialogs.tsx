import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Globe, Plus } from "lucide-react";
import { cn } from "cn";
import { api, namesApi, CREATABLE_TYPES, type DocSummary, type DocType, type Frontmatter, type SearchHit, type NameEntry } from "@/lib/api";
import { NameIndex } from "@/lib/names";
import { shortcut } from "@/lib/keys";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field } from "./Field";
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

/** A modal shell: always open while mounted, closes through onClose. */
function Shell({ title, description, wide, onClose, children }: { title: string; description?: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(wide && "sm:max-w-2xl")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function TypePicker({ value, onChange }: { value: DocType; onChange: (t: DocType) => void }) {
  const t = useT();
  return (
    <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v as DocType)} variant="outline" size="sm" spacing={1} className="flex-wrap justify-start">
      {CREATABLE_TYPES.map((x) => (
        <ToggleGroupItem key={x} value={x} className="gap-1.5 data-[state=on]:bg-accent">
          <TypeDot type={x} />
          {t.types[x]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
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
      <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
      {focus && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          {matches.map((d) => (
            <li key={d.id}>
              <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent" onMouseDown={() => onChange(d.title, d)}>
                <TypeDot type={d.type} />
                <span className="truncate">{d.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KindSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const kinds = Object.keys(t.kinds) as (keyof typeof t.kinds)[];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {kinds.map((k) => (
          <SelectItem key={k} value={k}>
            {t.kinds[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
          const existing = f.source_id ? s.docsById.get(f.source_id) : ((await api.resolveLink(sourceTitle)) ?? undefined);
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

  const urlField = (
    <Field label={type === "source" ? t.url : t.clipping_url}>
      <div className="flex gap-2">
        <Input className="flex-1" value={f.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="https://" />
        <Button type="button" variant="outline" onClick={fetchMeta} disabled={busy || !f.url}>
          <Globe />
          {t.fetch_metadata}
        </Button>
      </div>
    </Field>
  );
  const sourceMeta = (
    <div className="grid grid-cols-3 gap-3">
      <Field label={t.kind}>
        <KindSelect value={f.kind} onChange={(v) => set("kind", v)} />
      </Field>
      <Field label={t.author}>
        <Input value={f.author ?? ""} onChange={(e) => set("author", e.target.value)} />
      </Field>
      <Field label={t.date}>
        <Input value={f.date ?? ""} onChange={(e) => set("date", e.target.value)} placeholder="2026-09-08" />
      </Field>
    </div>
  );

  return (
    <Shell title={`${t.new} · ${t.types[type]}`} onClose={onClose} wide={type === "clipping"}>
      <form onSubmit={submit} className="grid gap-4">
        <TypePicker value={type} onChange={setType} />
        <Field label={t.title}>
          <Input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === "clipping" || type === "note" ? "(optional)" : ""} />
        </Field>
        {type === "clipping" && (
          <>
            <Field label={t.clipping_text}>
              <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} autoFocus className="font-prose" />
            </Field>
            {urlField}
            <Field label={t.source}>
              <DocPicker
                types={["source"]}
                value={f.source ?? ""}
                onChange={(v, d) => {
                  set("source", v);
                  set("source_id", d?.id ?? "");
                }}
                placeholder={t.source_existing + " / " + t.source_new}
              />
            </Field>
            {!f.source_id && f.source && sourceMeta}
            <Field label={t.locator}>
              <Input value={f.locator ?? ""} onChange={(e) => set("locator", e.target.value)} placeholder="par. 12 · p. 4 · 14:32" />
            </Field>
          </>
        )}
        {type === "source" && (
          <>
            {urlField}
            {sourceMeta}
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Occasion">
              <Input value={f.occasion ?? ""} onChange={(e) => set("occasion", e.target.value)} />
            </Field>
            <Field label={t.date}>
              <Input value={f.date ?? ""} onChange={(e) => set("date", e.target.value)} />
            </Field>
          </div>
        )}
        {type === "place" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.lat}>
              <Input value={f.lat ?? ""} onChange={(e) => set("lat", e.target.value)} placeholder="31.7683" />
            </Field>
            <Field label={t.lon}>
              <Input value={f.lon ?? ""} onChange={(e) => set("lon", e.target.value)} placeholder="35.2137" />
            </Field>
          </div>
        )}
        {error && <div className="text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" disabled={busy}>
            {t.create}
          </Button>
        </DialogFooter>
      </form>
    </Shell>
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
    <Shell title={t.quick_capture} description={t.quick_capture_hint} onClose={onClose}>
      <Textarea
        rows={6}
        autoFocus
        className="font-prose text-[15px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t.cancel}
        </Button>
        <Button onClick={submit}>
          {t.create}
          <Kbd className="bg-primary-foreground/20 text-primary-foreground">{shortcut("↵")}</Kbd>
        </Button>
      </DialogFooter>
    </Shell>
  );
}

function Search({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [names, setNames] = useState<NameIndex>(() => new NameIndex());
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
  const seen = new Set(titleHits.map((n) => n.id));
  const contentHits = hits.filter((h) => !seen.has(h.doc.id));
  const go = (id: string) => {
    s.openDoc(id);
    onClose();
  };
  const query = q.trim();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[18%] translate-y-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">{t.search}</DialogTitle>
        <DialogDescription className="sr-only">{t.search_placeholder}</DialogDescription>
        <Command shouldFilter={false} className="[&_[cmdk-input-wrapper]]:h-12">
          <CommandInput placeholder={t.search_placeholder} value={q} onValueChange={setQ} className="text-base" />
          <CommandList className="thin-scroll max-h-[50vh]">
            {query && <CommandEmpty>{t.no_results}</CommandEmpty>}
            {titleHits.length > 0 && (
              <CommandGroup heading={t.titles}>
                {titleHits.map((n) => (
                  <CommandItem key={n.id} value={"n:" + n.id} onSelect={() => go(n.id)}>
                    <TypeDot type={n.type} />
                    <span className="truncate font-medium">{n.name}</span>
                    {n.alias && <span className="text-xs text-muted-foreground">alias</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {contentHits.length > 0 && (
              <CommandGroup heading={t.content}>
                {contentHits.map((h) => (
                  <CommandItem key={h.doc.id} value={"d:" + h.doc.id} onSelect={() => go(h.doc.id)} className="items-start">
                    <TypeDot type={h.doc.type} className="mt-1.5" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{h.doc.title}</span>
                      {h.snippet && <span className="ml-2 text-xs text-muted-foreground [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-foreground" dangerouslySetInnerHTML={{ __html: h.snippet.replace(/</g, "&lt;").replace(/\[([^\]]+)\]/g, "<mark>$1</mark>") }} />}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {query && (
              <CommandGroup>
                <CommandItem
                  value="__create__"
                  onSelect={() => {
                    s.setDialog({ kind: "new", title: query });
                  }}
                >
                  <Plus />
                  <span className="truncate">{t.create_new(query)}</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CreateLink({ target, onClose }: { target: string; onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const [type, setType] = useState<DocType>("concept");
  const title = target.replace(/-/g, " ");
  return (
    <Shell title={`${t.create_page} · ${title}`} onClose={onClose}>
      <TypePicker value={type} onChange={setType} />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t.cancel}
        </Button>
        <Button
          onClick={async () => {
            await s.createDoc(type, title);
            onClose();
          }}
        >
          {t.create}
        </Button>
      </DialogFooter>
    </Shell>
  );
}

function ConfirmDelete({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const doc = s.docsById.get(id);
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.delete}</AlertDialogTitle>
          <AlertDialogDescription>{t.confirm_delete(doc?.title ?? "")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={async () => {
              await api.deleteDocument(id);
              await s.refresh();
              onClose();
              s.back();
            }}
          >
            {t.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
    <Shell title={t.rename} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.target.select()} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit">{t.rename}</Button>
        </DialogFooter>
      </form>
    </Shell>
  );
}

export async function pickFolder(): Promise<string | null> {
  const dir = await openDialog({ directory: true, multiple: false });
  return typeof dir === "string" ? dir : null;
}
