import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, LogOut, RefreshCw, Settings } from "lucide-react";
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
  const devices = useMemo(() => devicesData ?? [], [devicesData]);
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
                        <span className="block truncate font-medium">
                          {d.name || t.sync.unknown_device}
                          {d.is_self && <span className="ml-2 text-xs font-normal text-muted-foreground">({t.sync.this_device})</span>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {d.platform} · {t.sync.last_snapshot} {ago(d.last_snapshot)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
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
        </div>
      </div>
    </div>
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
  useEffect(() => setName(s.info?.meta.name ?? ""), [s.info?.meta.name]);
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
              </span>
              {v.id === openId ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  ({t.sync.this_device})
                </span>
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
        <p className="text-xs text-muted-foreground">{t.forget_vault_hint}</p>
      </CardContent>
    </Card>
  );
}
