import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RefreshCw, Settings } from "lucide-react";
import { api, type DeviceInfo, type Lang } from "@/lib/api";
import { useCommands } from "@/lib/commands";
import { formatShortcut } from "@/lib/keys";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function SettingsView() {
  const s = useStore();
  const t = useT();
  const commands = useCommands();
  const change = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string") await s.openVault(dir);
  };
  const shortcuts = commands.filter((c) => c.shortcut);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  useEffect(() => {
    api.syncStatus().then(setDevices).catch(() => setDevices([]));
  }, [s.info?.root, s.changeTick]);
  const method = s.settings?.sync_method ?? null;
  const ago = (ms: number) => (ms ? new Date(ms).toLocaleString() : "—");
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
              <div>
                <Button variant="outline" onClick={change}>
                  <FolderOpen />
                  {t.change_vault}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card data-testid="settings-sync">
            <CardHeader>
              <CardTitle>{t.sync.title}</CardTitle>
              <CardDescription>{method && method !== "none" ? t.sync.method_is(t.sync.methods[method]) : t.sync.method_none}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
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
