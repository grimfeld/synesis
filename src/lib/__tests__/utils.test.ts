// The small DOM helpers the Map and its Border drawing share.
import { afterEach, describe, expect, it } from "vitest";
import { cssVar, esc } from "../utils";

describe("esc", () => {
  it("makes a title safe to render as HTML", () => {
    const host = document.createElement("div");
    host.innerHTML = esc(`<b>Tom & "Jerry's"</b>`);
    expect(host.textContent).toBe(`<b>Tom & "Jerry's"</b>`);
    expect(host.children).toHaveLength(0);
  });
});

describe("cssVar", () => {
  afterEach(() => document.documentElement.style.removeProperty("--c-test"));

  it("reads a theme token, trimmed", () => {
    document.documentElement.style.setProperty("--c-test", "  #123456 ");
    expect(cssVar("--c-test", "red")).toBe("#123456");
  });

  it("falls back when the token is not set", () => {
    expect(cssVar("--c-test", "red")).toBe("red");
  });
});
