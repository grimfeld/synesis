#!/usr/bin/env node
// Screenshots for the landing page (site/), in both languages and both
// themes, written to site/src/assets/screens/<name>.<lang>.<theme>.webp.
//
// Needs `npm run tauri dev` running: it drives the UI on :1420 against the
// engine behind the dev bridge on :4321, like Cypress. It opens a fresh copy
// of examples/demo-vault, never one of your vaults, and afterwards reopens
// the vault you had open, puts back the language and appearance it changed,
// and forgets and deletes the copy with its index.
//
//   node scripts/site-screenshots.mjs            every picture
//   node scripts/site-screenshots.mjs hub map    only these
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site", "src", "assets", "screens");
const APP = "http://localhost:1420";
const BRIDGE = "http://127.0.0.1:4321";
const WIDTH = 1600; // stored width: twice the largest the page shows them

const bridge = async (cmd, args = {}) => {
  const r = await fetch(`${BRIDGE}/invoke/${cmd}`, { method: "POST", body: JSON.stringify(args) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${cmd}: ${text}`);
  return text ? JSON.parse(text) : null;
};

/** `engine::vault::local_dir_for`, as in cypress.config.ts. */
const appData = () =>
  process.platform === "win32"
    ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "tech.grimfeld.synesis")
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "tech.grimfeld.synesis")
      : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "tech.grimfeld.synesis");
const localDirFor = (path) => join(appData(), "vaults", createHash("sha256").update(path, "utf8").digest("hex").slice(0, 16));

const openDoc = async (page, title) => {
  await page.click("[data-testid=sidebar-search]");
  await page.fill("[data-testid=palette] input[cmdk-input]", title);
  await page.locator("[data-testid=palette] [cmdk-item]", { hasText: title }).first().click();
  await page.waitForSelector("[data-testid=palette]", { state: "detached" });
};
const view = (page, kind) => page.click(`[data-testid=nav-${kind}]`);
/** The view area, right of the sidebar. */
const inset = (page) => page.locator("[data-slot=sidebar-inset]").first().boundingBox();

/** Each picture: how to get there, and the region to keep (whole window when absent). */
const SHOTS = {
  hero: {
    go: async (page) => {
      await openDoc(page, "Talk on endurance");
      await page.waitForSelector(".cm-content");
      await page.locator(".cm-content").first().focus();
      await page.keyboard.press("Control+Home");
    },
  },
  passages: {
    go: async (page) => {
      await openDoc(page, "Psalm 23 reflections");
      await page.waitForSelector(".cm-passage");
      await page.locator(".cm-passage").first().hover();
      await page.waitForTimeout(900);
    },
    clip: async (page) => {
      const c = await page.locator(".cm-content").first().boundingBox();
      return { x: c.x - 24, y: c.y - 16, width: 800, height: 230 };
    },
  },
  hub: {
    go: async (page) => {
      // A Book's Hub: its chapter strip, shaded by how often each is mentioned.
      await openDoc(page, "Romans");
      await page.waitForSelector("[data-testid=hub-header]");
    },
    clip: inset,
  },
  board: {
    go: async (page) => {
      await openDoc(page, "Talk on endurance");
      await page.click("[data-testid=tab-board]");
      await page.waitForTimeout(1200);
    },
    clip: inset,
  },
  timeline: {
    go: async (page) => {
      await view(page, "timeline");
      await page.waitForSelector("[data-testid=timeline]");
      await page.waitForTimeout(800);
    },
    clip: inset,
  },
  map: {
    go: async (page) => {
      await view(page, "map");
      await page.waitForSelector("[data-testid=map-pin]", { state: "attached" });
      await page.waitForTimeout(3000);
    },
    clip: inset,
  },
  graph: {
    go: async (page) => {
      await view(page, "graph");
      await page.waitForSelector("[data-testid=graph-canvas]");
      await page.waitForTimeout(5000);
    },
    clip: inset,
  },
};

const only = process.argv.slice(2);
// Installed Chrome rather than a Playwright download: playwright-core pins a
// build that may not be cached. CHROME overrides the channel with a path.
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" });
const before = await bridge("get_settings");
// One copy per language, in a folder named for it: the sidebar shows the
// vault's folder name. Inside a `synesis-cy-` folder, so cleanups find it.
const dir = mkdtempSync(join(tmpdir(), "synesis-cy-"));
const vaultFor = (lang) => join(dir, { en: "Bible study", fr: "Étude biblique" }[lang]);
for (const lang of ["en", "fr"])
  cpSync(join(root, "examples", "demo-vault"), vaultFor(lang), {
    recursive: true,
    filter: (src) => !/[\\/]\.bible-study[\\/]sync([\\/]|$)/.test(src) && !/[\\/]Scripture([\\/]|$)/.test(src),
  });
mkdirSync(out, { recursive: true });
try {
  await bridge("set_map_filters", { books: [], mentionedOnly: false, colorBy: "kind" });
  for (const lang of ["en", "fr"]) {
    await bridge("set_language", { lang });
    await bridge("open_vault", { path: vaultFor(lang) });
    for (const theme of ["light", "dark"]) {
      await bridge("set_device_appearance", { mode: theme, textScale: 1 });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
      const page = await context.newPage();
      await page.goto(APP);
      await page.waitForSelector("[data-testid=home-recent]", { timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      for (const [name, shot] of Object.entries(SHOTS)) {
        if (only.length && !only.includes(name)) continue;
        await view(page, "home");
        await shot.go(page);
        await page.waitForTimeout(500);
        await page.mouse.move(1, 1).catch(() => {});
        if (name === "passages") await page.locator(".cm-passage").first().hover();
        const clip = shot.clip ? await shot.clip(page) : undefined;
        const png = await page.screenshot(clip ? { clip } : {});
        // Chromium encodes WebP; Playwright only writes PNG and JPEG.
        const webp = await page.evaluate(
          async ({ b64, width }) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const scale = Math.min(1, width / img.width);
            const c = document.createElement("canvas");
            c.width = Math.round(img.width * scale);
            c.height = Math.round(img.height * scale);
            const g = c.getContext("2d");
            g.imageSmoothingQuality = "high";
            g.drawImage(img, 0, 0, c.width, c.height);
            return c.toDataURL("image/webp", 0.86).split(",")[1];
          },
          { b64: png.toString("base64"), width: WIDTH },
        );
        const file = join(out, `${name}.${lang}.${theme}.webp`);
        writeFileSync(file, Buffer.from(webp, "base64"));
        console.log(file);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await bridge("set_language", { lang: before.lang });
  await bridge("set_device_appearance", { mode: before.appearance_mode ?? "system", textScale: before.text_scale || 1 });
  await bridge("set_map_filters", {
    books: before.map_books ?? [],
    mentionedOnly: before.map_mentioned_only ?? false,
    colorBy: before.map_color_by ?? "kind",
  });
  if (before.vault_path && !before.vault_path.includes("synesis-cy-")) await bridge("open_vault", { path: before.vault_path });
  else await bridge("close_vault");
  for (const v of (await bridge("get_settings")).vaults.filter((v) => v.path.includes("synesis-cy-"))) {
    await bridge("forget_vault", { id: v.id });
    rmSync(v.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    rmSync(localDirFor(v.path), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  rmSync(localDirFor(dir), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
