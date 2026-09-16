// The Map's four filters behind one trigger (PLAN §19.5), mirroring the
// Timeline's popover: the chip lists are unbounded, so a wrapping bar would be
// several rows tall and would not survive a phone's narrow gutter.
import { Filter, X } from "lucide-react";
import { activeCount, type MapFilters as Filters } from "@/lib/map";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function Chips({
  label,
  values,
  selected,
  onChange,
  name = (v: string) => v,
}: {
  label: string;
  values: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  name?: (v: string) => string;
}) {
  if (values.length === 0) return null;
  return (
    <div>
      <Label className="mb-1.5 text-xs text-muted-foreground">{label}</Label>
      <ToggleGroup
        type="multiple"
        value={selected}
        onValueChange={onChange}
        variant="outline"
        size="sm"
        spacing={1}
        className="flex-wrap justify-start"
      >
        {values.map((v) => (
          <ToggleGroupItem
            key={v}
            value={v}
            className="h-7 gap-1.5 text-xs data-[state=off]:opacity-45"
          >
            {name(v)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

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
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
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
