// Settings -> Appearance (PLAN §22.9): this Device's mode and Text scale, the
// Vault's Skin, and the editor for it. Edits paint the whole app at once and
// save after a pause; "Undo changes" goes back to the Skin as it was when the
// editor opened.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ChevronDown, Copy, Download, RotateCcw, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { parseColor, toHex } from "@/lib/color";
import {
  DEFAULT_LINE_HEIGHT,
  DEFAULT_LINE_WIDTH,
  FONTS,
  TOKENS,
  freeName,
  isBuiltin,
  keyContrasts,
  normalizeSkin,
  unknownOverrides,
  type Side,
  type Skin,
  type SkinSide,
  type TokenDef,
  type TokenGroup,
} from "@/lib/skin";
import { useFormat, useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const SAVE_AFTER_MS = 500;

export function AppearanceCard() {
  const a = useAppearance();
  const t = useT();
  const ta = t.appearance;
  const fmt = useFormat();
  const skinName = (s: Skin) => ta.builtin_names[s.id] ?? s.name;
  const builtin = isBuiltin(a.active.id);
  const [deleting, setDeleting] = useState<Skin | null>(null);
  const [importing, setImporting] = useState<Skin | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = async (from: Skin, name: string) => {
    const saved = await a.save({ ...normalizeSkin(from), id: "", name: freeName(name, a.skins.map(skinName)) });
    await a.select(saved.id);
  };

  const importFile = async () => {
    setError(null);
    const path = await openDialog({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      const skin = normalizeSkin(await api.readSkinFile(path));
      if (skin.id && !isBuiltin(skin.id) && a.skins.some((s) => s.id === skin.id)) return setImporting(skin);
      await finishImport(skin, false);
    } catch (e) {
      setError(ta.import_failed(String(e)));
    }
  };
  const finishImport = async (skin: Skin, replace: boolean) => {
    setImporting(null);
    const others = a.skins.filter((s) => !(replace && s.id === skin.id)).map(skinName);
    const id = replace ? skin.id : isBuiltin(skin.id) || a.skins.some((s) => s.id === skin.id) ? "" : skin.id;
    const saved = await a.save({ ...skin, id, name: freeName(skin.name, others) });
    await a.select(saved.id);
  };

  const exportFile = async () => {
    const path = await saveDialog({ defaultPath: `${skinName(a.active)}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (path) await api.exportSkin({ ...a.active, name: skinName(a.active) }, path);
  };

  return (
    <Card data-testid="settings-appearance">
      <CardHeader>
        <CardTitle>{ta.title}</CardTitle>
        <CardDescription>{ta.skin_hint}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <Row label={ta.mode}>
          <ToggleGroup
            type="single"
            variant="outline"
            value={a.mode}
            onValueChange={(v) => v && a.setMode(v as typeof a.mode)}
            className="flex-wrap"
            data-testid="appearance-mode"
          >
            {(["light", "dark", "system"] as const).map((m) => (
              <ToggleGroupItem key={m} value={m} className="min-h-8 h-auto" data-testid={`appearance-mode-${m}`}>
                {ta.modes[m]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Row>

        <Row label={ta.text_scale} value={`${fmt.number(Math.round(a.scale * 100))} %`}>
          <Slider min={75} max={200} step={5} value={Math.round(a.scale * 100)} onChange={(n) => a.setScale(n / 100)} testid="appearance-scale" />
        </Row>

        <Row label={ta.skin}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Select value={a.active.id} onValueChange={(id) => a.select(id).catch(console.error)}>
              <SelectTrigger className="min-w-0 w-56 max-w-full" data-testid="appearance-skin">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {a.skins.map((s) => (
                  <SelectItem key={s.id} value={s.id} data-testid={`appearance-skin-${s.id}`}>
                    {skinName(s)}
                    {isBuiltin(s.id) && <span className="ml-2 text-xs text-muted-foreground">{ta.builtin_badge}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-8 h-auto"
              onClick={() => copy(a.active, ta.copy_of(skinName(a.active))).catch(console.error)}
              data-testid="appearance-duplicate"
            >
              <Copy /> {builtin ? ta.customize : ta.duplicate}
            </Button>
            <Button variant="outline" size="sm" className="min-h-8 h-auto" onClick={importFile} data-testid="appearance-import">
              <Upload /> {ta.import}
            </Button>
            <Button variant="outline" size="sm" className="min-h-8 h-auto" onClick={exportFile} data-testid="appearance-export">
              <Download /> {ta.export}
            </Button>
            {!builtin && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-8 h-auto"
                onClick={() => setDeleting(a.active)}
                data-testid="appearance-delete"
              >
                <Trash2 /> {ta.delete}
              </Button>
            )}
          </div>
          {builtin && <p className="text-sm text-muted-foreground">{ta.customize_hint}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </Row>

        {!builtin && <SkinEditor key={a.active.id} skin={a.active} />}
      </CardContent>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleting && ta.delete_title(skinName(deleting))}</AlertDialogTitle>
            <AlertDialogDescription>{ta.delete_body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="appearance-delete-confirm"
              onClick={() => deleting && a.remove(deleting.id).catch(console.error)}
            >
              {ta.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!importing} onOpenChange={(o) => !o && setImporting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{importing && ta.import_same_title(importing.name)}</AlertDialogTitle>
            <AlertDialogDescription>{ta.import_same_body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <Button variant="outline" onClick={() => importing && finishImport(importing, false).catch(console.error)}>
              {ta.import_keep_both}
            </Button>
            <AlertDialogAction onClick={() => importing && finishImport(importing, true).catch(console.error)}>
              {ta.import_replace}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ------------------------------------------------------------ editor

function SkinEditor({ skin }: { skin: Skin }) {
  const a = useAppearance();
  const ta = useT().appearance;
  // What "Undo changes" goes back to.
  const original = useRef(skin);
  const [draft, setDraft] = useState(skin);
  const [side, setSide] = useState<Side>(a.side);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<Skin | null>(null);

  // The side being edited is the side on screen, for as long as the editor is open.
  useEffect(() => {
    a.preview(side);
  }, [side]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      a.preview(null);
      a.draft(null);
      // Leaving mid-pause still saves.
      window.clearTimeout(timer.current);
      if (pending.current) a.save(pending.current).catch(console.error);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const update = (next: Skin) => {
    setDraft(next);
    a.draft(next);
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      pending.current = null;
      if (next.name.trim()) a.save(next).catch(console.error);
    }, SAVE_AFTER_MS);
  };
  const s = draft[side];
  const setSideValue = (patch: Partial<SkinSide>) => update({ ...draft, [side]: { ...s, ...patch } });
  const changed = JSON.stringify(draft) !== JSON.stringify(original.current);
  const k = keyContrasts(a.palette);
  const hex = (v: string | undefined) => {
    const c = parseColor(v ?? "");
    return c ? toHex({ ...c, alpha: 1 }) : "#000000";
  };

  const seed = (key: "background" | "text" | "accent", label: string, ratio: number | null) => (
    <ColorRow
      label={label}
      value={s.seeds[key]}
      shown={hex(s.seeds[key] ?? a.palette[key === "background" ? "--background" : key === "text" ? "--foreground" : "--primary"])}
      ratio={ratio}
      onChange={(v) => setSideValue({ seeds: { ...s.seeds, [key]: v } })}
      testid={`appearance-seed-${key}`}
    />
  );

  return (
    <div className="grid gap-5 border-t pt-5" data-testid="appearance-editor">
      <Row label={ta.name}>
        <Input value={draft.name} onChange={(e) => update({ ...draft, name: e.target.value })} data-testid="appearance-name" />
      </Row>

      <Tabs value={side} onValueChange={(v) => setSide(v as Side)}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="light" className="min-h-7 h-auto" data-testid="appearance-side-light">
            {ta.side_light}
          </TabsTrigger>
          <TabsTrigger value="dark" className="min-h-7 h-auto" data-testid="appearance-side-dark">
            {ta.side_dark}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-2">
        {seed("background", ta.background, null)}
        {seed("text", ta.text, k.text)}
        {seed("accent", ta.accent, k.accent)}
      </div>

      <Row label={ta.type_chroma} value={`${Math.round((s.typeChroma ?? 1) * 100)} %`} hint={ta.type_chroma_hint}>
        <Slider
          min={0}
          max={150}
          step={5}
          value={Math.round((s.typeChroma ?? 1) * 100)}
          onChange={(n) => setSideValue({ typeChroma: n === 100 ? undefined : n / 100 })}
          testid="appearance-chroma"
        />
      </Row>

      <Section title={ta.typography}>
        <FontRow label={ta.prose_font} kind="serif" value={s.typography.proseFont} onChange={(v) => setSideValue({ typography: { ...s.typography, proseFont: v } })} testid="appearance-prose-font" />
        <FontRow label={ta.ui_font} kind="sans" value={s.typography.uiFont} onChange={(v) => setSideValue({ typography: { ...s.typography, uiFont: v } })} testid="appearance-ui-font" />
        <Row label={ta.prose_size} value={`${Math.round((s.typography.proseSize ?? 1) * 100)} %`}>
          <Slider min={80} max={160} step={5} value={Math.round((s.typography.proseSize ?? 1) * 100)} onChange={(n) => setSideValue({ typography: { ...s.typography, proseSize: n === 100 ? undefined : n / 100 } })} testid="appearance-prose-size" />
        </Row>
        <Row label={ta.line_height} value={(s.typography.lineHeight ?? DEFAULT_LINE_HEIGHT).toFixed(2)}>
          <Slider min={120} max={220} step={5} value={Math.round((s.typography.lineHeight ?? DEFAULT_LINE_HEIGHT) * 100)} onChange={(n) => setSideValue({ typography: { ...s.typography, lineHeight: n / 100 } })} testid="appearance-line-height" />
        </Row>
        <Row label={ta.line_width} value={`${s.typography.lineWidth ?? DEFAULT_LINE_WIDTH} px`}>
          <Slider min={480} max={1200} step={20} value={s.typography.lineWidth ?? DEFAULT_LINE_WIDTH} onChange={(n) => setSideValue({ typography: { ...s.typography, lineWidth: n } })} testid="appearance-line-width" />
        </Row>
      </Section>

      <Section title={ta.advanced} hint={ta.advanced_hint} collapsed testid="appearance-advanced">
        <AdvancedList side={s} palette={a.palette} onChange={(overrides) => setSideValue({ overrides })} />
      </Section>

      {changed && (
        <div>
          <Button
            variant="outline"
            size="sm"
            className="min-h-8 h-auto"
            onClick={() => {
              window.clearTimeout(timer.current);
              pending.current = null;
              setDraft(original.current);
              a.draft(null);
              a.save(original.current).catch(console.error);
            }}
            data-testid="appearance-revert"
          >
            <RotateCcw /> {ta.revert}
          </Button>
        </div>
      )}
    </div>
  );
}

function AdvancedList({ side, palette, onChange }: { side: SkinSide; palette: Record<string, string>; onChange: (o: Record<string, string>) => void }) {
  const t = useT();
  const ta = t.appearance;
  const label = (d: TokenDef) => {
    const [group, key] = d.name.split(".");
    if (ta.tokens[d.name]) return ta.tokens[d.name];
    if (group === "type") return (t.types as Record<string, string>)[key] ?? key;
    if (group === "route") return ta.route_n(key);
    if (group === "cover") return ta.cover_n(key);
    return d.name;
  };
  const groups = useMemo(() => {
    const out = new Map<TokenGroup, TokenDef[]>();
    for (const d of TOKENS) out.set(d.group, [...(out.get(d.group) ?? []), d]);
    return [...out];
  }, []);
  const unknown = unknownOverrides(side);
  const set = (name: string, v: string | undefined) => {
    const next = { ...side.overrides };
    if (v === undefined) delete next[name];
    else next[name] = v;
    onChange(next);
  };
  return (
    <div className="grid gap-4">
      {unknown.length > 0 && <p className="text-sm text-muted-foreground">{ta.unknown_overrides(unknown.join(", "))}</p>}
      {groups.map(([group, defs]) => (
        <div key={group} className="grid gap-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{ta.groups[group]}</div>
          {defs.map((d) => {
            const c = parseColor(side.overrides[d.name] ?? palette[d.vars[0]] ?? "");
            return (
              <ColorRow
                key={d.name}
                label={label(d)}
                value={side.overrides[d.name]}
                shown={c ? toHex({ ...c, alpha: 1 }) : "#000000"}
                ratio={null}
                onChange={(v) => set(d.name, v)}
                testid={`appearance-token-${d.name}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ pieces

function Row({ label, value, hint, children }: { label: string; value?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 text-sm font-medium">{label}</span>
        {value && <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{value}</span>}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Section({ title, hint, collapsed, testid, children }: { title: string; hint?: string; collapsed?: boolean; testid?: string; children: ReactNode }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="grid min-w-0 gap-3" data-testid={testid}>
      <CollapsibleTrigger className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold" data-testid={testid && `${testid}-toggle`}>
        <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className="min-w-0">{title}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid min-w-0 gap-4">
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Slider({ min, max, step, value, onChange, testid }: { min: number; max: number; step: number; value: number; onChange: (n: number) => void; testid: string }) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full min-w-0 accent-primary"
      data-testid={testid}
    />
  );
}

/** A colour the user may set or leave to the Skin's default. */
function ColorRow({
  label,
  value,
  shown,
  ratio,
  onChange,
  testid,
}: {
  label: string;
  value: string | undefined;
  shown: string;
  ratio: number | null;
  onChange: (v: string | undefined) => void;
  testid: string;
}) {
  const ta = useT().appearance;
  const fmt = useFormat();
  const low = ratio !== null && ratio < 4.5;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" data-testid={testid}>
      <input
        type="color"
        value={shown}
        onChange={(e) => onChange(e.target.value)}
        className="size-8 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
        aria-label={label}
        data-testid={`${testid}-input`}
      />
      <span className={`min-w-0 flex-1 text-sm ${value ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
      {ratio !== null && (
        <span className={`shrink-0 text-xs tabular-nums ${low ? "text-destructive" : "text-muted-foreground"}`} data-testid={`${testid}-contrast`}>
          {ta.contrast(fmt.number(Math.round(ratio * 10) / 10))}
          {low && ` · ${ta.contrast_low}`}
        </span>
      )}
      {value && (
        <Button variant="ghost" size="sm" className="min-h-7 h-auto shrink-0" onClick={() => onChange(undefined)} data-testid={`${testid}-reset`}>
          {ta.reset}
        </Button>
      )}
    </div>
  );
}

const CUSTOM = "__custom__";
const DEFAULT = "__default__";

function FontRow({ label, kind, value, onChange, testid }: { label: string; kind: "serif" | "sans"; value: string | undefined; onChange: (v: string | undefined) => void; testid: string }) {
  const ta = useT().appearance;
  const known = !value || FONTS.some((f) => f.id === value);
  const [custom, setCustom] = useState(!known);
  const fontLabel = (id: string, fallback: string) => (id === "system-serif" ? ta.font_system_serif : id === "system-sans" ? ta.font_system_sans : fallback);
  // Prose may take any font; the interface is better off with a sans.
  const offered = kind === "serif" ? FONTS : FONTS.filter((f) => f.kind === "sans");
  return (
    <Row label={label}>
      <Select
        value={custom ? CUSTOM : (value ?? DEFAULT)}
        onValueChange={(v) => {
          setCustom(v === CUSTOM);
          if (v !== CUSTOM) onChange(v === DEFAULT ? undefined : v);
        }}
      >
        <SelectTrigger className="min-w-0 w-56 max-w-full" data-testid={testid}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>{ta.font_default}</SelectItem>
          {offered.map((f) => (
            <SelectItem key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
              {fontLabel(f.id, f.label)}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>{ta.font_custom}</SelectItem>
        </SelectContent>
      </Select>
      {custom && (
        <Input
          defaultValue={known ? "" : value}
          placeholder={ta.font_custom_placeholder}
          onBlur={(e) => onChange(e.target.value.trim() || undefined)}
          data-testid={`${testid}-custom`}
        />
      )}
    </Row>
  );
}

