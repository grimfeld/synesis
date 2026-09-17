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
use crate::document::DocType;
use crate::index::{
    Backlink, DocSummary, LibraryEntry, TrailEntry,
};
use serde::{Deserialize, Serialize};

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
}
