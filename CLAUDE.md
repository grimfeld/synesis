# Synesis

Read `docs/PLAN.md` for the design and `CONTEXT.md` for vocabulary before changing anything. Use the glossary's terms in code and UI (Note, Clipping, Composition, Source, Locator, Subject, Book, Chapter, Verse, Passage, Mention, Tag, Place, Character, Concept, Embed).

## Hard constraints

- The vault must stay Obsidian-compatible (ADR 0003). No custom syntax in markdown files.
- Never rewrite the user's text. Detected Passages are decorations only.
- All file access goes through the Rust engine (ADR 0004). The UI never touches files.
- Verse identity: 66-book canon, English versification, `crates/engine/src/versification.rs`.

## Layout

- `crates/engine` — Rust library: versification, book names, Passage parser, document parser, SQLite index, vault.
- `src-tauri` — Tauri shell exposing engine commands. Command logic that is not Tauri-specific lives in `engine::api`, so the web build shares it.
- `site` — the landing page (Astro, en at `/`, fr at `/fr/`), its own Vercel project at synesis-app.vercel.app. Downloads open by themselves once the latest GitHub Release is 0.1.0 or later and holds the platform's file (`site/src/lib/release.ts`); the words are in `site/src/i18n/strings.ts`, both languages.
- `crates/web` — the web test build: the engine compiled to `wasm32-wasip1` behind one `invoke` export, loaded by `src/lib/webengine.ts` on an in-memory copy of `examples/demo-vault`. Pairing, native dialogs and network commands answer with an error. Test-only; never shipped in the app.
- `src` — React UI. `src/editor` is CodeMirror, `src/views` are whole-pane views, `src/i18n` are UI strings (en, fr).

## Commands

- `cargo test -p engine` — engine tests. The Passage parser is the most-tested code; add a case for every bug.
- `npm run tauri dev` — run the desktop app.
- `npm run icons` — regenerate every app icon from `branding/` (the logo, white on a navy tile; Android gets separate foreground, background and monochrome layers). Edit the SVGs there, never the PNGs.
- `npm run release -- X.Y.Z` — bump, push and start `.github/workflows/release.yml`. Desktop releases are signed for the auto-updater (`src/lib/updater.ts`, tauri-plugin-updater, desktop only): the run stops unless the `TAURI_SIGNING_PRIVATE_KEY` secret is set (`.github/actions/require-updater-key`), and installed apps read `releases/latest/download/latest.json`, which skips prereleases. The public key is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`; never replace it without a plan for the installed apps, which then refuse every update. See README → Releasing.
- `npm run icons:mobile` — after `tauri android init` / `tauri ios init`, copy the app icons from `src-tauri/icons/{android,ios}` into the generated project (the templates ship Tauri's default icon). The release workflow does this.
- `npm run ios:post-init` — after `tauri ios init`: the icons, plus the iCloud entitlements from `src-tauri/ios/Synesis_iOS.entitlements` (ADR 0022), plus a check that SystemConfiguration and Network are linked (`scripts/ios-post-init.mjs`). The release workflow runs it; `src-tauri/Info.ios.plist` is merged by `tauri ios build` itself.
- `npm run typecheck` — typecheck the UI.
- `npm run licenses` — regenerate `public/third-party-licenses.txt` (Settings → About → Third-party licences) after adding, removing or updating an npm or cargo dependency; CI runs `--check`.
- `npm run build:web` — build the web test build into `dist-web/` (fetches the wasm32-wasip1 target and wasi-sdk into `target/` on first run). Vercel runs this on every push and gives each branch a preview URL (`vercel.json`). `npm run dev:web` serves it with hot reload for the UI; rerun it after engine changes.
- `npm run test:unit` — Vitest unit tests for pure TypeScript in `src/lib` (`src/**/*.test.ts`, jsdom, ~1s). Put logic that needs no engine here rather than in Cypress.
- `node scripts/site-screenshots.mjs` — the landing page's screenshots, from the dev app (`npm run tauri dev` running) on a copy of the demo vault, en/fr × light/dark. In `site/`: `npm run build`, `npm run check` (no overflow in en/fr at phone and desktop width; CI runs it), `npm run og` (share images).
- `npm run test:e2e` — Cypress UI end-to-end suite. Needs `npm run tauri dev` running; each spec opens a temp copy of `examples/demo-vault` through the dev bridge, reopens your vault afterwards, and forgets and deletes every `synesis-cy-*` copy with its app-data index (`cypress/support/e2e.ts`). A spec must never open one of your real vaults. Each test reloads the page through `cy.openApp()`; that reload is cheap (measured: an in-place reset via the palette was slower), the time goes into the tests' own UI steps. Run one spec while iterating: `npx cypress run --spec cypress/e2e/editor.cy.ts`. `npm run test:e2e:open` for the runner UI. Add a spec under `cypress/e2e/` for every UI feature.

## Tutorials

Every feature has a Tutorial (PLAN §25): `docs/tutorials/<id>.<lang>.md`, in every language, listed by the views in `tutorialsFor` (`src/lib/tutorials.ts`) and walked by `cypress/e2e/tutorials/<id>.cy.ts`. When you add a feature, add its Tutorial; when you change how one behaves, reread its Tutorial and walk. The shape is checked by `npm run test:unit`: `# Title`, intro, exactly one numbered list of steps (the last is "Try it once", done for real in the user's Vault), then reference. Name actions as Command links, `[New Note](command:create.note)`, never as hand-written labels or shortcuts. Pictures are diagrams, `![alt](image:<name>)` for `docs/tutorials/diagrams/<name>.svg`, language-neutral with no text (PLAN §25.12).

## Locales

French strings run 30-60% longer than English ones, so a layout that only fits in
English breaks in French: `Card` is `overflow-hidden`, and a child that cannot
shrink below its content is simply clipped. When adding UI:

- Give flex/grid children that hold text `min-w-0` (Card, CardHeader and CardContent
  already do this for their own children), and `truncate` only where an ellipsis is
  the intended result.
- Button labels wrap rather than force their row wider (`min-h-*`, not `h-*`). Keep
  it that way; a fixed-height button with a long label overflows its card.
- Format dates and numbers with `useFormat()` from `@/i18n` so they follow the app
  language instead of the operating system's.
- Target elements in tests by `data-testid`, never by a localized label.
- `cypress/e2e/locales.cy.ts` walks the app in each language at phone width and
  fails on anything laid out wider than the box that clips it. Add a case there when
  a new view has long labels.

## UI smoke testing without the Tauri window

In debug builds the app starts an HTTP bridge on `127.0.0.1:4321` (`src-tauri/src/devbridge.rs`); `src/lib/devbridge.ts` routes `invoke` to it when the page runs in a plain browser. So with `npm run tauri dev` running, open `http://localhost:1420` in Chrome, or drive it headless with `node scripts/ui-smoke.mjs '<json steps>'` (screenshots + console errors). Webview errors are also forwarded to the terminal as `[ui:…]` lines.
