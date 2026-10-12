// The picker for a Place's kind (PLAN §27.12): the five built-in kinds with
// their icons, then the Vault's custom kinds, then "New kind…", which makes one
// in place, on the Place that needs it. A custom kind is a name, the label it
// shows, and one icon from the curated set; no colour is picked (§27.4).
import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { fold } from "@/lib/names";
import { kindCatalogue, kindOf, type KindDef } from "@/lib/map";
import { PIN_ICON_NAMES, pinIcon } from "@/lib/pinIcons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** A kind's glyph on its colour, as the Map draws the pin. */
export function KindBadge({ kind, className }: { kind: KindDef | null; className?: string }) {
  const Icon = kind ? pinIcon(kind.icon) : null;
  return (
    <span
      aria-hidden="true"
      className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-white", className)}
      style={{ background: kind ? `var(${kind.token})` : "var(--c-place)" }}
    >
      {Icon ? <Icon className="size-3" strokeWidth={2.5} /> : <span className="size-1.5 rounded-full bg-white" />}
    </span>
  );
}

/** What a kind is called in the UI: a custom kind's label, a built-in's translation. */
export function useKindName() {
  const t = useT();
  return (k: KindDef) => k.label ?? t.place_kind[k.name] ?? k.name;
}

/** The curated icons, one to choose. */
export function IconGrid({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t.kind_icon} className="grid max-h-40 grid-cols-7 gap-1 overflow-y-auto">
      {PIN_ICON_NAMES.map((n) => {
        const Icon = pinIcon(n);
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={n}
            title={n}
            data-testid="kind-icon"
            data-icon={n}
            onClick={() => onChange(n)}
            className={cn(
              "flex aspect-square items-center justify-center rounded-md border text-foreground hover:bg-accent",
              value === n && "border-primary bg-primary text-primary-foreground hover:bg-primary",
            )}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

/** The form that makes a custom kind: a name and one icon. */
export function NewKindForm({
  initialName = "",
  onDone,
  onCancel,
}: {
  initialName?: string;
  onDone: (name: string) => void;
  onCancel: () => void;
}) {
  const s = useStore();
  const t = useT();
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState("tent");
  const catalogue = useMemo(() => kindCatalogue(s.placeKinds), [s.placeKinds]);
  const trimmed = name.trim();
  const taken = trimmed !== "" && catalogue.some((k) => fold(k.name) === fold(trimmed));
  const save = async () => {
    if (!trimmed || taken) return;
    await s.setPlaceKinds([...s.placeKinds, { name: trimmed, label: trimmed, icon }]);
    onDone(trimmed);
  };
  return (
    <form
      data-testid="kind-new-form"
      className="grid min-w-0 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save().catch(console.error);
      }}
    >
      <Input
        autoFocus
        data-testid="kind-new-name"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        placeholder={t.kind_new_name}
        aria-label={t.kind_new_name}
        className="h-8 text-sm"
      />
      {taken && <p className="text-xs text-muted-foreground">{t.kind_taken}</p>}
      <IconGrid value={icon} onChange={setIcon} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" className="min-h-8 h-auto" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" size="sm" className="min-h-8 h-auto" disabled={!trimmed || taken} data-testid="kind-new-save">
          {t.kind_create}
        </Button>
      </div>
    </form>
  );
}

export function KindPicker({
  value,
  onChange,
  readOnly = false,
}: {
  /** The `kind:` text as written, "" when unset. */
  value: string;
  onChange: (kind: string | null) => void;
  readOnly?: boolean;
}) {
  const s = useStore();
  const t = useT();
  const kindName = useKindName();
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState(false);
  const catalogue = useMemo(() => kindCatalogue(s.placeKinds), [s.placeKinds]);
  const current = kindOf(value, catalogue);
  // Text nobody defined yet: shown as written, and one step from its own pin.
  const undefinedText = !current && value.trim() ? value.trim() : "";
  const pick = (k: string | null) => {
    onChange(k);
    setOpen(false);
    setMaking(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setMaking(false);
      }}
    >
      <PopoverTrigger asChild disabled={readOnly}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="kind-picker"
          data-kind={current?.name ?? ""}
          className="min-h-8 h-auto max-w-full justify-start gap-2"
        >
          <KindBadge kind={current} />
          <span className="min-w-0 truncate">
            {current ? kindName(current) : undefinedText ? `${undefinedText} · ${t.kind_undefined}` : t.place_kind_none}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-2">
        {making ? (
          <NewKindForm initialName={undefinedText} onDone={(n) => pick(n)} onCancel={() => setMaking(false)} />
        ) : (
          <div role="listbox" aria-label={t.kind} className="grid gap-0.5">
            {catalogue.map((k) => (
              <button
                key={k.name}
                type="button"
                role="option"
                aria-selected={current?.name === k.name}
                data-testid="kind-option"
                data-kind={k.name}
                onClick={() => pick(k.name)}
                className="flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
              >
                <KindBadge kind={k} />
                <span className="min-w-0 flex-1 truncate">{kindName(k)}</span>
                {current?.name === k.name && <Check className="size-4 shrink-0" />}
              </button>
            ))}
            <button
              type="button"
              role="option"
              aria-selected={!value.trim()}
              data-testid="kind-option"
              data-kind=""
              onClick={() => pick(null)}
              className="flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent"
            >
              <KindBadge kind={null} />
              <span className="min-w-0 flex-1 truncate">{t.place_kind_none}</span>
            </button>
            <div className="my-1 border-t" />
            <button
              type="button"
              data-testid="kind-new"
              onClick={() => setMaking(true)}
              className="flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
            >
              <Plus className="size-4 shrink-0" />
              <span className="min-w-0 truncate">
                {undefinedText ? t.kind_new_for(undefinedText) : t.kind_new}
              </span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
