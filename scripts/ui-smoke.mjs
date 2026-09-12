// Headless-Chrome smoke driver over the DevTools protocol. Requires `npm run tauri dev` running
// (the debug HTTP bridge on :4321 serves the engine) and Google Chrome installed.
// Usage: node scripts/ui-smoke.mjs '[{"goto":"http://localhost:1420","after":3000},{"clickText":"Graph"},{"shot":"/tmp/graph.png"},{"errors":true}]'
// Step kinds: {goto:url} {wait:ms} {click:selector} {clickText:"..."} {type:text} {key:"Enter",mods?:4} {eval:js} {shot:file,clip?:[x,y,w,h],scale?:n} {dark:true|false} {errors:true} {mouse:[x,y]} {hover:selector}
//   {mobile:true|false|[w,h]} phone viewport + touch (reload after it to re-run breakpoint hooks)
//   {tap:[x,y]} {tapEval:js returning [x,y]} {swipe:[x1,y1,x2,y2],steps?:n} {pinch:[cx,cy],from:px,to:px} touch gestures
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const steps = JSON.parse(process.argv[2]);
const port = 9333;
const profile = mkdtempSync(join(tmpdir(), "cdp-"));
const CHROME =
  process.env.CHROME ??
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : process.platform === "win32"
      ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map((d) => join(d, "Google", "Chrome", "Application", "chrome.exe")).find(existsSync)
      : "google-chrome");
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1400,900", "--hide-scrollbars", "--no-first-run", "--disable-gpu", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) logs.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  if (msg.method === "Runtime.exceptionThrown") logs.push("[exception] " + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed"); return r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");
const rectOf = async (sel) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:"center"}); const r = e.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
const rectOfText = async (text) => evaluate(`(() => { const all = [...document.querySelectorAll("button, a, span, div, li, h1, h2, input, label")]; const e = all.find(x => x.childElementCount === 0 && x.textContent.trim() === ${JSON.stringify(text)}) || all.find(x => x.textContent.trim().startsWith(${JSON.stringify(text)}) && x.getBoundingClientRect().height < 80); if (!e) return null; e.scrollIntoView({block:"center"}); const r = e.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
const clickAt = async ({ x, y }) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
const touch = (type, points) => send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i })) });
const swipe = async ([x1, y1, x2, y2], n = 12) => {
  await touch("touchStart", [[x1, y1]]);
  for (let i = 1; i <= n; i++) { await touch("touchMove", [[x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n]]); await sleep(16); }
  await touch("touchEnd", []);
};
const pinch = async ([cx, cy], from, to, n = 12) => {
  const at = (d) => [[cx - d / 2, cy], [cx + d / 2, cy]];
  await touch("touchStart", at(from));
  for (let i = 1; i <= n; i++) { await touch("touchMove", at(from + ((to - from) * i) / n)); await sleep(16); }
  await touch("touchEnd", []);
};
for (const st of steps) {
  if (st.goto) { await send("Page.navigate", { url: st.goto }); await sleep(st.after ?? 1500); }
  else if (st.wait) await sleep(st.wait);
  else if (st.click) { const p = await rectOf(st.click); if (!p) { console.log(`MISSING selector ${st.click}`); continue; } await clickAt(p); await sleep(st.after ?? 500); }
  else if (st.clickText) { const p = await rectOfText(st.clickText); if (!p) { console.log(`MISSING text ${st.clickText}`); continue; } await clickAt(p); await sleep(st.after ?? 500); }
  else if (st.mouse) { await clickAt({ x: st.mouse[0], y: st.mouse[1] }); await sleep(st.after ?? 500); }
  else if (st.hover) { const p = await rectOf(st.hover); if (p) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await sleep(st.after ?? 600); }
  else if (st.type) { await send("Input.insertText", { text: st.type }); await sleep(st.after ?? 300); }
  else if (st.key) { const key = st.key; const code = key === "Enter" ? 13 : key === "Escape" ? 27 : key === "Backspace" ? 8 : 0; const mods = st.mods ?? 0; await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: mods }); await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, modifiers: mods }); await sleep(st.after ?? 400); }
  else if (st.eval) { try { console.log("EVAL:", JSON.stringify(await evaluate(st.eval))); } catch (e) { console.log("EVAL ERROR:", e.message); } }
  else if (st.shot) { const r = await send("Page.captureScreenshot", { format: "png", ...(st.clip ? { clip: { x: st.clip[0], y: st.clip[1], width: st.clip[2], height: st.clip[3], scale: st.scale ?? 3 } } : {}) }); writeFileSync(st.shot, Buffer.from(r.result.data, "base64")); console.log("SHOT", st.shot); }
  else if (st.dark != null) { await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: st.dark ? "dark" : "light" }] }); await sleep(st.after ?? 300); }
  else if (st.mobile != null) {
    const [w, h] = Array.isArray(st.mobile) ? st.mobile : st.mobile ? [412, 915] : [1400, 900];
    const mob = st.mobile !== false;
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mob ? 2.6 : 1, mobile: mob, screenWidth: w, screenHeight: h });
    await send("Emulation.setTouchEmulationEnabled", { enabled: mob, maxTouchPoints: mob ? 5 : 0 });
    await sleep(st.after ?? 400);
  }
  else if (st.tapEval) { const p = await evaluate(st.tapEval); if (!Array.isArray(p)) { console.log("MISSING tapEval point", JSON.stringify(p)); continue; } console.log("TAP", JSON.stringify(p)); await touch("touchStart", [p]); await sleep(40); await touch("touchEnd", []); await sleep(st.after ?? 500); }
  else if (st.tap) { await touch("touchStart", [st.tap]); await sleep(40); await touch("touchEnd", []); await sleep(st.after ?? 500); }
  else if (st.swipe) { await swipe(st.swipe, st.steps); await sleep(st.after ?? 400); }
  else if (st.pinch) { await pinch(st.pinch, st.from, st.to, st.steps); await sleep(st.after ?? 400); }
  else if (st.errors) { console.log(logs.length ? "CONSOLE:\n" + logs.join("\n") : "CONSOLE: clean"); logs.length = 0; }
}
ws.close(); chrome.kill();
