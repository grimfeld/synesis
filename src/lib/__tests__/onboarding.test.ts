// The wizard's decisions, before any of it is drawn: where a Vault lands and
// whether its owner will be able to open the folder (PLAN §21, ADR 0015).
import { describe, expect, it } from "vitest";
import type { StorageAccess, SyncLocations } from "../api";
import { canAsk, destination, joinPath, looksLikeInvite, methodFor, nameIsUsable, visible } from "../onboarding";

function locations(over: Partial<SyncLocations> = {}): SyncLocations {
  return {
    platform: "android",
    home: "/storage/emulated/0/Documents/Synesis",
    can_pick_folder: false,
    app_decides_path: true,
    storage: { needed: true, granted: true },
    locations: [],
    found: [],
    ...over,
  };
}

const granted: StorageAccess = { needed: true, granted: true };
const refused: StorageAccess = { needed: true, granted: false };
const unneeded: StorageAccess = { needed: false, granted: false };

describe("whether the folder is one the user can reach", () => {
  it("desktop and iOS need no permission, so the folder is always visible", () => {
    expect(visible(unneeded)).toBe(true);
    expect(visible(undefined)).toBe(true);
  });

  it("Android without the grant writes somewhere the Files app hides", () => {
    expect(visible(refused)).toBe(false);
    expect(visible(granted)).toBe(true);
  });

  it("only offers to ask when asking would change the answer", () => {
    expect(canAsk(refused)).toBe(true);
    expect(canAsk(granted)).toBe(false);
    expect(canAsk(unneeded)).toBe(false);
    expect(canAsk(undefined)).toBe(false);
  });
});

describe("where the Vault lands", () => {
  it("derives the path from the name on mobile", () => {
    const d = destination(locations(), "main");
    expect(d.path).toBe("/storage/emulated/0/Documents/Synesis/main");
    expect(d.visible).toBe(true);
    expect(d.canAsk).toBe(false);
  });

  it("says so when the folder will be the hidden fallback", () => {
    const d = destination(locations({ storage: refused, home: "/storage/emulated/0/Android/data/tech.grimfeld.synesis/files/Documents/Synesis" }), "main");
    expect(d.visible).toBe(false);
    expect(d.canAsk).toBe(true);
  });

  it("ignores a typed path on mobile, where there is no picker", () => {
    // The field does not exist there; a stale value must not win.
    const d = destination(locations(), "main", "/somewhere/else");
    expect(d.path).toBe("/storage/emulated/0/Documents/Synesis/main");
  });

  it("lets the desktop picker win, because the user chose it", () => {
    const desktop = locations({
      platform: "windows",
      can_pick_folder: true,
      app_decides_path: false,
      storage: unneeded,
      home: "C:\\Users\\x\\Documents\\Synesis",
    });
    const d = destination(desktop, "main", "D:\\Vaults\\main");
    expect(d.path).toBe("D:\\Vaults\\main");
    expect(d.canAsk).toBe(false);
  });

  it("uses the separator the host uses", () => {
    expect(joinPath("C:\\Users\\x\\Documents\\Synesis", "main")).toBe("C:\\Users\\x\\Documents\\Synesis\\main");
    expect(joinPath("/home/x/Documents/Synesis/", "main")).toBe("/home/x/Documents/Synesis/main");
  });

  it("trims a name before it becomes a folder", () => {
    expect(destination(locations(), "  main  ").path).toBe("/storage/emulated/0/Documents/Synesis/main");
  });
});

describe("whether a route can be finished", () => {
  it("wants a code that looks like one before asking what Vault it is for", () => {
    expect(looksLikeInvite("synesis:abc")).toBe(true);
    expect(looksLikeInvite("  synesis:abc ")).toBe(true);
    expect(looksLikeInvite("abc")).toBe(false);
    expect(looksLikeInvite("")).toBe(false);
  });

  it("wants a name that is not just spaces", () => {
    expect(nameIsUsable("main")).toBe(true);
    expect(nameIsUsable("   ")).toBe(false);
    expect(nameIsUsable("")).toBe(false);
  });
});

describe("the method each route records", () => {
  it("names itself, and the folder route carries the tool it showed", () => {
    expect(methodFor("pairing", null)).toBe("pairing");
    expect(methodFor("local", "syncthing")).toBe("none");
    expect(methodFor("folder", "syncthing")).toBe("syncthing");
    expect(methodFor("folder", null)).toBe("none");
  });
});
