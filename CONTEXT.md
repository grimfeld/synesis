# Synesis

A local-first note-taking app for Bible study. The user reads Scripture, meditates, writes, collects material from other people's work, and composes their own talks and content from all of it. Everything lives in a Vault the user owns.

## Language

### Things the user writes

**Note**:
A piece of the user's own thinking, usually a meditation on a passage. The core unit of study.
_Avoid_: Entry, page, document (too generic)

**Clipping**:
A verbatim excerpt from a Source, kept as-is. The words are someone else's; the user only chose to keep them. A Clipping has no title, because naming someone else's words is the user's commentary rather than the excerpt: it is known by its own text, and identified by its Citation. It always names exactly one Source and carries a Locator.
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
Someone else's work that the user studied, at whatever unit the user cites: a periodical, an issue, an article, a book, a chapter, a video, a talk. Has structured metadata (kind, URL, date, Cover) and is cited by Notes and Clippings. A Source may sit inside a parent Source, so a chapter belongs to its book and an issue to its periodical, and a parent's page gathers everything cited from its descendants. Its page is also where Clippings and Notes citing it are written, so a sitting with one chapter does not mean leaving it.
_Avoid_: Reference, resource, material, publication (a periodical is just a Source with children)

**Library**:
The view that shows every Source the user holds, arranged on Shelves. Browsing, not searching: it answers "what do I have?" rather than "where was that quote?". Only top-level Sources appear; a child is reached through its parent.
_Avoid_: Catalogue, collection, bookshelf (one Shelf is not the Library)

**Clippings**:
The view that shows every Clipping as its own text, newest first, narrowed by Tag or by Source. Answers "where was that quote?", the question the Library deliberately does not: the Library is browsed when the user knows what they read, the Clippings view when they remember only what was said.
_Avoid_: Quotes, Commonplace, Excerpts

**Shelf**:
A row of the Library holding every top-level Source of one kind: all the books together, all the videos together. Kinds that only ever sit inside something else, like a chapter or an issue, never get a Shelf. A Source whose kind has no Shelf, or that is missing the parent it needs, waits on the Unshelved row until the user files it.
_Avoid_: Category, section, group, collection

**Cover**:
The picture that stands for a Source in the Library. May be a picture on the web, a picture kept in the vault, or, when the user has given neither, one the app draws from the Source's own title, kind and date. Every Source has a Cover; only some have a picture.
_Avoid_: Image, thumbnail, artwork, poster

**Locator**:
Where within a Source a Clipping or Note was taken from: a paragraph, page, or timestamp. Lives on the citing document, not on the Source.
_Avoid_: Position, anchor

**Citation**:
The Source and Locator a Clipping names, said the way a reader would say it: "Keep Enduring with Joy, par. 12". A Clipping has no title, so its Citation is what identifies it — as its file's name, and as the text shown wherever it is linked from another document. Two Clippings may carry the same Citation, so the file's name also carries the moment it was kept.
_Avoid_: Reference (overloaded with Source), title (a Clipping has none)

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

**Backlink**:
A document that Mentions this one, seen from the page being Mentioned. One Backlink however many times that document Mentions the page: the list answers "who points here", and the Mentions inside it are occurrences of the one answer. Counting Backlinks therefore counts documents, not Mentions. (The engine's `Backlink` row is one Mention, not one Backlink — it predates this entry, and renaming it would change a serialised type for a vocabulary reason.)

**Mention**:
A link from one document to another. A Scripture Mention names a Passage and therefore links to every Verse in it, and is detected automatically. Every other Mention is written explicitly by the user, either inline in a sentence or as a Tag. Both forms are the same link and produce the same backlink.
_Avoid_: Reference (overloaded with Source), citation (a Citation names a Source and a Locator; a Mention is a link, and most Mentions cite nothing)

**Tag**:
A Mention placed outside the prose, used when the target is relevant but naming it in a sentence would read badly. Any document can be tagged, and any Tag names a document, creating it if needed. Tags are not a separate kind of thing from links.
_Avoid_: Label, keyword, hashtag

**Unlinked mention**:
A Mention that isn't: text in another document that matches this Hub's name or one of its aliases but was never written as a link. Shown on the Hub it names, so the user can see who talks about it without pointing at it, and link it if it is worth linking.
_Avoid_: Unlinked reference, ghost link, potential backlink

**Linkable**:
A name in the document being written that matches a Topical Subject or a Source and is not yet a Mention. Shown while writing, so the user can turn it into a Mention in place. The mirror of an Unlinked mention, seen from the other end: the same documents that gather Unlinked mentions are the ones that can appear as a Linkable. Scripture is never Linkable, because a Passage is already a Mention.
_Avoid_: Link suggestion, autolink, loose name

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

**Journey**:
An ordered course through Places that someone in the Bible's world travelled, such as Paul's second missionary journey or Israel's route out of Egypt. Names its Stops in order, carries a Date span, and so sits on the Map as a route and on the Timeline as a span. Created manually by the user.
_Avoid_: Route, Trip, Itinerary, Travels

**Stop**:
One Place on a Journey, at one position in its order. The same Place may be Stopped at more than once, so a Journey that returns where it began names that Place twice.
_Avoid_: Leg, Waypoint, Station

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
A page that gathers what points at it: a Source or any Subject. Opens as a view (metadata, Clippings, reading trail, mentions, backlinks); its body is an optional "About" the user may fill or ignore. A Source's Hub is where its Clippings are read, since a Clipping belongs to its Source in a way that a Note merely citing it does not.
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
The view the app opens on: recent documents, a quick-capture box, and Compositions in progress. Not a document. Home's quick capture is for a thought that belongs to no Source; the same box on a Source's page keeps a passage from the work being read.
_Avoid_: Dashboard, start page, landing

**Timeline**:
The view that lays every dated thing along the Bible's chronology: Events, and each Subject that carries a Date, on its own Lane. Zooms from millennia to a single year, and narrows to the Lanes worth seeing by type, Tag, Property name, title, or what the current zoom covers.
_Avoid_: Chronology (that is the subject matter), history view, Gantt

**Lane**:
One row of a Timeline: the Events Lane on top, then one per dated Subject. A Subject's Lane carries its own Dates and every Event naming it. A Subject's Hub shows the same Lane in miniature.
_Avoid_: Row, track, swimlane

**Cluster**:
Marks that fall too close together to draw apart, shown as one mark carrying how many it stands for. Zooming or opening it reveals the members. Spans are never Clustered.
_Avoid_: Group, bundle, stack

**Candidate**:
A document that shares a Tag or a Passage with a Composition and is not yet Mentioned by it: material the writer might still pull in. Once the Composition Mentions it (inline, as an Embed, or as a Tag) it stops being a Candidate and counts as used. Placing it on the Composition's Board does not: the Board is where nothing is committed yet, so a Candidate there is marked as on the Board and stays a Candidate.
_Avoid_: Suggestion, related, recommendation

**Board**:
A spatial arrangement of the material for one Composition: the writer's own bubbles, documents from the Vault, and labelled groups, laid out by hand. Where a talk is thought out before it is written. Every Composition may have one, stored beside it as a JSON Canvas file that Obsidian opens as a canvas of its own.
_Avoid_: Canvas (that is the file format on disk), Mind map, Map (that is the Places view), Whiteboard

**Board excerpt**:
The few lines of a document's own text shown on the card that stands for it on a Board: a Clipping's quote, a Note's opening line, or the section a card points at. A snapshot taken when the Board is read, not a live view — a Board never renders the documents it holds. A Hub with nothing to quote shows how many documents mention it instead.
_Avoid_: Embed (that is live, and belongs to Compositions), Preview, Summary, Snippet

**Map**:
The view that plots every Place with coordinates, and draws Journeys as routes through their Stops. Narrows to the Places worth seeing by Tag, title, the Book they are mentioned in, and whether anything mentions them at all.
_Avoid_: Atlas, Globe, Geography view

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
