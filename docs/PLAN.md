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
| Journey | user | has `start` / `end` Dates; names its Stops in order via a `places` link-list (ADR 0010, §19) |

Links: a **Mention** is any link between documents. Scripture Mentions are auto-detected and resolve a Passage to its Verse set (ADR 0002). All other Mentions are explicit, either inline `[[Paul]]` or as a Tag `#Paul`; both are the same link. Any document is taggable; any Tag names a document.

Every file carries a ULID `id` in frontmatter; the CRDT and index key on it. `type` in frontmatter is the truth; folders are only a default.

## 4. Vault layout

```
Vault/
  Notes/  Clippings/  Compositions/  Sources/
  Scripture/John/John 3/John 3.16.md     (aliases so [[John 3:16]] resolves)
  Places/  Characters/  Concepts/  Events/  Journeys/
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
- ~~Journeys on the map (ordered Places as a route).~~ Designed in §19.
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
## 17. Boards: a mind map per Composition (grilling session, 2026-09-13)

People preparing talks want to arrange their material spatially before writing prose. New vocabulary in [CONTEXT.md](../CONTEXT.md): **Board**. Disk format is [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/), the open spec Obsidian uses for `.canvas` files (ADR 0009).

### Decided

1. **A Board is a free-form canvas**, not an outline mirror of the Composition's headings and not a filtered Graph. The job is the thinking done *before* there is prose, so it needs its own surface and its own state.
2. **JSON Canvas**, one file per Composition: `Compositions/talk on endurance.canvas` beside `talk on endurance.md`. The deciding argument is the fallback-client promise (ADR 0003): every other storage option shows coordinate soup or nothing in Obsidian, while a `.canvas` opens there as a working canvas. The format also gives `file` nodes a `subpath` (`#Heading`, `#^block`), which is a Clipping or a Note section on the Board without inventing anything.
3. **One Board per Composition, paired by path.** Boards are not a document type: JSON Canvas has no root metadata slot, so a canvas cannot carry the ULID every other file does (§3), and a standalone Map type would fall back to identity-by-path — the exact problem the frontmatter `id` exists to avoid (§11). Pairing sidesteps identity altogether.
4. **Merged as a Loro map inside the Composition's existing `LoroDoc`**, a `canvas` container beside `body` and `meta`. Node-id-keyed, so two Devices dragging two different nodes both win; concurrent edits to the *same* node fall to per-key LWW, which is right for a coordinate. One snapshot, one delete path, one Version covering talk and Board together. A text CRDT over JSON would interleave into invalid files; last-writer-wins over the whole file would drop a Device's work and break the conflict-free non-negotiable (§2).
5. **Node types: `text`, `file`, `group`.** No `link` nodes — an external URL is a Source. `group` earns its place because labelled sections are what turn a scatter of ideas into a talk.
6. **Board refs are indexed apart from prose links**, via a `kind` column on `links`. `candidates` filters to prose only, so dragging a Candidate onto the Board does not mark it used — §14.7 defines used as committed to the talk, and the Board is where nothing is committed yet. The Candidates panel gains an "on the board" state between unused and used, and a referenced document's Hub gains a "Boards" line, so material placed on a Board is visible from both ends.
7. **Editing**: pan, zoom, create / drag / select / delete / edit nodes, draw edges, create groups, multi-select with marquee, edge labels, colors, resize. No auto-layout: arrangement by hand is the entire point. No group auto-move: JSON Canvas has no parent field, membership is geometric only, so a group is an honest visual backdrop.
8. **Preserve unknown fields.** Hard requirement, not a nicety. The spec is silent on unknown keys and Obsidian round-trips them, so anything Synesis parses and does not keep is destroyed the moment the user touches the Board here. Keep the raw JSON per node.
9. **UI is a tab on the Composition** ("Talk" / "Board"). A tab is discoverable where a third editor mode behind a shortcut is not, and Live Preview / Source are two views of one text (§12.2) while a Board is different content in a different file. The Board sizes from its container and the tab lives in the store rather than the route, so the later split pane (talk left, Board right) is not foreclosed.
10. **Material arrives** three ways: palette search on the canvas, a Candidates drawer on the Board, and a button on the Candidates panel. The drawer is what makes this Synesis rather than a generic canvas — the app already knows which material shares Tags and Passages with this talk.
11. **Typed `[[links]]` in a `text` node are ordinary Mentions; dragged `file` nodes are Board refs.** A known rough edge, accepted: the alternative is markdown meaning different things in different files. What you typed is a claim, what you dragged is a reference.
12. **`file` nodes render as card plus excerpt** — a Clipping shows its quote rather than its made-up title, a Note its first line, a Hub its type and mention count, and a `subpath` node that section. No live embeds: a renderer per node will not survive a forty-node Board, and body text is unreadable at the zoom where a Board is useful.
    **Amended (2026-09-15): specified but never implemented; now built, and as one rule rather than four.** The card's excerpt slot shipped empty — `excerptFor` returned the subpath or nothing at all, so an imported card showed its title and the bare word "Clipping" while the hand-typed bubbles beside it carried real text. What is built now: **one rule for every type** — the first meaningful block of body text, minus a heading that merely repeats the title (the vault's house style, and the card shows the title already). That yields this section's Clipping and Note answers without a branch per type, so a new document type gets a sensible excerpt the day it is added. A `subpath` selects the section to start from and the same rule then applies; an unresolvable one shows the document's opening and **says the section is gone** rather than passing it off as what was pinned (§17.13). A Subject Hub falls back to its mention count only when its body says nothing, so a Concept page that opens with real prose shows the prose. The excerpt **replaces** the type label rather than stacking under it: on a 140px card the type is the least valuable row once there is text, though the subpath marker stays, because a sectioned card is otherwise indistinguishable from a whole-document one. Extraction lives in `crates/engine/src/excerpt.rs` (plain text, capped at 200 chars on a word boundary, no ellipsis — the card's `line-clamp` draws its own), reached through one `board_excerpts` call per Board keyed by path *and* subpath, since a Board may legitimately hold both a whole document and one of its sections. Text comes from the FTS row indexing already wrote, so nothing is re-read or re-parsed, and the UI refetches only when a *referenced* document's mtime changes.

13. **Rename rewrites paths** in every Board referencing the document, engine-side in `rename_document`. **Delete keeps the node**, rendered as missing — never silently remove something the user placed by hand, and a hole in a spatial layout is worse than a missing list row. Precedent: `unresolved_links` surfaces broken references rather than hiding them.
14. **External edits reconcile structurally**: parse the JSON, diff node by node against the map, apply. The watcher learns `.canvas`. Folding outside edits is mandatory (ADR 0003), and wholesale replace would reintroduce through Obsidian exactly the loss the map CRDT exists to prevent.
15. **Mobile is view plus light edit**: pan, zoom, long-press to move a node. No edge-drawing (fiddly by finger in every app that has tried it), no groups, no marquee. Preparing a talk is a desk activity; reviewing a Board before speaking is a phone one.

    **Amended (2026-09-14): opening a document is a mode, not a platform rule.** A toolbar toggle switches the Board between *arranging* (the default: click selects, drag moves, nothing navigates) and *reading* (a press opens the card's document, nothing moves or is selectable). The original rule — tap opens on touch, click opens on the desktop — made a card hard to pick up, because the press that selects it is the press that navigates away. It also made `file` nodes wholly undraggable: rendering one as a button marked it `data-board-ui`, which the canvas skips, so it never entered a move gesture. One mode answers both platforms, and touch gains the open gesture rather than losing one. Entering reading mode clears the selection and hides the editing tools (add, drawer, selection toolbar, delete key), so nothing destructive is reachable while reading.
16. **Fit-all on open, no viewport persistence.** A Board's shape is the point and fit-all shows it. The Timeline persists its range because that range is a query (§16.5); a Board's viewport is not.
17. **Versions cover text and Board together**, and the diff view gains a Board tab listing nodes added, removed and moved. Restore restores both, said plainly in the confirmation. A Version is a moment (§14.8); restoring half of one is not.
18. **Export** is a Command producing SVG and PNG of the Board's extent. The renderer is SVG anyway (the `TimelineView` precedent), so this is cheap. Not PDF — that belongs to the later Composition export (§8), and a Board is not a page.

### Build order

Each step ships with engine tests, a Cypress spec, and demo-vault content that exercises it.

1. **Engine: canvas model and the Loro map.** Parse and serialise JSON Canvas, preserve unknown fields, add the `canvas` container to the Composition's doc, structural reconcile. Rust tests including two Devices dragging different nodes concurrently and an Obsidian-style external edit folded in.
2. **Engine: indexing.** `kind` on `links`, Board refs recorded, `candidates` filtered to prose, `boards_referencing(id)`, path rewrite in `rename_document`.
3. **UI: the Board tab and canvas.** Render, pan / zoom, table-stakes editing. `src/lib/board.ts` takes the geometry — hit-testing, marquee, fit-all — as Vitest territory, mirroring the `src/lib/timeline.ts` precedent (§16.13).
4. **UI: material.** Candidates drawer, palette insert, Candidates-panel button, card-plus-excerpt rendering.
5. **Editing extras.** Multi-select and marquee, edge labels, colors, resize, groups.
6. **Mobile.** The view-plus-light-edit gesture model; `cypress/e2e/touch.cy.ts`.
7. **Versions Board diff and export.**

Demo vault: "Talk on endurance" gains a Board exercising every node type — a few `text` bubbles for its points, `file` nodes pointing at the existing Clipping and a Note, one labelled `group`, one labelled edge.

### Declined

- **Outline mirror** (the Composition's heading tree drawn as a radial map) and **scoped Graph** (GraphView filtered to one Composition's neighbourhood): both are views of existing data, and neither is the pre-writing surface the feature is for.
- **Standalone Map documents** in a `Maps/` folder: no place for a ULID in the format.
- **Sidecar JSON under `.bible-study/`** and **coordinates in the Composition's frontmatter**: both invisible or ugly in the fallback client.
- **Last-writer-wins on the whole file**, and **a separate `LoroDoc` for the canvas** (splits Versions).
- **`link` nodes**, **auto-layout**, **group auto-move**, **live embeds in nodes**, **full mobile editing**, **viewport persistence**, **PDF export**.

### Open

- Whether a Board can exist before its Composition does. Currently no: name the talk first.
- Nested groups.
- Whether `text` node markdown gets Passage detection like other bodies.

## 18. Events listed elsewhere carry their Date (grilling session, 2026-09-14)

After using the Timeline for a while, an Event title on its own ("Paul in Ephesus") in a Hub's Events list, a backlink row or the palette reads as half a fact: the Date is what makes an Event an Event. No new vocabulary; [CONTEXT.md](../CONTEXT.md) already says an Event *has a Date*. This is a presentation rule, so no ADR.

### Decided

1. **Rule**: wherever an Event is listed outside its own Hub, its Date follows its title. Surfaces: a Subject Hub's Events section, Home recent documents, backlinks and related lists in the side panel, Hub mentions, the palette (title and content hits) and the link HoverCard. Not the Timeline and mini-timeline (position already says it), not Graph nodes or Board cards (their own visual language, no room).
2. **The text is the Date as written** (ADR 0005): `start`, or `start – end` when both are present, or `– end` when only `end` is. An unparseable value is still shown; the Hub already flags it. An Event with neither shows its title alone. Never normalised, never a computed year.
3. **`DocSummary` carries `start` and `end`** as two nullable strings, null on every other type, so any list can show them without a second query. §16.12 refused adding `tags` to `DocSummary` because every query would grow to serve one feature; two nullable columns for a rule that applies to every list is the opposite case, and `DocSummary` already carries `lat` / `lon` for Places and `book` / `chapter` / `verse` for Scripture.
4. **Layout**: inline after the title, muted, tabular figures; the title truncates and the Date is capped at half the row, so a long French span squeezes the title rather than pushing it out of its box. `DocLink` renders it for any Event by itself; the rows that do not use `DocLink` render the same `EventDate`.
5. **A Hub's Events list is chronological** by parsed `start`; Events whose `start` is missing or unparseable come last, alphabetically. Alphabetical order beside visible Dates reads as wrong. Other lists keep their own order (Home by recency, backlinks by their own rules).

### Declined

- A normalised year ("1513 BCE") instead of the text as written: contradicts ADR 0005 and hides precision the user chose.
- A vault-wide `event_dates()` lookup cached in the store: every list component would have to consult it; the summary is what lists already hold.
- Dates on Timeline marks, Graph nodes and Board cards.

## 19. Map filters and Journeys (grilling session, 2026-09-14)

The Map is the least-developed view: 83 lines, one query (`places()`), one layer group of identical markers, no filters and no Cypress spec. Meanwhile the engine already knows a Place's Tags, backlinks, Dates and the Events naming it, and §8 has carried "Journeys on the map (ordered Places as a route)" since the first session. Both halves are settled here. New vocabulary in [CONTEXT.md](../CONTEXT.md): **Journey**, **Stop**, **Map**. Disk format is ADR 0010.

### Decided

1. **A Journey is a fifth Topical Subject** — `type: journey`, `Journeys/` folder, ULID, Hub page, Mentioned and Tagged like any Subject. Not a derived view over Events (ordering would be inferred from Dates, and two Stops in the same year have no defined order), and not a widened `place:` on Event (an Event happens at one Place; a Journey is a course through many). ADR 0010.
2. **The route is a flat, ordered `places:` link-list**, with the About body carrying the per-leg narrative. Order of the list is order of travel. Rejected: a list of objects per Stop — legal YAML that Obsidian's property editor cannot edit, which fails the fallback-client promise (ADR 0003) on the one Property that matters most on the page. Template mirrors Event's: `start`, `end`, `places`, `characters`.
3. **Journeys are off by default and opt in per Journey**, as a chip group in the same filter popover as the Place filters. One control surface, and multi-select falls out for free — the second and third missionary journeys overlap at Ephesus and are worth seeing together. Rejected: drawing all Journeys at once (spaghetti in a grown Vault), and a single-select "active Journey" dropdown (forecloses comparison, and invents a second way to mean "show this").
4. **A Journey's Hub has "Show on map"**, which sets that Journey's chip and navigates — the entry point that makes (3) discoverable. Same pattern as §16.10's "Open in Timeline". The `show_on_map` string and the `hub-map` button already exist.
5. **Four filter axes**, AND across them, OR within each: **Tag chips**, **title search**, **Book chips** ("Places mentioned in Acts"), and **mentioned-ness** ("only Places something mentions"). The Timeline's type axis is dead here — everything is a Place — and its viewport cull is meaningless, because the map *is* a viewport and panning already culls. Book is the axis that makes this a Bible-study map rather than a pin board, and it is the only one using Passage-to-Verse resolution (ADR 0002). Mentioned-ness is defensive: the bundled gazetteer holds ~1,300 Places, so the moment anyone bulk-imports, "only what I have written about" is the rescue.
6. **Deferred: an era filter.** One of eleven demo Places carries a Date, so it would ship unexercised, and §16's `props` axis already covers filtering by Date Property where it belongs.
7. **Filters govern ordinary Places; a Journey chip governs its own Stops.** A Journey that is on draws its complete route and shows every Stop's marker regardless of the other four filters, in the route's colour. The two controls answer different questions — "which Places am I browsing?" against "draw me this route" — and a route with holes is a lie about geography. The accepted cost: a Place outside your Book filter can stay on screen because a Journey put it there, which the route colouring makes legible rather than looking like a bug.
8. **Undrawable Stops are skipped and reported, never silently dropped.** `journeys()` returns every Stop with a status — `ok`, `no_coords`, `unresolved`, `not_a_place` — and the polyline connects the survivors, because a journey is still a journey with one unlocatable Stop. The Hub lists what could not be drawn, with "Set location" as the fix for `no_coords`. Precedent: §17.13 keeps a Board node whose file was deleted rather than removing what the user placed by hand.
9. **One new engine command, `journeys()`** -> `[{doc, stops: [{doc, status}]}]`, Stops ordered by `l.rowid` and carrying coordinates, mirroring how `places()` serves the Map in a single query. Wikilink resolution stays in the engine where `norm` matching lives (ADR 0004). The `rowid` ordering is load-bearing — a re-index that rewrote those rows in another order would silently reverse a Journey — so a test round-trips a Journey through a re-index.
10. **Drawing: a palette by index, numbered Stops, arrowheads, and curved legs.** Palette rather than a `color` Property, so nothing has to be chosen before anything is visible; as CSS tokens beside `--c-place`, so dark mode works. Numbers do double duty: direction, and telling apart a Place visited twice — Antioch as both "1" and "14" is the whole story of a round trip that two identical markers cannot tell. Legs are quadratic Bézier curves with a consistent bulge direction, which separates an outbound leg from its return between the same two Places instead of drawing one on top of the other.
11. **Stops are edited on the Journey Hub**, as an ordered list with drag-to-reorder, insert and remove, and a picker that searches existing Places first and the bundled gazetteer second, offering to create the Place when a gazetteer entry is picked. A twelve-Stop journey must not mean twelve trips to the New Place dialog. Rejected: the plain `list` widget (getting the order wrong on first pass is certain, and Source mode as the only fix makes the feature unused), and click-the-Map-to-route (a modal editing state on a view that has none, and it only works for Places that already exist).
12. **Journeys reach the Timeline for free.** `start` and `end` are Date Properties, so §14.4 makes a Journey a dated Subject and §16 draws the pair as a span — three missionary journeys become three comparable bars. `journey` joins `TIMELINE_TYPES` and the Graph's `FILTERABLE`; verify rather than build.
13. **Persistence follows §16.5's split**: Book chips and mentioned-ness persist through engine settings; Tag chips, search and Journey chips are session-only, because a Tag renamed in the Vault would otherwise silently hide everything with no way to see why. All of it lives in the app store, so a Map -> Hub -> back round-trip keeps it.
14. **`src/lib/map.ts`** takes the filter predicate and the curve geometry, as Vitest territory — the `src/lib/timeline.ts` (§16.13) and `src/lib/board.ts` (§17.3) precedent. `cypress/e2e/map.cy.ts` does not exist today; the `data-zoom` / `data-center` hooks MapView already exposes were put there for exactly this.

### Build order

Filters first: they are self-contained, they give the Map the test coverage it lacks, and they establish the popover that the Journey chips then hang on. Building Journeys first would mean building that chip group twice. Each step ships engine tests, a Cypress spec, and demo-vault content.

All six steps were built on 2026-09-14: `src/lib/map.ts` (filter predicate, route
geometry, palette) with `src/lib/__tests__/map.test.ts`; engine `place_facts()`
and `journeys()` in `index.rs` with `StopStatus` / `JourneyStop` / `Journey`;
`DocType::Journey` threaded through `document.rs`, `templates.rs`,
`properties.rs` (`places` as a List) and both locales; `set_map_filters` and the
`map_books` / `map_mentioned_only` Settings; `MapFilters.tsx`, the rewritten
`MapView.tsx`, and `JourneySection` on the Hub; `cypress/e2e/map.cy.ts` (the
Map's first spec). Demo vault: Paul's second missionary journey (Antioch to
Antioch, with Troas deliberately uncoordinated) and the Exodus route.

1. **`src/lib/map.ts` and a baseline `map.cy.ts`.** The filter predicate as a pure function under Vitest, and a spec pinning today's behaviour: eleven Places plot, a click opens the Hub.
2. **Engine: Place-to-Books and mentioned-ness.** The query behind the Book axis, Rust test, Tauri command, `api.` mirror.
3. **The filter popover.** Four axes, AND / OR, active-count badge, filtered-empty state naming the active filters, `mapFilters` in the store with the persistence split. Cypress per axis.
4. **Engine: the Journey type.** Folder, template, indexing, `journeys()` with ordered Stops and statuses. Rust tests including the rowid round-trip through a re-index and one case per status.
5. **Map: routes.** Curve geometry in `src/lib/map.ts` (Vitest: consistent bulge, outbound and return separated), palette, numbered Stops, arrowheads, Journey chips, force-shown Stops.
6. **The Journey Hub.** Stops editor with drag-reorder and the picker, the "cannot be drawn" list, "Show on map". Confirm the Timeline span and the mini-timeline appear without new code.

Demo vault: Paul's second missionary journey (Antioch to Antioch, over ten Stops, exercising the repeat visit), one short Journey, and deliberately one Stop whose Place has no coordinates, so the "cannot be drawn" path is exercised by default.

### Declined

- **Journeys as a derived view over Events**, and **Event's `place:` widened to a list**.
- **A list of objects per Stop**, and **a JSON sidecar or paired file** on the ADR 0009 model (a Journey is markdown and can hold its own ULID).
- **All Journeys drawn at once**, and **a single-select active-Journey dropdown**.
- **Breaking the polyline at an undrawable Stop.**
- **An era filter**, **the type axis**, and **the viewport cull** on the Map.
- **Click-the-Map-to-route**, and **the plain `list` widget** for Stops.
- **A typed Event-to-Journey link**: they already meet at the Place and on the Timeline, and relational queries are the Graph's job.
- **Great-circle legs**: rejected in the session in favour of Bézier curves, which separate outbound from return.

### Open

- Whether a Journey may name a Stop that is a Character or a Concept (currently `not_a_place`, surfaced as an error).
- Whether `places:` should accept a Passage (`Ac 15:36`) as a Stop, resolving to whatever Place that Passage names.
- A `color` Property overriding the palette, if anyone asks for it.

## 20. The Library: Sources on Shelves, with Covers (grilling session, 2026-09-16)

Sources had no view of their own — a flat, alphabetical sidebar group and a Hub each — so a Vault with sixty of them was a list of titles. This session turned the collection into a place you browse. New vocabulary in [CONTEXT.md](../CONTEXT.md): **Library**, **Shelf**, **Cover**. Disk format and attachments are ADR 0012.

### Decided

1. **A Shelf is a kind, and only top-level Sources stand on one.** A Source with a `parent` sits inside it and is reached through it, so the Library shows works rather than every fragment ever cited. Rejected: shelving every Source by kind, which turns "Chapters" into a junk drawer holding every chapter of every book.
2. **Only container kinds get a Shelf**: book, periodical, video, talk, podcast, article, other. `chapter` and `issue` never do — they exist only inside something. A Source of a child kind that has lost its parent, or whose kind the app has never heard of, falls to a trailing **Unshelved** row that doubles as the user's fix-it queue. Rejected: auto-promoting a parentless chapter onto the Books shelf (blurs the model), and forbidding it at creation (blocks fast capture to protect a rule the user did not ask for).
3. **The container/child split lives in the UI** (`src/lib/library.ts`), not the engine. `kind` stays `PropertyType::Text`, so a hand-written `kind: sermon` shelves as Unshelved rather than erroring — the vault stays editable by hand (ADR 0003). Rejected: a Rust enum, which would reject vocabulary the user invented in their own files.
4. **One `cover` Property, read three ways**: `http(s)://` is a picture on the web, anything else is a path inside the vault, and empty draws a Cover from the Source's own title, kind and date. Every Source has a Cover; only some have a picture. The drawn fallback is what makes a Shelf read as a library on the first day, and it frequently beats the site logo an `og:image` actually returns. ADR 0012.
5. **Pictures are copied into `Attachments/`, downscaled, and never indexed.** The scanner still reads `.md` only; an image is referenced by a `cover` value and is not a document. Read back as a data URL rather than through Tauri's asset protocol, because the asset protocol does not exist on the development bridge and a Cover no Cypress spec can see is a Cover that is not tested.
6. **`Fetch` fills `cover` from `og:image`; "Save a copy" is a separate, explicit action** that downloads it into the vault and rewrites the property. Pulling third-party images into the user's vault is a decision, not a side effect of asking for a title.
6b. **An attachment is named after its Source, so it cannot be written before the Source has a title.** In the New dialog a picked Cover is *staged* and copied in on submit; on a Hub, where the title already exists, it copies at once. `unique_path` refuses an empty title rather than falling back to "untitled" — nothing indexes attachments, so the file name is the only thing tying a picture to its Source, and `untitled.jpg` / `untitled 2.jpg` is a folder nobody can read. Found the hard way: the first real Cover saved from a URL landed as `Attachments/untitled.jpg`.
7. **Shelves scroll sideways at every width**, because the shelf is the metaphor. The cards inside still have to survive French at 375px, so each is `min-w-0` with a clamped title; `locales.cy.ts` walks the view in both languages. Arrows appear only when a Shelf overflows, and give the row a keyboard path.
8. **A card shows Cover, title, and its direct child count** ("12 parts"). Clicking opens the Source's Hub, where the Contains list already lives. Deferred: a clipping count, which would need an engine-side batch query rather than one `source_trail` call per card.
9. **Two gestures add parts.** A button on the parent's Hub opens the dialog with the parent filled **and locked** and the kind it usually holds (book -> chapter, periodical -> issue, issue -> article); an inline row under Contains takes a title and Enter, keeps focus, and creates the part without leaving the page. Pasting several lines creates them all behind a confirm, because a contents page is usually something you can copy and twelve new files is not something to do silently. Nothing but the title is inherited — date inheritance is right for a book's chapters and wrong for a periodical's issues, so it waits for a case that needs it.
10. **Child Sources sort naturally**, so "Chapter 2" precedes "Chapter 10" in the Contains list, in the reading trail's groups and on a Shelf. `natural_cmp` already existed for Locators one function away.
11. **"Part of" is never plain text.** The picker accepts a Source the user chose — capturing its **id**, so a rename cannot break the link — or an explicit "Create X" row; typing alone never becomes a `[[wikilink]]`. The same component replaces the `source` picker on Notes and Clippings, which had the identical bug. Rejected: a strict select over existing Sources only (a dead end mid-thought), and silent creation from typed text (how "The Watchtwoer" becomes a real Source).
12. **`author` is gone** from the dialog, the template, the built-in schema and the URL scrape — empty on every demo Source and a third of the metadata row. Existing values are never stripped: they stay in the file and render as an untyped Property.
13. **One new engine command, `library()`** -> `[{id, title, kind, cover, date, parent_id, child_count}]`, sorted naturally, with parents resolved to ids and children counted in SQL. `DocSummary` carries none of those fields and adding them would bloat all thirteen document types for the sake of one; the alternative is a round-trip per card.

### Open

- A clipping count on the card, once there is a batch query for it.
- Sidebar nesting: children under their parent in the rail, which is a second, independent piece of work.
- Sweeping `Attachments/` for pictures no `cover` names any more.
- Renaming a Source's Cover file when the Source is renamed, which also means rewriting the `cover` property in step.

## 21. Onboarding rebuilt: three ways in, and a Vault you can find (grilling session, 2026-09-19)

Outcome of a session after using the Android build. Two faults: the wizard's
sync step offered a pairing code field and a "Next" button that ignored it, so
typing a code and pressing Next silently created a local Vault; and every Vault
the phone made landed in `Android/data/`, which the Files app will not browse.
The location decision is [ADR 0015](adr/0015-the-app-decides-where-a-vault-lives-on-mobile.md).

### Decided

1. **Step 2 is a chooser, and nothing else.** Three cards: **Pair with another
   device** (recommended), **Use a synced folder**, **Just this device**. The
   cards are the navigation — tapping one opens its own screen. There is no
   `Next` on the chooser and no `Skip`; the footer carries only `Back`. Each
   detail screen has exactly one primary action, labelled with what it does
   (`Join vault`, `Create vault`), so no button can mean something other than
   the one the user is looking at. This is the fix for the reported bug, and it
   removes the class rather than the instance.
2. **Four steps stay**, on desktop and mobile alike: Welcome, Sync, Vault,
   Done. Step 2 is chooser-then-detail, and `Back` from a detail screen returns
   to the chooser rather than to step 1. The pairing branch reaches its Vault
   through the join itself, so it passes through step 3 without a screen.
3. **Mobile has no path field.** The app derives the path from the Vault's
   name: `<shared Documents>/Synesis/<name>`, with `free_path`'s suffix on a
   collision. The local branch asks for a name (prefilled, editable) and shows
   the resulting folder read-only underneath. Desktop is unchanged — picker and
   path input, defaulting inside the chosen sync tool's folder when there is
   one, `~/Documents/Synesis/<name>` otherwise.
4. **The permission is asked where the consequence is visible.** Each branch's
   screen shows the folder the Vault will occupy; on Android without all-files
   access that preview shows the `Android/data/` fallback, says it will be
   hidden from the Files app, and offers "Allow access to Documents". `Create`
   stays enabled throughout: refusing yields a working Vault in a hidden
   folder, never a blocked wizard. iOS needs no permission and shows no row.
5. **"Drive" is not a choice, because on Android it cannot be one.** Google
   Drive has no synced local folder on Android and reaches the engine only
   through SAF. The third card is **Use a synced folder** — honest about being
   any folder another app keeps in sync (Syncthing, a Drive-sync tool) — and
   carries the existing per-method tutorials.
6. **The synced-folder branch inverts the setup order on mobile**: create the
   Vault at `Documents/Synesis/<name>` first, then point the sync tool at a
   folder that already exists and already holds something. Discovery is
   unchanged and stays in this branch — found Vaults (`.bible-study/` in a
   known sync root, labelled by the Device that made them) are offered here,
   because they exist by virtue of a sync folder existing.
7. **A returning user does not walk a wizard.** When `settings.vaults` is not
   empty, step 1 lists the Vaults this Device holds with a "New vault" action
   underneath, instead of the three pillars. The pillars are for the first run.
8. **Joining derives its path from the Invite.** `inspect_invite` already
   reports the Vault's name; the join screen shows "Joining *main*, into
   `Documents/Synesis/main`" once the code parses. ADR 0014's occupied-folder
   case keeps moving to a sibling automatically, but is stated as information
   in that preview rather than as a destructive-red error — the app has already
   resolved it. Mobile gets no escape hatch: reintroducing a path field behind
   an "Advanced" disclosure would keep the confusion for the users likeliest to
   open it.
9. **Existing Vaults move on request, never on their own.** Settings gains a
   per-Vault "Move to Documents", shown when a Vault sits under `Android/data/`
   and the permission is granted. It closes the Vault, copies, updates
   `settings.vaults`, deletes the old folder and reopens at the new path.
10. **Settings keeps today's sync UI.** The chooser is onboarding-only: a
    Settings dialog opens with a Vault already open, where "create a local
    Vault" means nothing. `set_sync_method` moves from Vault-open time to each
    branch's action, where the method is actually known.

### Build order

One branch, several commits, shipped as one release — a half-migrated wizard is
worse than either end of it.

1. **Paths and permission.** `suggest_vault_path` parent `Synesis vaults` ->
   `Synesis`; shared-Documents parent on Android and iOS; `storage_access` and
   `request_storage_access` commands (a `@TauriPlugin` class injected by
   `scripts/android-post-init.mjs`, which also adds the manifest permission),
   reporting `{ needed: false, granted: true }` off Android; iOS Info.plist
   gains `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace`. Rust
   tests for the parent and for collision suffixes.
2. **The wizard.** Chooser plus three detail screens; step 1's Vault list;
   found Vaults into the synced-folder branch; the path-preview component with
   its permission row.
3. **Move a Vault** in Settings: a `move_vault` command (close, copy, update,
   delete, reopen) and its row.
4. **Tutorials and strings.** Reword `docs/sync/syncthing.android.*` for the
   inverted order; en and fr for every new screen.
5. **Tests.** Vitest in `src/lib` for the decision rules — given platform,
   permission, method and name, which path and which screens — next to
   `syncRules.ts`, which already has that shape. A rewritten `onboarding.cy.ts`
   for the three-branch navigation and the absence of `wizard-next` on step 2,
   with `sync_locations` and `storage_access` intercepted to drive the Android
   shape. A `locales.cy.ts` case at phone width: three cards of French copy is
   exactly the overflow this repo's locale rule warns about.

### Declined

- **SAF and a `DocumentsProvider`**, both in ADR 0015: the first needs a VFS
  under the whole engine, the second leaves Obsidian unable to open the folder.
- **Google Drive as a named method on Android.** It would promise a thing the
  platform cannot deliver, and the user would discover it only after choosing.
- **An "Advanced" path field on mobile.** The choice is what confused; hiding
  it does not unconfuse it.
- **Automatic migration of Vaults already on the device** (ADR 0015).
- **Three steps instead of four.** Vault creation stops having its own screen
  on mobile, but renumbering the header per branch makes the progress indicator
  lie about where the user is.
