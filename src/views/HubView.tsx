// Hub page: a Source or a Subject. The page gathers what points at it; the
// markdown body is an optional "About" at the bottom.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  FilePlus,
  ImagePlus,
  MapPin,
  PenLine,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "cn";
import {
  api,
  fmString,
  type Backlink,
  type DatedProperty,
  type DocSummary,
  type DocType,
  type DocumentPayload,
  type Journey,
  type TrailEntry,
  type UnlinkedMentions as UnlinkedMentionsData,
  type VerseCount,
  LINKABLE_TARGET_TYPES,
} from "@/lib/api";
import type { SectionProps } from "@/lib/docTypes";
import { formatShortcut, shortcut } from "@/lib/keys";
import { childKindFor } from "@/lib/library";
import { quoteBody } from "@/lib/clippingBody";
import { setField, splitFrontmatter } from "@/lib/frontmatter";
import { useStore } from "@/lib/store";
import { useDocument } from "@/lib/useDocument";
import { useT } from "@/i18n";
import { Editor } from "@/editor/Editor";
import type { EditorEnv } from "@/editor/decorations";
import { stamp } from "@/components/Dialogs";
import { ChipsRow, TagsRow, TitleEditor } from "@/components/DocHeader";
import { EventDate, TypeDot } from "@/components/DocLink";
import { HoverCard, type HoverState } from "@/components/HoverCard";
import { IconButton } from "@/components/IconButton";
import { PanelTitle } from "@/components/Field";
import {
  Backlinks,
  Properties,
  Section,
  UnlinkedMentions,
} from "@/components/RightPanel";
import { Cover } from "@/components/Cover";
import { DocLink } from "@/components/DocLink";
import { Input } from "@/components/ui/input";
import { MiniTimeline } from "@/components/MiniTimeline";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";

export function HubView({ id }: { id: string }) {
  const s = useStore();
  const t = useT();
  const d = useDocument(id);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [unlinked, setUnlinked] = useState<UnlinkedMentionsData>({
    items: [],
    total: 0,
  });
  const [boards, setBoards] = useState<DocSummary[]>([]);
  const doc = d.doc;

  // Linking rewrites another document, so both lists are refetched together:
  // what leaves one joins the other.
  const reload = useCallback(() => {
    api.backlinks(id).then(setBacklinks).catch(console.error);
    api.unlinkedMentions(id).then(setUnlinked).catch(console.error);
  }, [id]);

  useEffect(() => {
    let alive = true;
    api
      .backlinks(id)
      .then((b) => alive && setBacklinks(b))
      .catch(console.error);
    api
      .unlinkedMentions(id)
      .then((u) => alive && setUnlinked(u))
      .catch(console.error);
    // Material placed on a Board is visible from the document's side too, so
    // twelve Notes on a Board are not a one-way mirror (PLAN §17.6).
    api
      .boardsReferencing(id)
      .then((b) => alive && setBoards(b))
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
            label={t.add_child_to(sum.title)}
            onClick={() =>
              s.setDialog({
                kind: "new",
                type: "source",
                // The parent is settled by standing on its page, so the
                // dialog opens with it filled and the kind it usually holds.
                fields: {
                  parent: sum.title,
                  parent_id: sum.id,
                  kind: childKindFor(fmString(doc.frontmatter.kind)),
                },
              })
            }
          >
            <Plus />
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
        {type === "source" && (
          <IconButton
            label={t.new_note_from}
            onClick={() =>
              s.setDialog({
                kind: "new",
                type: "note",
                fields: { source: sum.title, source_id: sum.id },
              })
            }
          >
            <FilePlus />
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
            <TypeSection
              doc={doc}
              book={book}
              title={title}
              fm={d.fm}
              onFmChange={d.onFmChange}
            />
            {boards.length > 0 && (
              <Section
                title={t.boards}
                count={boards.length}
                hint={t.boards_hint}
              >
                <ul className="space-y-0.5" data-testid="hub-boards">
                  {boards.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                        onClick={() => {
                          s.setDocTab("board");
                          s.openDoc(b.id);
                        }}
                      >
                        <TypeDot type={b.type} />
                        <span className="min-w-0 flex-1 truncate">
                          {b.title}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <Backlinks items={backlinks} subject={type !== "source"} inline />
            {/* Adjacent to Backlinks: the same question asked the other way
                round, and the two lists never hold the same document. */}
            {doc && LINKABLE_TARGET_TYPES.includes(type) && (
              <UnlinkedMentions
                target={doc.summary}
                data={unlinked}
                onChanged={reload}
                inline
              />
            )}
            <About
              doc={doc}
              body={d.body}
              onBodyChange={d.setBodyText}
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

/**
 * The Source's Cover on its own Hub, and the place to change it (ADR 0012).
 *
 * Copying happens here and now rather than being staged, because the Source
 * already exists: its title is settled, so the picture can be named after it
 * straight away. Only the New dialog has to wait.
 */
function SourceCover({
  doc,
  fm,
  onFmChange,
}: {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const cover = fmString(doc.frontmatter.cover);

  const choose = async () => {
    const picked = await openFileDialog({
      multiple: false,
      filters: [
        { name: "Image", extensions: ["jpg", "jpeg", "png", "gif", "webp"] },
      ],
    });
    if (typeof picked !== "string") return;
    setBusy(true);
    try {
      const rel = await api.attachImage(doc.summary.title, picked);
      onFmChange(setField(fm, "cover", rel));
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="hub-cover" className="w-full md:w-40">
      <button
        type="button"
        data-testid="hub-cover-choose"
        className="group relative block w-full rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={t.cover_choose}
        title={t.cover_choose}
        disabled={busy}
        onClick={choose}
      >
        <Cover
          entry={{
            id: doc.summary.id,
            title: doc.summary.title,
            kind: fmString(doc.frontmatter.kind),
            cover,
            date: fmString(doc.frontmatter.date),
            parent_id: null,
            child_count: 0,
          }}
        />
        <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
          <ImagePlus className="size-5 text-white" />
        </span>
      </button>
      {/^https?:\/\//i.test(cover) && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 w-full"
          data-testid="hub-cover-save-copy"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const rel = await api.saveRemoteCover(doc.summary.title, cover);
              onFmChange(setField(fm, "cover", rel));
            } catch (e) {
              console.error(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t.cover_save_copy}
        </Button>
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
      {type === "source" && (
        // The same slot a Place uses for its mini-map: a Source's Cover is
        // what identifies it at a glance, in the Library and here (ADR 0012).
        <SourceCover doc={doc} fm={fm} onFmChange={onFmChange} />
      )}
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

/**
 * Which sections each type's Hub shows.
 *
 * A total map rather than a switch with a `default: return null`: a type added
 * to `DocType` without an entry here is a compile error naming the missing
 * key, where before it rendered an empty Hub in silence.
 *
 * `null` is a type that shows no type-specific section, said out loud.
 */
const HUB_SECTIONS: Record<DocType, ((p: SectionProps) => ReactNode) | null> = {
  source: ({ doc }) => <SourceSection doc={doc} />,
  book: ({ doc, book, title }) =>
    book ? <ScriptureSection doc={doc} book={book} title={title} /> : null,
  chapter: ({ doc, book, title }) =>
    book ? <ScriptureSection doc={doc} book={book} title={title} /> : null,
  verse: ({ doc, book, title }) =>
    book ? <ScriptureSection doc={doc} book={book} title={title} /> : null,
  journey: ({ doc, fm, onFmChange }) => (
    <>
      <JourneySection doc={doc} fm={fm} onFmChange={onFmChange} />
      <DatesSection doc={doc} />
    </>
  ),
  event: ({ doc }) => <DatesSection doc={doc} />,
  character: ({ doc }) => <DatesSection doc={doc} />,
  place: ({ doc }) => <DatesSection doc={doc} />,
  concept: ({ doc }) => <DatesSection doc={doc} />,
  // Writings open in the editor and have no Hub of their own (CONTEXT.md).
  note: null,
  clipping: null,
  composition: null,
  other: null,
};

function TypeSection(p: SectionProps) {
  const render = HUB_SECTIONS[p.doc.summary.type];
  return render ? render(p) : null;
}

/** The list a `places` Property holds, whatever shape YAML gave it. */
function stopList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

/** The document a `[[wikilink]]` names, or the text itself when it is bare. */
function linkTarget(raw: string): string {
  const m = raw.match(/^\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/);
  return (m ? m[1] : raw).trim();
}

/**
 * A Journey's Stops in travel order (PLAN §19.11): reorder, remove, and add
 * from the Vault's Places. The order of this list is the route, so it is
 * edited here rather than through the plain `list` widget, which cannot
 * reorder — and getting the order wrong on a first pass is certain.
 */
function JourneySection({
  doc,
  fm,
  onFmChange,
}: {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
}) {
  const s = useStore();
  const t = useT();
  const [journey, setJourney] = useState<Journey | null>(null);
  const id = doc.summary.id;

  useEffect(() => {
    api
      .journeys()
      .then((js) => setJourney(js.find((j) => j.doc.id === id) ?? null))
      .catch(console.error);
  }, [id, s.changeTick, doc.summary.mtime]);

  const stops = journey?.stops ?? [];
  const cannot = stops.filter((x) => x.status !== "ok").length;

  // Written the way every other list Property is (ChipsRow): through the
  // frontmatter text, so one edit path serves the app and Obsidian alike.
  const write = (next: string[]) =>
    onFmChange(setField(fm, "places", next.length ? next : null));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= stops.length) return;
    const raw = stopList(doc.frontmatter.places);
    const next = [...raw];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    write(next);
  };
  const remove = (i: number) => {
    const next = stopList(doc.frontmatter.places).filter((_, n) => n !== i);
    write(next);
  };

  const why = (status: string) =>
    status === "no_coords"
      ? t.journey_stop_no_coords
      : status === "unresolved"
        ? t.journey_stop_unresolved
        : status === "not_a_place"
          ? t.journey_stop_not_a_place
          : "";

  return (
    <section
      data-testid="journey-stops"
      className="rounded-2xl border bg-card p-6 shadow-xs"
    >
      <h2 className="mb-1 text-sm font-semibold">{t.journey_stops}</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        {t.journey_stops_hint}
      </p>
      {cannot > 0 && (
        <p
          data-testid="journey-undrawable"
          className="mb-3 text-xs text-muted-foreground"
        >
          {t.journey_undrawable(cannot)}
        </p>
      )}
      {stops.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.no_journey_stops}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {stops.map((stop, i) => (
            <li
              key={`${stop.target}-${i}`}
              data-testid="journey-stop"
              data-status={stop.status}
              className="flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5"
            >
              <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm hover:underline underline-offset-2"
                onClick={() => s.openLink(linkTarget(stop.target))}
              >
                {stop.doc?.title ?? linkTarget(stop.target)}
              </button>
              {stop.status !== "ok" && (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {why(stop.status)}
                </span>
              )}
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t.journey_move_up}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ChevronUp />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t.journey_move_down}
                  disabled={i === stops.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ChevronDown />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t.journey_remove_stop}
                  onClick={() => remove(i)}
                >
                  <X />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Button
        size="sm"
        variant="outline"
        className="mt-3"
        data-testid="journey-show-on-map"
        onClick={() => {
          s.setMapFilters({ ...s.mapFilters, journeys: [id] });
          s.navigate({ kind: "map" });
        }}
      >
        <MapPin />
        {t.show_on_map}
      </Button>
    </section>
  );
}

/** Dates on a Subject (ADR 0005) and, for anything but an Event, the Events naming it. */
function DatesSection({ doc }: { doc: DocumentPayload }) {
  const s = useStore();
  const t = useT();
  const id = doc.summary.id;
  const isEvent = doc.summary.type === "event";
  const [dates, setDates] = useState<DatedProperty[]>([]);
  const [events, setEvents] = useState<DocSummary[]>([]);
  // The mini-timeline needs each Event's own Dates, which `eventsNaming` omits.
  const [eventDates, setEventDates] = useState<
    { doc: DocSummary; dates: DatedProperty[] }[]
  >([]);
  useEffect(() => {
    let alive = true;
    api
      .datesOf(id)
      .then((x) => alive && setDates(x))
      .catch(console.error);
    if (!isEvent)
      api
        .eventsNaming(id)
        .then(async (x) => {
          if (!alive) return;
          setEvents(x);
          const withDates = await Promise.all(
            x.map(async (e) => ({ doc: e, dates: await api.datesOf(e.id) })),
          );
          if (alive) setEventDates(withDates);
        })
        .catch(console.error);
    return () => {
      alive = false;
    };
  }, [id, isEvent, s.changeTick, doc.summary.mtime]);
  if (dates.length === 0 && (isEvent || events.length === 0)) return null;
  const anyParsed =
    dates.some((d) => d.date) ||
    eventDates.some((e) => e.dates.some((d) => d.date));
  return (
    <section data-testid="hub-dates" className="space-y-4">
      {anyParsed && (
        <MiniTimeline doc={doc.summary} dates={dates} events={eventDates} />
      )}
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

/**
 * Add parts to a Source without leaving its page (ADR 0012).
 *
 * Title only: the parent, and the kind a parent of this kind usually holds,
 * are inherited, so adding a dozen chapters is a dozen keystrokes and an
 * Enter each rather than a dozen trips through the dialog. The field keeps
 * focus between them.
 *
 * Pasting several lines creates them all, behind a confirm — a contents page
 * is usually something you can copy, and creating twelve files is not
 * something to do silently.
 */
function AddChildren({
  parent,
  parentKind,
}: {
  parent: DocSummary;
  parentKind: string;
}) {
  const s = useStore();
  const t = useT();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const kind = childKindFor(parentKind);

  const create = async (titles: string[]) => {
    setBusy(true);
    try {
      for (const title of titles) {
        await s.createDoc(
          "source",
          title,
          { kind, parent: `[[${parent.title}]]` },
          "",
          // Stay on the parent: the point of the row is to add a dozen parts
          // without leaving the page, and opening each one defeats it.
          false,
        );
      }
      setValue("");
      setPending(null);
    } finally {
      setBusy(false);
      // After re-enabling, not before: a disabled input cannot take focus, and
      // keeping it is what makes a run of a dozen parts one keystroke each.
      requestAnimationFrame(() => input.current?.focus());
    }
  };

  if (pending) {
    return (
      <div
        data-testid="add-children-confirm"
        className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 text-sm"
      >
        <span className="min-w-0 flex-1">
          {t.add_many_confirm(pending.length)}
        </span>
        <Button size="sm" disabled={busy} onClick={() => create(pending)}>
          {t.create}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
          {t.cancel}
        </Button>
      </div>
    );
  }

  return (
    <Input
      ref={input}
      data-testid="add-child-input"
      className="h-8 text-sm"
      value={value}
      disabled={busy}
      placeholder={t.add_child_placeholder}
      onChange={(e) => setValue(e.target.value)}
      onPaste={(e) => {
        const lines = e.clipboardData
          .getData("text")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        // One line is an ordinary paste; a list is a batch worth confirming.
        if (lines.length < 2) return;
        e.preventDefault();
        setPending(lines);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const title = value.trim();
        if (title) create([title]);
      }}
    />
  );
}

/**
 * Keep a Clipping or write a Note without leaving the Source.
 *
 * The Source is settled by standing on its page, so it is shown rather than
 * picked — the fast path should not re-ask a question navigating here already
 * answered. The full dialog in the header is where a Clipping goes to a
 * different Source, or carries a URL and a Cover.
 */
function SourceCapture({ source }: { source: DocSummary }) {
  const s = useStore();
  const t = useT();
  const [type, setType] = useState<"clipping" | "note">("clipping");
  const [text, setText] = useState("");
  const [locator, setLocator] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const clipping = type === "clipping";

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const fields: Record<string, string> = {
        source: `[[${source.title}]]`,
      };
      if (clipping && locator.trim()) fields.locator = locator.trim();
      await s.createDoc(
        type,
        // A Clipping has no title: the engine names the file from the
        // Citation in these fields (ADR 0013).
        clipping ? "" : title.trim() || stamp(),
        fields,
        clipping ? quoteBody(text) : text.trim() + "\n",
        // Stay on the Source: capturing five passages from one chapter is the
        // point, and opening each one defeats it.
        false,
      );
      setText("");
      setLocator("");
      setTitle("");
    } finally {
      setBusy(false);
      // After re-enabling, not before: a disabled textarea cannot take focus.
      requestAnimationFrame(() => area.current?.focus());
    }
  };

  return (
    <section
      data-testid="hub-capture"
      className={cn(
        "mb-6 rounded-lg border-l-2 bg-card p-3",
        clipping ? "border-l-type-clipping" : "border-l-type-note",
      )}
    >
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex gap-1">
          {(["clipping", "note"] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={type === k ? "default" : "ghost"}
              className="h-auto min-h-7 px-2 text-xs whitespace-normal"
              data-testid={`capture-as-${k}`}
              aria-pressed={type === k}
              onClick={() => setType(k)}
            >
              <TypeDot type={k} />
              {t.types[k]}
            </Button>
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {t.capture_from(source.title)}
        </span>
      </div>
      <Textarea
        ref={area}
        rows={3}
        data-testid="capture-text"
        className="font-prose text-[15px]"
        placeholder={
          clipping ? t.capture_clipping_placeholder : t.capture_note_placeholder
        }
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          data-testid={clipping ? "capture-locator" : "capture-title"}
          className="h-8 min-w-0 flex-1 text-sm"
          placeholder={clipping ? t.locator : t.capture_note_title}
          value={clipping ? locator : title}
          disabled={busy}
          onChange={(e) =>
            clipping ? setLocator(e.target.value) : setTitle(e.target.value)
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button
          size="sm"
          data-testid="capture-submit"
          className="h-8"
          disabled={!text.trim() || busy}
          onClick={submit}
        >
          {t.create}
          <Kbd className="bg-primary-foreground/20 text-primary-foreground">
            {shortcut("↵")}
          </Kbd>
        </Button>
      </div>
    </section>
  );
}

function SourceSection({ doc }: { doc: DocumentPayload }) {
  const s = useStore();
  const t = useT();
  const id = doc.summary.id;
  // The kind a new part defaults to depends on what this Source is: a book
  // holds chapters, a periodical issues.
  const sourceKind = String(doc.frontmatter.kind ?? "");
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  const [clippings, setClippings] = useState<TrailEntry[]>([]);
  const [children, setChildren] = useState<DocSummary[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .sourceTrail(id)
      .then((x) => alive && setTrail(x))
      .catch(console.error);
    api
      .clippings(id)
      .then((x) => alive && setClippings(x))
      .catch(console.error);
    api
      .sourceChildren(id)
      .then((x) => alive && setChildren(x))
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [id, s.changeTick, doc.summary.mtime]);
  // Group under the child Source each entry came from; the parent's own
  // entries first. Clippings are left out: they have their own section above,
  // because a Clipping belongs to its Source in a way that a Note merely
  // citing it does not (ADR 0013).
  const groups = useMemo(() => {
    const m = new Map<string, { source: DocSummary; items: TrailEntry[] }>();
    for (const e of trail.filter((e) => e.doc.type !== "clipping")) {
      const g = m.get(e.source.id) ?? { source: e.source, items: [] };
      g.items.push(e);
      m.set(e.source.id, g);
    }
    const own = m.get(id);
    m.delete(id);
    return [...(own ? [own] : []), ...m.values()];
  }, [trail, id]);
  return (
    <>
      <SourceCapture source={doc.summary} />
      {clippings.length > 0 && (
        <section data-testid="hub-clippings" className="mb-6">
          <PanelTitle className="mb-3">{t.types_plural.clipping}</PanelTitle>
          <ul className="space-y-2">
            {clippings.map((e) => (
              <li key={e.doc.id}>
                <button
                  type="button"
                  data-testid="hub-clipping"
                  className="flex w-full min-w-0 gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent"
                  onClick={() => s.openDoc(e.doc.id)}
                >
                  <span className="w-16 shrink-0 truncate pt-0.5 text-xs text-muted-foreground tabular-nums">
                    {e.locator ?? "—"}
                  </span>
                  {/* The quote is the point; a Clipping has no title. */}
                  <span className="min-w-0 flex-1 font-prose text-sm leading-relaxed break-words">
                    {e.doc.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section data-testid="hub-trail">
        <PanelTitle className="mb-3">{t.reading_trail}</PanelTitle>
        {groups.length === 0 && children.length === 0 && (
          <Empty text={t.no_trail} />
        )}
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
                        {e.doc.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
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
            <div className="mt-2">
              <AddChildren parent={doc.summary} parentKind={sourceKind} />
            </div>
          </div>
        </div>
      </section>
    </>
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
                {b.doc.label}
              </span>
              <EventDate doc={b.doc} />
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
