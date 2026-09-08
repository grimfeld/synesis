import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Lang } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";

export function SettingsView() {
  const s = useStore();
  const t = useT();
  const change = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string") await s.openVault(dir);
  };
  return (
    <div className="thin-scroll h-full overflow-auto p-6">
      <header className="mb-4 flex items-center gap-2">
        {!s.sidebarOpen && (
          <button className="btn btn-ghost btn-sm" onClick={() => s.setSidebarOpen(true)}>
            ☰
          </button>
        )}
        <h1 className="text-xl font-semibold">{t.views.settings}</h1>
      </header>
      <div className="max-w-lg space-y-6">
        <section>
          <div className="panel-title mb-1">{t.language}</div>
          <select value={s.lang} onChange={(e) => s.setLang(e.target.value as Lang)}>
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </section>
        <section>
          <div className="panel-title mb-1">{t.vault}</div>
          <div className="mb-2 break-all text-sm">{s.info?.root}</div>
          <div className="muted mb-2 text-xs">{s.info ? t.documents(s.info.documents) : ""}</div>
          <button className="btn" onClick={change}>
            {t.change_vault}
          </button>
        </section>
        <section className="muted text-xs">
          <div>{t.shortcut_capture}</div>
          <div>{t.shortcut_search}</div>
        </section>
      </div>
    </div>
  );
}
