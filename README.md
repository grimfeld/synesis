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

## Releasing

Pushing a `vX.Y.Z` tag runs [.github/workflows/release.yml](.github/workflows/release.yml): it builds macOS (Apple Silicon and Intel), Windows, Linux and Android, and attaches the installers to a GitHub Release named after the tag. The iOS job runs only when the `APPLE_*` signing secrets are set (an unsigned device build is not possible). Android is unsigned unless `ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` are set.

```sh
npm run release -- 0.2.0   # sets the version in package.json, tauri.conf.json, Cargo.toml; commits; tags v0.2.0; pushes
```

The workflow refuses a tag whose version differs from those files. Every push and pull request also runs [ci.yml](.github/workflows/ci.yml) (typecheck, UI build, engine tests, Tauri check), and a Husky pre-commit hook runs `npm run check` (typecheck + `cargo check --workspace`) so a commit that does not compile is refused.

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
