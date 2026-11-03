// When the desktop app looks for an update by itself. The check itself is the
// plugin's; what is pinned here is who gets one and when.
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { applyUpdate, isDesktopApp, shouldCheckOnStart } from "../updater";

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

describe("installing an update", () => {
  it("has every Window save first, then installs and restarts", async () => {
    const order: string[] = [];
    await applyUpdate(
      { downloadAndInstall: async () => void order.push("install") },
      { flush: async () => void order.push("flush"), relaunch: async () => void order.push("relaunch") },
    );
    expect(order).toEqual(["flush", "install", "relaunch"]);
  });

  it("still installs when saving could not be asked for", async () => {
    const order: string[] = [];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await applyUpdate(
      { downloadAndInstall: async () => void order.push("install") },
      { flush: () => Promise.reject(new Error("no engine")), relaunch: async () => void order.push("relaunch") },
    );
    quiet.mockRestore();
    expect(order).toEqual(["install", "relaunch"]);
  });
});

describe("the Install button", () => {
  /** A fresh updater (its state is the module's), with `found` as the release the check finds. */
  async function updater(found: { version: string; downloadAndInstall: () => Promise<void> } | null) {
    vi.resetModules();
    vi.mocked(check).mockResolvedValue(found as never);
    vi.mocked(invoke).mockReset();
    vi.mocked(relaunch).mockReset();
    const u = await import("../updater");
    await u.checkForUpdate();
    return u;
  }

  it("has every Window save, installs the release found and restarts", async () => {
    const order: string[] = [];
    const u = await updater({ version: "1.0.0", downloadAndInstall: async () => void order.push("install") });
    vi.mocked(invoke).mockImplementation(async (cmd) => void order.push(String(cmd)));
    vi.mocked(relaunch).mockImplementation(async () => void order.push("relaunch"));
    await u.installUpdate();
    expect(order).toEqual(["flush_all_windows", "install", "relaunch"]);
  });

  it("does nothing when no release was found", async () => {
    const u = await updater(null);
    await u.installUpdate();
    expect(invoke).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("installs once when pressed twice, and can be pressed again after a failure", async () => {
    let fail!: (e: Error) => void;
    const downloadAndInstall = vi.fn(() => new Promise<void>((_, rej) => (fail = rej)));
    const u = await updater({ version: "1.0.0", downloadAndInstall });
    const first = u.installUpdate();
    await u.installUpdate();
    await vi.waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1));
    fail(new Error("offline"));
    await first;
    expect(relaunch).not.toHaveBeenCalled();
    downloadAndInstall.mockResolvedValueOnce(undefined);
    await u.installUpdate();
    expect(downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});
