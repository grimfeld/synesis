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

### Auto-updater

The desktop apps update themselves with [tauri-plugin-updater](https://v2.tauri.app/plugin/updater/): at start-up (unless Settings → Updates says otherwise) they read `https://github.com/grimfeld/synesis/releases/latest/download/latest.json`, and offer **Install & restart** when it names a newer version. GitHub serves `releases/latest` from the newest release that is neither a draft nor a prerelease, so a `X.Y.Z-pre` version never reaches installed apps. Phones update through their stores; the web build has no updater.

Each desktop job signs its updater bundle with the updater key, and tauri-action merges its platform into the release's `latest.json`. The installed apps accept only bundles signed by the key whose public half is `plugins.updater.pubkey` in [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json). Release secrets:

| Secret | Needed for |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | **Required.** Signs the updater bundles; without the key the run stops before tagging. Made with `npm run tauri signer generate`; the public key goes in `tauri.conf.json`. Losing the private key means installed apps can never be updated again, so keep a copy offline. |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Signing and notarising the macOS builds (optional). |
| `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8` (+ `APPLE_TEAM_ID`) | The iOS job; skipped without them. |
| `ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Signing the APK; the job fails without them. |
| `VERCEL_SITE_DEPLOY_HOOK` | Rebuilding the landing page after a release (optional). |

A local `npm run tauri build` needs `TAURI_SIGNING_PRIVATE_KEY` set too, since `bundle.createUpdaterArtifacts` is on.

The workflow refuses a version that differs from those files, or one whose tag already exists on another commit. Every push and pull request also runs [ci.yml](.github/workflows/ci.yml) (typecheck, UI build, engine tests, Tauri check), and a Husky pre-commit hook runs `npm run check` (typecheck + `cargo check --workspace`) so a commit that does not compile is refused.

## Licence

Synesis is free software under the [GNU AGPL-3.0](LICENSE): use it, change it and share it, and share the source of what you change with everyone you give it to. It is free, and will stay free: there is no paid tier ([ADR 0021](docs/adr/0021-open-source-under-the-agpl-with-the-name-kept.md)).

The name and icon are not part of the licence: a changed version needs its own ([TRADEMARKS.md](TRADEMARKS.md)). Issues are welcome; code is by invitation ([CONTRIBUTING.md](CONTRIBUTING.md)).

Every copy offers its source: Settings → About in the app and the web build (with the Commands **About Synesis** and **Synesis source code**) links to this repository and the licence text, and the web demo's banner links the source too, as the AGPL's §13 asks of a hosted copy. The installers carry the licence (`bundle.license`, `licenseFile`, `copyright`, `publisher` in `tauri.conf.json`).

Bundled data keeps its own terms, credited in Settings → About: OpenBible.info places (CC BY 4.0, `crates/engine/data/GAZETTEER-NOTICE.txt`), Natural Earth (public domain) and Mapzen Terrain Tiles (`public/atlas/NOTICE.txt`).

## Testing

```sh
cargo test -p engine                       # parser, index, vault, two-device sync
cargo run -p engine --example inspect -- <vault>   # print what the engine sees in a vault
npm run test:e2e                           # Cypress: UI end-to-end + TS unit specs (dev app must be running)
node scripts/ui-smoke.mjs '<steps>'        # headless UI run against the dev app (see CLAUDE.md)
```

`examples/sample-vault` is a small vault to open on first launch: two Notes, a Clipping, a Composition with an embedded Clipping, a nested Source, a Character, two Places with coordinates and a Concept. Opening it materialises the Scripture pages it mentions.
