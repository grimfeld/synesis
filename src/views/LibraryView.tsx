// The Library (ADR 0012): every Source the user holds, arranged on Shelves —
// all the books together, all the videos together. Browsing, not searching.
//
// Shelves scroll sideways, at every width: the shelf is the metaphor, and it
// does not become a grid on a phone. `locales.cy.ts` needs no exemption for
// that — its overflow check only fails a box that *clips*, and a scroller is
// allowed to hold more than it shows. The cards inside it still have to
// survive French at 375px, so each is `min-w-0` and its text clamps.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LibraryBig } from "lucide-react";
import { api, type LibraryEntry } from "@/lib/api";
import { useQuery } from "@/lib/useQuery";
import { shelve, UNSHELVED, type Shelf } from "@/lib/library";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Cover } from "@/components/Cover";
import { ViewHeader } from "@/components/ViewHeader";
import { Button } from "@/components/ui/button";

/** One Source: its Cover, its title, and what is inside it. */
function Card({ entry }: { entry: LibraryEntry }) {
  const s = useStore();
  const t = useT();
  // A drawn Cover already shows the title; repeating it below says the same
  // thing twice and costs the line the date and part count want.
  const [hasPicture, setHasPicture] = useState(false);
  const caption = [
    entry.child_count > 0 ? t.child_count(entry.child_count) : "",
    entry.date,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      data-testid="library-card"
      // Fixed width so a Shelf reads as a row of spines; `shrink-0` keeps the
      // flex row from squeezing them as it fills.
      className="group w-32 shrink-0 text-left focus-visible:outline-none sm:w-36"
      onClick={() => s.openDoc(entry.id)}
      title={entry.title}
    >
      <Cover
        entry={entry}
        onResolved={setHasPicture}
        className="transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring"
      />
      <div className="mt-1.5 min-w-0">
        {hasPicture && (
          <div className="line-clamp-2 text-sm font-medium leading-tight">
            {entry.title}
          </div>
        )}
        {caption && (
          <div className="min-w-0 truncate text-xs text-muted-foreground">
            {caption}
          </div>
        )}
      </div>
    </button>
  );
}

/**
 * One Shelf: a labelled row that scrolls sideways.
 *
 * The arrows are not decoration — a phone can swipe and a trackpad can shove,
 * but a mouse and a keyboard need a target, and the buttons give the row a
 * keyboard path for free.
 */
function ShelfRow({ shelf }: { shelf: Shelf }) {
  const t = useT();
  const row = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  // Arrows appear only when there is something to scroll to; a Shelf of three
  // books should not pretend it has more.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shelf.entries.length]);

  const scroll = (dir: -1 | 1) =>
    row.current?.scrollBy({ left: dir * 320, behavior: "smooth" });

  const label =
    shelf.id === UNSHELVED
      ? t.shelf_unshelved
      : (t.kinds as Record<string, string>)[shelf.id];

  return (
    <section data-testid={`shelf-${shelf.id}`} className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center gap-2 px-3">
        <h2 className="min-w-0 truncate text-sm font-semibold">{label}</h2>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {shelf.entries.length}
        </span>
        {overflow && (
          <div className="ml-auto flex shrink-0 gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={t.scroll_left}
              onClick={() => scroll(-1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={t.scroll_right}
              onClick={() => scroll(1)}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      {shelf.id === UNSHELVED && (
        <p className="mb-2 px-3 text-xs text-muted-foreground">
          {t.shelf_unshelved_hint}
        </p>
      )}
      {/* Wider than its box on purpose; `overflow-x-auto` is what tells the
          locale check this is a scroller and not a clipped layout. */}
      <div
        ref={row}
        data-testid="shelf-scroller"
        className="flex gap-3 overflow-x-auto scroll-smooth px-3 pb-2"
      >
        {shelf.entries.map((e) => (
          <Card key={e.id} entry={e} />
        ))}
      </div>
    </section>
  );
}

export function LibraryView() {
  const t = useT();
  // Shelves hold Sources and are built from their `parent` links, which are
  // Sources too: nothing else in the vault can move the Library.
  const { data, status } = useQuery<LibraryEntry[]>({
    key: [],
    deps: { types: ["source"] },
    fetch: () => api.library(),
  });

  const shelves = useMemo(() => shelve(data ?? []), [data]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader title={t.views.library} icon={<LibraryBig />} tutorials={{ kind: "library" }} />
      <div
        data-testid="library"
        className="min-h-0 flex-1 space-y-6 overflow-y-auto py-4"
      >
        {shelves.length === 0 ? (
          // Only once the answer is in: "no Sources yet" is a different thing
          // from "not read yet", and they used to look the same.
          status === "ready" && (
            <p className="px-3 text-sm text-muted-foreground">
              {t.library_empty}
            </p>
          )
        ) : (
          shelves.map((shelf) => <ShelfRow key={shelf.id} shelf={shelf} />)
        )}
      </div>
    </div>
  );
}
