---
status: accepted
---

# Rust engine behind a small document-shaped API, React UI in the Tauri webview

Everything that is not UI (vault watching, markdown and Passage parsing, the search/backlink/graph index in SQLite, CRDT merge and sync) lives in the Rust side of Tauri and is exposed to the React/TypeScript/Tailwind frontend through a small set of document-shaped commands and events. The UI keeps an in-memory mirror of the index for responsiveness but never touches files.

## Considered options

- **TypeScript engine in the webview** (Automerge via WebAssembly, JS parser, IndexedDB index). Faster to iterate for a React developer, but indexing thousands of files in a webview is sluggish on phones, and folding external file edits into the CRDT is awkward when the watcher and the CRDT live in different processes.

## Consequences

- The parser, versification tables and CRDT logic are testable in plain Rust with no browser.
- One engine binary serves desktop and mobile.
- Engine changes cross a serialisation boundary; the API must stay small and stable. The intended vocabulary is: get document, replace body, links to, search, subscribe to changes.
