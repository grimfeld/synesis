import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, Copy, FolderOpen, LogOut, RefreshCw, Settings } from "lucide-react";
import { api, type DeviceInfo, type Lang } from "@/lib/api";
import { useQuery } from "@/lib/useQuery";
import { useCommands } from "@/lib/commands";
import { formatShortcut } from "@/lib/keys";
import { useStore } from "@/lib/store";
import { useFormat, useT } from "@/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { PairingPanel } from "@/components/Pairing";
import { AppearanceCard } from "@/components/AppearanceCard";
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

export function SettingsView() {
  const s = useStore();
  const t = useT();
  const commands = useCommands();
  const change = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string") await s.openVault(dir);
  };
  const shortcuts = commands.filter((c) => c.shortcut);
  // Devices come and go with Pairing and sync, not with anything written in
  // the vault; the list reloads when the open vault changes.
  const { data: devicesData } = useQuery<DeviceInfo[]>({
    key: [s.info?.root ?? ""],
    deps: { none: true },
    fetch: () => api.syncStatus(),
  });
  const fetched = useMemo(() => devicesData ?? [], [devicesData]);
  // `forget_device` answers with the list that is left, so the row goes as soon
  // as the engine has removed it rather than on the next poll.
  const [evicted, setEvicted] = useState<DeviceInfo[] | null>(null);
  const devices = evicted ?? fetched;
  useEffect(() => setEvicted(null), [fetched]);
  const [evicting, setEvicting] = useState<DeviceInfo | null>(null);
  const evict = async (d: DeviceInfo) => {
    setEvicting(null);
    setEvicted(await api.forgetDevice(d.id));
  };
  const method = s.settings?.sync_method ?? null;
  const mobile = /Android|iPhone|iPad/.test(navigator.userAgent);
  const fmt = useFormat();
  const ago = (ms: number) => (ms ? fmt.dateTime(ms) : "—");
  const [relay, setRelay] = useState(s.settings?.relay_url ?? "");
  useEffect(() => setRelay(s.settings?.relay_url ?? ""), [s.settings?.relay_url]);
  const saveRelay = async () => {
    await api.setRelay(relay.trim() || null);
    s.attachVault().catch(() => {});
  };
  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t.views.settings} icon={<Settings />} />
      <div className="thin-scroll min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto grid max-w-xl gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t.language}</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={s.lang} onValueChange={(v) => s.setLang(v as Lang)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          <AppearanceCard />
          <Card>
            <CardHeader>
              <CardTitle>{t.vault}</CardTitle>
              <CardDescription>{s.info ? t.documents(s.info.documents) : ""}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <code className="rounded-md bg-muted px-2 py-1.5 text-xs break-all">{s.info?.root}</code>
              <div className="flex flex-wrap gap-2">
                {!mobile && (
                  <Button variant="outline" onClick={change}>
                    <FolderOpen />
                    {t.change_vault}
                  </Button>
                )}
                <Button variant="outline" onClick={() => s.closeVault()} data-testid="close-vault">
                  <LogOut />
                  {t.close_vault}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t.close_vault_hint}</p>
            </CardContent>
          </Card>
          <Card data-testid="settings-sync">
            <CardHeader>
              <CardTitle>{t.sync.title}</CardTitle>
              <CardDescription>{method && method !== "none" ? t.sync.method_is(t.sync.methods[method]) : t.sync.method_none}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <div className="mb-2 text-sm font-medium">{t.pairing.title}</div>
                <PairingPanel compact />
              </div>
              <div className="grid gap-2 border-t pt-4">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="block font-medium">{t.pairing.background}</span>
                    <span className="block text-xs text-muted-foreground">{t.pairing.background_hint}</span>
                  </span>
                  <Switch checked={s.settings?.background_sync ?? true} onCheckedChange={(v) => api.setBackgroundSync(v).then(() => s.attachVault().catch(() => {}))} data-testid="background-sync" />
                </label>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">{t.pairing.relay}</div>
                  <div className="flex gap-2">
                    <Input value={relay} onChange={(e) => setRelay(e.target.value)} placeholder={t.pairing.relay_placeholder} className="font-mono text-xs" data-testid="relay-url" />
                    <Button variant="outline" onClick={saveRelay} disabled={(s.settings?.relay_url ?? "") === relay.trim()}>
                      {t.save}
                    </Button>
                  </div>
                </div>
              </div>
              {devices.length > 0 && (
                <div className="mb-1 text-sm font-medium">{t.sync.folder_devices}</div>
              )}
              {devices.length > 0 && (
                <ul className="divide-y rounded-md border text-sm">
                  {devices.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-3 py-2" data-testid="sync-device">
                      <RefreshCw className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        {/* The name gives way, not the marker: a long name must not hide which row is this Device. */}
                        <span className="flex min-w-0 items-baseline gap-2 font-medium">
                          <span className="truncate">{d.name || t.sync.unknown_device}</span>
                          {d.is_self && <span className="shrink-0 text-xs font-normal text-muted-foreground">({t.sync.this_device})</span>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {d.platform} · {t.sync.last_snapshot} {ago(d.last_snapshot)}
                        </span>
                      </span>
                      {!d.is_self && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="min-h-9 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => setEvicting(d)}
                          data-testid="device-evict"
                        >
                          {t.sync.evict_device}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {evicting && (
                <AlertDialog open onOpenChange={(o) => !o && setEvicting(null)}>
                  <AlertDialogContent data-testid="device-evict-confirm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t.sync.evict_device_title(evicting.name || t.sync.unknown_device)}
                      </AlertDialogTitle>
                      <AlertDialogDescription>{t.sync.evict_device_body}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => evict(evicting)} data-testid="device-evict-go">
                        {t.sync.evict_device_confirm}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <div>
                <Button variant="outline" onClick={() => s.setDialog({ kind: "sync" })} data-testid="settings-sync-setup">
                  <RefreshCw />
                  {t.sync.setup_other}
                </Button>
              </div>
            </CardContent>
          </Card>
          <VaultsCard />
          <Card>
            <CardHeader>
              <CardTitle>{t.shortcuts}</CardTitle>
              <CardDescription>{t.cmd_hint}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 text-sm">
                {shortcuts.map((c) => (
                  <div key={c.id} className="contents">
                    <dt className="text-muted-foreground">{c.title}</dt>
                    <dd>
                      <KbdGroup>
                        {formatShortcut(c.shortcut!).map((k, i) => (
                          <Kbd key={i}>{k}</Kbd>
                        ))}
                      </KbdGroup>
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <AboutCard />
        </div>
      </div>
    </div>
  );
}

/** Which build this is: the version, and the commit it was made from. */
function AboutCard() {
  const t = useT();
  const fmt = useFormat();
  const [copied, setCopied] = useState(false);
  const commit = __APP_COMMIT__;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${__APP_VERSION__} (${commit || t.app_info.unknown})`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  const rows: [string, string, string][] = [
    [t.app_info.version, __APP_VERSION__, "about-version"],
    [t.app_info.commit, commit ? commit.slice(0, 7) : t.app_info.unknown, "about-commit"],
    ...(__APP_COMMIT_DATE__
      ? [[t.app_info.committed, fmt.dateTime(Date.parse(__APP_COMMIT_DATE__)), "about-committed"] as [string, string, string]]
      : []),
    [t.app_info.built, fmt.dateTime(Date.parse(__APP_BUILT__)), "about-built"],
  ];
  return (
    <Card data-testid="settings-about">
      <CardHeader>
        <CardTitle>{t.app_info.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value, id]) => (
            <div key={id} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 font-mono text-xs break-all select-text" data-testid={id} title={id === "about-commit" ? commit : undefined}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <div>
          <Button variant="outline" size="sm" className="min-h-8" onClick={copy} data-testid="about-copy">
            {copied ? <Check /> : <Copy />}
            {copied ? t.app_info.copied : t.app_info.copy}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The Vaults this Device holds (ADR 0014).
 *
 * A list of what you own, not a history of what you opened: a Vault stays here
 * until you forget it, so opening others cannot push it off the end.
 */
function VaultsCard() {
  const s = useStore();
  const t = useT();
  const vaults = s.settings?.vaults ?? [];
  const openId = s.info?.meta.id;
  const [name, setName] = useState("");
  // Vaults made before the app chose where they go can sit somewhere Android
  // hides. The engine decides which those are (ADR 0015).
  const [hidden, setHidden] = useState<string[]>([]);
  const [moving, setMoving] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  // Leaving is per-Vault and irreversible when it takes the documents, so the
  // dialog holds which Vault and what the user typed to confirm it.
  const [leaving, setLeaving] = useState<{ id: string; name: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [leaveError, setLeaveError] = useState<string | null>(null);
  useEffect(() => setTyped(""), [leaving?.id]);
  const leave = async (deleteDocuments: boolean) => {
    if (!leaving) return;
    setLeaveError(null);
    try {
      await api.leaveVault(leaving.id, deleteDocuments);
      setLeaving(null);
      // The Vault is gone from this Device; the store has to let go of it too.
      await s.attachVault();
    } catch (e) {
      setLeaveError(String(e));
    }
  };
  useEffect(() => setName(s.info?.meta.name ?? ""), [s.info?.meta.name]);
  useEffect(() => {
    api.hiddenVaults().then(setHidden).catch(() => setHidden([]));
  }, [s.settings?.vaults]);
  const move = async (id: string) => {
    setMoving(id);
    setMoveError(null);
    try {
      await api.moveVault(id);
      await s.attachVault();
      setHidden(await api.hiddenVaults());
    } catch (e) {
      setMoveError(String(e));
    } finally {
      setMoving(null);
    }
  };
  if (vaults.length === 0) return null;
  return (
    <Card data-testid="settings-vaults">
      <CardHeader>
        <CardTitle>{t.vaults}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={t.vault_name}
            data-testid="vault-name"
          />
          <Button
            variant="outline"
            disabled={!name.trim() || name.trim() === s.info?.meta.name}
            onClick={() => api.renameVault(name).then(() => s.attachVault())}
          >
            {t.save}
          </Button>
        </div>
        <ul className="divide-y rounded-md border text-sm" data-testid="vault-list">
          {vaults.map((v) => (
            <li
              key={v.id}
              className="flex items-center gap-3 px-3 py-2"
              data-testid="vault-row"
            >
              <span className="min-w-0 flex-1 overflow-hidden">
                <span className="block truncate font-medium">{v.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {v.path}
                </span>
                {hidden.includes(v.id) && (
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-destructive">
                      {t.move_vault_badge}
                    </span>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={moving !== null}
                      onClick={() => move(v.id)}
                      data-testid="vault-move"
                    >
                      {moving === v.id ? t.move_vault_busy : t.move_vault}
                    </Button>
                  </span>
                )}
              </span>
              {v.id === openId ? (
                <>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    ({t.sync.this_device})
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-9 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setLeaving({ id: v.id, name: v.name })}
                    data-testid="vault-leave"
                  >
                    {t.leave_vault}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => s.openVault(v.path)}
                    data-testid="vault-open"
                  >
                    {t.switch_vault}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => api.forgetVault(v.id).then(() => s.attachVault())}
                  >
                    {t.forget_vault}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        {moveError && <p className="text-sm text-destructive">{moveError}</p>}
        {leaving && (
          <AlertDialog open onOpenChange={(o) => !o && setLeaving(null)}>
            <AlertDialogContent data-testid="vault-leave-confirm">
              <AlertDialogHeader>
                <AlertDialogTitle>{t.leave_vault_title(leaving.name)}</AlertDialogTitle>
                <AlertDialogDescription>{t.leave_vault_body}</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="grid gap-3 text-sm">
                <p className="text-muted-foreground">{t.leave_vault_keep_hint}</p>
                <Button
                  variant="outline"
                  className="min-h-9"
                  onClick={() => leave(false)}
                  data-testid="vault-leave-keep"
                >
                  {t.leave_vault_keep}
                </Button>
                <p className="text-muted-foreground">{t.leave_vault_delete_hint}</p>
                <Input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={t.leave_vault_confirm(leaving.name)}
                  aria-label={t.leave_vault_confirm(leaving.name)}
                  data-testid="vault-leave-name"
                />
                <Button
                  variant="destructive"
                  className="min-h-9"
                  disabled={typed.trim() !== leaving.name}
                  onClick={() => leave(true)}
                  data-testid="vault-leave-delete"
                >
                  {t.leave_vault_delete}
                </Button>
                {leaveError && <p className="text-destructive">{leaveError}</p>}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {hidden.length > 0 && (
          <p className="text-xs text-muted-foreground">{t.move_vault_hint}</p>
        )}
        <p className="text-xs text-muted-foreground">{t.forget_vault_hint}</p>
        <p className="text-xs text-muted-foreground">{t.leave_vault_hint}</p>
      </CardContent>
    </Card>
  );
}
