import { useEffect } from "react";
import { LangContext } from "./i18n";
import { StoreProvider, useStore } from "./lib/store";
import { Sidebar } from "./components/Sidebar";
import { Dialogs } from "./components/Dialogs";
import { DocView } from "./views/DocView";
import { GraphView } from "./views/GraphView";
import { MapView } from "./views/MapView";
import { CoverageView } from "./views/CoverageView";
import { SettingsView } from "./views/SettingsView";
import { Welcome } from "./views/Welcome";
import { api } from "./lib/api";

function Shell() {
  const s = useStore();

  // Global shortcuts: search palette and quick capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setDialog({ kind: "search" });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        s.setDialog({ kind: "quick" });
      } else if (mod && e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        s.setDialog({ kind: "new" });
      } else if (e.key === "Escape" && s.dialog) {
        s.setDialog(null);
      }
    };
    window.addEventListener("keydown", onKey);
    let un: (() => void) | undefined;
    api.onQuickCapture(() => s.setDialog({ kind: "quick" })).then((u) => (un = u));
    return () => {
      window.removeEventListener("keydown", onKey);
      un?.();
    };
  }, [s]);

  if (!s.info) return <Welcome />;

  const main = (() => {
    switch (s.view.kind) {
      case "doc":
        return <DocView key={s.view.id} id={s.view.id} />;
      case "graph":
        return <GraphView />;
      case "map":
        return <MapView />;
      case "coverage":
        return <CoverageView />;
      case "settings":
        return <SettingsView />;
    }
  })();

  return (
    <div className="flex h-full w-full overflow-hidden">
      {s.sidebarOpen && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">{main}</div>
      <Dialogs />
    </div>
  );
}

function LangBridge() {
  const s = useStore();
  return (
    <LangContext.Provider value={s.lang}>
      <Shell />
    </LangContext.Provider>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <LangBridge />
    </StoreProvider>
  );
}
