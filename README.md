# Synesis

A local-first, Obsidian-compatible note-taking app for Bible study. Notes, Clippings, Sources, and Compositions link to each other and to every Verse, Chapter, and Book they mention. Scripture references are detected as you type. Your vault is a plain folder of markdown files that you own and that opens in Obsidian.

- **Design:** [docs/PLAN.md](docs/PLAN.md)
- **Vocabulary:** [CONTEXT.md](CONTEXT.md)
- **Decisions:** [docs/adr](docs/adr)

## Stack

Tauri 2 (macOS, Windows, iOS, Android). Rust engine (`crates/engine`) for parsing, indexing, and sync. React + TypeScript + Tailwind UI (`src`). CodeMirror 6 editor.

## Development

One command sets up a fresh machine (Rust via rustup, Node 22+, Tauri system libraries, npm and cargo dependencies), verifies the build, and starts the dev app. It works on macOS, Linux, and Windows; on Windows it needs Git for Windows (installed automatically through winget if missing) and runs from cmd, PowerShell, Git Bash, or a double-click on `scripts\dev.cmd`:

```sh
scripts/dev              # or: npm run dev:all   (Windows: scripts\dev)
scripts/dev --no-start   # setup only (or: npm run setup)
scripts/dev --skip-tests # start without running engine tests
```

It is safe to re-run. Once set up, the individual pieces are:

```sh
npm run tauri dev     # desktop app: Vite on :1420, Tauri window, dev bridge on :4321
cargo test -p engine  # engine tests
```

## Sync

Pair devices with a QR code / pairing code (Settings → Sync): paired devices sync directly over [Iroh](https://iroh.computer) whenever both are online, no account, no server storing data (ADR 0008). Alternatively put the vault in a folder you already sync (iCloud Drive, Syncthing, OneDrive / Google Drive / Dropbox); the wizard's tutorials live in `docs/tutorials/sync-*`. Both can be combined.

## Releasing

[.github/workflows/release.yml](.github/workflows/release.yml) is started by hand on `main` (`gh workflow run` or the Actions tab) with a version: it tags the commit `vX.Y.Z`, creates the GitHub Release, builds macOS (Apple Silicon and Intel), Windows, Linux and Android (arm64), and attaches the installers. It is not triggered by a tag push because a run on a new tag cannot see the caches of earlier runs, which made every release a cold 15-minute build per platform; from `main` the previous release's `target/` is reused. The iOS job runs only when the `APPLE_*` signing secrets are set (an unsigned device build is not possible). Android is unsigned unless `ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` are set.

```sh
npm run release -- 0.2.0   # sets the version in package.json, tauri.conf.json, Cargo.toml; commits; pushes; starts the workflow
```

The workflow refuses a version that differs from those files, or one whose tag already exists on another commit. Every push and pull request also runs [ci.yml](.github/workflows/ci.yml) (typecheck, UI build, engine tests, Tauri check), and a Husky pre-commit hook runs `npm run check` (typecheck + `cargo check --workspace`) so a commit that does not compile is refused.

## Licence

App: MIT. Sync server (when it exists): AGPL-3.0.

## Testing

```sh
cargo test -p engine                       # parser, index, vault, two-device sync
cargo run -p engine --example inspect -- <vault>   # print what the engine sees in a vault
npm run test:e2e                           # Cypress: UI end-to-end + TS unit specs (dev app must be running)
node scripts/ui-smoke.mjs '<steps>'        # headless UI run against the dev app (see CLAUDE.md)
```

`examples/sample-vault` is a small vault to open on first launch: two Notes, a Clipping, a Composition with an embedded Clipping, a nested Source, a Character, two Places with coordinates and a Concept. Opening it materialises the Scripture pages it mentions.
