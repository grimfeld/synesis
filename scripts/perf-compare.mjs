// Engine timings at a base commit against the working tree, on the same generated Vault.
// Usage: node scripts/perf-compare.mjs [base-ref=main] [--rounds 3] [--scale 1]
// Takes ~3 min at scale 1 (mostly the two cold opens). Work lands in target/perf/.
//
// The base is built from a temporary worktree with HEAD's `crates/engine/examples/perfbench.rs`
// copied in, so a query the base lacks shows as n/a. Each side gets its own copy of the Vault
// and its own data folder: a shared Vault folder makes each side import the other's sync
// snapshots as a second Device, and every scan looks far slower than it is.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : dflt;
};
const rounds = Number(flag("--rounds", "3"));
const scale = flag("--scale", "1");
const base = args[0] ?? "main";

const root = resolve(import.meta.dirname, "..");
const work = join(root, "target/perf");
const wt = join(work, "base-wt");
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { cwd: root, encoding: "utf8", ...opts });
const build = (cwd, targetDir) => {
  sh("cargo", ["build", "--release", "-q", "-p", "engine", "--example", "perfbench"], {
    cwd,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
  });
  return join(targetDir, "release/examples/perfbench");
};

mkdirSync(work, { recursive: true });
if (existsSync(wt)) sh("git", ["worktree", "remove", "--force", wt]);
sh("git", ["worktree", "add", "--detach", "-q", wt, base]);
try {
  cpSync(join(root, "crates/engine/examples/perfbench.rs"), join(wt, "crates/engine/examples/perfbench.rs"));
  console.error(`building ${base} and the working tree…`);
  const bins = { base: build(wt, join(work, "base-target")), head: build(root, join(root, "target")) };

  const vault = join(work, "vault");
  rmSync(vault, { recursive: true, force: true });
  sh(bins.head, ["gen", vault, scale]);

  const runs = { base: [], head: [] };
  const run = (side, keep) => {
    const out = sh(bins[side], ["run", join(work, `vault-${side}`), join(work, `data-${side}`), ...(keep ? ["--keep"] : [])]);
    runs[side].push(Object.fromEntries(out.trim().split("\n").map((l) => l.split("\t"))));
  };
  for (const side of ["base", "head"]) {
    rmSync(join(work, `vault-${side}`), { recursive: true, force: true });
    cpSync(vault, join(work, `vault-${side}`), { recursive: true });
    console.error(`cold open: ${side}…`);
    run(side, false);
  }
  for (let i = 0; i < rounds; i++) for (const side of ["base", "head"]) run(side, true);

  // Each round prints a median of 5-10; the table gives the median of those across rounds.
  const mid = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const at = (side, name) => {
    const xs = runs[side].map((r) => r[name]).filter((x) => x !== undefined && x !== "n/a").map(Number);
    return xs.length ? mid(xs) : null;
  };
  const names = [...new Set(runs.head.flatMap(Object.keys))];
  const fmt = (x) => (x === null ? "n/a" : x.toFixed(1));
  console.log(`| ms (median, ${rounds} rounds) | ${base} | HEAD | change |\n|---|---:|---:|---:|`);
  for (const n of names) {
    const [b, h] = [at("base", n), at("head", n)];
    const d = b && h ? `${h > b ? "+" : ""}${(((h - b) / b) * 100).toFixed(0)}%` : "";
    console.log(`| ${n} | ${fmt(b)} | ${fmt(h)} | ${d} |`);
  }
} finally {
  sh("git", ["worktree", "remove", "--force", wt]);
}
