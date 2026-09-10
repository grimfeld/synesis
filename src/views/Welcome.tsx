import { open } from "@tauri-apps/plugin-dialog";
import { BookOpenText, FolderOpen, FolderPlus } from "lucide-react";
import { useT } from "@/i18n";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PanelTitle } from "@/components/Field";

export function Welcome() {
  const t = useT();
  const s = useStore();

  const pick = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") await s.openVault(dir);
  };
  const recent = s.settings?.recent ?? [];

  return (
    <div className="flex h-full items-center justify-center bg-muted/40 p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <BookOpenText className="size-5" />
          </div>
          <CardTitle className="text-xl">{t.welcome_title}</CardTitle>
          <CardDescription>{t.welcome_body}</CardDescription>
        </CardHeader>
        {recent.length > 0 && (
          <CardContent>
            <PanelTitle className="mb-2">{t.recent}</PanelTitle>
            <ul className="-mx-2 space-y-0.5">
              {recent.map((p) => {
                const parts = p.split(/[\\/]/).filter(Boolean);
                const name = parts.pop();
                return (
                  <li key={p}>
                    <button type="button" className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent" onClick={() => s.openVault(p)} title={p}>
                      <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{parts.join("/")}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        )}
        <CardFooter className="gap-2">
          <Button onClick={pick}>
            <FolderOpen />
            {t.open_folder}
          </Button>
          <Button variant="outline" onClick={pick}>
            <FolderPlus />
            {t.create_folder}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
