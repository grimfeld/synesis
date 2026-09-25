// Tutorials (PLAN §24): every one in every language, in the one shape, naming
// only Commands and pictures that exist, and listed where the views say.
import { describe, expect, it } from "vitest";
import { knownCommandIds } from "@/lib/commands";
import { parse } from "@/components/Markdown";
import {
  FEATURE_TUTORIALS,
  LANGS,
  bundled,
  commandLinks,
  diagramNames,
  fileKey,
  finish,
  goToStep,
  imageRefs,
  parseTutorial,
  resumeAt,
  screenshotKeys,
  tutorial,
  tutorialIds,
  tutorialsFor,
  type TutorialPlace,
} from "../tutorials";
import type { DocType } from "../api";

const files = Object.entries(bundled());

describe("parseTutorial", () => {
  it("splits title, intro, steps and what follows", () => {
    const p = parseTutorial("# Passages\n\nIntro text.\n\n1. First\n2. Second\n   more of it\n\n## Good to know\n\n- a note\n");
    expect(p.errors).toEqual([]);
    expect(p.title).toBe("Passages");
    expect(p.intro).toBe("Intro text.");
    expect(p.steps).toEqual(["First", "Second\nmore of it"]);
    expect(p.after).toBe("## Good to know\n\n- a note");
  });

  it("keeps sub-lists and blank-separated paragraphs inside their step", () => {
    const p = parseTutorial("# T\n\nIntro.\n\n1. Pick one:\n   - OneDrive\n   - Dropbox\n\n   Then carry on.\n2. Last\n");
    expect(p.errors).toEqual([]);
    expect(p.steps).toEqual(["Pick one:\n- OneDrive\n- Dropbox\n\nThen carry on.", "Last"]);
  });

  it("allows blank lines between steps", () => {
    const p = parseTutorial("# T\n\nIntro.\n\n1. One\n\n2. Two\n");
    expect(p.steps).toEqual(["One", "Two"]);
  });

  it("reads the shape from structure, so headings may say anything", () => {
    const p = parseTutorial("# T\n\nIntro.\n\n## Essayez\n\n1. Un\n2. Deux\n\n## À savoir\n\nTexte.");
    expect(p.errors).toEqual([]);
    expect(p.intro).toBe("Intro.\n\n## Essayez");
  });

  it.each([
    ["no title", "Intro.\n\n1. One\n", "first line is not a `# Title`"],
    ["no intro", "# T\n\n1. One\n", "no intro before the steps"],
    ["no steps", "# T\n\nIntro only.\n", "no numbered list of steps"],
    ["two lists", "# T\n\nIntro.\n\n1. One\n\nBreak.\n\n1. Again\n", "more than one top-level numbered list"],
    ["two titles", "# T\n\nIntro.\n\n1. One\n\n# U\n", "more than one `# Title`"],
  ])("rejects %s", (_, md, error) => {
    expect(parseTutorial(md).errors).toContain(error);
  });
});

describe("the Markdown renderer", () => {
  it("keeps a numbered list whole across sub-bullets", () => {
    const blocks = parse("1. Install:\n   - a\n   - b\n2. Open it\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "ol", items: ["Install:\n- a\n- b", "Open it"] });
  });
});

describe("fileKey", () => {
  it("reads id and language from the name", () => {
    expect(fileKey("../../docs/tutorials/sync-icloud.mac.fr.md")).toEqual({ id: "sync-icloud.mac", lang: "fr" });
    expect(fileKey("docs/tutorials/passages.en.md")).toEqual({ id: "passages", lang: "en" });
    expect(fileKey("docs/tutorials/passages.de.md")).toBeNull();
  });
});

describe("the bundled Tutorials", () => {
  it("are all named <id>.<lang>.md in a known language", () => {
    for (const [path] of files) expect(fileKey(path), path).not.toBeNull();
  });

  it.each(files.map(([p, md]) => [p.replace(/^.*\//, ""), md]))("%s has the Tutorial shape", (_, md) => {
    expect(parseTutorial(md).errors).toEqual([]);
  });

  it("exist in every language, with the same number of steps", () => {
    for (const id of tutorialIds()) {
      const counts = LANGS.map((lang) => {
        const x = tutorial(id, lang);
        expect(x, `${id} in ${lang}`).not.toBeNull();
        return x?.steps.length;
      });
      expect(new Set(counts).size, `${id} step counts ${counts}`).toBe(1);
    }
  });

  it("cover the whole catalogue", () => {
    for (const id of FEATURE_TUTORIALS) expect(tutorialIds(), id).toContain(id);
  });

  it("name only Commands that exist", () => {
    // The type table arrives from the engine with a Vault; these are its
    // creatable types (`DocType::is_creatable`), the ones with a New command.
    const creatable: DocType[] = ["note", "clipping", "composition", "source", "place", "character", "concept", "event", "journey"];
    const known = new Set(knownCommandIds(creatable));
    for (const [path, md] of files) for (const id of commandLinks(md)) expect(known.has(id), `${path}: command:${id}`).toBe(true);
  });

  it("name the same Commands in every language", () => {
    for (const id of tutorialIds()) {
      const [first, ...rest] = LANGS.map((lang) => bundledFor(id, lang)).map((md) => commandLinks(md).sort());
      for (const other of rest) expect(other, id).toEqual(first);
    }
  });

  it("show only pictures that exist in both modes", () => {
    const diagrams = new Set(diagramNames());
    const shots = new Set(screenshotKeys());
    for (const [path, md] of files)
      for (const name of imageRefs(md)) {
        expect(diagrams.has(name), `${path}: diagram ${name}`).toBe(true);
        for (const lang of LANGS) for (const theme of ["light", "dark"]) expect(shots.has(`${name}.${lang}.${theme}`), `${path}: screenshot ${name}.${lang}.${theme}`).toBe(true);
      }
  });

  it("show the same pictures in every language", () => {
    for (const id of tutorialIds()) {
      const [first, ...rest] = LANGS.map((lang) => imageRefs(bundledFor(id, lang)).sort());
      for (const other of rest) expect(other, id).toEqual(first);
    }
  });
});

function bundledFor(id: string, lang: string): string {
  return files.find(([p]) => p.endsWith(`/${id}.${lang}.md`))?.[1] ?? "";
}

describe("tutorialsFor", () => {
  const places: TutorialPlace[] = [
    ...(["home", "library", "clippings", "timeline", "map", "graph", "coverage", "settings", "board"] as const).map((kind) => ({ kind })),
    ...(["note", "clipping", "composition"] as DocType[]).map((type) => ({ kind: "editor" as const, type })),
    ...(["source", "book", "chapter", "verse", "place", "character", "concept", "event", "journey"] as DocType[]).map((type) => ({ kind: "hub" as const, type })),
  ];

  it.each(places.map((p) => [JSON.stringify(p), p]))("%s lists at least one Tutorial that exists", (_, place) => {
    const ids = tutorialsFor(place as TutorialPlace, "mac");
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(tutorial(id, "en"), id).not.toBeNull();
  });

  it("puts every feature Tutorial on some view", () => {
    const listed = new Set(places.flatMap((p) => tutorialsFor(p, "mac")));
    for (const id of FEATURE_TUTORIALS) expect(listed, id).toContain(id);
  });

  it("offers this Device's folder-sync Tutorials in Settings", () => {
    expect(tutorialsFor({ kind: "settings" }, "android")).toEqual(["pairing", "sync-syncthing.android", "palette"]);
    expect(tutorialsFor({ kind: "settings" }, "mac")).toEqual(["pairing", "sync-icloud.mac", "sync-syncthing.mac", "sync-provider.mac", "palette"]);
  });

  it("lists nothing twice", () => {
    for (const p of places) {
      const ids = tutorialsFor(p, "mac");
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("progress", () => {
  it("resumes where the user left off", () => {
    const p = goToStep({}, "passages", 2, 4);
    expect(resumeAt(p, "passages", 4)).toBe(2);
    expect(p.passages.done).toBe(false);
  });

  it("clamps to the steps there are", () => {
    expect(goToStep({}, "x", 9, 3).x.step).toBe(2);
    expect(goToStep({}, "x", -1, 3).x.step).toBe(0);
    expect(resumeAt({ x: { step: 7, done: false } }, "x", 3)).toBe(2);
  });

  it("starts a finished Tutorial from the top, and keeps it finished", () => {
    const p = finish({}, "passages", 4);
    expect(p.passages).toEqual({ step: 3, done: true });
    expect(resumeAt(p, "passages", 4)).toBe(0);
    expect(goToStep(p, "passages", 1, 4).passages.done).toBe(true);
  });

  it("starts an unseen Tutorial at step one", () => {
    expect(resumeAt({}, "graph", 3)).toBe(0);
  });
});
