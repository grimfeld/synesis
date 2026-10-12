#!/usr/bin/env node
// Load the built site (site/dist) in each language and theme, at phone and
// desktop width, and fail on anything laid out wider than the page or than
// the box that clips it: the rule cypress/e2e/locales.cy.ts holds the app to,
// since French runs 30-60% longer than English.
//
//   npm run build && npm run check                 check
//   npm run check -- --shots ../target/site-shots  and keep full-page pictures
//
// Uses installed Chrome; CHROME=<path> picks another browser.
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : null;
if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("site/dist is missing: run `npm run build` first");
  process.exit(2);
}

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(dist, p);
  if (!file.startsWith(dist) || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: process.env.CI ? undefined : "chrome" });
const problems = [];
try {
  for (const [lang, url] of [["en", "/"], ["fr", "/fr/"]]) {
    for (const [device, viewport] of [["phone", { width: 360, height: 780 }], ["desktop", { width: 1280, height: 860 }]]) {
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.goto(base + url, { waitUntil: "networkidle" });
        // Open every question, so long answers are measured too.
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
        // Pictures load as they near the screen: scroll through so each one is
        // laid out (and in the full-page picture) before anything is measured.
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
            scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 60));
          }
          await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))));
          scrollTo(0, 0);
        });
        await page.evaluate(() => document.fonts.ready);
        const found = await page.evaluate(() => {
          const out = [];
          const vw = document.documentElement.clientWidth;
          if (document.documentElement.scrollWidth > vw + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide in a ${vw}px window`);
          for (const el of document.querySelectorAll("body *")) {
            const s = getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden" || el.closest("[aria-hidden=true], .sr-only, pre")) continue;
            const clips = /hidden|clip/.test(s.overflowX);
            if (clips && el.scrollWidth > el.clientWidth + 1) {
              out.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ""} clips "${el.textContent.trim().slice(0, 60)}" (${el.scrollWidth} > ${el.clientWidth})`);
            }
            const r = el.getBoundingClientRect();
            if (r.width && r.right > vw + 1 && !el.closest("[data-testid=hero] img")) {
              out.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 60)}" ends at ${Math.round(r.right)}px, past ${vw}px`);
            }
          }
          return [...new Set(out)].slice(0, 12);
        });
        for (const f of [...found, ...errors]) problems.push(`${lang} ${device} ${theme}: ${f}`);
        if (shots) {
          fs.mkdirSync(shots, { recursive: true });
          await page.screenshot({ path: path.join(shots, `${lang}-${device}-${theme}.png`), fullPage: true });
        }
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("layout ok: en, fr × phone, desktop × light, dark");
