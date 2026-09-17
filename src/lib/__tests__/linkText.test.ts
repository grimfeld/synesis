import { describe, expect, it } from "vitest";
import { linkInBody, linkText } from "../linkText";
import type { DocSummary } from "../api";

const doc = (title: string, path: string): DocSummary =>
  ({ id: "x", path, title, type: "place" }) as DocSummary;

describe("linkText", () => {
  it("writes a bare link when the prose already reads as the title", () => {
    expect(linkText(doc("Antioch", "Places/Antioch.md"), "Antioch", false)).toBe(
      "[[Antioch]]",
    );
  });

  it("keeps the prose as an alias whenever it differs", () => {
    const paul = doc("Paul", "Characters/Paul.md");
    expect(linkText(paul, "Paul's", false)).toBe("[[Paul|Paul's]]");
    // Case alone still counts: Obsidian would otherwise capitalise the word.
    expect(linkText(paul, "paul", false)).toBe("[[Paul|paul]]");
    expect(linkText(doc("Barnabas", "Characters/Barnabas.md"), "Joseph", false)).toBe(
      "[[Barnabas|Joseph]]",
    );
  });

  it("writes an ambiguous title as a path so it cannot resolve to the wrong page", () => {
    expect(
      linkText(doc("Antioch", "Places/Pisidia/Antioch.md"), "Antioch", true),
    ).toBe("[[Places/Pisidia/Antioch|Antioch]]");
  });
});

describe("linkInBody", () => {
  const doc = (title: string, path = `Places/${title}.md`) =>
    ({ title, path }) as DocSummary;
  const linkable = (matched: string, start: number, ambiguous: DocSummary[] = []) => ({
    start,
    end: start + matched.length,
    matched,
    ambiguous,
  });

  it("replaces the words with a link and says where it landed", () => {
    const body = "the brothers in Antioch met";
    const r = linkInBody(body, linkable("Antioch", 16), doc("Antioch"));
    expect(r).not.toBeNull();
    expect(r!.body).toBe("the brothers in [[Antioch]] met");
    expect(r!.at).toBe(16);
  });

  it("keeps the prose exactly when it differs from the title", () => {
    // ADR 0011: the rendered document must not change by a character.
    const body = "the city of antioch";
    const r = linkInBody(body, linkable("antioch", 12), doc("Antioch"));
    expect(r!.body).toBe("the city of [[Antioch|antioch]]");
  });

  it("finds the words again when the offset has gone stale", () => {
    // The list is debounced, so a writer who keeps typing shifts the text
    // under it. Refusing here is what made the button do nothing, silently.
    const body = "a longer opening than before, then Antioch";
    const r = linkInBody(body, linkable("Antioch", 3), doc("Antioch"));
    expect(r!.body).toContain("[[Antioch]]");
    expect(r!.at).toBe(35);
  });

  it("gives up only when the words are genuinely gone", () => {
    expect(linkInBody("nothing here", linkable("Antioch", 0), doc("Antioch"))).toBeNull();
  });

  it("skips an occurrence already inside a link when it has to search", () => {
    // The engine never offers a name it can already see linked, so the
    // in-place case cannot arise; the search that follows a stale offset can,
    // and it steps over the linked copy to the bare one.
    const body = "see [[Antioch]] and Antioch again";
    const r = linkInBody(body, linkable("Antioch", 99), doc("Antioch"));
    expect(r!.at).toBe(20);
    expect(r!.body).toBe("see [[Antioch]] and [[Antioch]] again");
  });

  it("writes an ambiguous title as a path", () => {
    const body = "he wrote to John";
    const r = linkInBody(
      body,
      linkable("John", 12, [doc("John", "Characters/John.md"), doc("John", "Scripture/John.md")]),
      doc("John", "Characters/John.md"),
    );
    expect(r!.body).toBe("he wrote to [[Characters/John|John]]");
  });
});
