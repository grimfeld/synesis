import { open } from "@tauri-apps/plugin-dialog";
import { useT } from "@/i18n";
import { useStore } from "@/lib/store";

export function Welcome() {
  const t = useT();
  const s = useStore();

  const pick = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") await s.openVault(dir);
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="mb-1 text-2xl font-semibold">{t.welcome_title}</div>
        <p className="muted mb-6">{t.welcome_body}</p>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={pick}>
            {t.open_folder}
          </button>
          <button className="btn" onClick={pick}>
            {t.create_folder}
          </button>
        </div>
        {s.settings?.recent && s.settings.recent.length > 0 && (
          <div className="mt-8">
            <div className="panel-title mb-2">{t.recent}</div>
            <ul className="space-y-1">
              {s.settings.recent.map((p) => (
                <li key={p}>
                  <button className="btn btn-ghost w-full truncate text-left" onClick={() => s.openVault(p)} title={p}>
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
