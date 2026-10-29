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
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Waypoints,
} from "lucide-react";
import { cn } from "cn";
import {
  api,
  fmString,
  type Backlink,
  type DocSummary,
  type DocType,
  type DocumentPayload,
  type Journey,
  type GazetteerHit,
  type LibraryEntry,
  type TrailEntry,
  type UnlinkedMentions as UnlinkedMentionsData,
  type VerseCount,
  LINKABLE_TARGET_TYPES,
} from "@/lib/api";
import { SPAN, dateAdds, type SectionProps } from "@/lib/docTypes";
import { checkNewProperty } from "@/lib/propertyName";
import { useQuery } from "@/lib/useQuery";
import { formatShortcut, shortcut } from "@/lib/keys";
import {
  ancestorsOf,
  childKindFor,
  descendantIds,
  holderKindFor,
  isContainerKind,
  isSourceKind,
  SOURCE_KINDS,
  type SourceKind,
} from "@/lib/library";
import { quoteBody } from "@/lib/clippingBody";
import { removeField, setField, splitFrontmatter } from "@/lib/frontmatter";
import { kindCatalogue, kindOf, stopChoices, type KindDef, type StopChoice } from "@/lib/map";
import { addAtlas, removeMap } from "@/lib/atlas";
import { pinIconSvg } from "@/lib/pinIcons";
import { useStore } from "@/lib/store";
import { useDocument } from "@/lib/useDocument";
import { propertyLabel, useT } from "@/i18n";
import { Editor } from "@/editor/Editor";
import { attachPictures } from "@/editor/pictures";
import type { EditorEnv } from "@/editor/decorations";
import { DocPicker, stamp } from "@/components/Dialogs";
import { ChipsRow, TagsRow, TitleEditor } from "@/components/DocHeader";
import { KindPicker } from "@/components/KindPicker";
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
import { DatePreview } from "@/components/DatePreview";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { TutorialButton } from "@/components/TutorialPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function HubView({ id }: { id: string }) {
  const s = useStore();
  const t = useT();
  const d = useDocument(id);
  const [hover, setHover] = useState<HoverState | null>(null);
  const doc = d.doc;
  const mtime = doc?.summary.mtime;

  // Anything written anywhere may point at this Hub, and saving the Hub itself
  // changes what these lists say, so they follow both.
  const { data: backlinksData, refetch: refetchBacklinks } = useQuery<
    Backlink[]
  >({
    key: [id, mtime],
    deps: { any: true },
    fetch: () => api.backlinks(id),
  });
  const { data: unlinkedData, refetch: refetchUnlinked } =
    useQuery<UnlinkedMentionsData>({
      key: [id, mtime],
      deps: { any: true },
      fetch: () => api.unlinkedMentions(id),
    });
  // Material placed on a Board is visible from the document's side too, so
  // twelve Notes on a Board are not a one-way mirror (PLAN §17.6).
  const { data: boardsData } = useQuery<DocSummary[]>({
    key: [id, mtime],
    deps: { types: ["composition"] },
    fetch: () => api.boardsReferencing(id),
  });
  const backlinks = useMemo(() => backlinksData ?? [], [backlinksData]);
  const unlinked = useMemo<UnlinkedMentionsData>(
    () => unlinkedData ?? { items: [], total: 0 },
    [unlinkedData],
  );
  const boards = useMemo(() => boardsData ?? [], [boardsData]);
  // A Source's place among the others: the breadcrumb of what it sits
  // inside, and what its "Part of" picker may offer (§28.3). The Library's
  // own query, so a parent resolves exactly as it does on a Shelf.
  const isSource = doc?.summary.type === "source";
  const { data: libraryData } = useQuery<LibraryEntry[]>({
    key: [id, mtime],
    deps: { types: ["source"] },
    fetch: () => api.library(),
    enabled: isSource,
  });
  const library = useMemo(() => libraryData ?? [], [libraryData]);
  // Where a Source sits is read by the sidebar, the Library and this page's
  // breadcrumb, none of which a page's own save reaches: the engine announces
  // only changes made outside the app. So a saved change of parent or kind is
  // announced here, once it is on disk.
  const placeKey = isSource
    ? JSON.stringify([id, fmString(doc!.frontmatter.parent), fmString(doc!.frontmatter.kind)])
    : null;
  const lastPlace = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastPlace.current;
    lastPlace.current = placeKey;
    if (!prev || !placeKey || prev === placeKey) return;
    if (JSON.parse(prev)[0] !== id) return;
    s.announceChanged([id]).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey]);

  // Linking rewrites another document, so both lists are refetched together:
  // what leaves one joins the other (ADR 0011).
  const reload = useCallback(() => {
    refetchBacklinks();
    refetchUnlinked();
  }, [refetchBacklinks, refetchUnlinked]);

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
        <TutorialButton place={{ kind: "hub", type }} />
        {/* Not on a phone, where a Source's header is full already: the
            "Open local graph" Command reaches it there. */}
        <IconButton
          label={t.local_graph}
          data-testid="open-local-graph"
          className="hidden md:inline-flex"
          onClick={() => s.navigate({ kind: "graph", focus: sum.id })}
        >
          <Waypoints />
        </IconButton>
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
            library={library}
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
            {/* Last but About: the file's own values, out of the header so
                they never read as the page's content (§28.2). */}
            {!isScripture && (
              <HubProperties
                doc={doc}
                fm={d.fm}
                onFmChange={d.onFmChange}
                library={library}
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
    // Beside the title from tablet width up; on a phone that column would
    // break the title mid-word, so it sits under it, small (§28.3).
    <div data-testid="hub-cover" className="flex items-end gap-3 md:block md:w-24">
      <button
        type="button"
        data-testid="hub-cover-choose"
        className="group relative block w-20 shrink-0 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:w-full"
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
          className="h-auto min-h-8 text-xs whitespace-normal md:mt-2 md:w-full"
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
  library,
}: {
  doc: DocumentPayload;
  title: string;
  readOnlyTitle: boolean;
  onRename: (t: string) => Promise<void>;
  fm: string;
  onFmChange: (fm: string) => void;
  library: LibraryEntry[];
}) {
  const s = useStore();
  const t = useT();
  const type = doc.summary.type;
  const hasAliases = HAS_ALIASES.includes(type);
  const kindText = typeof doc.frontmatter.kind === "string" ? doc.frontmatter.kind : "";
  const placeKind = useMemo(() => kindOf(kindText, kindCatalogue(s.placeKinds)), [kindText, s.placeKinds]);
  const isPlace =
    type === "place" && doc.summary.lat != null && doc.summary.lon != null;
  const aliasSuggestions = useMemo(() => [] as { value: string }[], []);
  // Only what says what this page is (§28.2): its type, title and Tags, and
  // the values a type edits with a control of its own. Every other Property
  // is at the foot of the page.
  return (
    <div
      data-testid="hub-header"
      className={cn(
        "grid gap-4 rounded-2xl border bg-card p-6 shadow-xs md:grid-cols-[1fr_auto]",
      )}
    >
      <div className="min-w-0">
        {type === "source" && (
          <SourceBreadcrumb doc={doc} fm={fm} onFmChange={onFmChange} library={library} />
        )}
        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
          <TypeDot type={type} />
          {t.types[type]}
        </div>
        <TitleEditor
          title={title}
          readOnly={readOnlyTitle}
          onRename={onRename}
        />
        {type === "source" && (
          <SourceKindLine doc={doc} fm={fm} onFmChange={onFmChange} library={library} />
        )}
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
        {type === "place" && (
          <div className="mt-2 flex items-center gap-2" data-testid="hub-kind">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">{t.kind}</span>
            <KindPicker
              value={kindText}
              onChange={(k) => onFmChange(setField(fm, "kind", k))}
            />
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
          <MiniMap lat={doc.summary.lat!} lon={doc.summary.lon!} kind={placeKind} />
          <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-popover/90 px-1.5 py-0.5 text-[11px] text-popover-foreground opacity-0 transition-opacity group-hover:opacity-100">
            <MapPin className="size-3" />
            {t.show_on_map}
          </span>
        </button>
      )}
    </div>
  );
}

// Every Topical Subject may go by other names. Scripture generates its own,
// and a Source's other names are not something it links by.
const HAS_ALIASES: readonly DocType[] = ["place", "character", "concept", "event", "journey"];

/**
 * Properties this page edits somewhere of its own, so the Properties section
 * leaves them out rather than offering the same value a second time.
 */
function ownedProperties(type: DocType): string[] {
  return [
    ...(SPAN[type] ?? []),
    ...(HAS_ALIASES.includes(type) ? ["aliases"] : []),
    // A Place's kind has its own picker (PLAN §27.12), and so has a
    // Source's (§28.1), with its Cover and its "Part of" (§28.3).
    ...(type === "place" ? ["kind"] : []),
    ...(type === "source" ? ["kind", "cover", "parent"] : []),
  ];
}

/**
 * The file's own values, at the foot of a Hub (§28.2): out of the header,
 * where a grid of fields read as what the page was about.
 */
function HubProperties({
  doc,
  fm,
  onFmChange,
  library,
}: {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
  library: LibraryEntry[];
}) {
  const t = useT();
  const type = doc.summary.type;
  const owned = useMemo(() => ownedProperties(type), [type]);
  // A Source inside another changes that from its breadcrumb; one that
  // stands alone has no breadcrumb, so its "Part of" is here (§28.3).
  const own = library.find((e) => e.id === doc.summary.id);
  const standsAlone = type === "source" && !!own && !own.parent_id;
  return (
    <section data-testid="hub-properties">
      <PanelTitle className="mb-3">{t.properties}</PanelTitle>
      {standsAlone && (
        <div className="mb-1.5 flex items-center gap-2 text-sm" data-testid="hub-part-of">
          <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
            {t.parent_source}
          </span>
          <div className="min-w-0 flex-1">
            <PartOfPicker doc={doc} fm={fm} onFmChange={onFmChange} library={library} />
          </div>
        </div>
      )}
      {/* Whatever the rest of this page already edits: the Span in the Dates
          section, the Aliases in their own row. Offering the same value twice
          is how one of them comes to disagree. */}
      <Properties
        doc={doc}
        fm={fm}
        onFmChange={onFmChange}
        hide={owned}
        inline
      />
    </section>
  );
}

/**
 * Choose the Source this one sits inside (§20.11): an existing Source, picked
 * by name, or an explicit "Create X". Never itself or one of its own parts,
 * which would make a loop. `holder` narrows it to the kind that holds this
 * one, when a chapter or an issue was just named (§28.7).
 */
function PartOfPicker({
  doc,
  fm,
  onFmChange,
  library,
  holder,
  onDone,
  autoFocus,
}: {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
  library: LibraryEntry[];
  holder?: SourceKind | null;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const s = useStore();
  const id = doc.summary.id;
  const current = linkTarget(fmString(doc.frontmatter.parent));
  const kindOfId = useMemo(() => new Map(library.map((e) => [e.id, e.kind.trim().toLowerCase()])), [library]);
  const inside = useMemo(() => descendantIds(library, id), [library, id]);
  const filter = useCallback(
    (d: DocSummary) => !inside.has(d.id) && (!holder || kindOfId.get(d.id) === holder),
    [inside, holder, kindOfId],
  );
  return (
    <DocPicker
      types={SOURCE_TYPES}
      testId="part-of-picker"
      value={current}
      filter={filter}
      autoFocus={autoFocus}
      // Only a pick writes: typing clears the box, never the file.
      onChange={(_, d) => {
        if (!d) return;
        onFmChange(setField(fm, "parent", `[[${d.title}]]`));
        onDone?.();
      }}
      onCreate={async (name) => {
        const created = await s.createDoc("source", name, { kind: holder ?? "book" }, undefined, false);
        onFmChange(setField(fm, "parent", `[[${created.summary.title}]]`));
        onDone?.();
      }}
    />
  );
}

const SOURCE_TYPES: DocType[] = ["source"];

/**
 * Where a Source sits (§28.3): each Source it is inside, outermost first,
 * each opening its own page, then the way to change it. Nothing for a Source
 * that stands alone.
 */
function SourceBreadcrumb({
  doc,
  fm,
  onFmChange,
  library,
}: {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
  library: LibraryEntry[];
}) {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const chain = useMemo(() => ancestorsOf(library, doc.summary.id), [library, doc.summary.id]);
  if (chain.length === 0) return null;
  return (
    <nav
      data-testid="hub-breadcrumb"
      aria-label={t.parent_source}
      className="mb-2 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-muted-foreground"
    >
      {chain.map((a) => (
        <span key={a.id} className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            data-testid="breadcrumb-step"
            className="min-w-0 truncate underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => s.openDoc(a.id)}
          >
            {a.title}
          </button>
          <ChevronRight className="size-3.5 shrink-0" />
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <IconButton label={t.part_of_change} size="icon-xs" data-testid="part-of-edit">
            <Pencil />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-2" data-testid="part-of-popover">
          {/* Above the picker, where its list of names cannot cover it. */}
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t.parent_source}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-auto min-h-7 px-2 text-xs whitespace-normal"
              data-testid="part-of-clear"
              onClick={() => {
                onFmChange(removeField(fm, "parent"));
                setOpen(false);
              }}
            >
              <X />
              {t.part_of_clear}
            </Button>
          </div>
          <PartOfPicker
            doc={doc}
            fm={fm}
            onFmChange={onFmChange}
            library={library}
            onDone={() => setOpen(false)}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </nav>
  );
}

/**
 * A Source's kind, as a picker of the nine (§28.1), and its date beside it:
 * "Book · 2019". Naming a chapter or an issue on a Source that sits inside
 * nothing asks at once what holds it (§28.7); dismissing that keeps the kind,
 * and the Source waits on Unshelved.
 */
function SourceKindLine({
  doc,
  fm,
  onFmChange,
  library,
}: {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
  library: LibraryEntry[];
}) {
  const t = useT();
  const [ask, setAsk] = useState<SourceKind | null>(null);
  const raw = fmString(doc.frontmatter.kind).trim();
  const kind = raw.toLowerCase();
  const known = isSourceKind(kind);
  const date = fmString(doc.frontmatter.date).trim();
  const own = library.find((e) => e.id === doc.summary.id);
  const hasParent = own ? !!own.parent_id : !!linkTarget(fmString(doc.frontmatter.parent));
  const kinds = t.kinds as Record<SourceKind, string>;
  return (
    <>
      <Popover open={ask !== null} onOpenChange={(o) => !o && setAsk(null)}>
        <PopoverAnchor asChild>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="hub-kind-line">
            <Select
              value={known ? kind : raw}
              onValueChange={(k) => {
                onFmChange(setField(fm, "kind", k));
                const holder = holderKindFor(k);
                // After the menu has closed and handed focus back to its
                // trigger: opened sooner, that focus move dismisses it.
                if (holder && !hasParent) setTimeout(() => setAsk(holder), 0);
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={t.kind}
                data-testid="hub-source-kind"
                className="h-auto min-h-7 max-w-full text-xs whitespace-normal"
              >
                <SelectValue placeholder={t.kind} />
              </SelectTrigger>
              <SelectContent>
                {/* A hand-written kind is shown as written, never rewritten
                    until the user picks one of the nine (ADR 0003). */}
                {raw && !known && (
                  <SelectItem value={raw} disabled>
                    {raw}
                  </SelectItem>
                )}
                {SOURCE_KINDS.map((k) => (
                  <SelectItem key={k} value={k} data-testid={`kind-option-${k}`}>
                    {kinds[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {date && (
              <span className="min-w-0 text-sm text-muted-foreground" data-testid="hub-source-date">
                · {date}
              </span>
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent align="start" className="w-72 space-y-2" data-testid="part-of-ask">
          <div className="text-sm font-medium">{t.part_of_ask}</div>
          <p className="text-xs text-muted-foreground">{t.part_of_ask_hint}</p>
          <PartOfPicker
            doc={doc}
            fm={fm}
            onFmChange={onFmChange}
            library={library}
            holder={ask}
            onDone={() => setAsk(null)}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {raw && !known && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="hub-kind-unknown">
          {t.kind_unknown(raw)}
        </p>
      )}
    </>
  );
}

function miniPin(kind: KindDef | null): string {
  const color =
    getComputedStyle(document.documentElement).getPropertyValue(kind?.token ?? "--c-place").trim() || "#c04f6b";
  const glyph = kind ? pinIconSvg(kind.icon, 13) : `<span class="map-pin-dot"></span>`;
  return (
    `<div class="map-place has-pin"><span class="map-pin" style="background:${color}">` +
    `<span class="map-pin-glyph">${glyph}</span></span></div>`
  );
}

function MiniMap({ lat, lon, kind }: { lat: number; lon: number; kind: KindDef | null }) {
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
    const atlas = addAtlas(map, { online: false });
    // The same badge the Map draws, in its kind's colour (PLAN §27.15).
    const marker = L.marker([lat, lon], {
      interactive: false,
      icon: L.divIcon({ className: "map-place-icon", html: miniPin(kind), iconSize: [0, 0], iconAnchor: [0, 0] }),
    }).addTo(map);
    const restyle = () => {
      atlas.restyle();
      marker.setIcon(L.divIcon({ className: "map-place-icon", html: miniPin(kind), iconSize: [0, 0], iconAnchor: [0, 0] }));
    };
    window.addEventListener("skin:applied", restyle);
    return () => {
      window.removeEventListener("skin:applied", restyle);
      removeMap(map);
    };
  }, [lat, lon, kind]);
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
      <DatesSection doc={doc} fm={fm} onFmChange={onFmChange} />
    </>
  ),
  event: ({ doc, fm, onFmChange }) => (
    <DatesSection doc={doc} fm={fm} onFmChange={onFmChange} />
  ),
  character: ({ doc, fm, onFmChange }) => (
    <DatesSection doc={doc} fm={fm} onFmChange={onFmChange} />
  ),
  place: ({ doc, fm, onFmChange }) => (
    <DatesSection doc={doc} fm={fm} onFmChange={onFmChange} />
  ),
  concept: ({ doc, fm, onFmChange }) => (
    <DatesSection doc={doc} fm={fm} onFmChange={onFmChange} />
  ),
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
  // The list as last written, until the saved document catches up: two quick
  // clicks on the arrows must each start from the order the previous one left.
  const written = useRef<{ from: unknown; places: string[] } | null>(null);
  const places = () =>
    written.current && written.current.from === doc.frontmatter.places
      ? written.current.places
      : stopList(doc.frontmatter.places);
  const write = (next: string[]) => {
    written.current = { from: doc.frontmatter.places, places: next };
    onFmChange(setField(fm, "places", next.length ? next : null));
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= stops.length) return;
    const raw = places();
    const next = [...raw];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    write(next);
  };
  const remove = (i: number) => {
    const next = places().filter((_, n) => n !== i);
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
              {/* Why a Stop cannot be drawn goes under its name, not beside
                  it: « Pas encore de coordonnées » beside a name on a phone
                  left no room for the name. */}
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="block max-w-full truncate text-left text-sm hover:underline underline-offset-2"
                  onClick={() => s.openLink(linkTarget(stop.target))}
                >
                  {stop.doc?.title ?? linkTarget(stop.target)}
                </button>
                {stop.status !== "ok" && (
                  <span className="block text-[11px] text-muted-foreground">
                    {why(stop.status)}
                  </span>
                )}
              </div>
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
      <StopPicker
        onAdd={(title) =>
          write([...places(), `[[${title}]]`])
        }
      />
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

/**
 * "Add a Stop" (PLAN §19.11): search the Vault's Places first and the bundled
 * gazetteer second; picking a gazetteer entry makes the Place, coordinates and
 * all, so a twelve-Stop Journey is twelve picks rather than twelve trips to
 * the New Place dialog. It stays open after a pick, because Stops come in
 * runs, and appends: the move buttons put a Stop where it belongs.
 */
function StopPicker({ onAdd }: { onAdd: (title: string) => void }) {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { data: hits } = useQuery<GazetteerHit[]>({
    key: [q.trim()],
    deps: { none: true },
    enabled: open && q.trim() !== "",
    fetch: () => api.gazetteer(q, 8),
  });
  const places = useMemo(() => s.docs.filter((d) => d.type === "place"), [s.docs]);
  const choices = useMemo(() => stopChoices(q, places, q.trim() ? (hits ?? []) : []), [q, places, hits]);
  useEffect(() => setActive(0), [q]);

  const pick = async (c: StopChoice) => {
    if (busy) return;
    setBusy(true);
    try {
      if (c.kind === "place") onAdd(c.doc.title);
      else {
        const d = await s.createDoc("place", c.title, { lat: c.hit.lat, lon: c.hit.lon, modern_name: c.hit.modern_name, ...(c.hit.kind ? { kind: c.hit.kind } : {}) }, undefined, false);
        onAdd(d.summary.title);
      }
      setQ("");
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <Button size="sm" variant="outline" className="mt-3 mr-2" data-testid="journey-add-stop" onClick={() => setOpen(true)}>
        <Plus />
        {t.journey_add_stop}
      </Button>
    );
  return (
    <div className="mt-3 grid gap-1.5" data-testid="journey-stop-picker">
      <div className="flex min-w-0 items-center gap-2">
        <Input
          ref={input}
          autoFocus
          value={q}
          placeholder={t.journey_stop_search}
          aria-label={t.journey_add_stop}
          data-testid="journey-stop-input"
          className="min-w-0 flex-1"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, choices.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && choices[active]) {
              e.preventDefault();
              pick(choices[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
              setQ("");
            }
          }}
        />
        <Button size="sm" variant="ghost" className="h-auto min-h-8 shrink-0" data-testid="journey-stop-close" onClick={() => { setOpen(false); setQ(""); }}>
          {t.journey_stop_done}
        </Button>
      </div>
      {q.trim() !== "" && (
        <ul className="grid gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground" role="listbox">
          {choices.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">{t.journey_stop_nothing}</li>
          ) : (
            choices.map((c, i) => (
              <li key={c.kind === "place" ? c.doc.id : `${c.hit.name}|${c.hit.lat}|${c.hit.lon}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  data-testid="journey-stop-option"
                  data-kind={c.kind}
                  disabled={busy}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(c)}
                  className={cn("flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", i === active && "bg-accent")}
                >
                  <TypeDot type="place" />
                  <span className="min-w-0 flex-1 truncate">{c.kind === "place" ? c.doc.title : c.title}</span>
                  {c.kind === "gazetteer" && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {c.hit.modern_name && c.hit.modern_name !== c.title ? `${c.hit.modern_name} · ` : ""}
                      {t.journey_stop_new}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">{t.gazetteer_hint}</p>
    </div>
  );
}

/**
 * One half of a Span, editable in place.
 *
 * Local state with a commit on blur, like `TitleEditor`: the saved value comes
 * back through the document and would fight the cursor on every keystroke.
 *
 * Emptying the field removes the Property rather than writing `born: ""` — a
 * blank Date is not a Date, and a key with nothing after it would be parsed
 * back as an invalid one and flagged.
 */
function SpanDate({
  name,
  value,
  invalid,
  onWrite,
  autoFocus,
}: {
  name: string;
  value: string;
  invalid: boolean;
  /** Write the value typed, or `null` to remove the Property. */
  onWrite: (value: string | null) => void;
  /** Just added through "Add Date": the user means to type it now. */
  autoFocus?: boolean;
}) {
  const t = useT();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const next = text.trim();
    if (next === value.trim()) return;
    onWrite(next === "" ? null : next);
  };
  // The preview under the field reads the text as typed, so it also says why a
  // saved value is not a Date; the red border marks what is saved.
  return (
    <div className="min-w-0 flex-1 space-y-0.5">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setText(value);
        }}
        placeholder={t.date_placeholder}
        aria-label={propertyLabel(name, t)}
        data-testid={`date-input-${name}`}
        autoFocus={autoFocus}
        className={cn(
          "h-7 max-w-52 text-sm tabular-nums",
          invalid && "border-destructive text-destructive",
        )}
      />
      <DatePreview text={text} testId={`date-preview-${name}`} />
    </div>
  );
}

/**
 * Dates on a Subject (ADR 0005) and, for anything but an Event, the Events
 * naming it.
 *
 * An "Add Date" control offers what the page can still take (`dateAdds` in
 * lib/docTypes.tsx): the Span its type suggests in one click — "Add lifespan"
 * on a Character, "Add Span" on an Event, a Journey or a Place — or the half
 * of it that is missing, and a Date the user names. A Character with no Dates
 * used to show nothing at all, so recording a lifespan meant knowing that a
 * Property called `born` existed; the button names the convention instead.
 *
 * What is added is local until typed: a blank Date is not a Date, and
 * writing `born:` with nothing after it would be read back as an invalid one.
 * The row appears, focused, and the first value typed writes the Property.
 *
 * These Properties are edited here, so the Properties panel is told to leave
 * the Span out rather than offer the same value twice.
 */
function DatesSection({
  doc,
  fm,
  onFmChange,
}: {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
}) {
  const t = useT();
  const id = doc.summary.id;
  const isEvent = doc.summary.type === "event";
  const span = SPAN[doc.summary.type];
  // The mini-timeline needs each Event's own Dates, which `eventsNaming` omits.
  // This document's own Dates, and — unless it is an Event itself — every
  // Event naming it, each with the Dates the mini-timeline needs. One answer,
  // so an Event can never appear without the Dates that place it.
  const { data } = useQuery({
    key: [id, isEvent, doc.summary.mtime],
    deps: { types: ["event"] },
    fetch: async () => {
      const dates = await api.datesOf(id);
      if (isEvent) return { dates, events: [], eventDates: [] };
      const events = await api.eventsNaming(id);
      const eventDates = await Promise.all(
        events.map(async (e) => ({ doc: e, dates: await api.datesOf(e.id) })),
      );
      return { dates, events, eventDates };
    },
  });
  const dates = useMemo(() => data?.dates ?? [], [data]);
  const events = useMemo(() => data?.events ?? [], [data]);
  const eventDates = useMemo(() => data?.eventDates ?? [], [data]);
  const s = useStore();
  // Names added through "Add Date" and not yet typed into, and the one to
  // focus. Forgotten when another page opens.
  const [added, setAdded] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    setAdded([]);
    setFocus(null);
  }, [id]);
  const add = (names: readonly string[]) => {
    setAdded((a) => [...a, ...names.filter((n) => !a.includes(n))]);
    setFocus(names[0] ?? null);
  };
  const present = [...new Set([...dates.map((d) => d.name), ...added])];
  // The suggested pair first, then a Date just named, then any other Date the
  // document carries — a Character's `reign_start` keeps its place below the
  // lifespan.
  //
  // A named Date is edited here only until it is written. From then on it is
  // a Property like any other, edited in the Properties section and shown
  // here read-only, so no value has two fields to disagree.
  const byName = new Map(dates.map((d) => [d.name, d]));
  const editable = [
    ...(span ?? []).filter((n) => present.includes(n)),
    ...added.filter((n) => !span?.includes(n) && !byName.has(n)),
  ].map((name) => ({ name, row: byName.get(name) ?? null }));
  const others = dates.filter((d) => !span?.includes(d.name));
  // A name is typed Date for the whole Vault (ADR 0006) when its first value
  // is written, not when it is named: a Date named and left empty leaves no
  // trace.
  const write = async (name: string, value: string | null) => {
    if (value != null && !s.schema.types[name]) await s.setPropertyType(name, "date");
    onFmChange(setField(fm, name, value));
  };
  const anyParsed =
    dates.some((d) => d.date) ||
    eventDates.some((e) => e.dates.some((d) => d.date));
  return (
    <section data-testid="hub-dates" className="space-y-4">
      {anyParsed && (
        <MiniTimeline doc={doc.summary} dates={dates} events={eventDates} />
      )}
      <div>
        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
          <PanelTitle className="min-w-0">{t.dates}</PanelTitle>
          <AddDate type={doc.summary.type} present={present} onAdd={add} />
        </div>
        {(editable.length > 0 || others.length > 0) && (
          <ul className="space-y-1">
            {editable.map(({ name, row }) => (
              <li
                key={name}
                className="flex min-w-0 items-start gap-3 text-sm"
                data-testid={`date-${name}`}
                data-valid={row?.date ? "true" : "false"}
              >
                <span
                  className="w-24 shrink-0 truncate pt-1.5 text-xs text-muted-foreground"
                  title={name}
                >
                  {propertyLabel(name, t)}
                </span>
                <SpanDate
                  name={name}
                  value={row?.text ?? ""}
                  invalid={row != null && !row.date}
                  onWrite={(v) => write(name, v).catch(console.error)}
                  autoFocus={focus === name}
                />
              </li>
            ))}
            {others.map((d) => (
              <li
                key={d.name}
                className="flex min-w-0 items-baseline gap-3 text-sm"
                data-testid={`date-${d.name}`}
                data-valid={d.date ? "true" : "false"}
              >
                <span
                  className="w-24 shrink-0 truncate text-xs text-muted-foreground"
                  title={d.name}
                >
                  {propertyLabel(d.name, t)}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <span
                    className={cn(
                      "break-words tabular-nums",
                      !d.date && "text-destructive",
                    )}
                  >
                    {d.text}
                  </span>
                  {/* Why it is not a Date, as the field's own preview says it. */}
                  {!d.date && (
                    <DatePreview text={d.text} testId={`date-preview-${d.name}`} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
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
 * The Dates section's "Add Date" menu, and the name field its "Date…" opens.
 *
 * Naming follows the Properties panel's rule (`checkNewProperty`) with the
 * type fixed to Date: a name the Vault already types otherwise is refused,
 * since a name has one type everywhere (ADR 0006). A new name is typed Date
 * once its first value is written (`DatesSection`), not here.
 */
function AddDate({
  type,
  present,
  onAdd,
}: {
  type: DocType;
  present: readonly string[];
  onAdd: (names: readonly string[]) => void;
}) {
  const s = useStore();
  const t = useT();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const offers = dateAdds(type, present);
  const close = () => {
    setNaming(false);
    setName("");
    setError(null);
  };
  const submit = () => {
    const check = checkNewProperty(name, s.schema.types, "date");
    if (!check.ok) {
      if (check.reason === "taken")
        setError(t.date_name_taken(check.name, t.property_types[check.type]));
      else if (check.reason === "reserved") setError(t.date_name_reserved(check.name));
      return;
    }
    close();
    onAdd([check.name]);
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="xs"
            variant="ghost"
            data-testid="add-date"
            className="h-auto text-muted-foreground"
          >
            <Plus />
            {t.add_date}
          </Button>
        </DropdownMenuTrigger>
        {/* Focus goes to the field just added, not back to this button. */}
        <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
          {offers.map((o) =>
            o.kind === "pair" ? (
              <DropdownMenuItem
                key="pair"
                data-testid="add-date-pair"
                onSelect={() => onAdd(o.names)}
              >
                {o.label === "lifespan" ? t.add_lifespan : t.add_span}
              </DropdownMenuItem>
            ) : o.kind === "half" ? (
              <DropdownMenuItem
                key="half"
                data-testid="add-date-half"
                data-name={o.name}
                onSelect={() => onAdd([o.name])}
              >
                {t.add_date_half(propertyLabel(o.name, t))}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                key="named"
                data-testid="add-date-named"
                onSelect={() => setNaming(true)}
              >
                {t.add_date_named}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {naming && (
        <form
          className="flex w-full min-w-0 flex-wrap items-center gap-2"
          data-testid="date-name-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
            placeholder={t.date_name_placeholder}
            aria-label={t.add_date_named}
            data-testid="date-name-input"
            className="h-7 min-w-0 max-w-52 flex-1 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" data-testid="date-name-submit">
            {t.date_name_add}
          </Button>
          <IconButton label={t.cancel} onClick={close}>
            <X />
          </IconButton>
          {error && (
            <p
              className="flex w-full min-w-0 items-start gap-1 text-xs text-destructive"
              data-testid="date-name-error"
            >
              <CircleAlert className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0">{error}</span>
            </p>
          )}
        </form>
      )}
    </>
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
  // What was kept from this Source: its reading trail, its Clippings, and the
  // Sources sitting inside it. All three move with what cites this Source.
  const { data } = useQuery({
    key: [id, doc.summary.mtime],
    deps: { types: ["clipping", "note", "composition", "source"] },
    fetch: async () => {
      const [trail, clippings, children] = await Promise.all([
        api.sourceTrail(id),
        api.clippings(id),
        api.sourceChildren(id),
      ]);
      return { trail, clippings, children };
    },
  });
  const trail = useMemo(() => data?.trail ?? [], [data]);
  const clippings = useMemo(() => data?.clippings ?? [], [data]);
  const children = useMemo(() => data?.children ?? [], [data]);
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
  // Contains is offered up front by the kinds that have parts, and by any
  // Source that already holds some (§28.4).
  const showContains = children.length > 0 || isContainerKind(sourceKind.trim().toLowerCase());
  // What a sitting with a Source is for comes first: keeping something from
  // it, its parts, and what was kept (§28.4).
  return (
    <>
      <SourceCapture source={doc.summary} />
      {showContains && (
        <section data-testid="hub-contains" className="mb-6">
          <PanelTitle className="mb-3">
            {t.child_sources}
            {children.length > 0 && (
              <span className="ml-2 font-normal tabular-nums">{children.length}</span>
            )}
          </PanelTitle>
          {children.length > 0 && (
            <ul className="space-y-0.5">
              {children.map((c) => (
                <li key={c.id}>
                  <DocLink doc={c} />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2">
            <AddChildren parent={doc.summary} parentKind={sourceKind} />
          </div>
        </section>
      )}
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
        {groups.length === 0 && <Empty text={t.no_trail} />}
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
  // How heavily each part of this Book or Chapter is Mentioned, and who
  // Mentions the unit itself. Both counted from every document, so both move
  // with the whole vault.
  const { data } = useQuery({
    key: [sum.type, sum.chapter ?? null, sum.verse ?? null, book.number],
    deps: { any: true },
    fetch: async () => {
      let cells: { n: number; count: number }[] = [];
      if (sum.type === "book") {
        const c = await api.coverage();
        const byCh = new Map(
          c.filter((x) => x.book === book.number).map((x) => [x.chapter, x.count]),
        );
        cells = book.chapters.map((_, i) => ({
          n: i + 1,
          count: byCh.get(i + 1) ?? 0,
        }));
      } else if (sum.type === "chapter" && sum.chapter) {
        const max = book.chapters[sum.chapter - 1];
        const v: VerseCount[] = await api.verseCoverage(book.number, sum.chapter);
        const byV = new Map(v.map((x) => [x.verse, x.count]));
        cells = Array.from({ length: max }, (_, i) => ({
          n: i + 1,
          count: byV.get(i + 1) ?? 0,
        }));
      }
      const mentions = await api.verseMentions(
        book.number,
        sum.type === "book" ? undefined : (sum.chapter ?? undefined),
        sum.type === "verse" ? (sum.verse ?? undefined) : undefined,
      );
      return { cells, mentions };
    },
  });
  const cells = useMemo(() => data?.cells ?? [], [data]);
  const mentions = data?.mentions ?? null;

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
  // The empty About takes a dropped Picture too, and opens with it as its
  // first line: the same writing as a Note, before a word is typed (ADR 0019).
  const [dragging, setDragging] = useState(false);
  const onDrop = async (e: React.DragEvent) => {
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    e.preventDefault();
    const lines = await attachPictures(title, files, {
      missing: t.picture_missing,
      refused: t.picture_refused,
      failed: t.picture_failed,
    });
    if (!lines.length) return;
    onBodyChange(lines.join("\n") + "\n");
    setOpen(true);
  };
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
            pictureTitle={title}
          />
        </div>
      ) : (
        <button
          type="button"
          data-testid="hub-about-empty"
          className={cn(
            "w-full rounded-xl border border-dashed px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-solid hover:bg-accent hover:text-foreground",
            dragging && "border-solid border-primary bg-accent text-foreground",
          )}
          onClick={() => setOpen(true)}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {prompt}
        </button>
      )}
    </section>
  );
}
