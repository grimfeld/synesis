# Synesis

Read `docs/PLAN.md` for the design and `CONTEXT.md` for vocabulary before changing anything. Use the glossary's terms in code and UI (Note, Clipping, Composition, Source, Locator, Subject, Book, Chapter, Verse, Passage, Mention, Tag, Place, Character, Concept, Embed).

## Hard constraints

- The vault must stay Obsidian-compatible (ADR 0003). No custom syntax in markdown files.
- Never rewrite the user's text. Detected Passages are decorations only.
- All file access goes through the Rust engine (ADR 0004). The UI never touches files.
- Verse identity: 66-book canon, English versification, `crates/engine/src/versification.rs`.

## Layout

- `crates/engine` — Rust library: versification, book names, Passage parser, document parser, SQLite index, vault.
- `src-tauri` — Tauri shell exposing engine commands.
- `src` — React UI. `src/editor` is CodeMirror, `src/views` are whole-pane views, `src/i18n` are UI strings (en, fr).

## Commands

- `cargo test -p engine` — engine tests. The Passage parser is the most-tested code; add a case for every bug.
- `npm run tauri dev` — run the desktop app.
- `npm run icons:mobile` — after `tauri android init` / `tauri ios init`, copy the app icons from `src-tauri/icons/{android,ios}` into the generated project (the templates ship Tauri's default icon). The release workflow does this.
- `npm run typecheck` — typecheck the UI.
- `npm run test:unit` — Vitest unit tests for pure TypeScript in `src/lib` (`src/**/*.test.ts`, jsdom, ~1s). Put logic that needs no engine here rather than in Cypress.
- `npm run test:e2e` — Cypress UI end-to-end suite. Needs `npm run tauri dev` running; each spec opens a temp copy of `examples/demo-vault` through the dev bridge and reopens your vault afterwards. The page is loaded once per spec and `cy.openApp()` resets it in place between tests (`testIsolation: false`), so a test must leave no modal open that Escape cannot close. Run one spec while iterating: `npx cypress run --spec cypress/e2e/editor.cy.ts`. `npm run test:e2e:open` for the runner UI. Add a spec under `cypress/e2e/` for every UI feature.

## UI smoke testing without the Tauri window

In debug builds the app starts an HTTP bridge on `127.0.0.1:4321` (`src-tauri/src/devbridge.rs`); `src/lib/devbridge.ts` routes `invoke` to it when the page runs in a plain browser. So with `npm run tauri dev` running, open `http://localhost:1420` in Chrome, or drive it headless with `node scripts/ui-smoke.mjs '<json steps>'` (screenshots + console errors). Webview errors are also forwarded to the terminal as `[ui:…]` lines.
