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
import { NameIndex, norm } from "../names";
import { recommend } from "../syncRules";

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
