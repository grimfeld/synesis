#!/usr/bin/env node
// Cut a release: set the same version in package.json, package-lock.json,
// src-tauri/tauri.conf.json and src-tauri/Cargo.toml, commit, push, and start
// the Release workflow (.github/workflows/release.yml) on that commit with
// `gh workflow run`. The workflow waits for CI to pass on the commit, creates
// the `vX.Y.Z` tag and a draft GitHub Release, and publishes the release once
// every platform is attached; it is not started by a tag push because a run on
// a fresh tag cannot use the build caches (see the note at the top of the
// workflow).
//
//   npm run release -- 0.2.0        bump, commit, push, start the workflow
//   node scripts/release.mjs --check 0.2.0   verify the files say 0.2.0 (used by CI)
//
// Before touching anything it refuses: a dirty working tree, a branch other
// than main (a `-pre` version may come from any branch), a main that differs
// from origin/main, and a version not greater than the current one (installed
// apps never update to a lower number, so a typo would strand them).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const check = args[0] === "--check";
const version = check ? args[1] : args[0];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
if (!version || !SEMVER.test(version)) {
  console.error("usage: release.mjs [--check] X.Y.Z[-pre]");
  process.exit(2);
}

/** Semver precedence: <0, 0 or >0 as `a` is lower, equal or higher than `b`. */
function compareVersions(a, b) {
  const [, ...pa] = SEMVER.exec(a);
  const [, ...pb] = SEMVER.exec(b);
  for (let i = 0; i < 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d;
  }
  const [preA, preB] = [pa[3], pb[3]];
  if (preA === preB) return 0;
  if (preA === undefined) return 1; // 1.0.0 > 1.0.0-rc
  if (preB === undefined) return -1;
  const ia = preA.split(".");
  const ib = preB.split(".");
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    if (ia[i] === undefined) return -1;
    if (ib[i] === undefined) return 1;
    const na = /^\d+$/.test(ia[i]);
    const nb = /^\d+$/.test(ib[i]);
    if (na && nb && Number(ia[i]) !== Number(ib[i])) return Number(ia[i]) - Number(ib[i]);
    if (na !== nb) return na ? -1 : 1;
    if (ia[i] !== ib[i]) return ia[i] < ib[i] ? -1 : 1;
  }
  return 0;
}

const files = {
  "package.json": [/("version":\s*")[^"]+(")/, `$1${version}$2`],
  "src-tauri/tauri.conf.json": [/("version":\s*")[^"]+(")/, `$1${version}$2`],
  "src-tauri/Cargo.toml": [/(^version\s*=\s*")[^"]+(")/m, `$1${version}$2`],
};
const LOCK = "package-lock.json";

const read = (file) => {
  const [re] = files[file];
  const text = readFileSync(file, "utf8");
  const m = re.exec(text);
  if (!m) {
    console.error(`${file}: no version field found`);
    process.exit(1);
  }
  return { text, current: text.slice(m.index + m[1].length, m.index + m[0].length - m[2].length) };
};
const lock = () => JSON.parse(readFileSync(LOCK, "utf8"));
const lockVersions = (l) => [l.version, l.packages?.[""]?.version];

if (check) {
  let ok = true;
  for (const file of Object.keys(files)) {
    const { current } = read(file);
    if (current !== version) {
      console.error(`${file}: version is ${current}, tag says ${version}`);
      ok = false;
    }
  }
  for (const v of lockVersions(lock()))
    if (v !== version) {
      console.error(`${LOCK}: version is ${v}, tag says ${version}`);
      ok = false;
    }
  if (!ok) process.exit(1);
  console.log(`all files at ${version}`);
  process.exit(0);
}

const out = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const refuse = (why) => {
  console.error(`${why}\nNothing was changed.`);
  process.exit(1);
};

// Check everything before touching anything: the commit and push are easy to
// make, and hard to take back once the workflow has tagged them.
try {
  execSync("gh auth status", { stdio: "ignore" });
} catch {
  refuse("gh is not installed or not logged in (gh auth login).");
}
if (out("git status --porcelain")) refuse("The working tree has uncommitted changes; commit or stash them first.");
const branch = out("git branch --show-current");
const pre = version.includes("-");
if (branch !== "main" && !pre) refuse(`Releases come from main, not ${branch || "a detached HEAD"} (a X.Y.Z-pre version may come from any branch).`);
run(`git fetch --quiet origin ${branch}`);
if (out("git rev-parse HEAD") !== out(`git rev-parse origin/${branch}`))
  refuse(`${branch} is not at origin/${branch}; pull or push first, so the release is the commit CI tested.`);
const current = read("package.json").current;
if (compareVersions(version, current) <= 0)
  refuse(`${version} is not greater than the current version ${current}; installed apps would never update to it.`);

for (const [file, [re, replacement]] of Object.entries(files)) {
  const { text, current: was } = read(file);
  if (was !== version) {
    writeFileSync(file, text.replace(re, replacement));
    console.log(`${file}: ${was} -> ${version}`);
  }
}
// npm writes the lockfile as 2-space JSON with a final newline.
const l = lock();
l.version = version;
if (l.packages?.[""]) l.packages[""].version = version;
writeFileSync(LOCK, JSON.stringify(l, null, 2) + "\n");

// Cargo.lock records the crate version too.
run("cargo update -p synesis --offline");
run(`git add package.json ${LOCK} src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock`);
run(`git commit -m "Release v${version}"`);
run("git push");
const dispatch = `gh workflow run release.yml --ref ${branch} -f version=${version}`;
try {
  run(dispatch);
} catch {
  console.error(`The commit is pushed but the workflow did not start. Run it yourself:\n  ${dispatch}`);
  process.exit(1);
}
console.log(`Release workflow started for v${version} on ${branch}. It waits for CI on this commit,`);
console.log("builds every platform into a draft release, and publishes it once all are attached.");
console.log("Follow it with: gh run watch");
