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
| Place | user | has coordinates (gazetteer lookup, click-to-set override) |
| Character | user | may carry Date Properties (`born`, `died`, ...) |
| Concept | user | |
| Event | user | has `start` and optional `end` Date; names its Place and Characters via link Properties |

Links: a **Mention** is any link between documents. Scripture Mentions are auto-detected and resolve a Passage to its Verse set (ADR 0002). All other Mentions are explicit, either inline `[[Paul]]` or as a Tag `#Paul`; both are the same link. Any document is taggable; any Tag names a document.

Every file carries a ULID `id` in frontmatter; the CRDT and index key on it. `type` in frontmatter is the truth; folders are only a default.

## 4. Vault layout

```
Vault/
  Notes/  Clippings/  Compositions/  Sources/
  Scripture/John/John 3/John 3.16.md     (aliases so [[John 3:16]] resolves)
  Places/  Characters/  Concepts/  Events/
  .bible-study/properties.json           (Property schema, ADR 0006)
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

Bible text, Notes copied into Compositions, resurfacing / spaced review, browser extension, genealogies, talk timer, collaboration, Daily Note / journal page, Bases (table views per type).

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

## 12. UI revision (grilling session, 2026-09-10)

Outcome of a second session after the first alpha UI. Lifeline (`F:\WORKPLACE\SOFTWARE\lifeline`) was surveyed for inspiration; what was borrowed and what was declined is listed here so it is not re-litigated.

### Decided

1. **Home** replaces Coverage as the opening view: recent documents (by modified time), a quick-capture box (Ctrl/⌘+Enter creates a Note), Compositions in progress (edited in the last 30 days, with candidate-material count). Coverage, Graph and Map stay as views.
2. **Editor = Live Preview + Source mode** on CodeMirror 6, Obsidian's default. Off the active line: hide markers for headings, emphasis, quotes, horizontal rules, lists, checkboxes (clickable), fenced and inline code. Wikilinks, Tags, Passages and Embeds keep their decorations. Not in this round: inline images, tables. Ctrl/⌘E toggles Source mode; one global setting, also a header icon and a Command. No Reading view.
3. **Document layout**: editable title as a heading above the body (committing renames the file; Scripture pages read-only), then a Tags row of editable chips backed by the `tags` property, then the body. Typed properties stay in the right panel with Backlinks, Candidates and Reading trail. The Rename dialog goes away.
4. **Command Palette**: one palette on Ctrl/⌘K. Default mode searches documents; a leading `>` switches to Commands; Ctrl/⌘⇧P opens in command mode. Commands are declared in one registry (id, title, keywords, icon, shortcut, run) so the palette, shortcuts and menus share it. Groups this round: Create + capture, Navigate, Editor. Document/app commands later.
5. **Sidebar**: Home, views and Settings on top; then tabs **Documents** (today's list grouped by type plus the Scripture tree) and **Tags** (every Tag with counts; click lists the tagged documents). Search is palette-only.
6. **Naming**: file names are lowercase (`Characters/paul of tarsus.md`, `Scripture/John/John 3/john 3.16.md`); the app shows the title with its first letter capitalised. A `title` property is written only when the typed title carries capitalisation the stem cannot ("Paul of Tarsus"). Links resolve case-insensitively, so `[[Paul of Tarsus]]` and `[[paul of tarsus]]` are the same Mention. A case-only rename keeps the file (no " 2" suffix on case-insensitive file systems).

### Declined from Lifeline

- Properties form above the body (kept in the panel).
- Daily Note / journal page and capture-appends-to-today (quick capture keeps creating its own Note).
- Paste-first clip dialog and a Home quick-clip card (current dialog with URL metadata fetch stays).
- Bases / table views per type.
- Folder file tree as the sidebar.

## 13. Writing pages and Hub pages (grilling session, 2026-09-10)

Problem: six of the nine types (Source, Book, Chapter, Verse, Place, Character, Concept) are files whose markdown body has no purpose beyond Obsidian compatibility, yet the app opened them in the editor like a Note. Vocabulary in [CONTEXT.md](../CONTEXT.md): **Writing** (Note, Clipping, Composition) and **Hub** (Source and every Subject).

### Decided

1. **Writing pages** keep today's layout: title, tags, editor, right panel (properties, backlinks, candidates).
2. **Hub pages** open as a view, full width, no right panel. Top to bottom: (a) header card: title (read-only for Scripture), type, tags, properties editable inline; (b) type section; (c) backlinks; (d) **About**: the file body, collapsed to one muted prompt line when empty, otherwise the same Live Preview editor as Writing pages.
3. **Type sections.** Source: reading trail ordered by Locator, grouped under child Sources for a parent; header has Open URL and New Clipping from this Source. Book: chapter strip shaded by mention count plus mentions of the whole Book. Chapter: verse strip plus mentions of the whole Chapter. Verse: every mention with excerpt in Bible order. Place, Character, Concept: mentions grouped by Book; Place shows a mini-map in the header; Character and Concept show aliases as editable chips.
4. **Lists.** Home Recent shows Writing only. Sidebar groups unchanged.
5. **Files unchanged.** A Hub is still one markdown file with frontmatter; nothing here changes the vault format (ADR 0003).

### Declined

- Hiding the body entirely (Obsidian edits would become invisible).
- Prompt templates in the body (keeps the editor-first confusion).
- Related Subjects (co-occurrence) section: later, needs an engine query.

## 14. Events, Timeline, typed Properties, Place lookup, Candidates, Versions (grilling session, 2026-09-10)

Outcome of a third session after the user tried the app. New vocabulary in [CONTEXT.md](../CONTEXT.md): **Event**, **Date**, **Property**, **Timeline**, **Candidate**, **Version**. Decisions on disk format are ADR 0005 (Dates), 0006 (Property schema), 0007 (Versions).

### Decided

1. **Event** is a fourth Topical Subject: `type: event`, `Events/` folder, Hub page, created manually, Mentioned like any Subject. Template: `start`, `end`, `place`, `characters`. Hub type section: its Date(s), Place, Characters, then mentions grouped by Book.
2. **Dates** are human text (`c. 1513 BCE`, `14 Nisan 33 CE`), parsed by the engine into astronomical year + precision + approximate flag (ADR 0005). Unparseable Date stays off the Timeline; the Hub shows a warning.
3. **Typed Properties**, one type per name vault-wide, in `.bible-study/properties.json` (ADR 0006). Types: text, number, date, calendar, link, list, checkbox. Built-in names pre-declared. The right panel and Hub header render a widget per type; "add property" asks for a type when the name is new. The Place dialog's `lat` / `lon` become number Properties.
4. **Dated Subjects**: any Character or Place with at least one Date Property is dated. Open-ended: `born`, `died`, `anointed`, `reign_start`, whatever the user declares as `date`.
5. **Timeline view**: lanes by Subject. Events lane on top (point or bar per Event); one lane per dated Subject, ordered by earliest Date. `born` + `died` (or `start` + `end`) draw a bar; every other Date Property is a mark labelled by key. An Event is also drawn on the lane of each Character and Place it names in its `characters` / `place` Properties (body mentions do not count). Approximate Dates render faded. Wheel / pinch zooms from millennia to a single year; drag pans; labels hide at coarse zoom. Click opens the Hub. Sidebar view next to Coverage, Graph, Map.
6. **Place lookup**: the OpenBible.info geocoding dataset (CC BY 4.0, ~1,300 names) bundled in the engine. The New Place dialog suggests as you type; picking fills title, `lat`, `lon`, `modern_name`. The Place Hub mini-map gets "Set location" (click on map) as the override. No online geocoder: modern names are useless for ancient sites.
7. **Candidates**: a document the Composition already Mentions (inline `[[..]]`, Embed `![[..]]`, or a Tag naming it) is not a Candidate. The panel shows **Candidates** (unused) and a collapsed **Used in this Composition** list with the same shared Tags / Passages. Home's candidate count counts unused only. Notes that merely share a Tag with the Composition stay Candidates.
8. **Versions**: "Save version" labels the current frontier of the Composition's Loro document; stored in the document so it syncs (ADR 0007). Panel section lists Versions newest first, each openable read-only with a diff against current and a Restore (new edit). "Browse history" underneath scrubs unnamed history by time. "Duplicate as new Composition" is a separate Command for adapting a talk to a new occasion.

### Build order

Each step ships with tests (engine unit tests, Cypress spec under `cypress/e2e/`) and demo-vault content in `examples/demo-vault` that exercises it. All six steps were built on 2026-09-10/11: engine modules `properties.rs`, `dates.rs`, `gazetteer.rs` (plus `data/gazetteer.tsv`, CC BY 4.0, see `data/GAZETTEER-NOTICE.txt`), Versions in `sync.rs`; UI `TimelineView.tsx`, typed Property rows, Set-location and Version dialogs; specs `candidates`, `properties`, `events`, `timeline`, `places`, `versions`.

1. Candidates used / unused split. Engine: `candidates` returns `used: bool`; test with a Composition that embeds one Clipping and tags one Concept. Demo vault already has "Talk on endurance" embedding a Clipping.
2. Property schema + typed widgets. Engine: read / write `.bible-study/properties.json`, expose typed Properties on `get document`; tests for defaulting, first-use declaration, re-index on type change. Demo vault gains a `properties.json`.
3. Date parser (engine, one test case per accepted form and per bug, English + French) + Event type + template + Hub section. Demo vault: `Events/` with the Flood, the Exodus, Paul in Ephesus, Jesus' death; `born` / `died` on David, Paul, Jesus.
4. Timeline view. Engine query: every dated Subject and Event with parsed years. Cypress: lanes present, zoom changes visible range, click opens Hub.
5. Place lookup. Engine: bundled gazetteer + prefix search; Cypress: type "Eph", pick, `lat` / `lon` filled; click-to-set on Hub mini-map. Demo Places lose hand-typed coordinates in favour of looked-up ones.
6. Versions. Engine: save / list / read / restore over Loro, tests including two-device sync (`crates/engine/tests/sync_two_devices.rs`). Cypress: save, edit, diff, restore.

### Found while building

- **Stale remote snapshots overwrite newer on-disk text.** `Vault::scan` imports other devices' snapshots (`apply_remote`) *before* folding the current file text into the CRDT. A snapshot never imported on this device (a foreign `.bible-study/sync/<device>/` folder, or a first open after a data-directory reset) is materialised over the file even when the file is newer, which is how the demo vault lost hand-edited Character dates. Fixed the same day: `apply_remote` now folds a file that is newer than the newest remote snapshot into the merged state (a diff over the imported text) instead of overwriting it; only a file older than the snapshot is treated as a stale copy. Import stays first so a file that already reflects remote edits does not duplicate them. Regression test in `crates/engine/tests/sync_two_devices.rs`.
- Loro merges consecutive same-peer commits into one change by default; the change merge interval is now disabled so history can be browsed save by save. Snapshots grow slightly faster as a result.

### Declined

- Fixed `born` / `died` only on Characters (user wants open-ended dated Properties).
- Inferring Dates by parsing every string value (replaced by typed Properties).
- Online geocoder (Nominatim): modern names, network dependency, no gain for ancient sites.
- Versions as vault files.
- Dates on Compositions / Sources joining the Timeline: those are today's calendar, a different Property type.

## 14. Onboarding and free sync (grilling session, 2026-09-12)

### Decided

1. **Onboarding is the Welcome wizard**, shown whenever no Vault is open: (1) Welcome: what a Vault is; (2) Devices & sync: "Which devices will you use?" (current one pre-ticked) -> the app recommends the one free method covering that set and shows its tutorial, the others one click away; "Only this device" skips; (3) Vault: open a Vault found in the synced folder ("synced from <device>"), create one at the suggested path inside the synced folder, or choose any folder; (4) Done: three things to try. No coach marks, no starter Note, no separate Help view.
2. **Free sync methods documented**: iCloud Drive (macOS, iOS; Apple-only sets), Syncthing (Windows, macOS, Linux, Android; any set with Android), provider desktop clients OneDrive / Google Drive / Dropbox (desktop-only sets). Git declined. Recommendation rule: Apple-only -> iCloud; contains Android -> Syncthing; desktop-only -> provider client (Syncthing offered as alternative). iOS + Android together: no free method; say so.
3. **Sync first, Vault second.** The wizard proposes a default Vault path inside the synced folder (iCloud Drive/Synesis, ~/Sync/Synesis, <Provider>/Synesis) so no Vault ever needs moving.
4. **Second device**: step 3 scans the suggested locations for folders containing `.bible-study/` and offers them first, labelled by the Device that created them. Each Device writes `device.json` (name, platform, last snapshot time) into its sync folder; a status query lists the Devices seen.
5. **Sync in Settings**: method, Vault path, Devices seen with last snapshot time, "Set up sync on another device" reopening the wizard's sync step; a Command "Set up sync".
6. **Tutorials** are markdown files `docs/sync/<method>.<platform>.<lang>.md` (en, fr), bundled at build time and rendered in-app; each ends with a verification step (create a Note on one Device, watch it appear on the other) and a short note on how conflicts are merged.

### Declined

- Coach-mark tour, starter "Getting started" Note, standalone Help view.
- Git as a sync method.
- Tutorials as i18n string arrays.

## 15. One-tap sync: Pairing over Iroh (grilling session, 2026-09-12)

Syncthing was judged too involved for most users. Decided: a built-in peer-to-peer transport (Iroh: Rust, encrypted QUIC, hole-punching with public relays) that mirrors each Device's `.bible-study/sync/<device>/` snapshots between paired Devices. Merge, Versions, materialised markdown and the folder methods are unchanged; the transport only moves snapshot files. ADR 0008.

### Decided

1. **Positioning**: the wizard's sync step leads with *Pair your devices* for every device set (including iOS + Android). The folder tutorials sit under *Use a folder you already sync*. Both can coexist on one Vault.
2. **Flow**: a Device that has the Vault shows an Invite as a QR and as a copyable code (~60 chars). A phone scans it (camera plugin); a desktop pastes it. The joiner requests to join; every paired online Device shows *Allow <name> to join?*; the first tap approves and the prompt clears elsewhere. The joiner shows *Waiting for approval on …* meanwhile, then receives the Vault key and member list, creates the Vault at the default path (`<home>/Synesis/<vault name>`), downloads every snapshot and opens.
3. **Trust**: the Invite carries the showing Device's node id, a relay hint and an invite secret; it stays valid until revoked, and joining always needs approval. Membership changes (join, remove) are gossiped to all peers.
4. **Scope**: Pairing is per Vault. Each Vault has its own member list and Invite.
5. **Relays**: Iroh's public relays by default (encrypted packets only, nothing stored); a custom relay URL in Settings for self-hosters, the same host that will later run the paid blob store.
6. **Background**: on desktop, closing the window leaves a tray / menu-bar icon that keeps syncing; *Quit* stops it; a setting turns this off. Mobile syncs while the app is open.
7. **Removal**: from any Device, Settings → Sync → Remove. Gossiped; peers refuse that node id from then on. Its published snapshots stay in history. Revoking the Invite is the same action on the Invite. Key rotation: later.
8. **Live**: every save publishes the changed snapshot to every connected peer immediately; a reconnecting Device catches up from whoever is online. No re-pairing ever, except after a reinstall.

### Declined

- One-time, 10-minute Invites with auto-accept (chosen: durable Invite + approval prompt).
- Per-Device pairing covering all Vaults.
- Same-network-only sync without relays.
- Key rotation on removal (later).

## 16. Timeline filters and Hub mini-timeline (grilling session, 2026-09-12)

The Timeline works but crowds on both axes: one Lane per dated Subject means endless vertical scroll in a grown Vault, and marks on a Lane collide horizontally because zoom only moves the x-axis. New vocabulary in [CONTEXT.md](../CONTEXT.md): **Lane**, **Cluster**.

### Decided

1. **Five filters**, AND across them, OR within each: **type chips** (event / character / place / concept, the `ToggleGroup` GraphView already uses), **viewport cull** (a Lane renders only when one of its marks falls in the visible range), **title search**, **Tag chips**, and **Property-name chips** (`born`, `died`, `reign_start`, …). Property filtering applies *before* span pairing, so filtering to `born` alone breaks a `born`/`died` span back into a point.
2. **Viewport cull is a toggle, default on.** It makes zoom do double duty: narrowing to 33 CE collapses the Vault to the Subjects alive then. Lane order stays globally sorted by first Date, so culled Lanes leave no gap and survivors never jump past each other while panning. The toggle is the escape hatch for a Lane that vanishes mid-drag.
3. **One filter popover** with an active-count badge, plus the search box inline in the header where width allows. Tag and Property chip lists are unbounded, so a wrapping bar would be three rows tall; a popover also survives `GUTTER_NARROW` on a phone. The cull toggle sits in the popover but does not count toward the badge, which counts user-added restrictions only.
4. **Empty result gets its own state**, naming the active filters with a "clear filters" button. Reusing `no_timeline` would claim the Vault holds no dated things.
5. **Persistence splits** along the `graph_level` precedent: the cull toggle and type chips persist through engine settings; Tag chips, Property chips and search are session-only, because a Tag renamed in the Vault would otherwise silently hide everything with no way to see why. All five live in the app store rather than component state, so the Timeline -> Hub -> back round-trip keeps them.
6. **Label collision**: per Lane, skip a label overlapping the last drawn, spans before points and earliest first, so which label survives does not depend on frontmatter order. This replaces the blanket `LABEL_MAX_SPAN` cutoff, which is removed — a few labels that fit beat none.
7. **Clusters**: points within 14px (mark diameter plus a gap) merge into one mark carrying a count; spans never Cluster, since a bar's width is the thing it shows. Click zooms to the Cluster's extent, hover lists the members, and on touch a tap opens that list with a "Zoom to these" button. The list is not optional: two Characters born "c. 1513 BCE" never separate under zoom, so a zoom-only Cluster would be a trap.
8. **Hub mini-timeline** on any Subject with at least one parsed Date — Character, Place, Concept and Event alike. One rule the user can learn, matching how the Timeline already picks Lanes without special-casing Character. Notes and Sources stay out (§14 Declined: their dates are today's calendar).
9. **Mini content is the Subject's own Dates plus the Events naming it** — what `DatesSection` already fetches, and the same Lane the Timeline builds. Two Lanes: own Dates above, Events below; an Event's own Hub collapses to one. Static: no zoom or pan, because a wheel-zoom inside a scrolling Hub hijacks the page. Extent is the content plus 6% padding, reusing the main view's degenerate-range padding. Labels off except the span bar. The existing Dates and Events text lists stay — they carry the unparseable Dates no timeline can show.
10. **"Open in Timeline"** on the mini's header sets the range to the Subject's extent and prefills search with its title. A soft scope, so "who else was alive then?" stays answerable; a hard one-document filter would show a single Lane and be useless.
11. **Filtering stays client-side.** `timeline()` keeps returning every parsed Date and all five filters run in JS: one person's Vault is ~1500 rows at worst, and a round-trip per search keystroke would be slower than filtering in memory.
12. **One new engine command, `timeline_tags()`** -> `(doc_id, tag)[]` over dated documents, mirroring `event_links()`. `DocSummary` is left alone; adding `tags` there would grow every query in the app to serve one feature. The Tag chips offer only Tags present on dated documents, so a chip can never match nothing.
13. **`src/lib/timeline.ts`** takes the shared core — `buildLanes`, `yearOf`, `formatYear`, scale projection, collision skipping, Clustering — leaving `TimelineView` and `MiniTimeline` as thin SVG shells. That logic needs no engine, so it is Vitest territory (`npm run test:unit`), tested once rather than through two views.

### Build order

Each step ships with tests and demo-vault content that exercises it.

1. Extract `src/lib/timeline.ts`: move `buildLanes` / `yearOf` / `formatYear` with no behaviour change, Vitest covering what they already do. Green before anything else.
2. Label collision and Clusters as pure functions in that module (Vitest: overlap, span priority, identical Dates), then wired into `TimelineView` with the Cluster hover card and click-to-zoom.
3. Engine `timeline_tags()`: query, Rust test, Tauri command, `api.timelineTags()`.
4. Filter state in the store, plus the popover: five controls, AND / OR, empty state, the persistence split. Cypress: each filter narrows Lanes, the badge counts, clear-filters restores.
5. Viewport cull: the toggle and stable ordering. Cypress: zoom in and Lane count drops; toggle off and they return.
6. `MiniTimeline` and the Hub section: two Lanes, static, "Open in Timeline". Cypress: a Character Hub shows it, a mark opens its document, Open-in-Timeline lands with search prefilled. Check the demo Vault's David / Paul / Jesus and four Events exercise Clustering, and give a Place `founded` / `destroyed` if none has Dates.

### Declined

- **A pin list** of hand-picked Subjects: it needs a persistence decision of its own and users rarely maintain one. Tags already do the job and live in the Vault.
- **Mentioned-by and mentions-Passage filters**: relational queries are the Graph's job, and they would turn the filter popover into a query builder.
- **Contemporaries on the mini-timeline**: that is the Timeline. The Hub's job is the one Subject.
- **Reusing `TimelineView` behind a `mini` prop**: the mini has no gutter, axis, filters, header or pan, which is four `if (mini)` branches through 500 lines.
- **Engine-side filtering**, **`tags` on `DocSummary`**, **Notes and Sources on the Timeline**.
