// "Which devices will you use?" -> recommended free sync method -> tutorial.
// Used by the Welcome wizard (step 2) and by Settings ("Set up sync on another device").
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Apple, CircleAlert, Laptop, Monitor, Smartphone, Terminal } from "lucide-react";
import { cn } from "cn";
import type { SyncLocations } from "@/lib/api";
import { DEVICE_KINDS, METHODS, platformToKind, recommend, tutorial, tutorialKinds, type DeviceKind, type Method } from "@/lib/sync";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const ICON: Record<DeviceKind, typeof Laptop> = { mac: Laptop, windows: Monitor, linux: Terminal, ios: Apple, android: Smartphone };

interface Props {
  locations: SyncLocations | null;
  /** The Pairing card rendered first (Invite panel or join form, depending on the caller). */
  pairing?: ReactNode;
  /** Open the folder section by default (e.g. when a folder method is already in use). */
  foldersOpen?: boolean;
  /** Called whenever the selection changes: the method to set up (null = single device / impossible). */
  onChange?: (method: Method | null, devices: DeviceKind[]) => void;
  className?: string;
}

export function SyncSetup({ locations, onChange, className, pairing, foldersOpen = false }: Props) {
  const s = useStore();
  const t = useT();
  const current = platformToKind(locations?.platform ?? "");
  const [devices, setDevices] = useState<DeviceKind[]>([current]);
  const [override, setOverride] = useState<Method | null>(null);
  // The platform arrives with `locations`; until then `current` is a placeholder that must not stick.
  useEffect(() => {
    if (!locations) return;
    setDevices((d) => (d.includes(current) ? d : [current]));
  }, [locations, current]);

  const rec = useMemo(() => recommend(new Set(devices)), [devices]);
  const method: Method | null = override && (override === rec.method || rec.alternatives.includes(override)) ? override : rec.method;
  useEffect(() => {
    onChange?.(method, devices);
  }, [method, devices, onChange]);

  const kinds = method ? tutorialKinds(method, current) : [];
  const [kind, setKind] = useState<DeviceKind>(current);
  useEffect(() => {
    if (kinds.length && !kinds.includes(kind)) setKind(kinds[0]);
  }, [kinds, kind]);
  const md = method ? tutorial(method, kind, s.lang) : null;

  return (
    <div className={cn("grid gap-5", className)}>
      {pairing && (
        <section className="rounded-xl border bg-card p-4" data-testid="sync-pairing">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-medium">{t.pairing.title}</span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-primary uppercase">{t.sync.recommended}</span>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">{t.pairing.intro}</p>
          {pairing}
        </section>
      )}
      <Collapsible defaultOpen={!pairing || foldersOpen} className="group/folders">
        <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-medium" data-testid="sync-folders-toggle">
          <ChevronRight className="size-4 transition-transform group-data-[state=open]/folders:rotate-90" />
          {pairing ? t.sync.folder_section : t.sync.which_devices}
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-5 pt-4">
      <div>
        <div className="mb-2 text-sm font-medium">{t.sync.which_devices}</div>
        <ToggleGroup type="multiple" value={devices} onValueChange={(v) => v.length && setDevices(v as DeviceKind[])} variant="outline" size="sm" spacing={1} className="flex-wrap justify-start" data-testid="sync-devices">
          {DEVICE_KINDS.map((k) => {
            const Icon = ICON[k];
            return (
              <ToggleGroupItem key={k} value={k} className="gap-1.5" data-testid={`device-${k}`}>
                <Icon className="size-3.5" />
                {t.sync.devices[k]}
                {k === current && <span className="text-[10px] text-muted-foreground">({t.sync.this_device})</span>}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>

      <div className="rounded-xl border bg-card p-4" data-testid="sync-recommendation">
        {devices.length <= 1 ? (
          <p className="text-sm text-muted-foreground">{t.sync.single_device}</p>
        ) : rec.impossible ? (
          <div className="flex gap-2 text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p>{t.sync.impossible}</p>
          </div>
        ) : (
          <>
            <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t.sync.recommended}</div>
            <div className="flex flex-wrap items-center gap-2">
              {[rec.method!, ...rec.alternatives].map((m) => (
                <button
                  key={m}
                  type="button"
                  data-testid={`method-${m}`}
                  aria-pressed={method === m}
                  className={cn("rounded-lg border px-3 py-1.5 text-sm transition-colors", method === m ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent")}
                  onClick={() => setOverride(m)}
                >
                  {t.sync.methods[m]}
                  {m === rec.method && (
                    <Badge variant="secondary" className="ml-2 h-4 px-1 text-[10px]">
                      {t.sync.best}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t.sync.reasons[method ?? rec.method!]}</p>
          </>
        )}
      </div>

      {method && md && (
        <div data-testid="sync-tutorial">
          <Tabs value={kind} onValueChange={(v) => setKind(v as DeviceKind)}>
            {kinds.length > 1 && (
              <TabsList className="mb-3">
                {kinds.map((k) => (
                  <TabsTrigger key={k} value={k} className="text-xs">
                    {t.sync.devices[k]}
                  </TabsTrigger>
                ))}
              </TabsList>
            )}
            {kinds.map((k) => (
              <TabsContent key={k} value={k}>
                <Markdown source={tutorial(method, k, s.lang) ?? ""} className="rounded-xl border bg-card p-5" />
              </TabsContent>
            ))}
          </Tabs>
        </div>
      )}
      {method && !md && <p className="text-sm text-muted-foreground">{METHODS.includes(method) ? t.sync.no_tutorial : ""}</p>}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
