#!/usr/bin/env node
// Screenshots for Tutorials in "screenshots" mode (PLAN §24.12, on trial).
//
// Drives the web test build (dist-web: the engine as WebAssembly on the demo
// vault) in headless Chromium and writes one WebP per picture, language and
// theme into docs/tutorials/screenshots/<name>.<lang>.<theme>.webp. The demo
// vault is English, so French shots show French UI around English content.
//
//   npm run build:web && npm run tutorials:screenshots
//
// Chromium comes from Playwright's browser cache, or CHROME=/path/to/chrome.
// Map tiles are fetched from OpenStreetMap; offline, the Map shot has none.
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "dist-web");
const out = path.join(root, "docs", "tutorials", "screenshots");
const WIDTH = 640; // Wide enough for the 320px panel on a 2x screen.
const QUALITY = 0.8;

if (!fs.existsSync(path.join(site, "index.html"))) {
  console.error("[screenshots] dist-web/ is missing: run `npm run build:web` first");
  process.exit(1);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(site, url);
  if (!file.startsWith(site) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(site, "index.html");
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const openDoc = async (page, title) => {
  await page.click("[data-testid=sidebar-search]");
  await page.fill("[data-testid=palette] input[cmdk-input]", title);
  await page.locator("[data-testid=palette] [cmdk-item]", { hasText: title }).first().click();
  await page.waitForSelector("[data-testid=palette]", { state: "detached" });
};
const view = async (page, kind) => page.click(`[data-testid=nav-${kind}]`);

/** A region of the page, from the top-left of an element, in CSS pixels. */
const from = (selector, dx, dy, width, height) => async (page) => {
  const b = await page.locator(selector).first().boundingBox();
  return { x: b.x + dx, y: b.y + dy, width, height };
};
/** A region centred on the box around everything a selector matches. */
const around = (selector, width, height) => async (page) => {
  const view = page.viewportSize();
  const boxes = (await Promise.all((await page.locator(selector).all()).map((l) => l.boundingBox()))).filter(
    (b) => b && b.width > 0 && b.x >= 0 && b.y >= 0 && b.x + b.width <= view.width && b.y + b.height <= view.height,
  );
  if (!boxes.length) throw new Error(`nothing on screen matches ${selector}`);
  const cx = (Math.min(...boxes.map((b) => b.x)) + Math.max(...boxes.map((b) => b.x + b.width))) / 2;
  const cy = (Math.min(...boxes.map((b) => b.y)) + Math.max(...boxes.map((b) => b.y + b.height))) / 2;
  return { x: Math.min(Math.max(0, cx - width / 2), view.width - width), y: Math.min(Math.max(0, cy - height / 2), view.height - height), width, height };
};

/**
 * Each picture a Tutorial names (`image:<name>`): how to get there, and the
 * region to keep. Regions are small on purpose: the panel shows them 290px
 * wide, so a whole view would be unreadable.
 */
const SHOTS = {
  passages: {
    go: async (page) => {
      await openDoc(page, "Psalm 23 reflections");
      await page.waitForSelector(".cm-content");
    },
    clip: from(".cm-content", -8, 40, 520, 150),
  },
  library: { go: (page) => view(page, "library"), clip: from("[data-testid=library]", 0, 0, 480, 300) },
  embeds: {
    go: async (page) => {
      await openDoc(page, "Talk on endurance");
      await page.waitForSelector(".cm-content");
      await page.getByText("Endurance is not merely", { exact: false }).first().scrollIntoViewIfNeeded();
    },
    clip: async (page) => {
      const b = await page.getByText("Endurance is not merely", { exact: false }).first().boundingBox();
      const c = await page.locator(".cm-content").first().boundingBox();
      return { x: c.x - 8, y: b.y - 150, width: 560, height: 260 };
    },
  },
  board: {
    go: async (page) => {
      await openDoc(page, "Talk on endurance");
      await page.click("[data-testid=tab-board]");
      await page.waitForTimeout(800);
    },
    clip: from("[data-slot=sidebar-inset]", 0, 48, 440, 280),
  },
  timeline: { go: (page) => view(page, "timeline"), clip: from("[data-testid=timeline]", 0, 0, 480, 300) },
  map: {
    go: async (page) => {
      await view(page, "map");
      await page.waitForTimeout(2500);
    },
    // Places are circle markers: SVG paths in the overlay pane.
    clip: around("[data-slot=sidebar-inset] .leaflet-overlay-pane path.leaflet-interactive", 440, 280),
  },
};

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
fs.mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
for (const lang of ["en", "fr"]) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2, colorScheme: theme });
    const page = await context.newPage();
    await page.goto(base);
    await page.waitForSelector("[data-testid=home-recent]", { timeout: 30000 });
    if (lang !== "en") {
      await view(page, "settings");
      await page.click("[data-testid=settings-language]");
      await page.getByRole("option", { name: { fr: "Français" }[lang] }).click();
      await page.waitForTimeout(300);
    }
    for (const [name, shot] of Object.entries(SHOTS)) {
      if (only.length && !only.includes(name)) continue;
      await view(page, "home");
      await shot.go(page);
      await page.waitForTimeout(600);
      const png = await page.screenshot({ clip: await shot.clip(page) });
      // Chromium encodes WebP; Playwright only writes PNG and JPEG.
      const webp = await page.evaluate(
        async ({ b64, width, quality }) => {
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
          return c.toDataURL("image/webp", quality).split(",")[1];
        },
        { b64: png.toString("base64"), width: WIDTH, quality: QUALITY },
      );
      const file = path.join(out, `${name}.${lang}.${theme}.webp`);
      fs.writeFileSync(file, Buffer.from(webp, "base64"));
      console.log(`[screenshots] ${path.relative(root, file)} ${Math.round(fs.statSync(file).size / 1024)} KB`);
    }
    await context.close();
  }
}
await browser.close();
server.close();
