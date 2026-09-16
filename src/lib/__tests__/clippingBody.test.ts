import { describe, expect, it } from "vitest";
import { quoteBody } from "../clippingBody";

describe("quoteBody", () => {
  it("quotes a single line", () => {
    expect(quoteBody("Endurance is not merely putting up with things.")).toBe(
      "> Endurance is not merely putting up with things.\n",
    );
  });

  it("quotes every line of a multi-line excerpt", () => {
    expect(quoteBody("First line.\nSecond line.")).toBe(
      "> First line.\n> Second line.\n",
    );
  });

  it("keeps a blank line inside the quote so the block stays one quote", () => {
    // A bare blank line would end the blockquote and start a second one.
    expect(quoteBody("First.\n\nSecond.")).toBe("> First.\n>\n> Second.\n");
  });

  it("leaves text the user already quoted alone", () => {
    expect(quoteBody("> Already quoted.")).toBe("> Already quoted.\n");
    expect(quoteBody("> Quoted.\nNot quoted.")).toBe(
      "> Quoted.\n> Not quoted.\n",
    );
  });

  it("trims the excerpt rather than quoting surrounding blank lines", () => {
    expect(quoteBody("\n\n  Kept.  \n\n")).toBe("> Kept.\n");
  });

  it("returns nothing for an empty excerpt", () => {
    expect(quoteBody("")).toBe("");
    expect(quoteBody("   \n  ")).toBe("");
  });

  it("normalises CRLF, since a paste from a PDF carries it", () => {
    expect(quoteBody("First.\r\nSecond.")).toBe("> First.\n> Second.\n");
  });
});
