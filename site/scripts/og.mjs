#!/usr/bin/env node
// The picture shown when the page is shared (og:image): the top of the built
// page at 1200×630, light, in each language, into public/. Rerun after the
// hero changes: `npm run build && npm run og && npm run build`.
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist");
const pub = path.join(here, "..", "public");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(dist, p);
  if (!file.startsWith(dist) || !fs.existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" });
try {
  for (const [lang, url, name] of [["en", "/", "og.png"], ["fr", "/fr/", "og-fr.png"]]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: "light", deviceScaleFactor: 1 });
    await page.goto(base + url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    // The header, the title and the first of the screenshot: hide the rest.
    await page.addStyleTag({ content: "[data-testid=hero] p:not(:first-child), [data-testid=hero] .mt-9 { display: none !important; } [data-testid=hero] > div:nth-child(2) { padding-top: 2.5rem !important; }" });
    await page.screenshot({ path: path.join(pub, name) });
    console.log(path.join(pub, name), lang);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
