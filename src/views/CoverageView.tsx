import { useEffect, useMemo, useState } from "react";
import { api, type CoverageCell } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";

export function CoverageView() {
  const s = useStore();
  const t = useT();
  const [cells, setCells] = useState<CoverageCell[]>([]);
  useEffect(() => {
    api.coverage().then(setCells).catch(console.error);
  }, [s.changeTick, s.docs]);
  const byKey = useMemo(() => new Map(cells.map((c) => [`${c.book}:${c.chapter}`, c.count])), [cells]);
  const max = useMemo(() => Math.max(1, ...cells.map((c) => c.count)), [cells]);
  const total = cells.length;
  const allChapters = s.books.reduce((n, b) => n + b.chapters.length, 0);

  const shade = (n: number) => {
    if (n === 0) return "var(--bg-3)";
    const a = 0.25 + 0.75 * Math.min(1, n / max);
    return `color-mix(in srgb, var(--c-scripture) ${Math.round(a * 100)}%, var(--bg-3))`;
  };

  const group = (hebrew: boolean) => (
    <div className="mb-6">
      <div className="panel-title mb-2">{hebrew ? t.hebrew_aramaic : t.greek}</div>
      {s.books
        .filter((b) => b.hebrew_aramaic === hebrew)
        .map((b) => (
          <div key={b.number} className="mb-1 flex items-center gap-2">
            <button className="w-36 shrink-0 truncate text-left text-sm hover:underline" onClick={() => s.openScripture(b.number)} title={b.name}>
              {b.name}
            </button>
            <div className="flex flex-wrap gap-[2px]">
              {b.chapters.map((_, i) => {
                const n = byKey.get(`${b.number}:${i + 1}`) ?? 0;
                return (
                  <button
                    key={i}
                    className="h-3.5 w-3.5 rounded-[2px] hover:outline hover:outline-1"
                    style={{ background: shade(n), outlineColor: "var(--fg)" }}
                    title={`${b.name} ${i + 1} · ${n}`}
                    onClick={() => s.openScripture(b.number, i + 1)}
                  />
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );

  return (
    <div className="thin-scroll h-full overflow-auto p-6">
      <header className="mb-4 flex items-center gap-2">
        {!s.sidebarOpen && (
          <button className="btn btn-ghost btn-sm" onClick={() => s.setSidebarOpen(true)}>
            ☰
          </button>
        )}
        <h1 className="text-xl font-semibold">{t.coverage_title}</h1>
        <span className="muted text-sm">
          {total} / {allChapters}
        </span>
      </header>
      <p className="muted mb-4 text-sm">{t.coverage_hint}</p>
      {group(true)}
      {group(false)}
    </div>
  );
}
