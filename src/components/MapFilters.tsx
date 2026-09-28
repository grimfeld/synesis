// The Map's four filters behind one trigger (PLAN §19.5), and above them the
// Colour by rule (§27.5), which hides nothing and so is not counted. Mirrors the
// Timeline's popover: the chip lists are unbounded, so a wrapping bar would be
// several rows tall and would not survive a phone's narrow gutter.
import { Filter, X } from "lucide-react";
import {
  activeCount,
  COLOR_BY,
  MAX_COLORED,
  type ColorBy,
  type MapFilters as Filters,
} from "@/lib/map";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Chips } from "@/components/FilterChips";


export function MapFilters({
  filters,
  onChange,
  tags,
  books,
  bookName,
  journeys,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  tags: string[];
  books: number[];
  bookName: (n: number) => string;
  /** Every Journey, offered as a chip that draws its route (§19.3). */
  journeys: { id: string; title: string }[];
}) {
  const t = useT();
  const n = activeCount(filters);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          data-testid="map-filter"
          data-active={n}
          aria-label={t.tl_filter}
        >
          <Filter />
          <span className="hidden sm:inline">{t.tl_filter}</span>
          {n > 0 && (
            <Badge
              variant="secondary"
              className="ml-0.5 h-4 min-w-4 px-1 tabular-nums"
            >
              {n}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-[80vh] w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto">
        {/* Colour first: it is not a filter and hides nothing (PLAN §27.5). */}
        <div className="min-w-0">
          <Label className="mb-1.5 text-xs text-muted-foreground">{t.map_color_by}</Label>
          <ToggleGroup
            type="single"
            value={filters.colorBy}
            onValueChange={(v) =>
              v &&
              onChange({
                ...filters,
                colorBy: v as ColorBy,
                // A Tag is not a Book: switching rule starts a new comparison.
                colored: v === filters.colorBy ? filters.colored : [],
              })
            }
            variant="outline"
            size="sm"
            spacing={1}
            className="flex-wrap justify-start"
            data-testid="map-color-by"
          >
            {COLOR_BY.map((c) => (
              <ToggleGroupItem
                key={c}
                value={c}
                data-testid={`map-color-by-${c}`}
                className="h-auto min-h-7 text-xs data-[state=off]:opacity-60"
              >
                {t.map_color_by_opts[c]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {(filters.colorBy === "tag" || filters.colorBy === "book") && (
          <div data-testid="map-color-values" className="min-w-0">
            {(filters.colorBy === "tag" ? tags.length : books.length) === 0 ? null : (
              <Chips
                label={`${t.map_color_pick} (${filters.colored.length}/${MAX_COLORED})`}
                values={filters.colorBy === "tag" ? tags : books.map(String)}
                selected={filters.colored}
                // At most five: past that the chips do nothing rather than
                // silently dropping a colour already on the map.
                onChange={(v) =>
                  v.length <= MAX_COLORED && onChange({ ...filters, colored: v })
                }
                name={(v) => (filters.colorBy === "book" ? bookName(Number(v)) : v)}
              />
            )}
          </div>
        )}
        <hr className="border-border" />
        <Chips
          label={t.map_filter_journeys}
          values={journeys.map((j) => j.id)}
          selected={filters.journeys}
          onChange={(v) => onChange({ ...filters, journeys: v })}
          name={(id) => journeys.find((j) => j.id === id)?.title ?? id}
        />
        <Chips
          label={t.map_filter_books}
          values={books.map(String)}
          selected={filters.books.map(String)}
          onChange={(v) => onChange({ ...filters, books: v.map(Number) })}
          name={(v) => bookName(Number(v))}
        />
        <Chips
          label={t.tl_filter_tags}
          values={tags}
          selected={filters.tags}
          onChange={(v) => onChange({ ...filters, tags: v })}
        />
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            data-testid="map-mentioned-only"
            className="size-3.5 accent-primary"
            checked={filters.mentionedOnly}
            onChange={(e) =>
              onChange({ ...filters, mentionedOnly: e.currentTarget.checked })
            }
          />
          {t.map_filter_mentioned}
        </label>
        {n > 0 && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="map-filter-clear"
            className="h-7 justify-start text-xs"
            onClick={() =>
              onChange({
                ...filters,
                tags: [],
                books: [],
                search: "",
                mentionedOnly: false,
              })
            }
          >
            <X />
            {t.tl_filter_clear}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
