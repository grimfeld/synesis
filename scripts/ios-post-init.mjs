// Adjust the generated iOS project after `tauri ios init`.
//
// `src-tauri/gen/` is generated and gitignored, so what the app needs in the
// Xcode project is re-applied here after every `init`. Idempotent
// (npm run ios:post-init; the release workflow runs it).
//
// 1. System frameworks: iroh's network crates (netdev, netwatch,
//    n0-dns-resolver) call SystemConfiguration and Network, and a static Rust
//    library cannot ask the linker for a framework itself. tauri.conf.json's
//    `bundle.iOS.frameworks` adds them at `init`; this checks that the
//    generated project really links them, and adds them if not, so the IPA
//    fails here with a sentence rather than at link time with a symbol list.
// 2. Entitlements: iCloud Documents in Synesis's container (ADR 0022). Tauri
//    has no config key for iOS entitlements; its template generates an empty
//    `<app>_iOS/<app>_iOS.entitlements` and points CODE_SIGN_ENTITLEMENTS at
//    it. The keys come from src-tauri/ios/Synesis_iOS.entitlements.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apple = join(root, "src-tauri", "gen", "apple");
if (!existsSync(apple)) {
  console.log("ios-post-init: no src-tauri/gen/apple, nothing to do");
  process.exit(0);
}

const fail = (msg) => {
  console.error("ios-post-init: " + msg);
  process.exit(1);
};

// --- 1. Frameworks ---------------------------------------------------------

const FRAMEWORKS = ["SystemConfiguration", "Network"];
const pbxprojs = readdirSync(apple)
  .filter((d) => d.endsWith(".xcodeproj"))
  .map((d) => join(apple, d, "project.pbxproj"))
  .filter(existsSync);
if (pbxprojs.length === 0) fail(`no *.xcodeproj under ${apple}`);
const linked = (name) => pbxprojs.every((p) => readFileSync(p, "utf8").includes(`${name}.framework`));
const missing = FRAMEWORKS.filter((f) => !linked(f));
if (missing.length === 0) {
  console.log(`ios-post-init: links ${FRAMEWORKS.join(", ")}`);
} else {
  const specPath = join(apple, "project.yml");
  if (!existsSync(specPath)) fail(`${missing.join(", ")} not linked and no project.yml to add them to`);
  let spec = readFileSync(specPath, "utf8");
  const anchor = /^(\s*)- sdk: Security\.framework\s*$/m.exec(spec);
  if (!anchor) fail("project.yml has no `- sdk: Security.framework` line to add frameworks after");
  const indent = anchor[1].replace(/^\r?\n/, "");
  const lines = missing.filter((f) => !spec.includes(`sdk: ${f}.framework`)).map((f) => `${indent}- sdk: ${f}.framework`);
  spec = spec.slice(0, anchor.index + anchor[0].length) + "\n" + lines.join("\n") + spec.slice(anchor.index + anchor[0].length);
  writeFileSync(specPath, spec);
  try {
    // Runs before the entitlements step below, so whatever XcodeGen does to
    // the entitlements file, the iCloud keys are written after it.
    execFileSync("xcodegen", ["generate", "--spec", specPath], { cwd: apple, stdio: "inherit" });
  } catch (e) {
    fail(`could not regenerate the Xcode project with xcodegen (${e.message}); ${missing.join(", ")} would be missing at link time`);
  }
  if (FRAMEWORKS.some((f) => !linked(f))) fail(`${missing.join(", ")} still not linked after xcodegen`);
  console.log(`ios-post-init: added ${missing.join(", ")} to project.yml and regenerated the project`);
}

// --- 2. Entitlements -------------------------------------------------------

const ours = readFileSync(join(root, "src-tauri", "ios", "Synesis_iOS.entitlements"), "utf8");
/** The inside of a plist's top-level <dict>, comments dropped. */
const dictBody = (xml) => {
  const m = /<plist[^>]*>\s*<dict>([\s\S]*)<\/dict>\s*<\/plist>/.exec(xml.replace(/<!--[\s\S]*?-->/g, ""));
  return m ? m[1] : null;
};
const wanted = dictBody(ours);
if (!wanted) fail("src-tauri/ios/Synesis_iOS.entitlements is not a plist with a <dict>");

const targets = readdirSync(apple).filter((d) => d.endsWith("_iOS") && existsSync(join(apple, d, `${d}.entitlements`)));
if (targets.length === 0) fail(`no <app>_iOS/<app>_iOS.entitlements under ${apple}; did \`tauri ios init\` change its layout?`);
for (const t of targets) {
  const path = join(apple, t, `${t}.entitlements`);
  const generated = readFileSync(path, "utf8");
  if (generated.includes("com.apple.developer.icloud-services")) {
    console.log(`ios-post-init: ${t}.entitlements already has iCloud`);
    continue;
  }
  let next;
  if (/<dict\s*\/>/.test(generated)) {
    next = generated.replace(/<dict\s*\/>/, `<dict>${wanted}</dict>`);
  } else {
    const at = generated.lastIndexOf("</dict>");
    if (at < 0) fail(`cannot read ${path}`);
    next = generated.slice(0, at) + wanted.trim() + "\n" + generated.slice(at);
  }
  writeFileSync(path, next);
  console.log(`ios-post-init: ${t}.entitlements -> iCloud Documents (iCloud.tech.grimfeld.synesis)`);
}

