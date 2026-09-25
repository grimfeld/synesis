import { useMemo } from "react";
import { LayoutGrid } from "lucide-react";
import { api, type CoverageCell } from "@/lib/api";
import { useQuery } from "@/lib/useQuery";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { PanelTitle } from "@/components/Field";
import { Badge } from "@/components/ui/badge";

export function CoverageView() {
  const s = useStore();
  const t = useT();
  // Every document may carry a Mention, so any change moves the grid.
  const { data } = useQuery<CoverageCell[]>({
    key: [],
    deps: { any: true },
    fetch: () => api.coverage(),
  });
  const cells = useMemo(() => data ?? [], [data]);
  const byKey = useMemo(() => new Map(cells.map((c) => [`${c.book}:${c.chapter}`, c.count])), [cells]);
  const max = useMemo(() => Math.max(1, ...cells.map((c) => c.count)), [cells]);
  const total = cells.length;
  const allChapters = s.books.reduce((n, b) => n + b.chapters.length, 0);

  const shade = (n: number) => {
    if (n === 0) return "var(--muted)";
    const a = 0.25 + 0.75 * Math.min(1, n / max);
    return `color-mix(in srgb, var(--c-scripture) ${Math.round(a * 100)}%, var(--muted))`;
  };

  const group = (hebrew: boolean) => (
    <section>
      <PanelTitle className="mb-3">{hebrew ? t.hebrew_aramaic : t.greek}</PanelTitle>
      <div className="space-y-1">
        {s.books
          .filter((b) => b.hebrew_aramaic === hebrew)
          .map((b) => (
            <div key={b.number} className="flex items-center gap-3">
              <button type="button" className="w-36 shrink-0 truncate text-left text-sm text-foreground/80 hover:text-foreground hover:underline underline-offset-4" onClick={() => s.openScripture(b.number)} title={b.name}>
                {b.name}
              </button>
              <div className="flex flex-wrap gap-[3px]">
                {b.chapters.map((_, i) => {
                  const n = byKey.get(`${b.number}:${i + 1}`) ?? 0;
                  return (
                    <button
                      key={i}
                      data-testid="coverage-cell"
                      data-count={n}
                      type="button"
                      className="size-3.5 rounded-[3px] transition-transform hover:scale-125 hover:ring-1 hover:ring-foreground/60"
                      style={{ background: shade(n) }}
                      title={`${b.name} ${i + 1} · ${n}`}
                      onClick={() => s.openScripture(b.number, i + 1)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
      </div>
    </section>
  );

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t.coverage_title} icon={<LayoutGrid />} tutorials={{ kind: "coverage" }}>
        <Badge variant="secondary" className="tabular-nums">
          {total} / {allChapters}
        </Badge>
        <span className="ml-auto hidden truncate text-xs text-muted-foreground lg:inline">{t.coverage_hint}</span>
      </ViewHeader>
      <div className="thin-scroll min-h-0 flex-1 overflow-auto p-6">
        <div className="grid max-w-5xl gap-8">
          {group(true)}
          {group(false)}
        </div>
      </div>
    </div>
  );
}
