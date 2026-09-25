import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BookOpenText,
  ChevronRight,
  Download,
  Globe,
  ImagePlus,
  Plus,
  X,
} from "lucide-react";
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
  type SyncLocations,
  type NameEntry,
} from "@/lib/api";
import { diffBoards, type BoardChange } from "@/lib/board";
import { useCommands, type Command, type CommandGroup } from "@/lib/commands";
import { formatShortcut, shortcut } from "@/lib/keys";
import { FRONTMATTER, SPAN, titleFor } from "@/lib/docTypes";
import { useQuery } from "@/lib/useQuery";
import { NameIndex } from "@/lib/names";
import { useStore } from "@/lib/store";
import { gazetteerTitle } from "@/lib/map";
import { quoteBody } from "@/lib/clippingBody";
import { propertyLabel, useT } from "@/i18n";
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
import { SyncSetup } from "./SyncSetup";
import { PairingPanel } from "./Pairing";
import { EventDate, TypeDot } from "./DocLink";

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
    case "sync":
      return <SyncDialog onClose={close} />;
    case "pairing-request":
      return <PairingRequest node={d.node} name={d.name} platform={d.platform} onClose={close} />;
    case "create-link":
      return <CreateLink target={d.target} onClose={close} />;
    case "delete":
      return <ConfirmDelete id={d.id} onClose={close} />;
    case "confirm":
      return (
        <ConfirmBatch
          title={d.title}
          body={d.body}
          items={d.items}
          confirmLabel={d.confirmLabel}
          onConfirm={d.onConfirm}
          onClose={close}
        />
      );
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
  onRestore?: (text: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [old, setOld] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boardOps, setBoardOps] = useState<BoardChange[]>([]);
  const [tab, setTab] = useState<"text" | "board">("text");
  useEffect(() => {
    let alive = true;
    Promise.all([api.textAt(id, frontier), api.getDocument(id)])
      .then(([o, c]) => {
        if (!alive) return;
        setOld(o);
        setCurrent(c.text);
      })
      .catch((e) => alive && setError(String(e)));
    // A Version covers the talk and its Board together, so the diff shows both
    // and restoring is never a surprise (PLAN §17.17).
    Promise.all([api.boardAt(id, frontier), api.getBoard(id)])
      .then(([o, c]) => alive && setBoardOps(diffBoards(o, c)))
      .catch(console.error);
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
        {boardOps.length > 0 && (
          <div className="flex items-center rounded-md border p-0.5 justify-self-start">
            {(["text", "board"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                data-testid={`version-tab-${k}`}
                className={cn(
                  "rounded px-2 py-0.5 text-xs transition-colors",
                  tab === k
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setTab(k)}
              >
                {k === "text" ? t.board_tab_talk : t.board}
              </button>
            ))}
          </div>
        )}
        {tab === "board" ? (
          <ul
            className="thin-scroll max-h-[50vh] overflow-auto rounded-lg border bg-muted/30 p-2 text-xs"
            data-testid="version-board-diff"
          >
            {boardOps.map((o) => (
              <li key={o.id} className="flex items-baseline gap-2 px-1 py-0.5">
                <span
                  className={cn(
                    "w-16 shrink-0 text-[10px] uppercase",
                    o.kind === "added" && "text-emerald-600 dark:text-emerald-400",
                    o.kind === "removed" && "text-rose-600 dark:text-rose-400",
                    (o.kind === "moved" || o.kind === "changed") &&
                      "text-muted-foreground",
                  )}
                >
                  {t.board_diff[o.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {o.label || t.board_note_empty}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          old != null && current != null && (
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
          )
        )}
        {boardOps.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t.version_restores_board}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t.cancel}
        </Button>
        {onRestore && (
          <Button
            type="button"
            data-testid="version-restore"
            disabled={old == null || old === current}
            onClick={() => {
              if (old != null) onRestore(old);
              onClose();
            }}
          >
            {t.restore_version}
          </Button>
        )}
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
  const [focus, setFocus] = useState(false);
  // The gazetteer is a table shipped with the app, not something the vault
  // holds, so nothing written can change what it answers.
  const { data: hitsData } = useQuery<GazetteerHit[]>({
    key: [q.trim()],
    deps: { none: true },
    enabled: q.trim() !== "",
    fetch: () => api.gazetteer(q, 8),
  });
  const hits = useMemo(
    () => (q.trim() ? (hitsData ?? []) : []),
    [q, hitsData],
  );
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
/**
 * Pick an existing document, or say explicitly that you are creating one.
 *
 * Not a free-text box that looks like a picker. The old one wrote whatever was
 * typed straight into a `[[wikilink]]` and dropped the id of anything picked,
 * so a typo produced a dangling link and a rename broke a real one. Here every
 * accepted value is either a document (`doc` is passed, and with it the id) or
 * a deliberate "Create X" — nothing becomes a link by accident.
 */
function DocPicker({
  types,
  value,
  onChange,
  onCreate,
  placeholder,
  disabled,
  testId,
}: {
  types: DocType[];
  value: string;
  onChange: (v: string, doc?: DocSummary) => void;
  /** Offered as an explicit row when the typed name matches nothing. */
  onCreate?: (title: string) => void;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const s = useStore();
  const t = useT();
  const list = useMemo(
    () => s.docs.filter((d) => types.includes(d.type)),
    [s.docs, types],
  );
  // What the user is typing, kept apart from the accepted value: the box may
  // show a half-typed name that is not yet anybody's title.
  const [draft, setDraft] = useState(value);
  const [focus, setFocus] = useState(false);
  useEffect(() => setDraft(value), [value]);

  const q = draft.trim();
  const matches = useMemo(() => {
    const f = q.toLowerCase();
    return list
      .filter((d) => !f || d.title.toLowerCase().includes(f))
      .slice(0, 8);
  }, [list, q]);
  const exact = matches.find((d) => d.title.toLowerCase() === q.toLowerCase());
  const canCreate = !!onCreate && q.length > 0 && !exact;

  const pick = (d: DocSummary) => {
    setDraft(d.title);
    setFocus(false);
    onChange(d.title, d);
  };
  const create = () => {
    if (!canCreate) return;
    setFocus(false);
    onCreate!(q);
  };

  return (
    <div className="relative">
      <Input
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => {
          setDraft(e.target.value);
          // Typing clears any previous pick: the value is only ever a
          // document the user chose, never the characters they left behind.
          if (value) onChange("");
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (matches.length === 1) pick(matches[0]);
          else if (exact) pick(exact);
          else create();
        }}
      />
      {focus && (matches.length > 0 || canCreate) && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          {matches.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={() => pick(d)}
              >
                <TypeDot type={d.type} />
                <span className="truncate">{d.label}</span>
              </button>
            </li>
          ))}
          {canCreate && (
            <li>
              <button
                type="button"
                data-testid="picker-create"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={create}
              >
                <Plus className="size-3.5 shrink-0" />
                <span className="truncate">{t.create_named(q)}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * A Source's Cover: a URL, a picture in the vault, or nothing (ADR 0012).
 *
 * The URL path is the quick one — `Fetch` fills it from `og:image` — and
 * "Save a copy" turns it into a picture the vault owns, because a remote Cover
 * renders only online and rots when the site reorganises. Downloading is
 * always the user's choice, never a side effect of fetching metadata.
 */
function CoverField({
  title,
  value,
  onChange,
  onStage,
  staged,
}: {
  /** The Source's title, or "" while the user is still typing it. */
  title: string;
  value: string;
  onChange: (v: string) => void;
  /**
   * Hold a picture back until the Source is written, when its title is final.
   * Absent on a Source that already exists, where copying can happen at once.
   */
  onStage?: (from: { path?: string; url?: string } | null) => void;
  staged?: { path?: string; url?: string } | null;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const remote = /^https?:\/\//i.test(value.trim());
  const stored = !!value.trim() && !remote;

  const choose = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [
        { name: "Image", extensions: ["jpg", "jpeg", "png", "gif", "webp"] },
      ],
    });
    if (typeof picked !== "string") return;
    // Staged, not copied: the title decides the file name, and in a New
    // dialog it is not settled until submit — copying now names the picture
    // after whatever the box happened to hold (ADR 0012).
    if (onStage) {
      onStage({ path: picked });
      return;
    }
    setBusy(true);
    try {
      onChange(await api.attachImage(title, picked));
    } finally {
      setBusy(false);
    }
  };

  const saveCopy = async () => {
    if (onStage) {
      onStage({ url: value.trim() });
      return;
    }
    setBusy(true);
    try {
      onChange(await api.saveRemoteCover(title, value.trim()));
    } finally {
      setBusy(false);
    }
  };

  // A staged picture is shown as a pending choice rather than a path that does
  // not exist yet, so the field never claims the vault holds something it does
  // not.
  if (staged) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span
          data-testid="cover-staged"
          className="min-w-0 flex-1 truncate rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
        >
          {t.cover_on_create}
        </span>
        <Button
          type="button"
          variant="ghost"
          aria-label={t.cover_remove}
          onClick={() => onStage?.(null)}
        >
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Input
        className="min-w-0 flex-1"
        data-testid="cover-input"
        value={value}
        placeholder="https:// · Attachments/…"
        onChange={(e) => onChange(e.target.value)}
      />
      {remote && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={saveCopy}
          data-testid="cover-save-copy"
        >
          <Download />
          {t.cover_save_copy}
        </Button>
      )}
      {!stored && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={choose}
          data-testid="cover-choose"
        >
          <ImagePlus />
        </Button>
      )}
      {!!value.trim() && (
        <Button
          type="button"
          variant="ghost"
          aria-label={t.cover_remove}
          onClick={() => onChange("")}
        >
          <X />
        </Button>
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

/**
 * The New dialog's type-specific fields.
 *
 * A total map, so a type added to `DocType` without deciding what its dialog
 * asks for is a compile error rather than a form that silently offers nothing.
 * `null` means the type needs no fields beyond a title.
 *
 * These stay in this file because they reach for the dialog's own pieces — the
 * Source picker, the gazetteer, `createDoc` — and moving the JSX somewhere
 * else would only move those dependencies with it.
 */
/**
 * The two Date fields of a Span (CONTEXT.md), labelled by the Property each
 * writes: `born`/`died` for a Character, `start`/`end` for an Event or a
 * Journey. One component, because it is one concept whichever page it is on.
 */
function SpanFields({
  f,
  set,
  type,
}: {
  f: Record<string, string>;
  set: (k: string, v: string) => void;
  type: DocType;
}) {
  const t = useT();
  const span = SPAN[type];
  if (!span) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {span.map((name) => (
        <Field key={name} label={propertyLabel(name, t)}>
          <Input
            value={f[name] ?? ""}
            onChange={(e) => set(name, e.target.value)}
            placeholder={t.date_placeholder}
            data-testid={`new-${name}`}
          />
        </Field>
      ))}
    </div>
  );
}

const TYPE_FIELDS: Record<
  DocType,
  ((p: {
    f: Record<string, string>;
    set: (k: string, v: string) => void;
    title: string;
    setTitle: (t: string) => void;
    s: ReturnType<typeof useStore>;
    t: ReturnType<typeof useT>;
  }) => ReactNode) | null
> = {
  note: ({ f, set, s, t }) => (
    <Field label={t.source}>
      <DocPicker
        types={["source"]}
        testId="source-picker"
        value={f.source ?? ""}
        onChange={(v, d) => {
          set("source", d ? d.title : v);
          set("source_id", d?.id ?? "");
        }}
        onCreate={async (name) => {
          const created = await s.createDoc("source", name, {
            kind: "article",
          });
          set("source", created.summary.title);
          set("source_id", created.summary.id);
        }}
        placeholder="(optional)"
      />
    </Field>
  ),
  composition: ({ f, set, t }) => (
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
  ),
  event: ({ f, set, t }) => (
    <>
      <div className="grid grid-cols-2 gap-3">
        <SpanFields f={f} set={set} type="event" />
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
  ),
  place: ({ f, set, title, setTitle, t }) => (
    <>
    <Field label={t.lookup_place}>
      <GazetteerPicker
        onPick={(h) => {
          if (!title.trim()) setTitle(gazetteerTitle(h.name));
          set("lat", String(h.lat));
          set("lon", String(h.lon));
          set("modern_name", h.modern_name);
        }}
      />
    </Field>
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
    </>
  ),
  // A Source's and a Clipping's fields are bound up with the URL lookup and
  // the Cover staging above, so they stay in the form itself.
  source: null,
  clipping: null,
  // The Span its type suggests, so a lifespan or a duration can be given when
  // the page is made rather than discovered later in the Properties panel.
  character: ({ f, set }) => <SpanFields f={f} set={set} type="character" />,
  concept: null,
  journey: ({ f, set }) => <SpanFields f={f} set={set} type="journey" />,
  book: null,
  chapter: null,
  verse: null,
  other: null,
};

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
  // A Cover picked before the Source exists waits here: the file it becomes is
  // named after the title, which is not settled until submit (ADR 0012).
  const [stagedCover, setStagedCover] = useState<{
    path?: string;
    url?: string;
  } | null>(null);
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
          if (m.date) set("date", m.date);
          // `og:image` is a suggestion, not an answer: often a site logo, and
          // remote until the user asks to keep a copy (ADR 0012).
          if (m.image) set("cover", m.image);
        } else {
          if (m.title) set("source", m.title);
          if (m.date) set("date", m.date);
          if (m.image) set("cover", m.image);
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
                url: f.url ?? "",
                date: f.date ?? "",
                cover: f.cover ?? "",
              },
              "",
              false,
            );
            sourceTitle = created.summary.title;
          }
          fields.source = `[[${sourceTitle}]]`;
        }
        if (f.locator) fields.locator = f.locator;
        // No title is invented here, and none is sent: the engine names the
        // file from the Citation in these fields (ADR 0013).
        finalTitle = "";
      } else {
        // Every other type's fields are a pure function of the form
        // (src/lib/docTypes.tsx), tested without a dialog or a vault.
        Object.assign(fields, FRONTMATTER[type]?.(f) ?? {});
      }
      finalTitle = titleFor(type, finalTitle, stamp, t.untitled);
      // Now the title is final, so the picture can be copied in under a name
      // that identifies it. Before this point there was nothing to name it
      // after (ADR 0012).
      if (stagedCover) {
        fields.cover = stagedCover.path
          ? await api.attachImage(finalTitle, stagedCover.path)
          : await api.saveRemoteCover(finalTitle, stagedCover.url!);
      }
      // Someone else's words are stored as a blockquote, so the file reads as
      // a quotation in Obsidian too (ADR 0013, ADR 0003).
      await s.createDoc(
        type,
        finalTitle,
        fields,
        type === "clipping" ? quoteBody(body) : body,
      );
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
    <div className="grid grid-cols-2 gap-3">
      <Field label={t.kind}>
        <KindSelect value={f.kind} onChange={(v) => set("kind", v)} />
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
  const coverField = (
    <Field label={t.cover}>
      <CoverField
        title={title}
        value={f.cover ?? ""}
        onChange={(v) => set("cover", v)}
        staged={stagedCover}
        onStage={setStagedCover}
      />
    </Field>
  );

  return (
    <Shell
      title={`${t.new} · ${t.types[type]}`}
      onClose={onClose}
      wide={type === "clipping"}
    >
      <form data-testid="new-doc-form" onSubmit={submit} className="grid gap-4">
        <TypePicker value={type} onChange={setType} />
        {/* A Clipping has no title: naming someone else's words is the user's
            commentary, not the excerpt, and its file is named by its Citation
            (ADR 0013). */}
        {type !== "clipping" && (
          <Field label={t.title}>
            <Input
              data-testid="new-doc-title"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={type === "note" ? "(optional)" : ""}
            />
          </Field>
        )}
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
                testId="source-picker"
                value={f.source ?? ""}
                onChange={(v, d) => {
                  set("source", d ? d.title : v);
                  set("source_id", d?.id ?? "");
                }}
                // Creating the Source here is what the dialog is for; the row
                // only makes it deliberate rather than a consequence of typing.
                // It is marked `new` so the kind and date fields appear, and
                // the Source itself is written on submit with them.
                onCreate={(name) => {
                  set("source", name);
                  set("source_id", "");
                  set("source_new", "1");
                }}
                placeholder={t.source_existing + " / " + t.source_new}
              />
            </Field>
            {f.source_new === "1" && !f.source_id && f.source && (
              <>
                {sourceMeta}
                {coverField}
              </>
            )}
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
            {coverField}
            <Field label={t.parent_source}>
              <DocPicker
                types={["source"]}
                testId="parent-picker"
                // Opened from a Source's own page, the parent is already
                // settled; leaving it editable invites changing it by accident.
                disabled={!!fields?.parent_id}
                value={f.parent ?? ""}
                // The title is what the wikilink needs; the id proves the
                // Source exists, so a typo can never become a parent.
                onChange={(v, d) => {
                  set("parent", d ? d.title : v);
                  set("parent_id", d?.id ?? "");
                }}
                onCreate={async (name) => {
                  const created = await s.createDoc("source", name, {
                    kind: "book",
                  });
                  set("parent", created.summary.title);
                  set("parent_id", created.summary.id);
                }}
              />
            </Field>
          </>
        )}
        {TYPE_FIELDS[type]?.({ f, set, title, setTitle, s, t })}
        {error && <div className="text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" data-testid="submit-doc" disabled={busy}>
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

const GROUP_ORDER: CommandGroup[] = ["create", "navigate", "editor", "help"];

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
  const [names, setNames] = useState<NameIndex>(() => new NameIndex());
  const commandMode = q.startsWith(">");
  const query = (commandMode ? q.slice(1) : q).trim();
  useEffect(() => {
    namesApi
      .names()
      .then((n) => setNames(new NameIndex(n)))
      .catch(console.error);
  }, []);
  // Full-text search follows what is being typed, and any document may match.
  const { data: searchData } = useQuery<SearchHit[]>({
    key: [query, commandMode],
    deps: { any: true },
    enabled: !commandMode && query !== "",
    debounce: 120,
    fetch: () => api.search(query, 20),
  });
  const hits = useMemo(
    () => (commandMode || !query ? [] : (searchData ?? [])),
    [commandMode, query, searchData],
  );
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
                        {(() => {
                          // Title hits come from the name index, which carries
                          // no Dates; the summary cache does.
                          const d = s.docsById.get(n.id);
                          return d ? <EventDate doc={d} /> : null;
                        })()}
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
                          <span className="font-medium">{h.doc.label}</span>
                          <EventDate doc={h.doc} className="ml-2" />
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

/** "Set up sync on another device": the wizard's sync step, on its own. */
function SyncDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const [locations, setLocations] = useState<SyncLocations | null>(null);
  useEffect(() => {
    api.syncLocations().then(setLocations).catch(console.error);
  }, []);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" data-testid="sync-dialog">
        <DialogHeader>
          <DialogTitle>{t.sync.title}</DialogTitle>
          <DialogDescription>{t.sync.dialog_body}</DialogDescription>
        </DialogHeader>
        <SyncSetup locations={locations} pairing={<PairingPanel />} foldersOpen={!!s.settings?.sync_method && s.settings.sync_method !== "pairing" && s.settings.sync_method !== "none"} onChange={(m) => m && s.settings?.sync_method !== "pairing" && m !== s.settings?.sync_method && s.setSyncMethod(m)} />
      </DialogContent>
    </Dialog>
  );
}

/** "Allow <device> to join?" raised by a pairing join request. */
function PairingRequest({ node, name, platform, onClose }: { node: string; name: string; platform: string; onClose: () => void }) {
  const t = useT();
  const decide = async (allow: boolean) => {
    await api.pairingApprove(node, allow).catch(console.error);
    onClose();
  };
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent data-testid="pairing-request">
        <AlertDialogHeader>
          <AlertDialogTitle>{t.pairing.wants_to_join(name || t.sync.unknown_device)}</AlertDialogTitle>
          <AlertDialogDescription>{t.pairing.request_body(platform)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => decide(false)}>{t.pairing.deny}</AlertDialogCancel>
          <AlertDialogAction onClick={() => decide(true)}>{t.pairing.allow}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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

/**
 * A write that touches several documents at once.
 *
 * The documents are named, not just counted: this is the one action in the app
 * that edits files the user is not looking at, so the extent of it is shown
 * before it runs rather than reported after (ADR 0011).
 */
function ConfirmBatch({
  title,
  body,
  items,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  items: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="thin-scroll max-h-48 space-y-0.5 overflow-y-auto rounded-md border p-2 text-sm">
          {items.map((x, i) => (
            <li key={i} className="truncate">
              {x}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-batch"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
