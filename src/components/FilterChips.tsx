// The chip row both filter popovers are built from: a labelled multi-select
// that disappears when there is nothing to choose between.
//
// It was written out twice, in MapFilters and TimelineFilters, and a diff of
// the two came to three lines — the optional `dot`. One of them had to be the
// superset, so it is this one.
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function Chips({
  label,
  values,
  selected,
  onChange,
  dot,
  name = (v: string) => v,
}: {
  label: string;
  values: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  dot?: (v: string) => ReactNode;
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
            {dot?.(v)}
            {name(v)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

