// A capture box clears only what it submitted (spec #206).
import { describe, expect, it } from "vitest";
import { captureRest } from "../captureRest";

describe("captureRest", () => {
  it("empties the box when nothing was typed during the create", () => {
    expect(captureRest("a thought", "a thought")).toBe("");
  });

  it("keeps what was typed after the submitted text", () => {
    expect(captureRest("a thought", "a thought and more")).toBe(" and more");
  });

  it("drops the line breaks between the submitted text and the next one", () => {
    expect(captureRest("first", "first\nsecond")).toBe("second");
    expect(captureRest("first", "first  \n\nsecond")).toBe("second");
  });

  it("keeps the whole text when it was edited inside what was submitted", () => {
    expect(captureRest("a thought", "a good thought")).toBe("a good thought");
    expect(captureRest("a thought", "")).toBe("");
  });
});
