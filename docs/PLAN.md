# Synesis — Design Plan

Outcome of the grilling session on 2026-09-08. Vocabulary is defined in [CONTEXT.md](../CONTEXT.md); hard-to-reverse decisions are in [docs/adr](./adr). This document is the shared understanding; nothing below is built yet.

## 1. What it is

A local-first, Obsidian-style note-taking app for Bible study. The user reads Scripture, meditates, writes Notes, keeps Clippings from Sources, and composes talks. Every document links to every other; Scripture references are detected automatically and become links to Verse pages. The vault is a plain folder the user owns.

## 2. Non-negotiables

- **Local-first.** Files on device. The app is an index over a folder.
- **Obsidian-compatible vault** (ADR 0003). Plain markdown, `[[links]]`, `#tags`, `![[embeds]]`, YAML frontmatter. No custom syntax. Obsidian is the fallback client everywhere.
- **Conflict-free sync** (ADR 0001). CRDT per-device change logs; markdown files are the materialisation. Transports: user's cloud folder (free), hosted E2EE blob store (paid, cost recovery), same server self-hostable.
- **Never rewrite the user's text.** Detected Passages are decorations, not edits.
- **Open source.** App under MIT or GPL, sync server under AGPL.

## 3. Document model

| Type | Who creates it | Notes |
|---|---|---|
| Note | user | the core unit; may cite one Source |
| Clipping | user | verbatim excerpt; must cite exactly one Source; carries a Locator |
| Composition | user | hand-written talk/content; may Embed Clippings; never contains copied Notes |
| Source | user (URL-enriched) | unit you cite; may nest under a parent Source; identified by URL when it has one |
| Book / Chapter / Verse | pre-seeded | file materialises on first Mention |
| Place | user | has coordinates (dataset lookup with manual override) |
| Character | user | |
| Concept | user | |

Links: a **Mention** is any link between documents. Scripture Mentions are auto-detected and resolve a Passage to its Verse set (ADR 0002). All other Mentions are explicit, either inline `[[Paul]]` or as a Tag `#Paul`; both are the same link. Any document is taggable; any Tag names a document.

Every file carries a ULID `id` in frontmatter; the CRDT and index key on it. `type` in frontmatter is the truth; folders are only a default.

## 4. Vault layout

```
Vault/
  Notes/  Clippings/  Compositions/  Sources/
  Scripture/John/John 3/John 3.16.md     (aliases so [[John 3:16]] resolves)
  Places/  Characters/  Concepts/
  .bible-study/sync/<device-id>/         (CRDT snapshots, one per changed document; ignored by Obsidian)
```

The search index and local CRDT state live in the app data directory, per device, not in the vault.

Files are named in English. UI is localised (English and French in alpha, built for more). Verse identity is language-neutral: 66-book canon, standard English / NWT versification. Vocabulary: Hebrew-Aramaic Scriptures and Christian Greek Scriptures.

## 5. Scripture detection rules

- Detect only when a chapter number is present ("Ro 8:38", "Acts 20", "Rev. 15"). Bare book names need `[[Acts]]`.
- Accept common English, Watchtower-standard, and French abbreviations and punctuation ("Jn 3,16"). Parser = language-neutral core + per-language tables.
- Contextual "v. 17" only after a Passage in the same paragraph; shown with a distinct underline.
- Ranges, including cross-chapter, expand to every Verse. Whole-chapter and whole-book Mentions expand too.
- Detection runs in Clippings as well as Notes and Compositions.
- Display collapses a Mention to the coarsest covering unit ("via Romans 8"). Graph defaults to Chapter nodes with a toggle to Verse level.
- No Bible text in the app, structure only.

## 6. Architecture (ADR 0004)

- **Tauri 2**, targets macOS, Windows, iOS, Android.
- **Rust engine:** vault watcher, markdown + Passage parser, SQLite index (search, backlinks, graph, coverage), CRDT (Loro or Automerge), sync transports, external-edit reconciliation on launch.
- **React + TypeScript + Tailwind + Vite** UI with an in-memory mirror of the index; never touches files directly.
- **CodeMirror 6** live-preview editor.
- **Leaflet or MapLibre** map view.
- Engine API vocabulary: get document, replace body, links to, search, subscribe to changes.

## 7. Alpha scope

Platforms: all four, with folder-transport sync (iCloud container on Apple, user-chosen folder elsewhere). Hosted and self-hosted sync come after folder sync is proven.

Features:
1. Editor with live preview, links, tags, Passage decorations, autocomplete.
2. Backlinks panel; graph view (Chapter default); map view of Places.
3. Verse hover card: everything touching that Verse.
4. Coverage grid: 66 books × chapters shaded by how much is written.
5. Canonical (Bible-order) grouping of backlinks on Concept, Character, Place pages.
6. Candidate-material sidebar on Compositions (shared Tags / Passages).
7. Source page as a reading trail, ordered by Locator; parent Source rolls up descendants.
8. Templates per type.
9. Quick capture (global hotkey, desktop).
10. Clipping capture: paste + URL enrichment, Source deduped by URL.

## 8. Later

- Hosted E2EE sync with accounts and key recovery; self-host server; ~$5–10/year paid tier (Apple IAP on iOS).
- Share-sheet capture on mobile.
- Composition export (print / PDF / DOCX) with Embeds resolved and Sources cited.
- Journeys on the map (ordered Places as a route).
- Reading-plan tracking tied to the coverage grid.
- Additional languages via contributed tables and resource files.

## 9. Dropped

Bible text, Notes copied into Compositions, resurfacing / spaced review, browser extension, genealogies, talk timer, collaboration.

## 10. Assumptions made without asking

- Place coordinates: lookup from the OpenBible.info dataset with manual override.
- Inline Topical Mentions use `[[...]]` syntax; nothing but Scripture is auto-detected.
- Graph: nodes coloured by type, filterable by type, plus a local graph per document.
- Search: SQLite full-text over titles and bodies, filterable by type.
- Mobile uses the same responsive UI, not a separate app.

## 11. Known risks

- The Passage parser (multi-language, contextual references, cross-chapter ranges) is the hardest and most-tested component.
- Folding external edits (Obsidian, text editors) into the CRDT is mandatory and non-trivial.
- Renames on the folder transport look like delete + create; the frontmatter `id` is what reconciles them.
- Tauri mobile share intents and signing pipelines are the least mature part of the stack.
