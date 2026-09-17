//! What the UI is allowed to ask the index, as a value.
//!
//! Before this, every read question was spelled out four times: a method on
//! `Index`, a one-line forward on `Vault`, a `#[tauri::command]` that called
//! the forward, and an arm in the debug bridge's hand-written dispatch — plus
//! a method in `api.ts` naming the command as a string. Three of those five
//! added nothing but the name, and the bridge is the one that got forgotten
//! (`set_map_filters` shipped without an arm and only failed in the browser).
//!
//! So a read is a `Query` and its result is an `Answer`, and both cross the
//! serialisation boundary as tagged unions (ADR 0004: the API stays small and
//! document-shaped). Adding a question means adding a variant; the compiler
//! then asks for the arm, which is the part a person forgets.
//!
//! This is a question language, not a query builder: each variant names a
//! question the index already knows how to answer, and dispatch in
//! `Vault::query` calls the same `Index` method as before. `index.rs` and its
//! tests are untouched by design — the waste was in the repetition above it.
//!
//! Not everything the UI reads is here. CRDT reads (Versions, history, a
//! Board) need `&mut` for Loro and read the sync layer rather than the index;
//! writes, settings, attachments and Pairing are their own operations. They
//! keep their own commands, because they are different questions, not the
//! same question wearing a different name.
//!
//! `linkables` is out for a different reason: the engine counts in bytes and
//! CodeMirror counts in UTF-16, so its answer is re-projected offset by offset
//! before it reaches the editor. That is a conversion for one caller, not a
//! question the index answers, and it stays in the command that does it.
use crate::document::DocType;
use crate::index::{
    AmbiguousTitle, Backlink, BoardExcerpt, Candidate, CoverageCell, DatedProperty, DocSummary,
    DocTag, EventLink, Graph, GraphLevel, Journey, LibraryEntry, PlaceFact, SearchHit, TrailEntry,
    UnlinkedMentions, UnresolvedLink,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// How many Candidates a Composition offers before the list is cut (PLAN §17).
pub const CANDIDATE_LIMIT: usize = 50;
/// How many Unlinked mentions a Hub gathers before it stops looking (ADR 0011).
pub const UNLINKED_LIMIT: usize = 200;
/// How many Linkables are offered for the document being written (ADR 0011).
pub const LINKABLE_LIMIT: usize = 50;

/// A question for the index.
///
/// A limit is a field with a default rather than a number buried in a
/// forwarding method, so the cap is visible where the question is asked.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Query {
    /// Every document, or every document of one type.
    List { doc_type: Option<DocType> },
    /// Every Place that has coordinates, for the Map.
    Places,
    /// Every Source, with what the Library needs to draw a Shelf of Covers.
    Library,
    /// Every Clipping as its own words, or only those citing one Source.
    Clippings { source_id: Option<String> },
    /// The documents that Mention this one.
    Backlinks { id: String },
    /// What was kept from this Source and everything inside it (PLAN §18).
    SourceTrail { id: String },
    /// The Sources sitting inside this one, however deep.
    SourceChildren { id: String },
    /// The Tags on each of these documents, for filtering a list in hand.
    TagsOf { ids: Vec<String> },
    /// Links that name a document the vault does not hold.
    UnresolvedLinks,
    /// The Compositions whose Board holds this document (PLAN §17.6).
    BoardsReferencing { id: String },
    /// What each Board card shows for its document (PLAN §17.12).
    BoardExcerpts { refs: Vec<BoardRef> },
    /// Text in other documents that names this Hub but never linked to it
    /// (ADR 0011). `limit` caps the search, and the answer carries the real
    /// total so the Hub can say how many it did not show.
    UnlinkedMentions {
        id: String,
        #[serde(default = "unlinked_limit")]
        limit: usize,
    },
    /// Titles more than one document answers to, so a link can say which.
    AmbiguousTitles,
    /// Material sharing a Tag or a Passage with this Composition (PLAN §17).
    Candidates {
        id: String,
        #[serde(default = "candidate_limit")]
        limit: usize,
    },
    /// The whole graph at one level of Scripture detail (ADR 0002).
    Graph { level: GraphLevel },
    /// Full-text search.
    Search { text: String, limit: usize },
    /// Titles beginning with a prefix, for completion.
    Suggest { prefix: String, limit: usize },
    /// Every Tag in the vault with how many documents carry it.
    Tags,
    /// The documents carrying one Tag.
    Tagged { tag: String },
    /// How many Mentions each Chapter of the Bible has (PLAN §15).
    Coverage,
    /// How many Mentions each Verse of one Chapter has.
    VerseCoverage { book: u8, chapter: u16 },
    /// The documents Mentioning a Passage, at whatever unit it names.
    VerseMentions {
        book: u8,
        chapter: Option<u16>,
        verse: Option<u16>,
    },
    /// The page for a Book, Chapter or Verse, if it has come into being.
    ScripturePage {
        book: u8,
        chapter: Option<u16>,
        verse: Option<u16>,
    },
    /// Every Date-typed Property on one document (ADR 0005).
    DatesOf { id: String },
    /// Every parsed Date in the vault, earliest first, for the Timeline.
    Timeline,
    /// Events whose `place` or `characters` Property names this document.
    EventsNaming { id: String },
    /// Every (Event, Subject) pair, for the Timeline's Lanes.
    EventLinks,
    /// Every (document, Tag) pair over dated documents, for the Timeline filter.
    TimelineTags,
    /// Every Journey with its Stops in travel order (ADR 0010).
    Journeys,
    /// Tags, Books and mention counts per Place, for the Map's filters.
    PlaceFacts,
}

fn unlinked_limit() -> usize {
    UNLINKED_LIMIT
}
fn candidate_limit() -> usize {
    CANDIDATE_LIMIT
}

/// One `file` node's identity on a Board: which document, and which part of it.
///
/// Named here rather than left as a `(String, Option<String>)` for the Tauri
/// layer to christen on its way past.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardRef {
    pub path: String,
    pub subpath: Option<String>,
}

/// What the index answered.
///
/// One variant per result shape rather than per question, so two questions
/// that answer with the same thing share an arm. The tag is what lets the UI
/// narrow the type on its side.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Answer {
    Docs(Vec<DocSummary>),
    Library(Vec<LibraryEntry>),
    Entries(Vec<TrailEntry>),
    Backlinks(Vec<Backlink>),
    UnresolvedLinks(Vec<UnresolvedLink>),
    TagsOf(HashMap<String, Vec<String>>),
    BoardExcerpts(HashMap<String, BoardExcerpt>),
    UnlinkedMentions(UnlinkedMentions),
    AmbiguousTitles(Vec<AmbiguousTitle>),
    Candidates(Vec<Candidate>),
    Graph(Graph),
    Search(Vec<SearchHit>),
    Tags(Vec<TagCount>),
    Coverage(Vec<CoverageCell>),
    VerseCoverage(Vec<VerseCount>),
    Doc(Option<DocSummary>),
    Dates(Vec<DatedProperty>),
    EventLinks(Vec<EventLink>),
    DocTags(Vec<DocTag>),
    Journeys(Vec<Journey>),
    PlaceFacts(Vec<PlaceFact>),
}

/// How many Mentions one Verse has.
///
/// Named here rather than returned as a `(u16, u32)` for the Tauri layer to
/// christen on its way past.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerseCount {
    pub verse: u16,
    pub count: u32,
}

/// One Tag and how many documents carry it.
///
/// Named here rather than returned as a `(String, u32)` for the Tauri layer
/// to christen on its way past.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagCount {
    pub tag: String,
    pub count: u32,
}
