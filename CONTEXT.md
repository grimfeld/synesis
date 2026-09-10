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

### Things the user collects

**Source**:
Someone else's work that the user studied, at whatever unit the user cites: a periodical, an issue, an article, a book, a chapter, a video, a talk. Has structured metadata (author, URL, date, type) and is cited by Notes and Clippings. A Source may sit inside a parent Source, so a chapter belongs to its book and an issue to its periodical, and a parent's page gathers everything cited from its descendants.
_Avoid_: Reference, resource, material, publication (a periodical is just a Source with children)

**Locator**:
Where within a Source a Clipping or Note was taken from: a paragraph, page, or timestamp. Lives on the citing document, not on the Source.
_Avoid_: Position, anchor

### Things the writing points at

**Subject**:
A thing in the Bible's world that Notes, Clippings and Compositions refer to. Every Subject has its own page with backlinks and a place in the graph. Subjects are either Scripture (Book, Chapter, Verse) or Topical (Place, Character, Concept).
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
