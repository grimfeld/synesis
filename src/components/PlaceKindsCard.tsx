// Settings: the Vault's custom Place kinds (PLAN §27.12). Each can be
// relabelled, given another icon, or deleted. The name is not editable: it is
// the `kind:` text written in the Places, and changing it here would leave
// every one of them pointing at nothing. Deleting never rewrites a Place; its
// kind text stays and it draws the plain pin.
import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { kindCatalogue, type CustomKind } from "@/lib/map";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconGrid, KindBadge } from "@/components/KindPicker";

function Row({ kind, onChange, onDelete }: { kind: CustomKind; onChange: (k: CustomKind) => void; onDelete: () => void }) {
  const s = useStore();
  const t = useT();
  const [label, setLabel] = useState(kind.label);
  const def = useMemo(() => kindCatalogue(s.placeKinds).find((k) => k.name === kind.name) ?? null, [s.placeKinds, kind.name]);
  return (
    <li data-testid="place-kind-row" data-kind={kind.name} className="flex min-w-0 flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" size="icon" variant="outline" className="size-8 shrink-0" aria-label={t.kind_icon} data-testid="place-kind-icon">
            <KindBadge kind={def} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-2">
          <IconGrid value={kind.icon} onChange={(icon) => onChange({ ...kind, icon })} />
        </PopoverContent>
      </Popover>
      <Input
        value={label}
        aria-label={t.kind_label}
        data-testid="place-kind-label"
        className="h-8 min-w-0 flex-1 basis-32 text-sm"
        onChange={(e) => setLabel(e.currentTarget.value)}
        onBlur={() => label.trim() !== kind.label && onChange({ ...kind, label: label.trim() || kind.name })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <code className="min-w-0 truncate text-xs text-muted-foreground">kind: {kind.name}</code>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        aria-label={t.kind_delete(kind.label || kind.name)}
        data-testid="place-kind-delete"
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

export function PlaceKindsCard() {
  const s = useStore();
  const t = useT();
  const save = (next: CustomKind[]) => s.setPlaceKinds(next).catch(console.error);
  return (
    <Card data-testid="settings-place-kinds">
      <CardHeader>
        <CardTitle>{t.place_kinds_title}</CardTitle>
        <CardDescription>{t.place_kinds_hint}</CardDescription>
      </CardHeader>
      <CardContent>
        {s.placeKinds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.place_kinds_empty}</p>
        ) : (
          <ul className="grid gap-2">
            {s.placeKinds.map((k, i) => (
              <Row
                key={k.name}
                kind={k}
                onChange={(next) => save(s.placeKinds.map((x, j) => (j === i ? next : x)))}
                onDelete={() => save(s.placeKinds.filter((_, j) => j !== i))}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
