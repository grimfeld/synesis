// PLAN §24.10: the phone's bars follow the Skin's Background.
import { describe, expect, it } from "vitest";
import { hasSystemBars, systemBarsFor } from "../systemBars";

describe("system bars", () => {
  it("take the Background as #rrggbb, with icons that read on it", () => {
    expect(systemBarsFor("#2E3440")).toEqual({ color: "#2e3440", dark: true }); // Nord dark
    expect(systemBarsFor("#F8F6F1")).toEqual({ color: "#f8f6f1", dark: false }); // Paper light
    expect(systemBarsFor("oklch(0.985 0.004 85)")?.dark).toBe(false); // the built-in light page
    expect(systemBarsFor("oklch(0.2 0.01 265)")?.dark).toBe(true);
    expect(systemBarsFor("oklch(0.985 0.004 85)")?.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("ignore a Background that is not a colour", () => {
    expect(systemBarsFor("")).toBeNull();
    expect(systemBarsFor("var(--x)")).toBeNull();
  });

  it("are left alone outside the app's webview", () => {
    // jsdom: no Tauri internals, as in the web test build.
    expect(hasSystemBars()).toBe(false);
  });
});
