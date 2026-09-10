import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Settings } from "lucide-react";
import type { Lang } from "@/lib/api";
import { shortcut } from "@/lib/keys";
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
  const change = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string") await s.openVault(dir);
  };
  const shortcuts: [string, string[]][] = [
    [t.search, [shortcut("K")]],
    [t.new_doc, [shortcut("N")]],
    [t.quick_capture, [shortcut("⇧N")]],
    [t.toggle_sidebar, [shortcut("B")]],
  ];
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
          <Card>
            <CardHeader>
              <CardTitle>{t.shortcuts}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 text-sm">
                {shortcuts.map(([label, keys]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd>
                      <KbdGroup>
                        {keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
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
