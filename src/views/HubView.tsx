// Hub page: a Source or a Subject. The page gathers what points at it; the
// markdown body is an optional "About" at the bottom.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  MapPin,
  PenLine,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { cn } from "cn";
import {
  api,
  fmString,
  type Backlink,
  type DatedProperty,
  type DocSummary,
  type DocumentPayload,
  type TrailEntry,
  type VerseCount,
} from "@/lib/api";
import { formatShortcut } from "@/lib/keys";
import { setField, splitFrontmatter } from "@/lib/frontmatter";
import { useStore } from "@/lib/store";
import { useDocument } from "@/lib/useDocument";
import { useT } from "@/i18n";
import { Editor } from "@/editor/Editor";
import type { EditorEnv } from "@/editor/decorations";
import { ChipsRow, TagsRow, TitleEditor } from "@/components/DocHeader";
import { TypeDot } from "@/components/DocLink";
import { HoverCard, type HoverState } from "@/components/HoverCard";
import { IconButton } from "@/components/IconButton";
import { PanelTitle } from "@/components/Field";
import { Backlinks, Properties } from "@/components/RightPanel";
import { DocLink } from "@/components/DocLink";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

export function HubView({ id }: { id: string }) {
  const s = useStore();
  const t = useT();
  const d = useDocument(id);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const doc = d.doc;

  useEffect(() => {
    let alive = true;
    api
      .backlinks(id)
      .then((b) => alive && setBacklinks(b))
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [id, s.changeTick, doc?.summary.mtime]);

  const env = useMemo<EditorEnv>(
    () => ({
      names: d.names,
      onOpenLink: (target) => s.openLink(target),
      onOpenPassage: (p) => s.openPassage(p),
      onPassageHover: (i) =>
        setHover(i ? { kind: "passage", passages: i.p, x: i.x, y: i.y } : null),
      onLinkHover: (i) =>
        setHover(i ? { kind: "link", target: i.target, x: i.x, y: i.y } : null),
      embedText: async (target) => {
        const r = await api.resolveLink(target);
        if (!r) return null;
        const full = await api.getDocument(r.id);
        return { title: r.title, body: splitFrontmatter(full.text).body };
      },
    }),
    [d.names, s],
  );

  if (!doc)
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-1" />
          <Skeleton className="h-4 w-48" />
        </header>
        <div className="mx-auto w-full max-w-[860px] space-y-3 px-8 py-8">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );

  const sum = doc.summary;
  const type = sum.type;
  const isScripture = type === "book" || type === "chapter" || type === "verse";
  const book = sum.book
    ? s.books.find((b) => b.number === sum.book)
    : undefined;
  const title = book
    ? type === "book"
      ? book.name
      : type === "chapter"
        ? `${book.name} ${sum.chapter}`
        : `${book.name} ${sum.chapter}:${sum.verse}`
    : sum.title;
  const url = fmString(doc.frontmatter.url).trim();

  const neighbours = (() => {
    if (!book || !sum.chapter) return null;
    if (type === "verse" && sum.verse) {
      const max = book.chapters[sum.chapter - 1];
      return {
        prev:
          sum.verse > 1
            ? () => s.openScripture(book.number, sum.chapter!, sum.verse! - 1)
            : undefined,
        next:
          sum.verse < max
            ? () => s.openScripture(book.number, sum.chapter!, sum.verse! + 1)
            : undefined,
        up: () => s.openScripture(book.number, sum.chapter!),
      };
    }
    if (type === "chapter") {
      return {
        prev:
          sum.chapter > 1
            ? () => s.openScripture(book.number, sum.chapter! - 1)
            : undefined,
        next:
          sum.chapter < book.chapters.length
            ? () => s.openScripture(book.number, sum.chapter! + 1)
            : undefined,
        up: () => s.openScripture(book.number),
      };
    }
    return null;
  })();

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b bg-background px-3">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-1 data-vertical:h-4 data-vertical:self-center"
        />
        <IconButton
          label={t.back}
          shortcut={formatShortcut("Alt+ArrowLeft").join(" ")}
          disabled={!s.canBack}
          onClick={s.back}
        >
          <ArrowLeft />
        </IconButton>
        <IconButton
          label={t.forward}
          shortcut={formatShortcut("Alt+ArrowRight").join(" ")}
          disabled={!s.canForward}
          onClick={s.forward}
        >
          <ArrowRight />
        </IconButton>
        <TypeDot type={type} className="mx-1.5" />
        <span
          className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
          title={sum.path}
        >
          {t.types[type]}
        </span>
        {neighbours && (
          <div className="flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5">
            <IconButton label={t.up} size="icon-xs" onClick={neighbours.up}>
              <ArrowUp />
            </IconButton>
            <IconButton
              label={t.previous}
              size="icon-xs"
              disabled={!neighbours.prev}
              onClick={neighbours.prev}
            >
              <ChevronLeft />
            </IconButton>
            <IconButton
              label={t.next}
              size="icon-xs"
              disabled={!neighbours.next}
              onClick={neighbours.next}
            >
              <ChevronRight />
            </IconButton>
          </div>
        )}
        <span
          className={cn(
            "mx-2 text-xs text-muted-foreground transition-opacity",
            d.status === "idle" && "opacity-0",
          )}
          aria-live="polite"
        >
          {d.status === "saving" ? (
            t.saving
          ) : d.status === "saved" ? (
            t.saved
          ) : d.status === "error" ? (
            <CircleAlert className="inline size-3.5 text-destructive" />
          ) : (
            ""
          )}
        </span>
        {type === "source" && url && (
          <IconButton
            label={t.open_url}
            onClick={() => openUrl(url).catch(console.error)}
          >
            <ExternalLink />
          </IconButton>
        )}
        {type === "source" && (
          <IconButton
            label={t.new_clipping_from}
            onClick={() =>
              s.setDialog({
                kind: "new",
                type: "clipping",
                fields: { source: sum.title, source_id: sum.id, url },
              })
            }
          >
            <PenLine />
          </IconButton>
        )}
        {type === "place" && (
          <IconButton
            label={t.set_location}
            onClick={() =>
              s.setDialog({
                kind: "set-location",
                id,
                onPick: (lat, lon, modernName) => {
                  let next = setField(d.fm, "lat", lat);
                  next = setField(next, "lon", lon);
                  if (modernName)
                    next = setField(next, "modern_name", modernName);
                  d.onFmChange(next);
                },
              })
            }
          >
            <MapPin />
          </IconButton>
        )}
        {!isScripture && (
          <IconButton
            label={t.delete}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => s.setDialog({ kind: "delete", id })}
          >
            <Trash2 />
          </IconButton>
        )}
      </header>
      {d.external && (
        <Alert className="mx-auto mt-3 w-[min(860px,calc(100%-2rem))]">
          <RefreshCw />
          <AlertTitle>{t.external_change}</AlertTitle>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => d.load()}>
              {t.reload}
            </Button>
          </AlertAction>
        </Alert>
      )}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px] px-8 pt-8 pb-24">
          <HubHeader
            doc={doc}
            title={title}
            readOnlyTitle={isScripture}
            onRename={d.rename}
            fm={d.fm}
            onFmChange={d.onFmChange}
          />
          <div className="mt-8 space-y-8">
            <TypeSection doc={doc} book={book} title={title} />
            <Backlinks items={backlinks} subject={type !== "source"} inline />
            <About
              doc={doc}
              body={d.body}
              onBodyChange={d.onBodyChange}
              env={env}
              names={d.names}
              title={title}
            />
          </div>
        </div>
      </div>
      {hover && (
        <HoverCard
          state={hover}
          excludeId={id}
          onClose={() => setHover(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- header card

function HubHeader({
  doc,
  title,
  readOnlyTitle,
  onRename,
  fm,
  onFmChange,
}: {
  doc: DocumentPayload;
  title: string;
  readOnlyTitle: boolean;
  onRename: (t: string) => Promise<void>;
  fm: string;
  onFmChange: (fm: string) => void;
}) {
  const s = useStore();
  const t = useT();
  const type = doc.summary.type;
  const isScripture = type === "book" || type === "chapter" || type === "verse";
  const hasAliases = type === "character" || type === "concept";
  const isPlace =
    type === "place" && doc.summary.lat != null && doc.summary.lon != null;
  const aliasSuggestions = useMemo(() => [] as { value: string }[], []);
  return (
    <div
      data-testid="hub-header"
      className="grid gap-4 rounded-2xl border bg-card p-6 shadow-xs md:grid-cols-[1fr_auto]"
    >
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
          <TypeDot type={type} />
          {t.types[type]}
        </div>
        <TitleEditor
          title={title}
          readOnly={readOnlyTitle}
          onRename={onRename}
        />
        <TagsRow doc={doc} fm={fm} onFmChange={onFmChange} />
        {hasAliases && (
          <div className="mt-2 flex items-start gap-2">
            <span className="mt-1 w-14 shrink-0 text-xs text-muted-foreground">
              {t.aliases}
            </span>
            <ChipsRow
              doc={doc}
              fm={fm}
              onFmChange={onFmChange}
              field="aliases"
              addLabel={t.add_alias}
              suggestions={aliasSuggestions}
            />
          </div>
        )}
        {!isScripture && (
          <div className="mt-4 border-t pt-4">
            <Properties doc={doc} fm={fm} onFmChange={onFmChange} inline />
          </div>
        )}
      </div>
      {isPlace && (
        <button
          data-testid="hub-map"
          type="button"
          className="group relative h-40 w-full overflow-hidden rounded-xl border md:w-56"
          onClick={() => s.navigate({ kind: "map" })}
          title={t.show_on_map}
        >
          <MiniMap lat={doc.summary.lat!} lon={doc.summary.lon!} />
          <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-popover/90 px-1.5 py-0.5 text-[11px] text-popover-foreground opacity-0 transition-opacity group-hover:opacity-100">
            <MapPin className="size-3" />
            {t.show_on_map}
          </span>
        </button>
      )}
    </div>
  );
}

function MiniMap({ lat, lon }: { lat: number; lon: number }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const map = L.map(host.current, {
      center: [lat, lon],
      zoom: 7,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
    }).addTo(map);
    const color =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--c-place")
        .trim() || "#c04f6b";
    L.circleMarker([lat, lon], {
      radius: 7,
      color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 1.5,
    }).addTo(map);
    return () => {
      map.remove();
    };
  }, [lat, lon]);
  return <div ref={host} className="pointer-events-none h-full w-full" />;
}

// -------------------------------------------------------------- type section

function TypeSection({
  doc,
  book,
  title,
}: {
  doc: DocumentPayload;
  book?: { number: number; name: string; chapters: number[] };
  title: string;
}) {
  switch (doc.summary.type) {
    case "source":
      return <SourceSection doc={doc} />;
    case "book":
    case "chapter":
    case "verse":
      return book ? (
        <ScriptureSection doc={doc} book={book} title={title} />
      ) : null;
    case "event":
    case "character":
    case "place":
    case "concept":
      return <DatesSection doc={doc} />;
    default:
      return null;
  }
}

/** Dates on a Subject (ADR 0005) and, for anything but an Event, the Events naming it. */
function DatesSection({ doc }: { doc: DocumentPayload }) {
  const s = useStore();
  const t = useT();
  const id = doc.summary.id;
  const isEvent = doc.summary.type === "event";
  const [dates, setDates] = useState<DatedProperty[]>([]);
  const [events, setEvents] = useState<DocSummary[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .datesOf(id)
      .then((x) => alive && setDates(x))
      .catch(console.error);
    if (!isEvent)
      api
        .eventsNaming(id)
        .then((x) => alive && setEvents(x))
        .catch(console.error);
    return () => {
      alive = false;
    };
  }, [id, isEvent, s.changeTick, doc.summary.mtime]);
  if (dates.length === 0 && (isEvent || events.length === 0)) return null;
  return (
    <section data-testid="hub-dates" className="space-y-4">
      {dates.length > 0 && (
        <div>
          <PanelTitle className="mb-3">{t.dates}</PanelTitle>
          <ul className="space-y-1">
            {dates.map((d) => (
              <li
                key={d.name}
                className="flex items-center gap-3 text-sm"
                data-testid={`date-${d.name}`}
                data-valid={d.date ? "true" : "false"}
              >
                <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
                  {d.name}
                </span>
                <span
                  className={cn("tabular-nums", !d.date && "text-destructive")}
                >
                  {d.text}
                </span>
                {!d.date && (
                  <span
                    className="flex items-center gap-1 text-xs text-destructive"
                    title={t.date_invalid}
                  >
                    <CircleAlert className="size-3.5" />
                    {t.date_invalid}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!isEvent && events.length > 0 && (
        <div data-testid="hub-events">
          <PanelTitle className="mb-3">{t.events}</PanelTitle>
          <ul className="space-y-0.5">
            {events.map((e) => (
              <li key={e.id}>
                <DocLink doc={e} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SourceSection({ doc }: { doc: DocumentPayload }) {
  const s = useStore();
  const t = useT();
  const id = doc.summary.id;
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  const [children, setChildren] = useState<DocSummary[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .sourceTrail(id)
      .then((x) => alive && setTrail(x))
      .catch(console.error);
    api
      .sourceChildren(id)
      .then((x) => alive && setChildren(x))
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [id, s.changeTick, doc.summary.mtime]);
  // Group under the child Source each entry came from; the parent's own entries first.
  const groups = useMemo(() => {
    const m = new Map<string, { source: DocSummary; items: TrailEntry[] }>();
    for (const e of trail) {
      const g = m.get(e.source.id) ?? { source: e.source, items: [] };
      g.items.push(e);
      m.set(e.source.id, g);
    }
    const own = m.get(id);
    m.delete(id);
    return [...(own ? [own] : []), ...m.values()];
  }, [trail, id]);
  return (
    <section data-testid="hub-trail">
      <PanelTitle className="mb-3">{t.reading_trail}</PanelTitle>
      {trail.length === 0 && children.length === 0 ? (
        <Empty text={t.no_trail} />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.source.id}>
              {g.source.id !== id && (
                <button
                  type="button"
                  className="mb-1 flex items-center gap-2 text-sm font-medium hover:underline underline-offset-4"
                  onClick={() => s.openDoc(g.source.id)}
                >
                  <TypeDot type="source" />
                  {g.source.title}
                </button>
              )}
              <ul className="space-y-0.5">
                {g.items.map((e, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                      onClick={() => s.openDoc(e.doc.id)}
                    >
                      <span className="w-16 shrink-0 truncate text-xs text-muted-foreground tabular-nums">
                        {e.locator ?? "—"}
                      </span>
                      <TypeDot type={e.doc.type} />
                      <span className="min-w-0 flex-1 truncate">
                        {e.doc.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {children.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">
                {t.child_sources}
              </div>
              <ul className="space-y-0.5">
                {children.map((c) => (
                  <li key={c.id}>
                    <DocLink doc={c} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ScriptureSection({
  doc,
  book,
  title,
}: {
  doc: DocumentPayload;
  book: { number: number; name: string; chapters: number[] };
  title: string;
}) {
  const s = useStore();
  const t = useT();
  const sum = doc.summary;
  const [cells, setCells] = useState<{ n: number; count: number }[]>([]);
  const [mentions, setMentions] = useState<Backlink[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (sum.type === "book") {
      api.coverage().then((c) => {
        if (!alive) return;
        const byCh = new Map(
          c
            .filter((x) => x.book === book.number)
            .map((x) => [x.chapter, x.count]),
        );
        setCells(
          book.chapters.map((_, i) => ({
            n: i + 1,
            count: byCh.get(i + 1) ?? 0,
          })),
        );
      });
    } else if (sum.type === "chapter" && sum.chapter) {
      const max = book.chapters[sum.chapter - 1];
      api.verseCoverage(book.number, sum.chapter).then((v: VerseCount[]) => {
        if (!alive) return;
        const byV = new Map(v.map((x) => [x.verse, x.count]));
        setCells(
          Array.from({ length: max }, (_, i) => ({
            n: i + 1,
            count: byV.get(i + 1) ?? 0,
          })),
        );
      });
    }
    api
      .verseMentions(
        book.number,
        sum.type === "book" ? undefined : (sum.chapter ?? undefined),
        sum.type === "verse" ? (sum.verse ?? undefined) : undefined,
      )
      .then((m) => alive && setMentions(m))
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [sum.type, sum.chapter, sum.verse, book, s.changeTick]);

  const max = Math.max(1, ...cells.map((c) => c.count));
  const shade = (n: number) =>
    n === 0
      ? "var(--muted)"
      : `color-mix(in srgb, var(--c-scripture) ${Math.round((0.25 + 0.75 * Math.min(1, n / max)) * 100)}%, var(--muted))`;
  const open = (n: number) =>
    sum.type === "book"
      ? s.openScripture(book.number, n)
      : s.openScripture(book.number, sum.chapter!, n);

  return (
    <>
      {sum.type !== "verse" && (
        <section data-testid="hub-strip">
          <PanelTitle className="mb-3">
            {sum.type === "book" ? t.chapters : t.verses}
          </PanelTitle>
          <div className="flex flex-wrap gap-1">
            {cells.map((c) => (
              <button
                key={c.n}
                type="button"
                className="flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs tabular-nums transition-transform hover:scale-110 hover:ring-1 hover:ring-foreground/60"
                style={{ background: shade(c.count) }}
                title={`${sum.type === "book" ? book.name : title} ${sum.type === "book" ? c.n : ":" + c.n} · ${c.count}`}
                onClick={() => open(c.n)}
              >
                {c.n}
              </button>
            ))}
          </div>
        </section>
      )}
      <section data-testid="hub-mentions">
        <PanelTitle className="mb-3">
          {sum.type === "verse" ? t.mentions : t.whole_unit_mentions(title)}
        </PanelTitle>
        {mentions === null ? (
          <Skeleton className="h-4 w-1/2" />
        ) : mentions.length === 0 ? (
          <Empty text={t.no_mentions} />
        ) : (
          <MentionList items={mentions} />
        )}
      </section>
    </>
  );
}

function MentionList({ items }: { items: Backlink[] }) {
  const s = useStore();
  const t = useT();
  return (
    <ul className="space-y-0.5">
      {items.map((b, i) => (
        <li key={i}>
          <button
            type="button"
            className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
            onClick={() => s.openDoc(b.doc.id)}
          >
            <div className="flex items-center gap-2 text-sm">
              <TypeDot type={b.doc.type} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {b.doc.title}
              </span>
              {b.via && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t.via} {b.via}
                  {b.inferred ? ` · ${t.inferred}` : ""}
                </span>
              )}
            </div>
            {b.excerpt && (
              <div className="mt-0.5 line-clamp-2 pl-4 text-xs text-muted-foreground">
                {b.excerpt}
              </div>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

// --------------------------------------------------------------------- about

function About({
  doc,
  body,
  onBodyChange,
  env,
  names,
  title,
}: {
  doc: DocumentPayload;
  body: string;
  onBodyChange: (t: string) => void;
  env: EditorEnv;
  names: EditorEnv["names"];
  title: string;
}) {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState(body.trim().length > 0);
  useEffect(() => {
    if (body.trim()) setOpen(true);
  }, [body]);
  const prompt =
    doc.summary.type === "source"
      ? t.about_prompt.source
      : t.about_prompt.subject(title);
  return (
    <section data-testid="hub-about">
      <PanelTitle className="mb-3">{t.about}</PanelTitle>
      {open ? (
        <div className="rounded-xl border bg-card">
          <Editor
            value={body}
            onChange={onBodyChange}
            env={env}
            names={names}
            tags={s.tags}
            placeholder={prompt}
            autofocus={!body.trim()}
            sourceMode={s.sourceMode}
            compact
          />
        </div>
      ) : (
        <button
          type="button"
          className="w-full rounded-xl border border-dashed px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-solid hover:bg-accent hover:text-foreground"
          onClick={() => setOpen(true)}
        >
          {prompt}
        </button>
      )}
    </section>
  );
}
