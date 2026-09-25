// Onboarding wizard, shown whenever no vault is open (PLAN §21):
// 1 Welcome · 2 Sync · 3 Vault · 4 Done.
//
// Step 2 is a chooser and nothing else — three cards, each opening its own
// screen. There is deliberately no "Next" there: the old one advanced past a
// typed pairing code and silently made a local vault instead.
import { useCallback, useEffect, useMemo, useState } from "react";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, ArrowRight, BookOpenText, Check, ChevronRight, FolderOpen, FolderPlus, Laptop, Link2, RefreshCw, Search, Zap } from "lucide-react";
import { cn } from "cn";
import { api, type SyncLocations } from "@/lib/api";
import { shortcut } from "@/lib/keys";
import { destination, methodFor, nameIsUsable, type Route } from "@/lib/onboarding";
import { locationsFor, type Method } from "@/lib/sync";
import { useStore } from "@/lib/store";
import { tutorial } from "@/lib/tutorials";
import { useTutorials } from "@/lib/tutorialState";
import { useT } from "@/i18n";
import { LandsIn } from "@/components/LandsIn";
import { SyncSetup } from "@/components/SyncSetup";
import { JoinPairing, JoinWaiting } from "@/components/Pairing";
import { usePairing } from "@/lib/pairing";
import type { PairingStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";

type Step = 1 | 2 | 3 | 4;

/** One way into a vault. The card is the button; tapping it opens its screen. */
function RouteCard({ icon: Icon, title, body, recommended, onClick, testid }: { icon: typeof Link2; title: string; body: string; recommended?: boolean; onClick: () => void; testid: string }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} data-testid={testid} className="flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent">
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          {recommended && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-primary uppercase">{t.sync.recommended}</span>}
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{body}</span>
      </span>
      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function Welcome() {
  const t = useT();
  const s = useStore();
  const [step, setStep] = useState<Step>(1);
  const [route, setRoute] = useState<Route | null>(null);
  const [locations, setLocations] = useState<SyncLocations | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinStatus, setJoinStatus] = useState<PairingStatus | null>(null);
  const joining = joinStatus !== null;
  const pairing = usePairing(joining);
  const known = s.settings?.vaults ?? [];
  const tutorials = useTutorials();

  // Joined and approved: the engine has the vault open; adopt it.
  useEffect(() => {
    if (joining && pairing.lastEvent?.kind === "approved") s.attachVault().catch(console.error);
    if (joining && pairing.lastEvent?.kind === "denied") {
      setJoinStatus(null);
      setError(t.pairing.denied);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing.lastEvent, joining]);

  const reload = useCallback(() => {
    api.syncLocations().then(setLocations).catch(console.error);
  }, []);
  useEffect(reload, [reload]);

  // The grant happens in the system's own settings, so the only reliable
  // moment to look again is when this window comes back.
  useEffect(() => {
    const onFocus = () => {
      if (locations?.storage.needed && !locations.storage.granted) reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [locations, reload]);

  const grant = async () => {
    try {
      await api.requestStorageAccess();
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    if (!name && locations) setName(t.wizard.name_placeholder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  // Desktop keeps the picker, and keeps proposing a folder inside the sync
  // tool's own directory when one was chosen (PLAN §21.3).
  const suggested = useMemo(() => {
    if (!locations || locations.app_decides_path) return undefined;
    const inMethod = method ? locationsFor(method, locations.locations).find((l) => l.exists) : undefined;
    return inMethod ? `${inMethod.suggested}` : destination(locations, name).path;
  }, [locations, method, name]);
  useEffect(() => setPath(suggested), [suggested]);

  const dest = destination(locations, name, path);

  const createVault = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setSyncMethod(methodFor(route ?? "local", method) as never);
      // The engine has the real free_path: ask it, so a name already taken
      // becomes a sibling rather than a folder that holds another Vault.
      const target = locations?.app_decides_path ? await api.suggestVaultPath(name.trim()) : dest.path;
      await s.openVault(target);
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

  // Back from a route's screen returns to the chooser, not to step 1.
  const back = () => {
    if (step === 3 && route) {
      setRoute(null);
      return setStep(2);
    }
    setStep((step - 1) as Step);
  };

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
          {step === 1 && known.length > 0 && (
            // This Device already holds Vaults: opening one is the likely
            // errand, not walking a wizard again (PLAN §21.7).
            <section className="grid gap-4 pt-8">
              <div>
                <h1 className="font-prose text-3xl font-bold tracking-tight">{t.wizard.open_title}</h1>
                <p className="mt-2 text-muted-foreground">{t.wizard.open_body}</p>
              </div>
              <ul className="grid gap-2" data-testid="known-vaults">
                {known.map((v) => (
                  <li key={v.id}>
                    <button type="button" className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent" onClick={() => s.openVault(v.path).catch((e) => setError(String(e)))} title={v.path}>
                      <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{v.name}</span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">{v.path}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </section>
          )}

          {step === 1 && known.length === 0 && (
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
            </section>
          )}

          {step === 2 && (
            <section className="grid gap-4 pt-6" data-testid="wizard-routes">
              <div>
                <h2 className="text-xl font-semibold">{t.wizard.choose_title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t.wizard.choose_body}</p>
              </div>
              <RouteCard icon={Link2} title={t.wizard.route_pairing} body={t.wizard.route_pairing_body} recommended testid="route-pairing" onClick={() => { setRoute("pairing"); setStep(3); }} />
              <RouteCard icon={RefreshCw} title={t.wizard.route_folder} body={t.wizard.route_folder_body} testid="route-folder" onClick={() => { setRoute("folder"); setStep(3); }} />
              <RouteCard icon={FolderPlus} title={t.wizard.route_local} body={t.wizard.route_local_body} testid="route-local" onClick={() => { setRoute("local"); setStep(3); }} />
            </section>
          )}

          {step === 3 && route === "pairing" && (
            <section className="grid gap-4 pt-6" data-testid="route-screen-pairing">
              <div>
                <h2 className="text-xl font-semibold">{t.wizard.pairing_title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t.pairing.intro}</p>
              </div>
              {joining ? (
                <JoinWaiting status={pairing.status ?? joinStatus} />
              ) : (
                <>
                  <JoinPairing
                    platform={locations?.platform ?? ""}
                    locations={locations}
                    onJoined={setJoinStatus}
                    onGrant={grant}
                  />
                  {error && <p className="text-sm text-destructive">{error}</p>}
                </>
              )}
            </section>
          )}

          {step === 3 && route === "folder" && (
            <section className="grid gap-4 pt-6" data-testid="route-screen-folder">
              <div>
                <h2 className="text-xl font-semibold">{t.wizard.folder_title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t.wizard.sync_body}</p>
              </div>
              {locations && locations.found.length > 0 && (
                // Found Vaults live here because they exist by virtue of a
                // synced folder existing (PLAN §21.6).
                <div className="rounded-xl border bg-card p-4" data-testid="found-vaults">
                  <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t.wizard.found_title}</div>
                  <ul className="space-y-1">
                    {locations.found.map((v) => {
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
              <SyncSetup locations={locations} foldersOpen onChange={(m) => setMethod(m)} />
              <VaultNameAndPlace
                locations={locations}
                name={name}
                onName={setName}
                path={path}
                onPath={setPath}
                onChoose={choose}
                dest={dest}
                onGrant={grant}
                busy={busy}
                error={error}
                onCreate={createVault}
                hint={locations?.app_decides_path ? t.wizard.point_tool_here(dest.path) : undefined}
              />
            </section>
          )}

          {step === 3 && route === "local" && (
            <section className="grid gap-4 pt-6" data-testid="route-screen-local">
              <div>
                <h2 className="text-xl font-semibold">{t.wizard.local_title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t.wizard.local_body}</p>
              </div>
              <VaultNameAndPlace
                locations={locations}
                name={name}
                onName={setName}
                path={path}
                onPath={setPath}
                onChoose={choose}
                dest={dest}
                onGrant={grant}
                busy={busy}
                error={error}
                onCreate={createVault}
              />
            </section>
          )}

          {step === 4 && (
            <section className="grid gap-6 pt-8">
              <div>
                <h2 className="font-prose text-3xl font-bold tracking-tight">{t.wizard.done_title}</h2>
                <p className="mt-2 text-muted-foreground">{t.wizard.done_body}</p>
              </div>
              <ul className="grid gap-3">
                {/* Each opens the Vault with its Tutorial beside it (PLAN §22.11). */}
                {[
                  { icon: Zap, title: t.wizard.try_capture, body: t.wizard.try_capture_body, kbd: shortcut("⇧N"), tutorial: "capture" },
                  { icon: Search, title: t.wizard.try_palette, body: t.wizard.try_palette_body, kbd: shortcut("K"), tutorial: "palette" },
                  { icon: Laptop, title: t.wizard.try_passage, body: t.wizard.try_passage_body, kbd: "", tutorial: "passages" },
                ].map((x, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-xl border bg-card p-4">
                    <x.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium">{x.title}</div>
                      <div className="text-muted-foreground">{x.body}</div>
                      <Button
                        variant="link"
                        size="sm"
                        className="mt-1 h-auto min-h-7 px-0 whitespace-normal"
                        disabled={busy}
                        data-testid={`wizard-tutorial-${x.tutorial}`}
                        onClick={() => {
                          tutorials.show(x.tutorial, tutorial(x.tutorial, s.lang)?.steps.length ?? 1);
                          createVault();
                        }}
                      >
                        {t.tutorials.show_me}
                        <ArrowRight />
                      </Button>
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
        {step > 1 && !joining && (
          <Button variant="ghost" onClick={back}>
            <ArrowLeft />
            {t.back}
          </Button>
        )}
        <div className="flex-1" />
        {step === 1 && (
          <Button onClick={() => setStep(2)} data-testid="wizard-next">
            {known.length > 0 ? t.wizard.new_vault : t.wizard.get_started}
            <ArrowRight />
          </Button>
        )}
        {/* Step 2 has no Next: the cards are the navigation, and each screen
            below carries the one action that says what it does (PLAN §21.1). */}
        {step === 4 && (
          <>
            {error && <span className="text-sm text-destructive">{error}</span>}
            <Button onClick={createVault} disabled={busy} data-testid="wizard-open">
              {t.wizard.open_vault}
              <ArrowRight />
            </Button>
          </>
        )}
      </footer>
    </div>
  );
}

/**
 * Name the vault and show where it will go. On mobile the path is derived and
 * read-only; on desktop the picker stays, because a real filesystem is there
 * to point at (PLAN §21.3).
 */
function VaultNameAndPlace({
  locations,
  name,
  onName,
  path,
  onPath,
  onChoose,
  dest,
  onGrant,
  busy,
  error,
  onCreate,
  hint,
}: {
  locations: SyncLocations | null;
  name: string;
  onName: (v: string) => void;
  path: string | undefined;
  onPath: (v: string) => void;
  onChoose: () => void;
  dest: { path: string; visible: boolean; canAsk: boolean };
  onGrant: () => void;
  busy: boolean;
  error: string | null;
  onCreate: () => void;
  hint?: string;
}) {
  const t = useT();
  const derived = locations?.app_decides_path ?? false;
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4" data-testid="vault-place">
      <div className="grid gap-1.5">
        <label className="text-sm font-medium" htmlFor="vault-name">
          {t.wizard.name_label}
        </label>
        <Input id="vault-name" value={name} onChange={(e) => onName(e.target.value)} placeholder={t.wizard.name_placeholder} data-testid="vault-name" />
      </div>
      {derived ? (
        <LandsIn path={dest.path} visible={dest.visible} canAsk={dest.canAsk} onGrant={onGrant} />
      ) : (
        <div className="grid gap-1.5">
          <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t.wizard.lands_in}</div>
          <div className="flex gap-2">
            <Input value={path ?? ""} onChange={(e) => onPath(e.target.value)} data-testid="vault-path" className="font-mono text-xs" />
            {locations?.can_pick_folder !== false && (
              <Button variant="outline" onClick={onChoose} title={t.wizard.choose}>
                <FolderOpen />
              </Button>
            )}
          </div>
        </div>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div>
        <Button onClick={onCreate} disabled={busy || !nameIsUsable(derived ? name : path ?? "")} data-testid="vault-create">
          <FolderPlus />
          {t.wizard.create_vault}
        </Button>
      </div>
    </div>
  );
}
