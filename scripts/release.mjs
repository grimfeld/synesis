#!/usr/bin/env node
// Cut a release: set the same version in package.json, src-tauri/tauri.conf.json
// and src-tauri/Cargo.toml, commit, push, and start the Release workflow
// (.github/workflows/release.yml) on that commit with `gh workflow run`. The
// workflow creates the `vX.Y.Z` tag and the GitHub Release itself; it is not
// started by a tag push because a run on a fresh tag cannot use the build
// caches (see the note at the top of the workflow).
//
//   npm run release -- 0.2.0        bump, commit, push, start the workflow
//   node scripts/release.mjs --check 0.2.0   verify the three files say 0.2.0 (used by CI)
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const check = args[0] === "--check";
const version = check ? args[1] : args[0];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error("usage: release.mjs [--check] X.Y.Z[-pre]");
  process.exit(2);
}

const files = {
  "package.json": [/("version":\s*")[^"]+(")/, `$1${version}$2`],
  "src-tauri/tauri.conf.json": [/("version":\s*")[^"]+(")/, `$1${version}$2`],
  "src-tauri/Cargo.toml": [/(^version\s*=\s*")[^"]+(")/m, `$1${version}$2`],
};

let ok = true;
for (const [file, [re, replacement]] of Object.entries(files)) {
  const text = readFileSync(file, "utf8");
  const m = re.exec(text);
  if (!m) {
    console.error(`${file}: no version field found`);
    process.exit(1);
  }
  const current = text.slice(m.index + m[1].length, m.index + m[0].length - m[2].length);
  if (check) {
    if (current !== version) {
      console.error(`${file}: version is ${current}, tag says ${version}`);
      ok = false;
    }
  } else if (current !== version) {
    writeFileSync(file, text.replace(re, replacement));
    console.log(`${file}: ${current} -> ${version}`);
  }
}
if (check) {
  if (!ok) process.exit(1);
  console.log(`all files at ${version}`);
  process.exit(0);
}

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const branch = execSync("git branch --show-current", { encoding: "utf8" }).trim();
const dispatch = `gh workflow run release.yml --ref ${branch} -f version=${version}`;

// Check `gh` before touching anything: the commit and push are easy to make,
// and only the dispatch can fail for a reason unrelated to the repository.
try {
  execSync("gh auth status", { stdio: "ignore" });
} catch {
  console.error("gh is not installed or not logged in (gh auth login); nothing was changed.");
  process.exit(1);
}

// Cargo.lock records the crate version too.
run("cargo update -p synesis --offline");
run(`git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock`);
run(`git commit -m "Release v${version}"`);
run("git push");
try {
  run(dispatch);
} catch {
  console.error(`The commit is pushed but the workflow did not start. Run it yourself:\n  ${dispatch}`);
  process.exit(1);
}
console.log(`Release workflow started for v${version} on ${branch}; it tags the commit and publishes the builds.`);
console.log("Follow it with: gh run watch");
