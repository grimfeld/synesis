// The view registry (spec #145) is the one list of navigable views: each kind
// it holds must be reachable by a "Go to …" Command and must list Tutorials.
import { describe, expect, it } from "vitest";
import { SIDEBAR_VIEWS, VIEW_KINDS, VIEW_REGISTRY, isSimpleKind, navCommandId } from "../views";
import { knownCommandIds } from "../commands";
import { tutorialsFor } from "../tutorials";

describe("the view registry", () => {
  it("gives every kind a nav Command id", () => {
    const known = new Set(knownCommandIds());
    for (const kind of VIEW_KINDS) expect(known.has(navCommandId(kind)), kind).toBe(true);
  });

  it("gives every kind a tutorialsFor answer", () => {
    for (const kind of VIEW_KINDS) expect(tutorialsFor({ kind }).length, kind).toBeGreaterThan(0);
  });

  it("keeps the sidebar's order, with Settings out of it", () => {
    expect(SIDEBAR_VIEWS).toEqual(["home", "timeline", "coverage", "graph", "library", "clippings", "map", "family-tree"]);
    expect(VIEW_KINDS.at(-1)).toBe("settings");
  });

  it("restores a kind alone only when it carries no data", () => {
    expect(isSimpleKind("home")).toBe(true);
    expect(isSimpleKind("settings")).toBe(true);
    expect(isSimpleKind("family-tree")).toBe(true);
    expect(isSimpleKind("graph")).toBe(false);
    expect(isSimpleKind("doc")).toBe(false);
    expect(isSimpleKind("toString")).toBe(false);
    expect(VIEW_REGISTRY.graph.simple).toBe(false);
  });
});
