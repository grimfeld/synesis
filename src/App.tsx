import { useEffect } from "react";
import { LangContext } from "./i18n";
import { StoreProvider, useStore } from "./lib/store";
import { AppSidebar } from "./components/AppSidebar";
import { Dialogs } from "./components/Dialogs";
import { DocView } from "./views/DocView";
import { GraphView } from "./views/GraphView";
import { MapView } from "./views/MapView";
import { CoverageView } from "./views/CoverageView";
import { SettingsView } from "./views/SettingsView";
import { Welcome } from "./views/Welcome";
import { api } from "./lib/api";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { TooltipProvider } from "./components/ui/tooltip";

function Shell() {
  const s = useStore();

  // Global shortcuts: search palette, new document, quick capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        s.setDialog({ kind: "search" });
      } else if (key === "n" && e.shiftKey) {
        e.preventDefault();
        s.setDialog({ kind: "quick" });
      } else if (key === "n") {
        e.preventDefault();
        s.setDialog({ kind: "new" });
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
    <SidebarProvider open={s.sidebarOpen} onOpenChange={s.setSidebarOpen} className="h-svh min-h-0 overflow-hidden">
      <AppSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">{main}</SidebarInset>
      <Dialogs />
    </SidebarProvider>
  );
}

function LangBridge() {
  const s = useStore();
  return (
    <LangContext.Provider value={s.lang}>
      <TooltipProvider delayDuration={400}>
        <Shell />
      </TooltipProvider>
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
