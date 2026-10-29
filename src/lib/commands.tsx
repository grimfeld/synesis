// The Command registry: one list feeds the Command Palette, keyboard
// shortcuts and the Settings shortcut table. Commands are built from the
// store so they can navigate and open dialogs; editor commands act on the
// mounted editor.
import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  BookOpenText,
  CalendarRange,
  CircleHelp,
  Code,
  Download,
  Info,
  Columns2,
  Copy,
  Lock,
  LockOpen,
  Presentation,
  Dices,
  FilePlus,
  House,
  LayoutGrid,
  MapPin,
  Network,
  PenLine,
  RefreshCw,
  Search,
  Settings,
  LibraryBig,
  Quote,
  SquareSplitHorizontal,
  Waypoints,
  X,
  Zap,
} from "lucide-react";
import { CREATABLE_TYPES, WRITING_TYPES, type DocType } from "@/lib/api";
import { useStore } from "@/lib/store";
import { IS_MAC } from "@/lib/keys";
import { useT } from "@/i18n";
import { tutorial, tutorialIds } from "@/lib/tutorials";
import { useTutorials } from "@/lib/tutorialState";
import { useAppearance } from "@/lib/appearance";
import { useFillKinds } from "@/lib/fillKinds";
import { checkForUpdate, isDesktopApp } from "@/lib/updater";
import { SOURCE_URL, openExternal } from "@/lib/links";
import { toast } from "sonner";
import { whenBoard } from "@/lib/activeBoard";
import {
  EDITOR_COMMANDS,
  getActiveEditor,
  useHasEditor,
} from "@/editor/active";

export type CommandGroup = "create" | "navigate" | "editor" | "help";

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  icon?: LucideIcon;
  /** Spec like "Mod+Shift+P"; see src/lib/keys.ts. */
  shortcut?: string;
  /**
   * The shortcut wins over the editor's own binding for the same keys. For
   * Back and Forward: CodeMirror binds Alt+←/→ to a syntax motion off macOS,
   * and handling the key there left Back dead whenever a page had focus.
   */
  overEditor?: boolean;
  keywords?: string;
  run: () => void;
}

const TYPE_ICON: Partial<Record<DocType, LucideIcon>> = {
  composition: PenLine,
};

export function useCommands(): Command[] {
  const s = useStore();
  const t = useT();
  const hasEditor = useHasEditor();
  const tutorials = useTutorials();
  const appearance = useAppearance();
  const fillKinds = useFillKinds();
  return useMemo(() => {
    const list: Command[] = [];
    // ---- create + capture
    for (const type of CREATABLE_TYPES) {
      list.push({
        id: `create.${type}`,
        title: t.new_type[type],
        group: "create",
        icon: TYPE_ICON[type] ?? FilePlus,
        shortcut: type === "note" ? "Mod+N" : undefined,
        keywords: t.types_plural[type],
        run: () => s.setDialog({ kind: "new", type }),
      });
    }
    list.push({
      id: "create.quick",
      title: t.quick_capture,
      group: "create",
      icon: Zap,
      shortcut: "Mod+Shift+N",
      run: () => s.setDialog({ kind: "quick" }),
    });
    // ---- navigate
    list.push({
      id: "nav.search",
      title: t.search,
      group: "navigate",
      icon: Search,
      shortcut: "Mod+K",
      run: () => s.setDialog({ kind: "search" }),
    });
    list.push({
      id: "nav.commands",
      title: t.cmd_palette,
      group: "navigate",
      icon: Search,
      shortcut: "Mod+Shift+P",
      run: () => s.setDialog({ kind: "search", query: ">" }),
    });
    const views: {
      kind:
        | "home"
        | "graph"
        | "library"
        | "clippings"
        | "map"
        | "timeline"
        | "coverage"
        | "settings";
      icon: LucideIcon;
      title: string;
    }[] = [
      { kind: "home", icon: House, title: t.views.home },
      { kind: "graph", icon: Waypoints, title: t.views.graph },
      { kind: "library", icon: LibraryBig, title: t.views.library },
      { kind: "clippings", icon: Quote, title: t.views.clippings },
      { kind: "map", icon: MapPin, title: t.views.map },
      { kind: "timeline", icon: CalendarRange, title: t.views.timeline },
      { kind: "coverage", icon: LayoutGrid, title: t.views.coverage },
      { kind: "settings", icon: Settings, title: t.views.settings },
    ];
    for (const v of views)
      list.push({
        id: `nav.${v.kind}`,
        title: `${t.go_to} ${v.title}`,
        group: "navigate",
        icon: v.icon,
        run: () => s.navigate({ kind: v.kind }),
      });
    list.push({
      id: "nav.back",
      title: t.back,
      group: "navigate",
      icon: ArrowLeft,
      shortcut: "Alt+ArrowLeft",
      // Not on macOS, where Option+← is word-left in every text field and
      // taking it from the editor would break ordinary editing.
      overEditor: !IS_MAC,
      run: s.back,
    });
    list.push({
      id: "nav.forward",
      title: t.forward,
      group: "navigate",
      icon: ArrowRight,
      shortcut: "Alt+ArrowRight",
      overEditor: !IS_MAC,
      run: s.forward,
    });
    // Panes (spec #35): what the last-used Pane shows, opened beside it; and,
    // with two open, closing the last-used one or swapping their sides.
    if (s.twoPanesFit)
      list.push({
        id: "pane.open_other",
        title: t.pane_open_other,
        group: "navigate",
        icon: SquareSplitHorizontal,
        keywords: "pane split side by side two documents beside open other",
        run: () => s.openInOther(s.view),
      });
    if (s.panes.panes.length === 2) {
      list.push({
        id: "pane.close",
        title: t.pane_close,
        group: "navigate",
        icon: X,
        keywords: "pane close one single",
        run: () => s.dispatchPanes({ type: "close" }),
      });
      list.push({
        id: "pane.swap",
        title: t.pane_swap,
        group: "navigate",
        icon: ArrowLeftRight,
        keywords: "pane swap switch sides exchange left right",
        run: () => s.dispatchPanes({ type: "swap" }),
      });
    }
    list.push({
      id: "nav.passage",
      title: t.open_passage,
      group: "navigate",
      icon: BookOpenText,
      keywords: "verse scripture",
      run: () => s.setDialog({ kind: "goto-passage" }),
    });
    list.push({
      id: "nav.sync",
      title: t.sync.setup_command,
      group: "navigate",
      icon: RefreshCw,
      keywords: "sync icloud syncthing dropbox onedrive drive devices",
      run: () => s.setDialog({ kind: "sync" }),
    });
    list.push({
      id: "skins.gallery",
      title: t.appearance.gallery_command,
      group: "navigate",
      icon: LayoutGrid,
      keywords: "skin theme look colours nord paper appearance",
      run: () => {
        s.navigate({ kind: "settings" });
        appearance.setGalleryOpen(true);
      },
    });
    list.push({
      id: "map.fill_kinds",
      title: t.fill_kinds,
      group: "create",
      icon: MapPin,
      keywords: "map place kind pin gazetteer",
      run: () => {
        s.navigate({ kind: "map" });
        fillKinds().catch(console.error);
      },
    });
    list.push({
      id: "nav.random",
      title: t.random_note,
      group: "navigate",
      icon: Dices,
      run: () => {
        const notes = s.docs.filter((d) => d.type === "note");
        if (notes.length)
          s.openDoc(notes[Math.floor(Math.random() * notes.length)].id);
      },
    });
    // The local graph of the document being read (PLAN §10): any document,
    // Writing or Hub.
    if (s.view.kind === "doc") {
      const id = s.view.id;
      list.push({
        id: "doc.local_graph",
        title: t.local_graph,
        group: "navigate",
        icon: Waypoints,
        keywords: "graph local neighbours links connections network",
        run: () => s.navigate({ kind: "graph", focus: id }),
      });
    }
    // The Board of the Composition being read. Named "Board" per the glossary,
    // with "mind map" in the keywords so the palette finds it either way.
    if (s.view.kind === "doc") {
      const doc = s.docsById.get(s.view.id);
      if (doc?.type === "composition") {
        list.push({
          id: "doc.board",
          title: s.docTab === "board" ? t.board_tab_talk : t.board,
          group: "navigate",
          icon: Network,
          keywords: "board mind map canvas talk outline",
          run: () => s.setDocTab(s.docTab === "board" ? "talk" : "board"),
        });
        // Export the Board as a picture (PLAN §17.18): the toolbar's button,
        // reachable from anywhere on the Composition. From the talk it opens
        // the Board first, since the picture is drawn from the Board on screen.
        list.push({
          id: "board.export",
          title: t.board_export,
          group: "create",
          icon: Download,
          keywords: "export board picture image png svg save mind map canvas",
          run: () => {
            if (s.docTab === "talk") s.setDocTab("board");
            void whenBoard(doc.id).then((b) => {
              if (b) return b.exportPicture();
              toast.error(t.board_export_failed);
            }).catch((e) => toast.error(String(e)));
          },
        });
        // Talk and Board side by side (PLAN §22.2). Offered even where the
        // split does not fit: the talk shows until there is room.
        list.push({
          id: "doc.split",
          title: s.docTab === "split" ? t.board_tab_talk : t.split_command,
          group: "navigate",
          icon: Columns2,
          keywords: "split side by side board talk both columns pane",
          run: () => s.setDocTab(s.docTab === "split" ? "talk" : "split"),
        });
        // Adapting a talk to a new occasion is a fork, not a Version
        // (PLAN §14.8, ADR 0007): the copy carries the Board along.
        list.push({
          id: "doc.duplicate",
          title: t.duplicate_command,
          group: "create",
          icon: Copy,
          keywords: "duplicate copy fork clone new occasion adapt talk composition",
          run: () => {
            s.duplicateComposition(doc.id, t.copy_title(doc.title)).catch((e) =>
              toast.error(String(e)),
            );
          },
        });
        // The Delivery view (PLAN §23.12).
        list.push({
          id: "doc.deliver",
          title: t.deliver_command,
          group: "navigate",
          icon: Presentation,
          keywords: "deliver present presentation talk give timer lectern full screen",
          run: () => s.openDelivery(doc.id),
        });
      }
      // The capture box on a Source Hub. Reaching it by hand means scrolling
      // back up past a long list of Clippings, which is what the box exists to
      // avoid; the palette gets there from anywhere on the page.
      if (doc?.type === "source") {
        list.push({
          id: "doc.capture",
          // Not "Quick capture": that is the global command, which creates a
          // Note belonging to no Source. This one is the box on the page.
          title: t.capture_here,
          group: "create",
          icon: Zap,
          keywords: "capture clipping note keep quote excerpt source",
          run: () =>
            document
              .querySelector<HTMLTextAreaElement>("[data-testid=capture-text]")
              ?.focus(),
        });
      }
    }
    // ---- editor
    // Reading mode is the Device's lock on every Writing (PLAN §23), so it is
    // offered wherever one is open.
    if (s.view.kind === "doc") {
      const doc = s.docsById.get(s.view.id);
      if (doc && WRITING_TYPES.includes(doc.type)) {
        list.push({
          id: "editor.reading",
          title: s.readingMode ? t.reading_unlock : t.reading_mode,
          group: "editor",
          icon: s.readingMode ? LockOpen : Lock,
          keywords: "reading read only lock locked keyboard edit unlock",
          run: () => s.setReadingMode(!s.readingMode),
        });
      }
    }
    // Editing Commands are not offered on a locked page: the lock would drop
    // their change anyway, and a Command that does nothing is a lie.
    if (hasEditor && !s.readingMode) {
      list.push({
        id: "editor.source",
        title: s.sourceMode ? t.live_preview : t.source_mode,
        group: "editor",
        icon: Code,
        shortcut: "Mod+E",
        keywords: "source live preview mode",
        run: () => s.setSourceMode(!s.sourceMode),
      });
      for (const c of EDITOR_COMMANDS) {
        list.push({
          id: c.id,
          title:
            t.editor_cmds[
              c.id.slice("editor.".length) as keyof typeof t.editor_cmds
            ],
          group: "editor",
          icon: PenLine,
          shortcut: c.shortcut,
          run: () => {
            const v = getActiveEditor();
            if (v) c.run(v);
          },
        });
      }
    }
    // ---- help: what this build is, and where its source is (ADR 0021).
    const showAbout = () => {
      s.navigate({ kind: "settings" });
      setTimeout(() => document.querySelector("[data-testid=settings-about]")?.scrollIntoView({ block: "start" }), 50);
    };
    list.push({
      id: "app.about",
      title: t.licence.about_command,
      group: "help",
      icon: Info,
      keywords: "about version licence license agpl copyright credits",
      run: showAbout,
    });
    list.push({
      id: "app.source",
      title: t.licence.source_command,
      group: "help",
      icon: Code,
      keywords: "source code github agpl licence license",
      run: () => openExternal(SOURCE_URL),
    });
    if (isDesktopApp())
      list.push({
        id: "app.check_updates",
        title: t.updater.check,
        group: "help",
        icon: Download,
        keywords: "update upgrade new version release",
        run: () => {
          s.navigate({ kind: "settings" });
          checkForUpdate();
        },
      });
    // ---- help: every Tutorial, by its title in the app's language (PLAN §25.1).
    for (const id of tutorialIds()) {
      const tut = tutorial(id, s.lang);
      if (!tut) continue;
      list.push({
        id: `tutorial.${id}`,
        title: t.tutorials.command(tut.title),
        group: "help",
        icon: CircleHelp,
        keywords: "tutorial help how",
        run: () => tutorials.show(id, tut.steps.length),
      });
    }
    return list;
  }, [s, t, hasEditor, tutorials, appearance.setGalleryOpen, fillKinds]);
}

/**
 * Every Command id the registry can hold, whatever the current view. The
 * registry itself only lists what applies now (the Board toggle on a
 * Composition, editor commands with an editor), so a Tutorial's
 * `command:` links are checked against this instead (PLAN §25.9).
 */
export function knownCommandIds(creatable: DocType[] = CREATABLE_TYPES): string[] {
  return [
    ...creatable.map((type) => `create.${type}`),
    "create.quick",
    "nav.search",
    "nav.commands",
    ...["home", "graph", "library", "clippings", "map", "timeline", "coverage", "settings"].map((v) => `nav.${v}`),
    "nav.back",
    "nav.forward",
    "pane.open_other",
    "pane.close",
    "pane.swap",
    "nav.passage",
    "nav.sync",
    "nav.random",
    "skins.gallery",
    "map.fill_kinds",
    "doc.board",
    "doc.split",
    "doc.deliver",
    "doc.local_graph",
    "board.export",
    "doc.duplicate",
    "doc.capture",
    "editor.reading",
    "editor.source",
    "app.about",
    "app.source",
    "app.check_updates",
    ...EDITOR_COMMANDS.map((c) => c.id),
    ...tutorialIds().map((id) => `tutorial.${id}`),
  ];
}
