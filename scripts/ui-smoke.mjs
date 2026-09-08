// Headless-Chrome smoke driver over the DevTools protocol. Requires `npm run tauri dev` running
// (the debug HTTP bridge on :4321 serves the engine) and Google Chrome installed.
// Usage: node scripts/ui-smoke.mjs '[{"goto":"http://localhost:1420","after":3000},{"clickText":"Graph"},{"shot":"/tmp/graph.png"},{"errors":true}]'
// Step kinds: {goto:url} {wait:ms} {click:selector} {clickText:"..."} {type:text} {key:"Enter",mods?:4} {eval:js} {shot:file} {errors:true} {mouse:[x,y]} {hover:selector}
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const steps = JSON.parse(process.argv[2]);
const port = 9333;
const profile = mkdtempSync(join(tmpdir(), "cdp-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
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
  else if (st.shot) { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(st.shot, Buffer.from(r.result.data, "base64")); console.log("SHOT", st.shot); }
  else if (st.errors) { console.log(logs.length ? "CONSOLE:\n" + logs.join("\n") : "CONSOLE: clean"); logs.length = 0; }
}
ws.close(); chrome.kill();
