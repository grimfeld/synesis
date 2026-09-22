// The Timeline's five filters behind one trigger (PLAN §16.3): the chip lists
// are unbounded, so a wrapping bar would be three rows tall and would not
// survive a phone's narrow gutter.
import { Filter, X } from "lucide-react";
import type { DocType } from "@/lib/api";
import { activeCount, type Filters } from "@/lib/timeline";
import { propertyLabel, useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TypeDot } from "@/components/DocLink";
import { Chips } from "@/components/FilterChips";

/** The Subject types that can carry a Date, and so can own a Lane. */
export const TIMELINE_TYPES: DocType[] = [
  "event",
  "character",
  "place",
  "concept",
  // A Journey's `start` / `end` make it a dated Subject, so it owns a Lane and
  // draws as a span like any other (PLAN §19.12).
  "journey",
];


export function TimelineFilters({
  filters,
  onChange,
  tags,
  props,
  typeLabel,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  tags: string[];
  props: string[];
  typeLabel: (ty: DocType) => string;
}) {
  const t = useT();
  const n = activeCount(filters);
  const shownTypes = TIMELINE_TYPES.filter(
    (ty) => !filters.hiddenTypes.includes(ty),
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          data-testid="tl-filter"
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
      <PopoverContent align="end" className="w-80">
        <Chips
          label={t.tl_filter_types}
          values={TIMELINE_TYPES}
          selected={shownTypes}
          onChange={(v) =>
            onChange({
              ...filters,
              hiddenTypes: TIMELINE_TYPES.filter((ty) => !v.includes(ty)),
            })
          }
          dot={(v) => <TypeDot type={v as DocType} />}
          name={(v) => typeLabel(v as DocType)}
        />
        <Chips
          label={t.tl_filter_props}
          values={props}
          selected={filters.props}
          onChange={(v) => onChange({ ...filters, props: v })}
          // The chip is a Property name: a built-in reads in the current
          // language, one the user invented reads as they named it.
          name={(v) => propertyLabel(v, t)}
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
            data-testid="tl-in-view"
            className="size-3.5 accent-primary"
            checked={filters.inView}
            onChange={(e) =>
              onChange({ ...filters, inView: e.currentTarget.checked })
            }
          />
          {t.tl_filter_in_view}
        </label>
        {n > 0 && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="tl-filter-clear"
            className="h-7 justify-start text-xs"
            onClick={() =>
              onChange({
                ...filters,
                hiddenTypes: [],
                tags: [],
                props: [],
                search: "",
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
