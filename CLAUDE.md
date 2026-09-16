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
- `npm run test:e2e` — Cypress UI end-to-end suite. Needs `npm run tauri dev` running; each spec opens a temp copy of `examples/demo-vault` through the dev bridge and reopens your vault afterwards. Each test reloads the page through `cy.openApp()`; that reload is cheap (measured: an in-place reset via the palette was slower), the time goes into the tests' own UI steps. Run one spec while iterating: `npx cypress run --spec cypress/e2e/editor.cy.ts`. `npm run test:e2e:open` for the runner UI. Add a spec under `cypress/e2e/` for every UI feature.

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
