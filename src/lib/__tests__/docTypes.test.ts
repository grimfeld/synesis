// What a filled-in New dialog becomes, per document type. These rules used to
// live inside an async submit handler beside four engine calls, so the only
// way to check them was to drive the app.
import { describe, expect, it } from "vitest";
import { FRONTMATTER, titleFor } from "../docTypes";
import type { DocType } from "../api";

const stamp = () => "2026-09-17 14.30";
const UNTITLED = "Untitled";

describe("titleFor", () => {
  it("gives a Clipping no title at all", () => {
    // ADR 0013: the engine names the file from the Citation, and a
    // machine-made title is still a title.
    expect(titleFor("clipping", "", stamp, UNTITLED)).toBe("");
    expect(titleFor("clipping", "something typed", stamp, UNTITLED)).toBe("");
  });

  it("stamps a blank Note with the moment it was captured", () => {
    expect(titleFor("note", "", stamp, UNTITLED)).toBe("2026-09-17 14.30");
    expect(titleFor("note", "  ", stamp, UNTITLED)).toBe("2026-09-17 14.30");
  });

  it("falls back to a placeholder for every other type", () => {
    for (const t of ["source", "place", "event", "composition"] as DocType[]) {
      expect(titleFor(t, "", stamp, UNTITLED)).toBe(UNTITLED);
    }
  });

  it("keeps what the user typed, trimmed", () => {
    expect(titleFor("place", "  Antioch  ", stamp, UNTITLED)).toBe("Antioch");
    expect(titleFor("note", " a thought ", stamp, UNTITLED)).toBe("a thought");
  });
});

describe("FRONTMATTER", () => {
  it("gives a Source its kind, defaulting to article", () => {
    expect(FRONTMATTER.source!({})).toEqual({ kind: "article" });
    expect(FRONTMATTER.source!({ kind: "video" })).toEqual({ kind: "video" });
  });

  it("writes a Source's parent as a link, never a bare title", () => {
    const fm = FRONTMATTER.source!({ parent: "The Watchtower" });
    expect(fm.parent).toBe("[[The Watchtower]]");
  });

  it("leaves out what the user did not fill in", () => {
    // An empty string is absence, not a value: a blank url must not write
    // `url: ""` into the file the user opens in Obsidian.
    expect(FRONTMATTER.source!({ url: "", date: "", cover: "" })).toEqual({
      kind: "article",
    });
    expect(FRONTMATTER.event!({ start: "", end: "", place: "" })).toEqual({});
    expect(FRONTMATTER.composition!({ occasion: "", date: "" })).toEqual({});
  });

  it("reads a Place's coordinates as numbers", () => {
    // Written as text in the form; `lat` is a number Property (ADR 0006).
    const fm = FRONTMATTER.place!({ lat: "36.2", lon: "-5.35" });
    expect(fm.lat).toBe(36.2);
    expect(fm.lon).toBe(-5.35);
  });

  it("keeps an Event's Dates as the reader wrote them", () => {
    // ADR 0005: a Date is human text; the engine parses it, nothing rewrites it.
    const fm = FRONTMATTER.event!({ start: "c. 1513 BCE", end: "52 CE" });
    expect(fm.start).toBe("c. 1513 BCE");
    expect(fm.end).toBe("52 CE");
  });

  it("writes an Event's Place and a Note's Source as links", () => {
    expect(FRONTMATTER.event!({ place: "Antioch" }).place).toBe("[[Antioch]]");
    expect(FRONTMATTER.note!({ source: "Keep Enduring" }).source).toBe(
      "[[Keep Enduring]]",
    );
  });

  it("has no builder for the types whose New dialog adds no fields", () => {
    // Said with null rather than left out, so adding a type to DocType without
    // deciding this is a compile error.
    for (const t of ["character", "concept", "journey"] as DocType[]) {
      expect(FRONTMATTER[t]).toBeNull();
    }
  });

  it("has no builder for a Clipping, whose Source may not exist yet", () => {
    // Creating the Source it cites is not a pure decision, so that stays in
    // the dialog; only the title rule is here.
    expect(FRONTMATTER.clipping).toBeNull();
  });
});
