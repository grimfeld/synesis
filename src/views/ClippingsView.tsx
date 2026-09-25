// The Clippings view (ADR 0013): every Clipping as its own words, newest
// first. The Library asks "what have I read?"; this asks "where was that
// quote?" — the question you have when you remember the words and not the
// Source, which is why the quote is the card and the Citation is the caption.
//
// Flat rather than grouped by Source: grouping only helps when you already
// know the Source, and in that case the Source's own Hub is the better door.
import { useMemo, useState } from "react";
import { Quote, X } from "lucide-react";
import { api, type TrailEntry } from "@/lib/api";
import { useQuery } from "@/lib/useQuery";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { Button } from "@/components/ui/button";

/** One Clipping: its own words, with the Citation underneath. */
function ClippingCard({ entry }: { entry: TrailEntry }) {
  const s = useStore();
  const citation = [entry.source.title, entry.locator]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      data-testid="clipping-card"
      className="w-full min-w-0 rounded-lg border bg-card p-3 text-left transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={() => s.openDoc(entry.doc.id)}
    >
      {/* The quote is the card. `label` is the Clipping's own text, already
          stripped of its `>` and capped by the engine. */}
      <p className="min-w-0 font-prose text-sm leading-relaxed break-words">
        {entry.doc.label}
      </p>
      <p
        data-testid="clipping-citation"
        className="mt-2 min-w-0 truncate text-xs text-muted-foreground"
      >
        {citation}
      </p>
    </button>
  );
}

/** A filter chip: one Tag or one Source, toggled off by picking it again. */
function Chip({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      data-testid={testId}
      // Labels wrap rather than force the row wider: French Tag names run
      // long, and a fixed-height chip clips them.
      className="h-auto min-h-8 shrink-0 py-1 text-xs font-normal whitespace-normal"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function ClippingsView() {
  const t = useT();
  const [tag, setTag] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);

  // A Clipping and the Source it cites: editing either changes what a card
  // says, since the Citation is the Source's title.
  const { data, status } = useQuery({
    key: [],
    deps: { types: ["clipping", "source"] },
    fetch: async () => {
      const entries = await api.clippings();
      // One batch call rather than a query per card; the store's own tag
      // index counts Tags across the vault and cannot say which document
      // carries which.
      const tagsOf = await api.tagsOf(entries.map((e) => e.doc.id));
      return { entries, tagsOf };
    },
  });
  const entries = useMemo<TrailEntry[]>(() => data?.entries ?? [], [data]);
  const tagsOf = useMemo<Record<string, string[]>>(
    () => data?.tagsOf ?? {},
    [data],
  );

  const tags = useMemo(() => {
    const seen = new Map<string, number>();
    for (const list of Object.values(tagsOf))
      for (const name of list) seen.set(name, (seen.get(name) ?? 0) + 1);
    // Commonest first: the Tag you filter by is usually one you use a lot.
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
  }, [tagsOf]);

  const sources = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) seen.set(e.source.id, e.source.title);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const shown = useMemo(
    () =>
      entries.filter(
        (e) =>
          (!sourceId || e.source.id === sourceId) &&
          (!tag || (tagsOf[e.doc.id] ?? []).includes(tag)),
      ),
    [entries, sourceId, tag, tagsOf],
  );

  const filtered = tag !== null || sourceId !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader title={t.views.clippings} icon={<Quote />} tutorials={{ kind: "clippings" }}>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {shown.length}
        </span>
      </ViewHeader>

      {(tags.length > 0 || sources.length > 1) && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
          {tags.map((name) => (
            <Chip
              key={name}
              testId={`clippings-tag-${name}`}
              active={tag === name}
              onClick={() => setTag(tag === name ? null : name)}
            >
              #{name}
            </Chip>
          ))}
          {sources.map(([id, title]) => (
            <Chip
              key={id}
              testId={`clippings-source-${id}`}
              active={sourceId === id}
              onClick={() => setSourceId(sourceId === id ? null : id)}
            >
              {title}
            </Chip>
          ))}
          {filtered && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="clippings-clear"
              className="h-auto min-h-8 shrink-0 py-1 text-xs font-normal"
              onClick={() => {
                setTag(null);
                setSourceId(null);
              }}
            >
              <X />
              {t.tl_filter_clear}
            </Button>
          )}
        </div>
      )}

      <div
        data-testid="clippings"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
      >
        {entries.length === 0 ? (
          // Only once the answer is in: "you have kept nothing" is not the
          // same as "not read yet", and they used to look alike.
          status === "ready" && (
            <p className="text-sm text-muted-foreground">{t.clippings_empty}</p>
          )
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              {t.clippings_hint}
            </p>
            {shown.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t.tl_filtered_empty}
              </p>
            ) : (
              <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((e) => (
                  <ClippingCard key={e.doc.id} entry={e} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
