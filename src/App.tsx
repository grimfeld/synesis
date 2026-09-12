import { useEffect } from "react";
import { LangContext } from "./i18n";
import { StoreProvider, useStore } from "./lib/store";
import { useCommands } from "./lib/commands";
import { matchShortcut } from "./lib/keys";
import { AppSidebar } from "./components/AppSidebar";
import { Dialogs } from "./components/Dialogs";
import { DocView } from "./views/DocView";
import { HubView } from "./views/HubView";
import { TimelineView } from "./views/TimelineView";
import { HUB_TYPES } from "./lib/api";
import { GraphView } from "./views/GraphView";
import { HomeView } from "./views/HomeView";
import { MapView } from "./views/MapView";
import { CoverageView } from "./views/CoverageView";
import { SettingsView } from "./views/SettingsView";
import { Welcome } from "./views/Welcome";
import { api } from "./lib/api";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { TooltipProvider } from "./components/ui/tooltip";

/** Global keyboard shortcuts come from the Command registry. */
function Shortcuts() {
  const commands = useCommands();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The editor's own keymap (bound from the same registry) runs first and prevents default.
      if (e.defaultPrevented) return;
      const c = commands.find(
        (c) => c.shortcut && matchShortcut(e, c.shortcut),
      );
      if (!c) return;
      e.preventDefault();
      c.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commands]);
  return null;
}

function Shell() {
  const s = useStore();

  useEffect(() => {
    let un: (() => void) | undefined;
    let unPair: (() => void) | undefined;
    api.onQuickCapture(() => s.setDialog({ kind: "quick" })).then((u) => (un = u));
    api
      .onPairingEvent((e) => {
        if (e.kind === "join_request") s.setDialog({ kind: "pairing-request", node: e.node, name: e.member.name, platform: e.member.platform });
      })
      .then((u) => (unPair = u));
    return () => {
      un?.();
      unPair?.();
    };
  }, [s]);

  // Dev/test hook: lets the Cypress suite raise dialogs the engine would (join requests).
  if (import.meta.env.DEV) (window as unknown as { __synesis_setDialog?: unknown }).__synesis_setDialog = s.setDialog;

  if (!s.info) return <Welcome />;

  const main = (() => {
    switch (s.view.kind) {
      case "home":
        return <HomeView />;
      case "doc": {
        const type = s.docsById.get(s.view.id)?.type;
        return type && HUB_TYPES.includes(type) ? (
          <HubView key={s.view.id} id={s.view.id} />
        ) : (
          <DocView key={s.view.id} id={s.view.id} />
        );
      }
      case "graph":
        return <GraphView />;
      case "map":
        return <MapView />;
      case "timeline":
        return <TimelineView />;
      case "coverage":
        return <CoverageView />;
      case "settings":
        return <SettingsView />;
    }
  })();

  return (
    <SidebarProvider
      open={s.sidebarOpen}
      onOpenChange={s.setSidebarOpen}
      className="h-full min-h-0 overflow-hidden"
    >
      <AppSidebar />
      <SidebarInset className="h-full min-h-0 overflow-hidden">
        {main}
      </SidebarInset>
      <Dialogs />
      <Shortcuts />
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
