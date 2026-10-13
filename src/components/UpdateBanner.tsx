// "Synesis X is available": a strip above the view, never a dialog, so an
// update waits until the user has a moment (desktop only, src/lib/updater.ts).
import { useEffect, useRef } from "react";
import { Download, X } from "lucide-react";
import { useT } from "@/i18n";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  checkForUpdate,
  dismissUpdate,
  installUpdate,
  isDesktopApp,
  shouldCheckOnStart,
  useUpdater,
} from "@/lib/updater";

export function UpdateBanner() {
  const t = useT();
  const s = useStore();
  const { status, banner } = useUpdater();
  const started = useRef(false);
  const enabled = s.settings ? s.settings.check_updates : undefined;
  useEffect(() => {
    // Wait for the settings, so a Device that turned it off never checks.
    if (started.current || !s.settings) return;
    started.current = true;
    if (shouldCheckOnStart({ desktop: isDesktopApp(), dev: import.meta.env.DEV, enabled }))
      checkForUpdate(true);
  }, [s.settings, enabled]);
  if (!banner) return null;
  const installing = status.kind === "installing";
  const version = "version" in status ? status.version ?? "" : "";
  return (
    <div
      data-testid="update-banner"
      role="status"
      className="flex min-w-0 shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b bg-muted px-3 py-1.5 text-sm"
    >
      <span className="min-w-0 font-medium" data-testid="update-banner-text">
        {status.kind === "error"
          ? t.updater.failed(status.message)
          : installing
            ? t.updater.installing(version)
            : t.updater.available(version)}
      </span>
      {!installing && (
        <span className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="min-h-8" onClick={() => installUpdate()} data-testid="update-install">
            <Download />
            {t.updater.install}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-8"
            onClick={dismissUpdate}
            data-testid="update-dismiss"
            aria-label={t.updater.later}
          >
            <X />
            {t.updater.later}
          </Button>
        </span>
      )}
    </div>
  );
}
