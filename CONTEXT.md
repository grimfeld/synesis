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
A person in the Bible's world. May carry a Span — their lifespan, as `born` and `died` — and so sit on the Timeline. Created manually by the user.
_Avoid_: Person, figure

**Concept**:
An idea or theme the user studies across Scripture, such as grace or covenant. Created manually by the user.
_Avoid_: Topic, theme, idea

**Event**:
Something that happened in the Bible's world at a point or a Span in time, such as the Flood or Paul's stay in Ephesus. Has a Date, or a Span as `start` and `end`; may name a Place and Characters; sits on the Timeline. Created manually by the user.
_Avoid_: Happening, occurrence, milestone

**Journey**:
An ordered course through Places that someone in the Bible's world travelled, such as Paul's second missionary journey or Israel's route out of Egypt. Names its Stops in order, carries a Span as `start` and `end`, and so sits on the Map as a route and on the Timeline as a span. Created manually by the user.
_Avoid_: Route, Trip, Itinerary, Travels

**Stop**:
One Place on a Journey, at one position in its order. The same Place may be Stopped at more than once, so a Journey that returns where it began names that Place twice.
_Avoid_: Leg, Waypoint, Station

**Date**:
A moment in the Bible's chronology, written the way a reader would say it: "c. 1513 BCE", "14 Nisan 33 CE", "52 CE". Carries its own precision (year, month, day) and whether it is approximate. A Date is never rewritten; the app only reads it. A pair of Dates makes a Span.
_Avoid_: Timestamp, year (a year is one precision of Date)

**Span**:
The stretch between a pair of Dates: a Character's lifespan, an Event's or a Journey's duration. One concept whichever it is, carried by two Date Properties whose names differ by what the Span is of — a Character is `born` and `died`, an Event and a Journey `start` and `end`. A Span is recognised, never declared: the user writes two Dates and the app sees the Span in them, so there is nothing named "span" to fill in. Recognised on any page that carries such a pair, so a Character with a reign has that Span too; each kind of page only *suggests* the pair conventional for it.
_Avoid_: Lifespan or duration (both are what a particular Span is of, not a second term), period, range, interval

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
The folder that holds every document as a markdown file. The user owns it; the app is an index over it. Obsidian opens the same folder. A Vault knows its own name and carries an identity of its own, so that two of them can never be mistaken for each other: a Device may hold several and the same Vault may sit at a different path on each Device. On a phone the Device chooses that path from the Vault's name, and chooses somewhere the user can reach with their file manager, so the folder is never hidden from the person who owns it.
_Avoid_: Library, workspace, database

**Vault id**:
What makes a Vault itself rather than whatever folder it happens to sit in. Written once when the Vault comes into being and never changed, so a Device joining one can refuse a folder that already holds another. A Vault that predates ids is given one the first time it is opened.
_Avoid_: Folder name, path (both change per Device and per whim)

**Known Vault**:
A Vault this Device holds: its name, its id, and where it sits here. The user adds one by making it or by joining it, and removes it deliberately; it is what the Vault switcher lists. Not a history of what was opened lately, which is why opening something else can never push a Vault out of the list.
_Avoid_: Recent, workspace list

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

**Delivery view**:
The full-screen view a Composition is given from: its text, its Board, or both side by side where the screen fits them, with a timer and nothing else. Nothing in it can be edited, and nothing in it navigates away: a Passage, a link or a card on the Board opens over the view rather than leaving it. The timer counts down from the Composition's duration when it has one, and up from zero when it does not.
_Avoid_: Presentation mode, presenter view, slideshow, teleprompter

**Map**:
The view that plots every Place with coordinates, and draws Journeys as routes through their Stops. Narrows to the Places worth seeing by Tag, title, the Book they are mentioned in, and whether anything mentions them at all.
_Avoid_: Atlas, Globe, Geography view

**Command**:
A named action the user can run from the Command Palette ("New Clipping", "Toggle Source mode", "Go to Graph"). Commands may also have a keyboard shortcut; the shortcut is a way to run the command, not a separate thing.
_Avoid_: Action, verb, hotkey

**Command Palette**:
The single search box that finds documents by default and runs Commands when the query starts with `>`.
_Avoid_: Quick switcher, launcher, omnibox

**Tutorial**:
A short explanation of one feature, in the app's language, opened from the views where that feature is used or from the Command Palette. Every Tutorial ends by having the user do the thing once, for real in their own Vault, so they leave having used the feature rather than read about it. A step may add to what the user has or create something new, saying so; it never changes what the user already wrote. Setting up sync is a feature like any other, so its Tutorials are Tutorials too, with a variant per platform.
_Avoid_: Help page, guide, walkthrough, docs

**Live Preview**:
The default editing mode: markdown syntax is hidden and rendered except on the line being edited. The text underneath is unchanged.
_Avoid_: WYSIWYG, rich text, rendered mode

**Source mode**:
The editing mode that shows the raw markdown of a document exactly as stored.
_Avoid_: Raw mode, text mode, code view

**Appearance mode**:
Whether the app shows the light or the dark side of the active Skin, or follows the operating system's setting.
_Avoid_: Theme, colour scheme, dark mode (that is one value of it)

**Skin**:
A named, shareable look for the app: colours and typography for a light side and a dark side, either of which may be left to the default. A Device holds several and wears one at a time. The built-in Skin cannot be edited; editing it makes a copy.
_Avoid_: Theme (that word belongs to Concept), Style, Palette

**Text scale**:
How large this Device draws text, as a percentage applied on top of the active Skin's sizes. Set per Device, because it is about the screen and the reader's eyes rather than the look.
_Avoid_: Zoom, font size (that belongs to the Skin)

**Reading mode**:
A lock on a Writing that stops it being edited, whichever of Live Preview or Source mode is showing. Nothing can be typed, and a phone's keyboard never comes up; the title, Tags and Properties are fixed. Links, Passages and Embeds still open, the text can be selected and copied, and a checkbox can still be ticked, so a checklist stays usable. A Board opens for reading too, rather than for arranging. Set once per Device and kept, since a phone is mostly for reading and a desktop for writing.
_Avoid_: Read-only mode, Reading view, locked mode
