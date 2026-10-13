// The web test build runs the app on a copy of the demo vault in the browser
// (crates/web), and the landing page offers it as "Try it in your browser".
// Say so, since nothing written there survives a reload. Never in the app.
// The source link is the AGPL's §13: a hosted copy offers its source to
// everyone who uses it over the network (ADR 0021).
import { useT } from "@/i18n";
import { SOURCE_URL } from "@/lib/links";

export function DemoBanner() {
  const t = useT();
  if (import.meta.env.MODE !== "web") return null;
  return (
    <div
      data-testid="demo-banner"
      className="flex min-w-0 shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-0.5 bg-primary px-3 py-1 text-center text-xs text-primary-foreground"
    >
      <span className="min-w-0">{t.demo_banner}</span>
      <a href={t.demo_site} className="font-medium underline underline-offset-2">
        {t.demo_about}
      </a>
      <a href={SOURCE_URL} className="font-medium underline underline-offset-2" data-testid="demo-source">
        {t.demo_source}
      </a>
    </div>
  );
}
