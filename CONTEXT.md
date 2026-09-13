# Synesis

A local-first note-taking app for Bible study. The user reads Scripture, meditates, writes, collects material from other people's work, and composes their own talks and content from all of it. Everything lives in a Vault the user owns.

## Language

### Things the user writes

**Note**:
A piece of the user's own thinking, usually a meditation on a passage. The core unit of study.
_Avoid_: Entry, page, document (too generic)

**Clipping**:
A verbatim excerpt from a Source, kept as-is. The words are someone else's; the user only chose to keep them.
_Avoid_: Quote, snippet, highlight

**Composition**:
A talk or piece of content the user writes for others, by hand and from scratch. Notes are consulted while composing but are never copied into it; Clippings may be embedded so a quotation and its Source travel together.
_Avoid_: Talk, sermon, essay, article (these are kinds of Composition, not the term)

**Embed**:
A Clipping shown live inside a Composition. The Composition displays the Clipping's current text and Source rather than holding a copy.
_Avoid_: Transclusion, include

**Version**:
A named moment in a Composition's history, kept by the user ("as delivered, 2026-09-20"). A Version can be read, compared with the current text, or restored; restoring is a new edit, never a rewind. Not a separate document.
_Avoid_: Revision, snapshot, backup, draft

### Things the user collects

**Source**:
Someone else's work that the user studied, at whatever unit the user cites: a periodical, an issue, an article, a book, a chapter, a video, a talk. Has structured metadata (author, URL, date, type) and is cited by Notes and Clippings. A Source may sit inside a parent Source, so a chapter belongs to its book and an issue to its periodical, and a parent's page gathers everything cited from its descendants.
_Avoid_: Reference, resource, material, publication (a periodical is just a Source with children)

**Locator**:
Where within a Source a Clipping or Note was taken from: a paragraph, page, or timestamp. Lives on the citing document, not on the Source.
_Avoid_: Position, anchor

### Things the writing points at

**Subject**:
A thing in the Bible's world that Notes, Clippings and Compositions refer to. Every Subject has its own page with backlinks and a place in the graph. Subjects are either Scripture (Book, Chapter, Verse) or Topical (Place, Character, Concept, Event).
_Avoid_: Entity, topic page, node

**Book**:
One of the 66 books of the Bible, grouped into the Hebrew-Aramaic Scriptures and the Christian Greek Scriptures. Pre-seeded; its page comes into being the first time it is mentioned.
_Avoid_: Old Testament, New Testament

**Chapter**:
A chapter of a Book. Pre-seeded; its page comes into being the first time it is mentioned.

**Verse**:
A single verse of a Chapter. The finest unit of Scripture. Pre-seeded; its page comes into being the first time it is mentioned.

**Passage**:
A contiguous run of Scripture named as one unit, from a single Verse up to a whole Book. A Passage always resolves to the set of Verses it covers.
_Avoid_: Range, reference, pericope

**Mention**:
A link from one document to another. A Scripture Mention names a Passage and therefore links to every Verse in it, and is detected automatically. Every other Mention is written explicitly by the user, either inline in a sentence or as a Tag. Both forms are the same link and produce the same backlink.
_Avoid_: Reference (overloaded with Source), citation

**Tag**:
A Mention placed outside the prose, used when the target is relevant but naming it in a sentence would read badly. Any document can be tagged, and any Tag names a document, creating it if needed. Tags are not a separate kind of thing from links.
_Avoid_: Label, keyword, hashtag

**Place**:
A geographical location in the Bible's world, with a position on the map. Created manually by the user.
_Avoid_: Location

**Character**:
A person in the Bible's world. Created manually by the user.
_Avoid_: Person, figure

**Concept**:
An idea or theme the user studies across Scripture, such as grace or covenant. Created manually by the user.
_Avoid_: Topic, theme, idea

**Event**:
Something that happened in the Bible's world at a point or span in time, such as the Flood or Paul's stay in Ephesus. Has a Date, may name a Place and Characters, and sits on the Timeline. Created manually by the user.
_Avoid_: Happening, occurrence, milestone

**Date**:
A moment in the Bible's chronology, written the way a reader would say it: "c. 1513 BCE", "14 Nisan 33 CE", "52 CE". Carries its own precision (year, month, day) and whether it is approximate. A Date is never rewritten; the app only reads it. A pair of Dates makes a span.
_Avoid_: Timestamp, year (a year is one precision of Date)

**Property**:
A named, typed value on a document's front matter, such as a Place's latitude or a Character's `born` Date. A property name means the same thing and has the same type everywhere in the Vault; the user chooses the type once, the first time the name is used. Types: text, number, Date, calendar date (today's world), link, list, checkbox.
_Avoid_: Field, attribute, metadata (Source metadata is a set of Properties)

### Kinds of page

**Writing**:
A page whose body is the point: a Note, a Clipping or a Composition. Opens in the editor.
_Avoid_: Document (every page is a document), content page

**Hub**:
A page that gathers what points at it: a Source or any Subject. Opens as a view (metadata, reading trail, mentions, backlinks); its body is an optional "About" the user may fill or ignore.
_Avoid_: Index page, landing page, entity page

### Where things live

**Vault**:
The folder that holds every document as a markdown file. The user owns it; the app is an index over it. Obsidian opens the same folder.
_Avoid_: Library, workspace, database

**Device**:
One installation of the app on one machine or phone. Each Device writes its own sync snapshots into the Vault and reads the others'; merging happens on the Device, never in the cloud.
_Avoid_: Client, node, peer

**Pairing**:
Making two Devices trust each other for one Vault by scanning or pasting an Invite, then approving the newcomer on an already paired Device. Done once per Device per Vault; afterwards the Devices sync directly whenever both are online.
_Avoid_: Linking, connecting, registering

**Invite**:
The QR code or short text code a paired Device shows so another Device can request to join a Vault. Valid until revoked; joining still needs approval.
_Avoid_: Ticket, token, key

### Things the user does in the app

**Home**:
The view the app opens on: recent documents, a quick-capture box, and Compositions in progress. Not a document.
_Avoid_: Dashboard, start page, landing

**Timeline**:
The view that lays every dated thing along the Bible's chronology: Events, and each Subject that carries a Date, on its own lane. Zooms from millennia to a single year.
_Avoid_: Chronology (that is the subject matter), history view, Gantt

**Candidate**:
A document that shares a Tag or a Passage with a Composition and is not yet Mentioned by it: material the writer might still pull in. Once the Composition Mentions it (inline, as an Embed, or as a Tag) it stops being a Candidate and counts as used. Placing it on the Composition's Board does not: the Board is where nothing is committed yet, so a Candidate there is marked as on the Board and stays a Candidate.
_Avoid_: Suggestion, related, recommendation

**Board**:
A spatial arrangement of the material for one Composition: the writer's own bubbles, documents from the Vault, and labelled groups, laid out by hand. Where a talk is thought out before it is written. Every Composition may have one, stored beside it as a JSON Canvas file that Obsidian opens as a canvas of its own.
_Avoid_: Canvas (that is the file format on disk), Mind map, Map (that is the Places view), Whiteboard

**Command**:
A named action the user can run from the Command Palette ("New Clipping", "Toggle Source mode", "Go to Graph"). Commands may also have a keyboard shortcut; the shortcut is a way to run the command, not a separate thing.
_Avoid_: Action, verb, hotkey

**Command Palette**:
The single search box that finds documents by default and runs Commands when the query starts with `>`.
_Avoid_: Quick switcher, launcher, omnibox

**Live Preview**:
The default editing mode: markdown syntax is hidden and rendered except on the line being edited. The text underneath is unchanged.
_Avoid_: WYSIWYG, rich text, rendered mode

**Source mode**:
The editing mode that shows the raw markdown of a document exactly as stored.
_Avoid_: Raw mode, text mode, code view
