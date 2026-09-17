// Material for a Board: the Composition's Candidates, plus a search over the
// whole Vault for anything the Candidates query did not surface.
//
// This is what makes a Board Synesis rather than a generic canvas — the app
// already knows which Notes and Clippings share Tags and Passages with this
// talk, so triaging them is a drag rather than a hunt (PLAN §17.10).
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { cn } from "cn";
import { api, type Candidate, type DocSummary } from "@/lib/api";
import { useT } from "@/i18n";
import { TypeDot } from "@/components/DocLink";
import { Input } from "@/components/ui/input";
import { useQuery } from "@/lib/useQuery";

export function BoardDrawer({
  compositionId,
  onAdd,
  onPath,
}: {
  compositionId: string;
  onAdd: (doc: DocSummary) => void;
  /** Whether a path is already on the Board, so it can be marked. */
  onPath: (path: string) => boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");

  // A Candidate is anything sharing a Tag or a Passage with the Composition,
  // so anything written may become one.
  const { data: itemsData } = useQuery<Candidate[]>({
    key: [compositionId],
    deps: { any: true },
    fetch: () => api.candidates(compositionId),
  });
  const items = useMemo(() => itemsData ?? [], [itemsData]);

  // The search box follows what is being typed.
  const q = query.trim();
  const { data: hitsData } = useQuery<DocSummary[]>({
    key: [q],
    deps: { any: true },
    enabled: q.length >= 2,
    debounce: 150,
    fetch: () => api.suggest(q, 20),
  });
  const hits = useMemo(
    () => (q.length < 2 ? [] : (hitsData ?? [])),
    [q, hitsData],
  );

  // Material worth offering: what the talk has not committed to yet. Anything
  // the prose already uses is not Board material.
  const unused = useMemo(() => items.filter((c) => !c.used), [items]);

  if (!open) {
    return (
      <button
        type="button"
        data-board-ui
        className="flex w-8 shrink-0 items-center justify-center border-l bg-sidebar text-sidebar-foreground hover:bg-accent"
        aria-label={t.board_material}
        onClick={() => setOpen(true)}
      >
        <ChevronRight className="size-4 rotate-180" />
      </button>
    );
  }

  const rows = query.trim().length >= 2 ? hits : unused.map((c) => c.doc);

  return (
    <aside
      data-board-ui
      data-testid="board-drawer"
      className="thin-scroll flex w-72 shrink-0 flex-col overflow-y-auto border-l bg-sidebar text-sidebar-foreground"
    >
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <span className="flex-1 text-xs font-medium">{t.board_material}</span>
        <button
          type="button"
          className="rounded p-1 hover:bg-accent"
          aria-label={t.board_material}
          onClick={() => setOpen(false)}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.board_search}
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>
      <p className="px-3 pb-2 text-[11px] text-muted-foreground">
        {query.trim().length >= 2 ? t.board_search_hint : t.board_material_hint}
      </p>
      {rows.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-muted-foreground">
          {query.trim().length >= 2 ? t.no_results : t.no_candidates}
        </p>
      ) : (
        <ul className="px-1.5 pb-3">
          {rows.map((doc) => {
            const placed = onPath(doc.path);
            const cand = unused.find((c) => c.doc.id === doc.id);
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  disabled={placed}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left transition-colors",
                    placed
                      ? "cursor-default opacity-50"
                      : "hover:bg-accent",
                  )}
                  onClick={() => !placed && onAdd(doc)}
                  title={placed ? t.board_already : t.board_add_material}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <TypeDot type={doc.type} />
                    <span className="min-w-0 flex-1 truncate">{doc.label}</span>
                    {placed && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {t.board_on}
                      </span>
                    )}
                  </span>
                  {cand && cand.shared_tags.length > 0 && (
                    <span className="mt-0.5 flex flex-wrap gap-1 pl-4">
                      {cand.shared_tags.slice(0, 3).map((x) => (
                        <span
                          key={x}
                          className="rounded bg-muted px-1 text-[10px] text-muted-foreground"
                        >
                          #{x}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
