// Unit tests for pure TypeScript helpers (Vitest, jsdom): `npm run test:unit`.
import { describe, expect, it } from "vitest";
import {
  joinFrontmatter,
  removeField,
  setField,
  splitFrontmatter,
  yamlScalar,
} from "../frontmatter";
import { diffLines, diffStats } from "../diff";
import {
  formatShortcut,
  matchShortcut,
  toCodeMirrorKey,
} from "../keys";
import { matchByName, NameIndex, norm } from "../names";
import { recommend } from "../syncRules";
import type { DocSummary } from "../api";

describe("frontmatter helpers", () => {
  const text = "---\nid: X\ntype: note\ntags: [a, b]\n---\nBody line\n";

  it("splits and joins without losing bytes", () => {
    const sp = splitFrontmatter(text);
    expect(sp.fm).to.equal("---\nid: X\ntype: note\ntags: [a, b]\n---\n");
    expect(sp.body).to.equal("Body line\n");
    expect(joinFrontmatter(sp.fm, sp.body)).to.equal(text);
    expect(splitFrontmatter("no fm").fm).to.equal("");
  });

  it("sets, replaces and removes fields touching only their line", () => {
    const { fm } = splitFrontmatter(text);
    expect(setField(fm, "source", "[[Paul]]")).to.equal(
      '---\nid: X\ntype: note\ntags: [a, b]\nsource: "[[Paul]]"\n---\n',
    );
    expect(setField(fm, "tags", ["x", "y z"])).to.equal(
      "---\nid: X\ntype: note\ntags: [x, y z]\n---\n",
    );
    expect(removeField(fm, "tags")).to.equal("---\nid: X\ntype: note\n---\n");
    expect(setField("", "type", "note")).to.equal("---\ntype: note\n---\n");
  });

  it("writes numbers and booleans bare, strings that look like them quoted", () => {
    expect(setField("", "lat", 37.9394)).to.equal("---\nlat: 37.9394\n---\n");
    expect(setField("", "lat", "37.9394")).to.equal(
      '---\nlat: "37.9394"\n---\n',
    );
    expect(setField("", "done", true)).to.equal("---\ndone: true\n---\n");
    expect(setField("---\ndone: true\n---\n", "done", false)).to.equal(
      "---\ndone: false\n---\n",
    );
  });

  it("quotes YAML scalars only when needed", () => {
    expect(yamlScalar("plain words")).to.equal("plain words");
    expect(yamlScalar("has: colon")).to.equal('"has: colon"');
    expect(yamlScalar("true")).to.equal('"true"');
    expect(yamlScalar("42")).to.equal('"42"');
    expect(yamlScalar("")).to.equal('""');
  });
});

describe("keyboard shortcuts", () => {
  const ev = (init: Partial<KeyboardEvent> & { key: string; code?: string }) =>
    new KeyboardEvent("keydown", init);

  it("matches Mod / Shift / Alt combinations", () => {
    expect(matchShortcut(ev({ key: "k", ctrlKey: true }), "Mod+K")).to.equal(
      true,
    );
    expect(
      matchShortcut(
        ev({ key: "K", ctrlKey: true, shiftKey: true }),
        "Mod+Shift+K",
      ),
    ).to.equal(true);
    expect(
      matchShortcut(ev({ key: "k", ctrlKey: true, shiftKey: true }), "Mod+K"),
    ).to.equal(false);
    expect(
      matchShortcut(ev({ key: "ArrowLeft", altKey: true }), "Alt+ArrowLeft"),
    ).to.equal(true);
    expect(matchShortcut(ev({ key: "k" }), "Mod+K")).to.equal(false);
  });

  it("formats and converts specs", () => {
    expect(formatShortcut("Mod+Shift+P").slice(1)).to.deep.equal(["⇧", "P"]);
    expect(formatShortcut("Alt+ArrowLeft")[1]).to.equal("←");
    expect(toCodeMirrorKey("Mod+Shift+H")).to.equal("Mod-Shift-h");
    expect(toCodeMirrorKey("Mod+L")).to.equal("Mod-l");
  });
});

describe("NameIndex", () => {
  const idx = new NameIndex([
    { id: "1", name: "Paul", type: "character", alias: false },
    { id: "1", name: "Saul of Tarsus", type: "character", alias: true },
    { id: "2", name: "Undeserved kindness", type: "concept", alias: false },
    { id: "3", name: "Paul in Ephesus", type: "note", alias: false },
  ]);

  it("calls a title ambiguous only when two documents carry it", () => {
    const two = new NameIndex([
      { id: "a", name: "Antioch", type: "place", alias: false },
      { id: "b", name: "antioch", type: "place", alias: false },
      { id: "1", name: "Paul", type: "character", alias: false },
      { id: "2", name: "Paul", type: "note", alias: true },
    ]);
    expect(two.ambiguous("Antioch")).to.equal(true);
    // An Alias never makes a title ambiguous: titles win over aliases.
    expect(two.ambiguous("Paul")).to.equal(false);
    expect(two.ambiguous("Rome")).to.equal(false);
  });

  it("normalises like the engine", () => {
    expect(norm("  Undeserved-Kindness ")).to.equal("undeserved kindness");
  });

  it("resolves titles, aliases and path segments case-insensitively", () => {
    expect(idx.resolve("paul")?.id).to.equal("1");
    expect(idx.resolve("SAUL OF TARSUS")?.id).to.equal("1");
    expect(idx.resolve("Concepts/undeserved kindness")?.id).to.equal("2");
    expect(idx.has("nobody")).to.equal(false);
  });

  it("suggests prefix matches first, then word starts, then substrings", () => {
    expect(idx.suggest("pa").map((e) => e.name)).to.deep.equal([
      "Paul",
      "Paul in Ephesus",
    ]);
    expect(idx.suggest("kind").map((e) => e.name)).to.deep.equal([
      "Undeserved kindness",
    ]);
    expect(idx.suggest("", 2)).to.have.length(2);
    expect(idx.suggest("pa", 10, ["note"]).map((e) => e.name)).to.deep.equal([
      "Paul in Ephesus",
    ]);
  });
});

describe("matchByName", () => {
  const d = (id: string, title: string) =>
    ({ id, title, label: title, type: "character", path: `${title}.md` }) as unknown as DocSummary;
  const docs = [d("jacob", "Jacob"), d("isaac", "Isaac"), d("esau", "Ésaü")];
  const entries = [
    { name: "Israel", id: "jacob", type: "character" as const, alias: true },
    { name: "Edom", id: "esau", type: "character" as const, alias: true },
  ];

  it("finds by title, accent-insensitive, then by Alias", () => {
    expect(matchByName(docs, entries, "esau").matches.map((m) => m.doc.id)).toEqual(["esau"]);
    const isr = matchByName(docs, entries, "isr");
    expect(isr.matches).toEqual([{ doc: docs[0], alias: "Israel" }]);
    expect(isr.exact).toBeNull();
    // "is" is in Isaac's title and Israel's Alias: title first, each once.
    expect(matchByName(docs, entries, "is").matches.map((m) => m.doc.id)).toEqual(["isaac", "jacob"]);
  });

  it("tells an exact title or Alias, so no Create is offered", () => {
    expect(matchByName(docs, entries, "israel").exact?.doc.id).toBe("jacob");
    expect(matchByName(docs, entries, " jacob ").exact?.doc.id).toBe("jacob");
    expect(matchByName(docs, entries, "Joseph")).toEqual({ matches: [], exact: null });
  });
});

describe("line diff", () => {
  it("marks added and removed lines and keeps common ones", () => {
    const ops = diffLines("a\nb\nc\n", "a\nc\nd\n");
    expect(ops.map((o) => o.kind + ":" + o.text)).to.deep.equal([
      "same:a",
      "del:b",
      "same:c",
      "add:d",
      "same:",
    ]);
    expect(diffStats(ops)).to.deep.equal({ added: 1, removed: 1 });
    expect(diffStats(diffLines("x", "x"))).to.deep.equal({
      added: 0,
      removed: 0,
    });
    expect(diffLines("", "one")).to.deep.equal([
      { kind: "del", text: "" },
      { kind: "add", text: "one" },
    ]);
  });
});

describe("sync recommendation", () => {
  const r = (...d: string[]) => recommend(new Set(d as never));
  it("follows the plan's rule", () => {
    expect(r("windows")).to.deep.equal({ method: null, alternatives: [], impossible: false });
    expect(r("mac", "ios").method).to.equal("icloud");
    expect(r("windows", "ios").method).to.equal("icloud");
    expect(r("linux", "ios").impossible).to.equal(true);
    expect(r("windows", "android").method).to.equal("syncthing");
    expect(r("mac", "ios", "android").impossible).to.equal(true);
    expect(r("mac", "mac")).to.deep.equal({ method: null, alternatives: [], impossible: false });
    expect(r("windows", "linux")).to.deep.equal({ method: "provider", alternatives: ["syncthing"], impossible: false });
    expect(r("mac", "windows").method).to.equal("provider");
  });
});
