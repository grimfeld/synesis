import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { BookOpenText, ChevronRight, Globe, Plus } from "lucide-react";
import { cn } from "cn";
import {
  api,
  namesApi,
  CREATABLE_TYPES,
  type DocSummary,
  type DocType,
  type Frontmatter,
  type GazetteerHit,
  type SearchHit,
  type NameEntry,
} from "@/lib/api";
import { useCommands, type Command, type CommandGroup } from "@/lib/commands";
import { formatShortcut, shortcut } from "@/lib/keys";
import { NameIndex } from "@/lib/names";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Command as CommandRoot,
  CommandEmpty,
  CommandGroup as CommandGroupUi,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import L from "leaflet";
import { diffLines, diffStats } from "@/lib/diff";
import { Field } from "./Field";
import { TypeDot } from "./DocLink";

export function Dialogs() {
  const s = useStore();
  const d = s.dialog;
  if (!d) return null;
  const close = () => s.setDialog(null);
  switch (d.kind) {
    case "new":
      return (
        <NewDocument
          type={d.type}
          title={d.title}
          body={d.body}
          fields={d.fields}
          onClose={close}
        />
      );
    case "quick":
      return <QuickCapture onClose={close} />;
    case "search":
      return <Palette initial={d.query ?? ""} onClose={close} />;
    case "goto-passage":
      return <GotoPassage onClose={close} />;
    case "create-link":
      return <CreateLink target={d.target} onClose={close} />;
    case "delete":
      return <ConfirmDelete id={d.id} onClose={close} />;
    case "set-location":
      return <SetLocation id={d.id} onPick={d.onPick} onClose={close} />;
    case "version":
      return (
        <VersionDialog
          id={d.id}
          frontier={d.frontier}
          label={d.label}
          onRestore={d.onRestore}
          onClose={close}
        />
      );
  }
}

/** A Version side by side with the current text, as a line diff; Restore writes it back as a new edit. */
function VersionDialog({
  id,
  frontier,
  label,
  onRestore,
  onClose,
}: {
  id: string;
  frontier: string;
  label: string;
  onRestore: (text: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [old, setOld] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([api.textAt(id, frontier), api.getDocument(id)])
      .then(([o, c]) => {
        if (!alive) return;
        setOld(o);
        setCurrent(c.text);
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [id, frontier]);
  const ops = useMemo(
    () => (old != null && current != null ? diffLines(old, current) : []),
    [old, current],
  );
  const stats = useMemo(() => diffStats(ops), [ops]);
  return (
    <Shell
      title={label}
      description={t.version_diff_hint}
      wide
      onClose={onClose}
    >
      <div data-testid="version-dialog" className="grid gap-2">
        {error && <div className="text-sm text-destructive">{error}</div>}
        {old != null && current != null && (
          <>
            <div
              className="text-xs text-muted-foreground tabular-nums"
              data-testid="version-stats"
            >
              {stats.added === 0 && stats.removed === 0
                ? t.version_same
                : `+${stats.added} −${stats.removed}`}
            </div>
            <pre
              className="thin-scroll max-h-[50vh] overflow-auto rounded-lg border bg-muted/30 p-2 font-mono text-xs leading-5 whitespace-pre-wrap"
              data-testid="version-diff"
            >
              {ops.map((o, i) => (
                <div
                  key={i}
                  className={cn(
                    "px-1",
                    o.kind === "add" &&
                      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                    o.kind === "del" &&
                      "bg-rose-500/15 text-rose-700 line-through dark:text-rose-300",
                  )}
                >
                  <span className="mr-2 inline-block w-3 select-none text-muted-foreground">
                    {o.kind === "add" ? "+" : o.kind === "del" ? "−" : " "}
                  </span>
                  {o.text || " "}
                </div>
              ))}
            </pre>
          </>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t.cancel}
        </Button>
        <Button
          type="button"
          disabled={old == null || old === current}
          onClick={() => {
            if (old != null) onRestore(old);
            onClose();
          }}
        >
          {t.restore_version}
        </Button>
      </DialogFooter>
    </Shell>
  );
}

/** Type a Bible place name, pick a hit from the bundled gazetteer. */
function GazetteerPicker({
  onPick,
  autoFocus,
}: {
  onPick: (hit: GazetteerHit) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GazetteerHit[]>([]);
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!q.trim()) {
      setHits([]);
      return;
    }
    api
      .gazetteer(q, 8)
      .then((h) => alive && setHits(h))
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [q]);
  return (
    <div className="relative" data-testid="gazetteer">
      <Input
        value={q}
        placeholder={t.lookup_place}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
      />
      {focus && hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          {hits.map((h) => (
            <li key={h.name}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={() => {
                  onPick(h);
                  setQ("");
                  setHits([]);
                }}
              >
                <TypeDot type="place" />
                <span className="truncate">{h.name}</span>
                <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                  {h.modern_name !== h.name ? h.modern_name : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {t.gazetteer_hint}
      </p>
    </div>
  );
}

/** Disambiguated gazetteer names ("Bethlehem 1") become plain titles. */
function placeTitle(name: string): string {
  return name.replace(/ \d+$/, "");
}

/** Pick a Place's coordinates on a map or from the gazetteer; the page applies them. */
function SetLocation({
  id,
  onPick,
  onClose,
}: {
  id: string;
  onPick: (lat: number, lon: number, modernName: string | null) => void;
  onClose: () => void;
}) {
  const s = useStore();
  const t = useT();
  const doc = s.docsById.get(id);
  const [pos, setPos] = useState<[number, number]>(
    doc?.lat != null && doc?.lon != null ? [doc.lat, doc.lon] : [31.8, 35.2],
  );
  const [modern, setModern] = useState<string | null>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  // A callback ref: runs exactly when the node attaches inside the dialog's portal.
  const host = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) {
        map.current?.remove();
        map.current = null;
        return;
      }
      if (map.current) return;
      const m = L.map(el, {
        center: pos,
        zoom: doc?.lat != null ? 8 : 6,
        zoomControl: true,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
      }).addTo(m);
      const color =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--c-place")
          .trim() || "#c04f6b";
      marker.current = L.circleMarker(pos, {
        radius: 8,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 1.5,
      }).addTo(m);
      m.on("click", (e: L.LeafletMouseEvent) => {
        setPos([e.latlng.lat, e.latlng.lng]);
        setModern(null);
      });
      map.current = m;
      setTimeout(() => m.invalidateSize(), 50);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    marker.current?.setLatLng(pos);
  }, [pos]);
  const save = () => {
    onPick(Number(pos[0].toFixed(4)), Number(pos[1].toFixed(4)), modern);
    onClose();
  };
  return (
    <Shell
      title={t.set_location}
      description={t.place_map_hint}
      wide
      onClose={onClose}
    >
      <div data-testid="set-location" className="grid gap-3">
        <GazetteerPicker
          autoFocus
          onPick={(h) => {
            setPos([h.lat, h.lon]);
            setModern(h.modern_name);
            map.current?.setView([h.lat, h.lon], 8);
          }}
        />
        <div
          ref={host}
          data-testid="set-location-map"
          className="h-72 w-full overflow-hidden rounded-xl border"
        />
        <div
          className="text-xs text-muted-foreground tabular-nums"
          data-testid="set-location-pos"
        >
          {pos[0].toFixed(4)}, {pos[1].toFixed(4)}
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t.cancel}
        </Button>
        <Button type="button" onClick={save}>
          {t.use_location}
        </Button>
      </DialogFooter>
    </Shell>
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
export function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

/** A modal shell: always open while mounted, closes through onClose. */
function Shell({
  title,
  description,
  wide,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(wide && "sm:max-w-2xl")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function TypePicker({
  value,
  onChange,
}: {
  value: DocType;
  onChange: (t: DocType) => void;
}) {
  const t = useT();
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as DocType)}
      variant="outline"
      size="sm"
      spacing={1}
      className="flex-wrap justify-start"
    >
      {CREATABLE_TYPES.map((x) => (
        <ToggleGroupItem
          key={x}
          value={x}
          className="gap-1.5 data-[state=on]:bg-accent"
        >
          <TypeDot type={x} />
          {t.types[x]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Picker over existing documents of some types, with free text fallback. */
function DocPicker({
  types,
  value,
  onChange,
  placeholder,
}: {
  types: DocType[];
  value: string;
  onChange: (v: string, doc?: DocSummary) => void;
  placeholder?: string;
}) {
  const s = useStore();
  const list = useMemo(
    () => s.docs.filter((d) => types.includes(d.type)),
    [s.docs, types],
  );
  const [focus, setFocus] = useState(false);
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    return list
      .filter((d) => !q || d.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [list, value]);
  return (
    <div className="relative">
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
      />
      {focus && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          {matches.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={() => onChange(d.title, d)}
              >
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

function KindSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
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

function NewDocument({
  type: initial,
  title: initialTitle,
  body: initialBody,
  fields,
  onClose,
}: {
  type?: DocType;
  title?: string;
  body?: string;
  fields?: Record<string, string>;
  onClose: () => void;
}) {
  const s = useStore();
  const t = useT();
  const [type, setType] = useState<DocType>(initial ?? "note");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [body, setBody] = useState(initialBody ?? "");
  const [f, setF] = useState<Record<string, string>>({
    kind: "article",
    ...fields,
  });
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
          const existing = f.source_id
            ? s.docsById.get(f.source_id)
            : ((await api.resolveLink(sourceTitle)) ?? undefined);
          if (existing) sourceTitle = existing.title;
          else {
            const created = await s.createDoc(
              "source",
              sourceTitle,
              {
                kind: f.kind || "article",
                author: f.author ?? "",
                url: f.url ?? "",
                date: f.date ?? "",
              },
              "",
              false,
            );
            sourceTitle = created.summary.title;
          }
          fields.source = `[[${sourceTitle}]]`;
        }
        if (f.locator) fields.locator = f.locator;
        if (!finalTitle)
          finalTitle =
            (sourceTitle ? sourceTitle + " – " : "") +
            (body.trim().slice(0, 48) || stamp());
      } else if (type === "source") {
        fields.kind = f.kind || "article";
        if (f.author) fields.author = f.author;
        if (f.url) fields.url = f.url;
        if (f.date) fields.date = f.date;
        if (f.parent) fields.parent = `[[${f.parent}]]`;
      } else if (type === "place") {
        if (f.lat) fields.lat = Number(f.lat);
        if (f.lon) fields.lon = Number(f.lon);
        if (f.modern_name) fields.modern_name = f.modern_name;
      } else if (type === "event") {
        if (f.start) fields.start = f.start;
        if (f.end) fields.end = f.end;
        if (f.place) fields.place = `[[${f.place}]]`;
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
        <Input
          className="flex-1"
          value={f.url ?? ""}
          onChange={(e) => set("url", e.target.value)}
          placeholder="https://"
        />
        <Button
          type="button"
          variant="outline"
          onClick={fetchMeta}
          disabled={busy || !f.url}
        >
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
        <Input
          value={f.author ?? ""}
          onChange={(e) => set("author", e.target.value)}
        />
      </Field>
      <Field label={t.date}>
        <Input
          value={f.date ?? ""}
          onChange={(e) => set("date", e.target.value)}
          placeholder="2026-09-08"
        />
      </Field>
    </div>
  );

  return (
    <Shell
      title={`${t.new} · ${t.types[type]}`}
      onClose={onClose}
      wide={type === "clipping"}
    >
      <form data-testid="new-doc-form" onSubmit={submit} className="grid gap-4">
        <TypePicker value={type} onChange={setType} />
        <Field label={t.title}>
          <Input
            data-testid="new-doc-title"
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              type === "clipping" || type === "note" ? "(optional)" : ""
            }
          />
        </Field>
        {type === "clipping" && (
          <>
            <Field label={t.clipping_text}>
              <Textarea
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                autoFocus
                className="font-prose"
              />
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
              <Input
                value={f.locator ?? ""}
                onChange={(e) => set("locator", e.target.value)}
                placeholder="par. 12 · p. 4 · 14:32"
              />
            </Field>
          </>
        )}
        {type === "source" && (
          <>
            {urlField}
            {sourceMeta}
            <Field label={t.parent_source}>
              <DocPicker
                types={["source"]}
                value={f.parent ?? ""}
                onChange={(v) => set("parent", v)}
              />
            </Field>
          </>
        )}
        {type === "note" && (
          <Field label={t.source}>
            <DocPicker
              types={["source"]}
              value={f.source ?? ""}
              onChange={(v) => set("source", v)}
              placeholder="(optional)"
            />
          </Field>
        )}
        {type === "composition" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Occasion">
              <Input
                value={f.occasion ?? ""}
                onChange={(e) => set("occasion", e.target.value)}
              />
            </Field>
            <Field label={t.date}>
              <Input
                value={f.date ?? ""}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
          </div>
        )}
        {type === "event" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.start}>
                <Input
                  value={f.start ?? ""}
                  onChange={(e) => set("start", e.target.value)}
                  placeholder={t.date_placeholder}
                />
              </Field>
              <Field label={t.end}>
                <Input
                  value={f.end ?? ""}
                  onChange={(e) => set("end", e.target.value)}
                  placeholder={t.date_placeholder}
                />
              </Field>
            </div>
            <Field label={t.types.place}>
              <DocPicker
                types={["place"]}
                value={f.place ?? ""}
                onChange={(v) => set("place", v)}
                placeholder="(optional)"
              />
            </Field>
          </>
        )}
        {type === "place" && (
          <Field label={t.lookup_place}>
            <GazetteerPicker
              onPick={(h) => {
                if (!title.trim()) setTitle(placeTitle(h.name));
                set("lat", String(h.lat));
                set("lon", String(h.lon));
                set("modern_name", h.modern_name);
              }}
            />
          </Field>
        )}
        {type === "place" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.lat}>
              <Input
                type="number"
                step="any"
                value={f.lat ?? ""}
                onChange={(e) => set("lat", e.target.value)}
                placeholder="31.7683"
              />
            </Field>
            <Field label={t.lon}>
              <Input
                type="number"
                step="any"
                value={f.lon ?? ""}
                onChange={(e) => set("lon", e.target.value)}
                placeholder="35.2137"
              />
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
    <Shell
      title={t.quick_capture}
      description={t.quick_capture_hint}
      onClose={onClose}
    >
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
          <Kbd className="bg-primary-foreground/20 text-primary-foreground">
            {shortcut("↵")}
          </Kbd>
        </Button>
      </DialogFooter>
    </Shell>
  );
}

const GROUP_ORDER: CommandGroup[] = ["create", "navigate", "editor"];

function matchesCommand(c: Command, q: string): boolean {
  const hay = `${c.title} ${c.keywords ?? ""} ${c.id}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** The Command Palette: documents by default, Commands when the query starts with ">". */
function Palette({
  initial,
  onClose,
}: {
  initial: string;
  onClose: () => void;
}) {
  const s = useStore();
  const t = useT();
  const commands = useCommands();
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [names, setNames] = useState<NameIndex>(() => new NameIndex());
  const commandMode = q.startsWith(">");
  const query = (commandMode ? q.slice(1) : q).trim();
  useEffect(() => {
    namesApi
      .names()
      .then((n) => setNames(new NameIndex(n)))
      .catch(console.error);
  }, []);
  useEffect(() => {
    if (commandMode || !query) return setHits([]);
    let alive = true;
    const h = window.setTimeout(
      () =>
        api
          .search(query, 20)
          .then((r) => alive && setHits(r))
          .catch(console.error),
      120,
    );
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [query, commandMode]);
  const titleHits: NameEntry[] = useMemo(() => {
    if (commandMode || !query) return [];
    const seen = new Set<string>();
    return names
      .suggest(query, 8)
      .filter((n) => {
        const k = n.id + "\u0000" + n.name.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 6);
  }, [query, names, commandMode]);
  const seen = new Set(titleHits.map((n) => n.id));
  const contentHits = hits.filter((h) => !seen.has(h.doc.id));
  const go = (id: string) => {
    s.openDoc(id);
    onClose();
  };
  const runCommand = (c: Command) => {
    onClose();
    // Let the dialog unmount before the command opens another one.
    window.setTimeout(c.run, 0);
  };
  const grouped = useMemo(() => {
    const out: { group: CommandGroup; items: Command[] }[] = [];
    for (const g of GROUP_ORDER) {
      const items = commands.filter(
        (c) => c.group === g && matchesCommand(c, query),
      );
      if (items.length) out.push({ group: g, items });
    }
    return out;
  }, [commands, query]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        data-testid="palette"
        className="top-[18%] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t.search}</DialogTitle>
        <DialogDescription className="sr-only">
          {t.search_placeholder}
        </DialogDescription>
        <CommandRoot
          shouldFilter={false}
          className="[&_[cmdk-input-wrapper]]:h-12"
        >
          <CommandInput
            placeholder={commandMode ? t.cmd_palette : t.search_placeholder}
            value={q}
            onValueChange={setQ}
            className="text-base"
            autoFocus
          />
          <CommandList className="thin-scroll max-h-[50vh]">
            {commandMode ? (
              <>
                <CommandEmpty>{t.no_results}</CommandEmpty>
                {grouped.map(({ group, items }) => (
                  <CommandGroupUi key={group} heading={t.groups[group]}>
                    {items.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={c.id}
                        onSelect={() => runCommand(c)}
                      >
                        {c.icon ? (
                          <c.icon className="text-muted-foreground" />
                        ) : (
                          <ChevronRight className="text-muted-foreground" />
                        )}
                        <span className="truncate">{c.title}</span>
                        {c.shortcut && (
                          <KbdGroup className="ml-auto">
                            {formatShortcut(c.shortcut).map((k, i) => (
                              <Kbd key={i}>{k}</Kbd>
                            ))}
                          </KbdGroup>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroupUi>
                ))}
              </>
            ) : (
              <>
                {query && <CommandEmpty>{t.no_results}</CommandEmpty>}
                {!query && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    {t.cmd_hint} <Kbd>{shortcut("⇧P")}</Kbd>
                  </div>
                )}
                {titleHits.length > 0 && (
                  <CommandGroupUi heading={t.titles}>
                    {titleHits.map((n) => (
                      <CommandItem
                        key={n.id + ":" + n.name}
                        value={"n:" + n.id + ":" + n.name}
                        onSelect={() => go(n.id)}
                      >
                        <TypeDot type={n.type} />
                        <span className="truncate font-medium">{n.name}</span>
                        {n.alias && (
                          <span className="text-xs text-muted-foreground">
                            alias
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroupUi>
                )}
                {contentHits.length > 0 && (
                  <CommandGroupUi heading={t.content}>
                    {contentHits.map((h) => (
                      <CommandItem
                        key={h.doc.id}
                        value={"d:" + h.doc.id}
                        onSelect={() => go(h.doc.id)}
                        className="items-start"
                      >
                        <TypeDot type={h.doc.type} className="mt-1.5" />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{h.doc.title}</span>
                          {h.snippet && (
                            <span
                              className="ml-2 text-xs text-muted-foreground [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-foreground"
                              dangerouslySetInnerHTML={{
                                __html: h.snippet
                                  .replace(/</g, "&lt;")
                                  .replace(/\[([^\]]+)\]/g, "<mark>$1</mark>"),
                              }}
                            />
                          )}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroupUi>
                )}
                {query && (
                  <CommandGroupUi>
                    <CommandItem
                      value="__create__"
                      onSelect={() =>
                        s.setDialog({ kind: "new", title: query })
                      }
                    >
                      <Plus />
                      <span className="truncate">{t.create_new(query)}</span>
                    </CommandItem>
                  </CommandGroupUi>
                )}
              </>
            )}
          </CommandList>
        </CommandRoot>
      </DialogContent>
    </Dialog>
  );
}

function GotoPassage({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const [q, setQ] = useState("");
  const [error, setError] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ranges = await api.detectPassages(q.trim());
    const p = ranges[0]?.passages[0];
    if (!p) return setError(true);
    onClose();
    s.openPassage(p);
  };
  return (
    <Shell title={t.open_passage} onClose={onClose}>
      <form data-testid="goto-passage" onSubmit={submit} className="grid gap-3">
        <div className="relative">
          <BookOpenText className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-9"
            placeholder={t.goto_passage_placeholder}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setError(false);
            }}
          />
        </div>
        {error && (
          <div className="text-sm text-destructive">{t.not_a_passage}</div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" disabled={!q.trim()}>
            {t.open}
          </Button>
        </DialogFooter>
      </form>
    </Shell>
  );
}

function CreateLink({
  target,
  onClose,
}: {
  target: string;
  onClose: () => void;
}) {
  const s = useStore();
  const t = useT();
  const [type, setType] = useState<DocType>("concept");
  const title = target.replace(/-/g, " ");
  return (
    <Shell title={`${t.create_page} · ${title}`} onClose={onClose}>
      <div data-testid="create-link" />
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
          <AlertDialogDescription>
            {t.confirm_delete(doc?.title ?? "")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-delete"
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

export async function pickFolder(): Promise<string | null> {
  const dir = await openDialog({ directory: true, multiple: false });
  return typeof dir === "string" ? dir : null;
}
