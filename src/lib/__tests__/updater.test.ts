// When the desktop app looks for an update by itself. The check itself is the
// plugin's; what is pinned here is who gets one and when.
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { isDesktopApp, shouldCheckOnStart } from "../updater";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

describe("isDesktopApp", () => {
  it("is the app on a computer", () => {
    expect(isDesktopApp("production", MAC)).toBe(true);
    expect(isDesktopApp("development", MAC)).toBe(true);
  });
  it("is not a phone, which updates through its store", () => {
    expect(isDesktopApp("production", ANDROID)).toBe(false);
    expect(isDesktopApp("production", IPHONE)).toBe(false);
  });
  it("is not the web build", () => {
    expect(isDesktopApp("web", MAC)).toBe(false);
  });
});

describe("shouldCheckOnStart", () => {
  it("checks a release build on desktop unless the Device turned it off", () => {
    expect(shouldCheckOnStart({ desktop: true, dev: false, enabled: true })).toBe(true);
    expect(shouldCheckOnStart({ desktop: true, dev: false, enabled: false })).toBe(false);
  });
  it("defaults to on before the setting exists", () => {
    expect(shouldCheckOnStart({ desktop: true, dev: false, enabled: undefined })).toBe(true);
  });
  it("never checks from a dev build or off desktop", () => {
    expect(shouldCheckOnStart({ desktop: true, dev: true, enabled: true })).toBe(false);
    expect(shouldCheckOnStart({ desktop: false, dev: false, enabled: true })).toBe(false);
  });
});
