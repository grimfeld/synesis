//! What the UI receives: the shapes the commands answer with, and the commands
//! whose work is more than a call on `Vault`.
//!
//! Shared by the Tauri shell and the browser test build (`crates/web`), so the
//! two cannot drift apart. Offsets here are UTF-16, which is what the editor
//! counts in; the engine itself works in bytes.

use crate::document::DocType;
use crate::index::{DocSummary, Linkable};
use crate::scripture::{Lang, Passage, Unit};
use crate::vault::DocumentView;
use crate::{parser, Vault};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize)]
pub struct PassageInfo {
    pub display: String,
    pub book: u8,
    pub start_chapter: u16,
    pub start_verse: Option<u16>,
    pub end_chapter: u16,
    pub end_verse: Option<u16>,
    pub unit: Unit,
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedRange {
    pub from: usize,
    pub to: usize,
    pub passages: Vec<PassageInfo>,
    pub inferred: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkRange {
    pub from: usize,
    pub to: usize,
    pub target: String,
    pub alias: Option<String>,
    pub embed: bool,
    pub property: Option<String>,
    pub resolved: Option<DocSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagRange {
    pub from: usize,
    pub to: usize,
    pub name: String,
    pub in_frontmatter: bool,
    pub resolved: Option<DocSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocumentPayload {
    pub summary: DocSummary,
    pub text: String,
    pub frontmatter: Map<String, Value>,
    pub body_offset: usize,
    pub links: Vec<LinkRange>,
    pub tags: Vec<TagRange>,
    pub references: Vec<DetectedRange>,
}

fn passage_info(p: &Passage, lang: Lang) -> PassageInfo {
    PassageInfo {
        display: p.display(lang),
        book: p.book,
        start_chapter: p.start_chapter,
        start_verse: p.start_verse,
        end_chapter: p.end_chapter,
        end_verse: p.end_verse,
        unit: p.unit(),
    }
}

/// A document as the editor draws it: text plus every decoration, resolved.
pub fn payload(v: &Vault, view: DocumentView) -> DocumentPayload {
    let text = &view.text;
    let u16 = |b: usize| parser::byte_to_utf16(text, b);
    let lang = v.lang();
    DocumentPayload {
        links: view
            .links
            .iter()
            .map(|l| LinkRange {
                from: u16(l.start),
                to: u16(l.end),
                target: l.target.clone(),
                alias: l.alias.clone(),
                embed: l.embed,
                property: l.property.clone(),
                resolved: v.resolve(&l.target).ok().flatten(),
            })
            .collect(),
        tags: view
            .tags
            .iter()
            .map(|t| TagRange {
                from: u16(t.start),
                to: u16(t.end),
                name: t.name.clone(),
                in_frontmatter: t.in_frontmatter,
                resolved: v.resolve(&t.name).ok().flatten(),
            })
            .collect(),
        references: view
            .references
            .iter()
            .map(|d| DetectedRange {
                from: u16(d.start),
                to: u16(d.end),
                passages: d.passages.iter().map(|p| passage_info(p, lang)).collect(),
                inferred: d.inferred,
            })
            .collect(),
        body_offset: u16(view.body_offset),
        summary: view.summary,
        text: view.text,
        frontmatter: view.frontmatter,
    }
}

/// Live detection for the editor: runs on the text as typed.
pub fn detect_passages(text: &str, lang: Lang) -> Vec<DetectedRange> {
    parser::detect(text)
        .into_iter()
        .map(|d| DetectedRange {
            from: parser::byte_to_utf16(text, d.start),
            to: parser::byte_to_utf16(text, d.end),
            passages: d.passages.iter().map(|p| passage_info(p, lang)).collect(),
            inferred: d.inferred,
        })
        .collect()
}

#[derive(Serialize)]
pub struct NameEntry {
    pub name: String,
    pub id: String,
    #[serde(rename = "type")]
    pub doc_type: DocType,
    pub alias: bool,
}

/// Every title and alias in the vault, for client-side link resolution and autocomplete.
pub fn names(v: &Vault) -> crate::Result<Vec<NameEntry>> {
    let mut out = Vec::new();
    for d in v.list(None)? {
        out.push(NameEntry {
            name: d.title.clone(),
            id: d.id.clone(),
            doc_type: d.doc_type,
            alias: false,
        });
        for a in v.aliases_of(&d.id)? {
            out.push(NameEntry {
                name: a,
                id: d.id.clone(),
                doc_type: d.doc_type,
                alias: true,
            });
        }
    }
    Ok(out)
}

/// Names in the text being written that could become Mentions.
///
/// Takes the live editor body rather than an id: what the writer is looking at
/// has usually not been saved yet, and the caller splices into this exact
/// string, so the offsets come back measured against it — in UTF-16, which is
/// what the editor counts in.
///
/// The body is passed without frontmatter, which is also why a Property
/// holding a name is never offered as prose.
pub fn linkables(v: &Vault, id: &str, text: &str) -> crate::Result<Vec<Linkable>> {
    let mut out = v.linkables(id, text)?;
    for l in &mut out {
        l.start = parser::byte_to_utf16(text, l.start);
        l.end = parser::byte_to_utf16(text, l.end);
    }
    Ok(out)
}

/// What one linking edit restored, so a batch can be undone.
#[derive(Serialize)]
pub struct LinkedEdit {
    pub id: String,
    /// The document's text before the edit.
    pub before: String,
}

/// The outcome of linking one or more Unlinked mentions.
#[derive(Serialize)]
pub struct LinkResult {
    /// Documents actually rewritten, with the text to restore on undo.
    pub linked: Vec<LinkedEdit>,
    /// Documents skipped because the file had changed since it was indexed.
    pub skipped: Vec<String>,
}

/// One Unlinked mention to link, as the panel lists it.
#[derive(Deserialize)]
pub struct MentionRef {
    pub doc_id: String,
    pub start: usize,
    pub end: usize,
    /// The matched text, checked against the file before anything is written.
    pub matched: String,
}

/// Link some Unlinked mentions of `target_id`.
///
/// One call whether the user clicked a single row or "Link all": a batch that
/// hits a stale offset skips that document and carries on rather than aborting
/// half-done, and reports what it skipped (ADR 0011).
pub fn link_mentions(v: &mut Vault, target_id: &str, mentions: &[MentionRef]) -> LinkResult {
    let mut linked = Vec::new();
    let mut skipped = Vec::new();
    for m in mentions {
        match v.link_mention(&m.doc_id, m.start, m.end, &m.matched, target_id) {
            Ok(before) => linked.push(LinkedEdit {
                id: m.doc_id.clone(),
                before,
            }),
            Err(_) => skipped.push(m.doc_id.clone()),
        }
    }
    LinkResult { linked, skipped }
}

/// Materialise (and return) the page for a Scripture unit, e.g. when the user
/// clicks a detected Passage that has not been written on yet.
pub fn ensure_scripture_page(
    v: &mut Vault,
    book: u8,
    chapter: Option<u16>,
    verse: Option<u16>,
) -> crate::Result<DocSummary> {
    let p = match (chapter, verse) {
        (None, _) => Passage::whole_book(book),
        (Some(c), None) => Passage::chapter(book, c),
        (Some(c), Some(vs)) => Passage::verse(book, c, vs),
    };
    v.materialise(&[p])?;
    v.scripture_doc(book, chapter, verse)?
        .ok_or_else(|| crate::Error::NotFound("scripture page".into()))
}

#[derive(Serialize)]
pub struct BookMeta {
    pub number: u8,
    pub name: String,
    pub english: String,
    pub chapters: Vec<u16>,
    pub hebrew_aramaic: bool,
}

pub fn books(lang: Lang) -> Vec<BookMeta> {
    crate::versification::BOOKS
        .iter()
        .map(|b| BookMeta {
            number: b.number,
            name: crate::names::book_name(b.number, lang).to_string(),
            english: b.english.to_string(),
            chapters: b.chapters.to_vec(),
            hebrew_aramaic: crate::scripture::is_hebrew_aramaic(b.number),
        })
        .collect()
}

/// Make the vault folder and the folders each document type is written to.
pub fn prepare_vault_folder(root: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(root)?;
    for folder in [
        "Notes",
        "Clippings",
        "Compositions",
        "Sources",
        "Scripture",
        "Places",
        "Characters",
        "Concepts",
        "Events",
        "Journeys",
        // Pictures the vault owns (ADR 0012). Referenced by `cover`, never
        // indexed: the scanner still reads `.md` only.
        "Attachments",
    ] {
        std::fs::create_dir_all(root.join(folder))?;
    }
    Ok(())
}
