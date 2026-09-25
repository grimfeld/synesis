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
- `crates/web` — the web test build: the engine compiled to `wasm32-wasip1` behind one `invoke` export, loaded by `src/lib/webengine.ts` on an in-memory copy of `examples/demo-vault`. Pairing, native dialogs and network commands answer with an error. Test-only; never shipped in the app.
- `src` — React UI. `src/editor` is CodeMirror, `src/views` are whole-pane views, `src/i18n` are UI strings (en, fr).

## Commands

- `cargo test -p engine` — engine tests. The Passage parser is the most-tested code; add a case for every bug.
- `npm run tauri dev` — run the desktop app.
- `npm run icons:mobile` — after `tauri android init` / `tauri ios init`, copy the app icons from `src-tauri/icons/{android,ios}` into the generated project (the templates ship Tauri's default icon). The release workflow does this.
- `npm run typecheck` — typecheck the UI.
- `npm run build:web` — build the web test build into `dist-web/` (fetches the wasm32-wasip1 target and wasi-sdk into `target/` on first run). Vercel runs this on every push and gives each branch a preview URL (`vercel.json`). `npm run dev:web` serves it with hot reload for the UI; rerun it after engine changes.
- `npm run test:unit` — Vitest unit tests for pure TypeScript in `src/lib` (`src/**/*.test.ts`, jsdom, ~1s). Put logic that needs no engine here rather than in Cypress.
- `npm run tutorials:screenshots` — regenerate the Tutorial screenshots (`docs/tutorials/screenshots/`) from `dist-web/`; run `npm run build:web` first. Only while the pictures trial lasts (PLAN §22.12).
- `npm run test:e2e` — Cypress UI end-to-end suite. Needs `npm run tauri dev` running; each spec opens a temp copy of `examples/demo-vault` through the dev bridge and reopens your vault afterwards. Each test reloads the page through `cy.openApp()`; that reload is cheap (measured: an in-place reset via the palette was slower), the time goes into the tests' own UI steps. Run one spec while iterating: `npx cypress run --spec cypress/e2e/editor.cy.ts`. `npm run test:e2e:open` for the runner UI. Add a spec under `cypress/e2e/` for every UI feature.

## Tutorials

Every feature has a Tutorial (PLAN §22): `docs/tutorials/<id>.<lang>.md`, in every language, listed by the views in `tutorialsFor` (`src/lib/tutorials.ts`) and walked by `cypress/e2e/tutorials/<id>.cy.ts`. When you add a feature, add its Tutorial; when you change how one behaves, reread its Tutorial and walk. The shape is checked by `npm run test:unit`: `# Title`, intro, exactly one numbered list of steps (the last is "Try it once", done for real in the user's Vault), then reference. Name actions as Command links, `[New Note](command:create.note)`, never as hand-written labels or shortcuts.

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
