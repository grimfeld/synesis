// Where a Vault will land, said before it lands there (ADR 0015).
//
// On Android without all-files access the path shown is the private fallback
// the Files app hides, and the line says so rather than presenting a folder
// the user will later fail to find. Shared by the wizard's create screens and
// by the join screen, which derives its folder from the Invite.
import { FolderOpen, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";

interface Props {
  path: string;
  /** False when the folder is the private fallback. */
  visible: boolean;
  /** True when a permission would move it somewhere the user can browse. */
  canAsk: boolean;
  onGrant: () => void;
}

export function LandsIn({ path, visible, canAsk, onGrant }: Props) {
  const t = useT();
  return (
    <div className="rounded-lg border bg-muted/40 p-3" data-testid="lands-in">
      <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t.wizard.lands_in}</div>
      <div className="mt-1 flex items-start gap-2">
        {visible ? <FolderOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />}
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs break-all" data-testid="lands-path">
            {path}
          </div>
          <p className={cn("mt-1 text-xs", visible ? "text-muted-foreground" : "text-destructive")}>{visible ? t.wizard.lands_visible : t.wizard.lands_hidden}</p>
        </div>
      </div>
      {canAsk && (
        <div className="mt-3 grid gap-1.5">
          <div>
            <Button size="sm" variant="outline" onClick={onGrant} data-testid="grant-access">
              {t.wizard.grant_access}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t.wizard.grant_hint}</p>
        </div>
      )}
    </div>
  );
}
