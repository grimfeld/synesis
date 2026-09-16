---
status: accepted
---

# A Journey is a Subject whose ordered `places:` link-list is the route

A Journey is an ordered course through Places that someone in the Bible's world travelled: Paul's second missionary journey, Israel's route out of Egypt. We decided it is a fifth Topical Subject — `type: journey`, a `Journeys/` folder, a ULID in frontmatter like every other document — and that its route is a flat, ordered list of wikilinks in a `places:` Property:

```yaml
---
id: 01M2A...
type: journey
title: "Paul's second missionary journey"
start: "c. 49 CE"
end: "c. 52 CE"
places: ["[[Antioch]]", "[[Derbe]]", "[[Lystra]]", "[[Troas]]", "[[Philippi]]", "[[Antioch]]"]
characters: ["[[Paul]]", "[[Silas]]"]
---
Wintered in Corinth (Ac 18:11).
```

The order of the list is the order of travel. Everything else a Stop might carry — why he stayed, which Passage records it — goes in the body as prose.

Being a Subject buys the whole existing machinery at no cost: a Hub page, backlinks, Tags, `[[Paul's second journey]]` resolving like any other link, and — because `start` and `end` are Date Properties — a span on the Timeline with no new Timeline code (PLAN §14.4, §16).

## Considered options

- **A Journey as a derived view over Events**, with no new type: tag the Events of one trip and sort them by their parsed Dates. Free, and rejected because the ordering is inferred rather than stated. Two Stops dated "c. 52 CE" have no defined order, a Stop with no Date has no position at all, and the three missionary journeys overlap in both Place and time. The route is the data; it should not be a side effect of chronology.
- **Widening Event's `place:` to a list**, keeping one type. Rejected because it conflates two different facts: Paul's stay in Ephesus is a thing that happened at one Place, and a Journey is a course through many. An Event is already defined as happening "at a point or span in time" in one location.
- **A list of objects per Stop** (`places: [{place: "[[Antioch]]", note: "start"}]`), so a Stop could carry its own Passage, Date or comment. Legal YAML, and rejected on ADR 0003: Obsidian's property editor cannot edit nested objects, so the fallback client degrades to showing unreadable soup for the one Property that matters most on the page.
- **A JSON sidecar or a `.canvas`-style paired file**, following ADR 0009. Rejected because the reasoning there does not transfer: JSON Canvas needed pairing because it has nowhere to put a ULID. A Journey is markdown with frontmatter, so it can hold its own `id` and should.

## Consequences

- Route order is carried by the order of the `links` rows the `places:` Property produces, read back with `ORDER BY l.rowid` — the same insertion-order guarantee `event_links()` already relies on. That ordering is load-bearing: a re-index that rewrote those rows in a different order would silently reverse a Journey, so it is asserted by a test that round-trips a Journey through a re-index.
- The same Place may appear twice in one list, and the two occurrences are indistinguishable in the data. This is accepted: the route is the sequence, and the Map tells them apart by numbering the Stops rather than by making them different things.
- A Stop may name a document that does not resolve, resolves to a Place with no coordinates, or resolves to something that is not a Place. `journeys()` returns every Stop with its status rather than silently dropping the undrawable ones, and the Map draws through a gap while the Journey's Hub lists what it could not draw. Precedent: `unresolved_links` surfaces broken references, and a Board keeps a node whose file was deleted (ADR 0009) rather than removing something the user placed by hand.
- `journey` joins the type in every place a type is enumerated: `SUBJECT_TYPES`, `HUB_TYPES`, `CREATABLE_TYPES`, the Graph's filterable types, the Timeline's lane types, and both locale files. That breadth is the cost of being a real type, and it is the same cost Event pays.
- Nothing links an Event to the Journey it happened during. The two already meet at the Place and on the Timeline; a typed Event-to-Journey edge is a relational query, which is the Graph's job.
