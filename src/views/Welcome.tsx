// Onboarding wizard, shown whenever no vault is open (docs/PLAN.md §14):
// 1 Welcome · 2 Devices & sync · 3 Vault · 4 Done.
import { useEffect, useMemo, useState } from "react";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, ArrowRight, BookOpenText, Check, FolderOpen, FolderPlus, Laptop, RefreshCw, Search, Zap } from "lucide-react";
import { cn } from "cn";
import { api, type SyncLocations } from "@/lib/api";
import { shortcut } from "@/lib/keys";
import { locationsFor, type DeviceKind, type Method } from "@/lib/sync";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { SyncSetup } from "@/components/SyncSetup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";

type Step = 1 | 2 | 3 | 4;

function joinPath(home: string, name: string) {
  const sep = home.includes("\\") ? "\\" : "/";
  return home.replace(/[\\/]+$/, "") + sep + name;
}

export function Welcome() {
  const t = useT();
  const s = useStore();
  const [step, setStep] = useState<Step>(1);
  const [locations, setLocations] = useState<SyncLocations | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [, setDevices] = useState<DeviceKind[]>([]);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recent = s.settings?.recent ?? [];

  useEffect(() => {
    api.syncLocations().then(setLocations).catch(console.error);
  }, []);

  // Default vault path: inside the chosen method's folder when it exists, else the home folder.
  const suggested = useMemo(() => {
    if (!locations) return "";
    const inMethod = method ? locationsFor(method, locations.locations).find((l) => l.exists) : undefined;
    return inMethod?.suggested ?? joinPath(locations.home, "Synesis");
  }, [locations, method]);
  useEffect(() => setPath(suggested), [suggested]);

  const found = locations?.found ?? [];

  const openAt = async (p: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.setSyncMethod(method ?? "none");
      await s.openVault(p);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  const choose = async () => {
    const dir = await pickFolder({ directory: true, multiple: false });
    if (typeof dir === "string") setPath(dir);
  };

  const steps: { n: Step; label: string }[] = [
    { n: 1, label: t.wizard.step_welcome },
    { n: 2, label: t.wizard.step_sync },
    { n: 3, label: t.wizard.step_vault },
    { n: 4, label: t.wizard.step_done },
  ];

  return (
    <div className="flex h-full flex-col bg-muted/40">
      <header className="flex items-center gap-3 px-6 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BookOpenText className="size-4" />
        </div>
        <span className="text-sm font-semibold">{t.app}</span>
        <ol className="ml-auto flex items-center gap-1 text-xs" data-testid="wizard-steps">
          {steps.map((x, i) => (
            <li key={x.n} className="flex items-center gap-1">
              <span className={cn("flex size-5 items-center justify-center rounded-full border text-[10px]", step === x.n && "border-primary bg-primary text-primary-foreground", step > x.n && "border-primary text-primary")}>{step > x.n ? <Check className="size-3" /> : x.n}</span>
              <span className={cn("hidden sm:inline", step === x.n ? "font-medium" : "text-muted-foreground")}>{x.label}</span>
              {i < steps.length - 1 && <span className="mx-1 text-muted-foreground/50">›</span>}
            </li>
          ))}
        </ol>
      </header>

      <div className="thin-scroll min-h-0 flex-1 overflow-auto px-6 pb-8">
        <div className="mx-auto max-w-2xl" data-testid={`wizard-step-${step}`}>
          {step === 1 && (
            <section className="grid gap-6 pt-8">
              <div>
                <h1 className="font-prose text-3xl font-bold tracking-tight">{t.welcome_title}</h1>
                <p className="mt-2 text-muted-foreground">{t.wizard.intro}</p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-3">
                {t.wizard.pillars.map((p, i) => (
                  <li key={i} className="rounded-xl border bg-card p-4 text-sm">
                    <div className="mb-1 font-medium">{p.title}</div>
                    <div className="text-muted-foreground">{p.body}</div>
                  </li>
                ))}
              </ul>
              {recent.length > 0 && (
                <div className="rounded-xl border bg-card p-4">
                  <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t.recent}</div>
                  <ul className="space-y-0.5">
                    {recent.map((p) => (
                      <li key={p}>
                        <button type="button" className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent" onClick={() => s.openVault(p)} title={p}>
                          <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{p}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {step === 2 && (
            <section className="grid gap-4 pt-6">
              <div>
                <h2 className="text-xl font-semibold">{t.wizard.sync_title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t.wizard.sync_body}</p>
              </div>
              <SyncSetup
                locations={locations}
                onChange={(m, d) => {
                  setMethod(m);
                  setDevices(d);
                }}
              />
            </section>
          )}

          {step === 3 && (
            <section className="grid gap-4 pt-6">
              <div>
                <h2 className="text-xl font-semibold">{t.wizard.vault_title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{method ? t.wizard.vault_body_synced(t.sync.methods[method]) : t.wizard.vault_body}</p>
              </div>
              {found.length > 0 && (
                <div className="rounded-xl border bg-card p-4" data-testid="found-vaults">
                  <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t.wizard.found_title}</div>
                  <ul className="space-y-1">
                    {found.map((v) => {
                      const others = v.devices.filter((d) => !d.is_self);
                      const from = others.map((d) => d.name || t.sync.unknown_device).join(", ");
                      return (
                        <li key={v.path}>
                          <button type="button" className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent" onClick={() => { setPath(v.path); setStep(4); }} disabled={busy}>
                            <RefreshCw className="size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{from ? t.wizard.synced_from(from) : v.path.split(/[\\/]/).pop()}</span>
                              <span className="block truncate text-xs text-muted-foreground">{v.path}</span>
                            </span>
                            <ArrowRight className="size-4 text-muted-foreground" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <div className="rounded-xl border bg-card p-4">
                <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t.wizard.create_title}</div>
                <p className="mb-2 text-xs text-muted-foreground">{t.wizard.create_body}</p>
                <div className="flex gap-2">
                  <Input value={path} onChange={(e) => setPath(e.target.value)} data-testid="vault-path" className="font-mono text-xs" />
                  <Button variant="outline" onClick={choose} title={t.wizard.choose}>
                    <FolderOpen />
                  </Button>
                </div>
                {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => setStep(4)} disabled={!path.trim() || busy} data-testid="vault-create">
                    <FolderPlus />
                    {t.wizard.create_here}
                  </Button>
                </div>
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="grid gap-6 pt-8">
              <div>
                <h2 className="font-prose text-3xl font-bold tracking-tight">{t.wizard.done_title}</h2>
                <p className="mt-2 text-muted-foreground">{t.wizard.done_body}</p>
              </div>
              <ul className="grid gap-3">
                {[
                  { icon: Zap, title: t.wizard.try_capture, body: t.wizard.try_capture_body, kbd: shortcut("⇧N") },
                  { icon: Search, title: t.wizard.try_palette, body: t.wizard.try_palette_body, kbd: shortcut("K") },
                  { icon: Laptop, title: t.wizard.try_passage, body: t.wizard.try_passage_body, kbd: "" },
                ].map((x, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-xl border bg-card p-4">
                    <x.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 text-sm">
                      <div className="font-medium">{x.title}</div>
                      <div className="text-muted-foreground">{x.body}</div>
                    </div>
                    {x.kbd && <Kbd>{x.kbd}</Kbd>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t bg-background px-6 py-3">
        {step > 1 && (
          <Button variant="ghost" onClick={() => setStep((step - 1) as Step)}>
            <ArrowLeft />
            {t.back}
          </Button>
        )}
        <div className="flex-1" />
        {step === 1 && (
          <Button onClick={() => setStep(2)} data-testid="wizard-next">
            {t.wizard.get_started}
            <ArrowRight />
          </Button>
        )}
        {step === 2 && (
          <>
            {!method && (
              <Button variant="ghost" onClick={() => setStep(3)} data-testid="wizard-skip">
                {t.wizard.skip_sync}
              </Button>
            )}
            <Button onClick={() => setStep(3)} data-testid="wizard-next">
              {t.next}
              <ArrowRight />
            </Button>
          </>
        )}
        {step === 4 && (
          <>
            {error && <span className="text-sm text-destructive">{error}</span>}
            <Button onClick={() => openAt(path.trim())} disabled={busy} data-testid="wizard-open">
              {t.wizard.open_vault}
              <ArrowRight />
            </Button>
          </>
        )}
      </footer>
    </div>
  );
}
