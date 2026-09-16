//! SQLite index over the vault: documents, aliases, links, tags, Scripture
//! Mentions and full-text search. Rebuilt from files; never the source of truth.

use crate::dates::{BibleDate, Precision};
use crate::document::{DocType, ParsedDoc};
use crate::excerpt;
use crate::names;
use crate::scripture::{Lang, Passage, VerseId};
use crate::unlinked;
use crate::Result;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocSummary {
    pub id: String,
    pub path: String,
    pub title: String,
    /// What to show where only one line fits: a Clipping's own words, every
    /// other type's title (ADR 0013). Never empty, so a caller can render it
    /// without falling back to `title` itself.
    pub label: String,
    #[serde(rename = "type")]
    pub doc_type: DocType,
    pub mtime: i64,
    pub book: Option<u8>,
    pub chapter: Option<u16>,
    pub verse: Option<u16>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    /// Earliest Verse this document mentions, for canonical ordering.
    pub first_verse: Option<u32>,
    /// An Event's `start` Date as written (ADR 0005); `None` on every other type.
    pub start: Option<String>,
    /// An Event's `end` Date as written; `None` when absent or on every other type.
    pub end: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BacklinkKind {
    Link,
    Embed,
    Tag,
    Property,
    Mention,
}

/// How a Board excerpt is addressed: the document's path and the part of it
/// the node names.
///
/// Not the path alone. A Board may hold the same document twice — the whole
/// thing in one card and one of its sections in another — and those two cards
/// do not show the same text, so a path-keyed map would collapse them into
/// whichever was written last.
pub fn board_excerpt_key(path: &str, subpath: Option<&str>) -> String {
    match subpath {
        Some(s) if !s.is_empty() => format!("{path}\u{1}{s}"),
        _ => path.to_string(),
    }
}

/// What one Board card shows for its document (PLAN §17.12).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoardExcerpt {
    /// The opening body text, plain and capped. Empty when the document has
    /// no prose to show.
    pub text: String,
    /// The node named a `subpath` that no longer resolves. The card shows the
    /// document's opening text instead and flags it, rather than silently
    /// showing something other than what was pinned (PLAN §17.13).
    pub subpath_missing: bool,
    /// Inbound link count, for a Subject Hub whose body says nothing. `None`
    /// for every other document, and for a Hub that does have prose.
    pub mentions: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Backlink {
    pub doc: DocSummary,
    pub kind: BacklinkKind,
    /// For Mentions: the Passage as the linking document names it ("via Romans 8").
    pub via: Option<String>,
    pub property: Option<String>,
    pub excerpt: String,
    pub start: usize,
    pub inferred: bool,
}

/// One place where a document writes another's name without linking it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlinkedMention {
    pub doc: DocSummary,
    /// Byte offsets into the document's **body**, not the whole file.
    pub start: usize,
    pub end: usize,
    /// The text exactly as written, which the inserted link must preserve.
    pub matched: String,
    pub excerpt: String,
}

/// The Unlinked mentions shown for a Hub, and how many there really are.
///
/// `total` counts past the cap: a Concept named "Grace" can occur hundreds of
/// times, and the header should say so even though the list stops at `limit`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UnlinkedMentions {
    pub items: Vec<UnlinkedMention>,
    pub total: u32,
}

/// A name in the document being written that could become a Mention.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Linkable {
    pub doc: DocSummary,
    /// How many unlinked occurrences remain; the link is inserted at the
    /// first. A target already linked anywhere in the document is not offered
    /// at all, so this never counts down — the row goes after one link.
    pub count: u32,
    pub start: usize,
    pub end: usize,
    pub matched: String,
    /// Non-empty when the title is shared by several documents, in which case
    /// the user picks before anything is written (ADR 0011).
    pub ambiguous: Vec<DocSummary>,
}

/// A title carried by more than one document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmbiguousTitle {
    pub title: String,
    pub docs: Vec<DocSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageCell {
    pub book: u8,
    pub chapter: u16,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub doc_type: DocType,
    /// Set when the node is a document (materialised Scripture pages included).
    pub doc_id: Option<String>,
    pub degree: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GraphLevel {
    Book,
    Chapter,
    Verse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub doc: DocSummary,
    pub snippet: String,
}

/// One Date-typed Property on a document (ADR 0005). `date` is `None` when the
/// text did not parse; the page shows a warning and the Timeline skips it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatedProperty {
    pub doc: DocSummary,
    pub name: String,
    pub text: String,
    pub date: Option<BibleDate>,
    pub precision: Option<Precision>,
}

/// An Event naming a Subject through its `place` or `characters` Property.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventLink {
    pub event: String,
    pub subject: String,
}

/// One Tag carried by a dated document: the Timeline's Tag filter (PLAN §17).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocTag {
    pub doc: String,
    pub tag: String,
}

/// Why a Stop cannot be drawn on the Map, or `Ok` when it can (PLAN §19.8).
/// Every Stop is reported, drawable or not: the polyline skips the ones it
/// cannot draw, and the Journey's Hub lists them so nothing vanishes silently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopStatus {
    Ok,
    /// Resolves to a Place that has no coordinates yet.
    NoCoords,
    /// Names a document that does not exist.
    Unresolved,
    /// Names a document that exists but is not a Place.
    NotAPlace,
}

/// One Stop on a Journey: the Place named at one position in the route, with
/// whatever the engine could resolve it to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JourneyStop {
    /// The link target as written, so an unresolved Stop can still be named.
    pub target: String,
    pub doc: Option<DocSummary>,
    pub status: StopStatus,
}

/// A Journey and its Stops in travel order (ADR 0010).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Journey {
    pub doc: DocSummary,
    pub stops: Vec<JourneyStop>,
}

/// What the Map's filters need to know about one Place beyond its summary
/// (PLAN §19.5): its own Tags, the Books it is mentioned in, and how many
/// documents mention it at all.
///
/// A Place carries no Scripture Mention of its own — the `mentions` rows belong
/// to the documents that cite a Passage. So "Corinth is mentioned in Acts"
/// means: some document links to Corinth *and* mentions a Passage in Acts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlaceFact {
    pub doc: String,
    pub tags: Vec<String>,
    pub books: Vec<u8>,
    pub mentions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candidate {
    pub doc: DocSummary,
    pub shared_tags: Vec<String>,
    pub shared_passages: Vec<String>,
    pub score: u32,
    /// The Composition already Mentions this document (inline link, Embed or
    /// Tag naming it), so it is used material rather than a Candidate.
    pub used: bool,
    /// The document sits on the Composition's Board. A third state between
    /// unused and used: placed, but not yet committed to the talk (PLAN §17.6).
    pub on_board: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrailEntry {
    pub doc: DocSummary,
    pub source: DocSummary,
    pub locator: Option<String>,
}

/// One Source as the Library draws it: enough to place it on a Shelf and put a
/// Cover on it, without a round-trip per card (ADR 0012).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LibraryEntry {
    pub id: String,
    pub title: String,
    /// The `kind` property as written, or empty. Never validated here: the
    /// vault is hand-editable, so an unknown kind is the UI's problem to
    /// shelve, not the engine's to reject (ADR 0003).
    pub kind: String,
    /// The `cover` property as written: a URL, a vault-relative path, or
    /// empty for a Cover the app draws.
    pub cover: String,
    /// The `date` property as written; loosely formatted by design (ADR 0005).
    pub date: String,
    /// The Source this one sits inside, resolved to an id. `None` makes it
    /// top-level, and only top-level Sources reach a Shelf.
    pub parent_id: Option<String>,
    /// How many Sources name this one as their parent; the card's "12
    /// chapters". Direct children only, not descendants.
    pub child_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnresolvedLink {
    pub target: String,
    pub count: u32,
}

/// Normalisation shared by titles, aliases, link targets and tags so that
/// `#undeserved-kindness` finds "Undeserved kindness".
pub fn norm(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_space = true;
    for c in s.trim().chars() {
        let c = if c == '-' || c == '_' { ' ' } else { c };
        if c.is_whitespace() {
            if !last_space {
                out.push(' ');
            }
            last_space = true;
        } else {
            for l in c.to_lowercase() {
                out.push(l);
            }
            last_space = false;
        }
    }
    out.trim_end().to_string()
}

fn last_segment(target: &str) -> &str {
    target.rsplit('/').next().unwrap_or(target)
}

pub struct Index {
    conn: Connection,
}

const SCHEMA: &str = r#"
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=OFF;
CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  -- What to show where only one line fits. A copy of `title` for every type
  -- but Clipping, which has no title and is known by its own text (ADR 0013).
  -- Deliberately not `title`: `title_norm` resolves `[[links]]`, and quoted
  -- prose in there makes link targets match the middle of someone's sentence.
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  frontmatter TEXT NOT NULL,
  text TEXT NOT NULL,
  body_offset INTEGER NOT NULL,
  book INTEGER, chapter INTEGER, verse INTEGER,
  lat REAL, lon REAL
);
CREATE INDEX IF NOT EXISTS documents_title_norm ON documents(title_norm);
CREATE INDEX IF NOT EXISTS documents_type ON documents(type);
CREATE INDEX IF NOT EXISTS documents_scripture ON documents(book, chapter, verse);
CREATE TABLE IF NOT EXISTS aliases(doc_id TEXT NOT NULL, alias TEXT NOT NULL, norm TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS aliases_norm ON aliases(norm);
CREATE INDEX IF NOT EXISTS aliases_doc ON aliases(doc_id);
-- `kind` separates prose links from Board refs (PLAN §17.6): a document
-- dragged onto a Composition's Board is referenced but not used, so
-- `candidates` counts prose only.
CREATE TABLE IF NOT EXISTS links(from_id TEXT NOT NULL, target TEXT NOT NULL, norm TEXT NOT NULL, alias TEXT, embed INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, property TEXT, kind TEXT NOT NULL DEFAULT 'prose');
CREATE INDEX IF NOT EXISTS links_norm ON links(norm);
CREATE INDEX IF NOT EXISTS links_from ON links(from_id);
-- links_kind is created by `migrate`, not here: this batch runs before it, and
-- on an existing database the column does not exist yet.
CREATE TABLE IF NOT EXISTS tags(doc_id TEXT NOT NULL, tag TEXT NOT NULL, norm TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, in_frontmatter INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS tags_norm ON tags(norm);
CREATE INDEX IF NOT EXISTS tags_doc ON tags(doc_id);
CREATE TABLE IF NOT EXISTS mentions(doc_id TEXT NOT NULL, verse_id INTEGER NOT NULL, book INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
  p_start_ch INTEGER NOT NULL, p_start_v INTEGER, p_end_ch INTEGER NOT NULL, p_end_v INTEGER, start INTEGER NOT NULL, end INTEGER NOT NULL, inferred INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mentions_verse ON mentions(verse_id);
CREATE INDEX IF NOT EXISTS mentions_bc ON mentions(book, chapter);
CREATE INDEX IF NOT EXISTS mentions_doc ON mentions(doc_id);
CREATE TABLE IF NOT EXISTS dates(doc_id TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, year INTEGER, month INTEGER, day INTEGER, approx INTEGER, sort_key REAL);
CREATE INDEX IF NOT EXISTS dates_doc ON dates(doc_id);
CREATE INDEX IF NOT EXISTS dates_sort ON dates(sort_key);
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2');
"#;

/// Bring an index written by an older build up to the current schema.
///
/// `CREATE TABLE IF NOT EXISTS` leaves an existing table alone, so a column
/// added to `links` never reaches a database that predates it. The index is
/// derived state and could be rebuilt from the vault, but a silent re-scan of
/// every file on launch is worse than one `ALTER TABLE`.
fn migrate(conn: &Connection) -> Result<()> {
    let has_kind = conn
        .prepare("SELECT 1 FROM pragma_table_info('links') WHERE name = 'kind'")?
        .exists([])?;
    if !has_kind {
        conn.execute_batch("ALTER TABLE links ADD COLUMN kind TEXT NOT NULL DEFAULT 'prose'")?;
    }
    // After the column exists either way: a fresh database gets it from the
    // schema, an old one from the ALTER above.
    conn.execute_batch("CREATE INDEX IF NOT EXISTS links_kind ON links(kind)")?;
    let has_label = conn
        .prepare("SELECT 1 FROM pragma_table_info('documents') WHERE name = 'label'")?
        .exists([])?;
    if !has_label {
        // Backfilled from `title`, not left empty: a blank label renders as a
        // blank row. That is already right for every type but Clipping, and a
        // Clipping's real label needs its body, so those rows are recomputed
        // below rather than guessed at in SQL.
        conn.execute_batch(
            "ALTER TABLE documents ADD COLUMN label TEXT NOT NULL DEFAULT '';
             UPDATE documents SET label = title WHERE label = ''",
        )?;
        let rows: Vec<(String, String, String, i64)> = conn
            .prepare("SELECT id, title, text, body_offset FROM documents WHERE type = 'clipping'")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (id, title, text, body_offset) in rows {
            let body = &text[(body_offset as usize).min(text.len())..];
            conn.execute(
                "UPDATE documents SET label = ?1 WHERE id = ?2",
                params![label_for(DocType::Clipping, &title, body), id],
            )?;
        }
    }
    Ok(())
}

/// What a document shows where only one line fits.
///
/// A Clipping has no title (ADR 0013), so it is known by its own words: the
/// same first-meaningful-block rule a Board card uses, which already strips
/// the `>` a quote is written with. Every other type shows the title its
/// author chose, because that is what they search by.
/// How wide a name may be before it crowds the graph it belongs to.
///
/// A Clipping's label is a sentence rather than a name (ADR 0013), and the
/// layout drops any label whose box lands on one already drawn — so an uncapped
/// quote would not just look wrong, it would silently take the names off its
/// neighbours. Forty characters is about three times a typical Subject's name,
/// which is enough to recognise a quote and little enough to draw.
const GRAPH_LABEL_CHARS: usize = 40;

/// A document's name on the Graph: its label, cut to something drawable.
fn graph_label(d: &DocSummary) -> String {
    let label = &d.label;
    if label.chars().count() <= GRAPH_LABEL_CHARS {
        return label.clone();
    }
    // On a word boundary where there is one close enough, so the cut reads as
    // an abbreviation rather than a glitch. The ellipsis is drawn here because
    // canvas text has no `line-clamp` to draw its own.
    let cut: String = label.chars().take(GRAPH_LABEL_CHARS).collect();
    let end = cut
        .rfind(char::is_whitespace)
        .filter(|i| *i > GRAPH_LABEL_CHARS / 2)
        .unwrap_or(cut.len());
    format!("{}…", cut[..end].trim_end())
}

fn label_for(doc_type: DocType, title: &str, body: &str) -> String {
    if doc_type != DocType::Clipping {
        return title.to_string();
    }
    let text = crate::excerpt::excerpt(body, title, None).text;
    if text.trim().is_empty() {
        title.to_string()
    } else {
        text
    }
}

fn row_summary(r: &Row) -> rusqlite::Result<DocSummary> {
    Ok(DocSummary {
        id: r.get("id")?,
        path: r.get("path")?,
        title: r.get("title")?,
        label: r.get("label")?,
        doc_type: DocType::parse(&r.get::<_, String>("type")?).unwrap_or(DocType::Other),
        mtime: r.get("mtime")?,
        book: r.get::<_, Option<i64>>("book")?.map(|x| x as u8),
        chapter: r.get::<_, Option<i64>>("chapter")?.map(|x| x as u16),
        verse: r.get::<_, Option<i64>>("verse")?.map(|x| x as u16),
        lat: r.get("lat")?,
        lon: r.get("lon")?,
        first_verse: r.get::<_, Option<i64>>("first_verse")?.map(|x| x as u32),
        start: r.get("start_text")?,
        end: r.get("end_text")?,
    })
}

const SUMMARY_COLS: &str = "d.id, d.path, d.title, d.label, d.type, d.mtime, d.book, d.chapter, d.verse, d.lat, d.lon, (SELECT MIN(verse_id) FROM mentions m WHERE m.doc_id = d.id) AS first_verse, (SELECT sd.text FROM dates sd WHERE sd.doc_id = d.id AND sd.name = 'start' AND d.type = 'event' LIMIT 1) AS start_text, (SELECT sd.text FROM dates sd WHERE sd.doc_id = d.id AND sd.name = 'end' AND d.type = 'event' LIMIT 1) AS end_text";

fn excerpt_at(text: &str, start: usize) -> String {
    let start = start.min(text.len());
    let line_start = text[..start].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let line_end = text[start..]
        .find('\n')
        .map(|i| start + i)
        .unwrap_or(text.len());
    let line = text[line_start..line_end].trim();
    if line.chars().count() > 220 {
        let rel = start - line_start;
        let from = line
            .char_indices()
            .map(|(i, _)| i)
            .filter(|&i| i <= rel.saturating_sub(80))
            .last()
            .unwrap_or(0);
        let to = line
            .char_indices()
            .map(|(i, _)| i)
            .find(|&i| i >= rel + 140)
            .unwrap_or(line.len());
        format!("…{}…", &line[from..to])
    } else {
        line.to_string()
    }
}

fn number_field(fm: &serde_json::Map<String, Value>, key: &str) -> Option<f64> {
    match fm.get(key) {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => s.trim().parse().ok(),
        _ => None,
    }
}

impl Index {
    pub fn open(path: &Path) -> Result<Index> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        migrate(&conn)?;
        Ok(Index { conn })
    }

    pub fn in_memory() -> Result<Index> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        migrate(&conn)?;
        Ok(Index { conn })
    }

    pub fn mtime_of(&self, path: &str) -> Result<Option<i64>> {
        Ok(self
            .conn
            .query_row("SELECT mtime FROM documents WHERE path = ?1", [path], |r| {
                r.get(0)
            })
            .optional()?)
    }

    pub fn all_paths(&self) -> Result<Vec<String>> {
        let mut st = self.conn.prepare("SELECT path FROM documents")?;
        let rows = st.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Replace everything the index knows about one document. `date_names`
    /// are the Property names typed as Dates (ADR 0006); their values are
    /// parsed into the `dates` table.
    pub fn upsert(
        &mut self,
        id: &str,
        path: &str,
        mtime: i64,
        text: &str,
        doc: &ParsedDoc,
        date_names: &[&str],
    ) -> Result<()> {
        let tx = self.conn.transaction()?;
        // A different document may previously have lived at this path.
        let old_id: Option<String> = tx
            .query_row("SELECT id FROM documents WHERE path = ?1", [path], |r| {
                r.get(0)
            })
            .optional()?;
        for victim in [Some(id.to_string()), old_id].into_iter().flatten() {
            for t in ["aliases", "tags", "mentions", "dates"] {
                tx.execute(&format!("DELETE FROM {t} WHERE doc_id = ?1"), [&victim])?;
            }
            // Board refs come from the `.canvas`, not this file, so they are
            // not this re-index's to clear (PLAN §17.6).
            tx.execute("DELETE FROM links WHERE from_id = ?1 AND kind = 'prose'", [&victim])?;
            tx.execute("DELETE FROM docs_fts WHERE id = ?1", [&victim])?;
            tx.execute("DELETE FROM documents WHERE id = ?1", [&victim])?;
        }
        let fm = &doc.frontmatter;
        let book = number_field(fm, "book_number").map(|x| x as i64);
        let chapter = number_field(fm, "chapter").map(|x| x as i64);
        let verse = number_field(fm, "verse").map(|x| x as i64);
        let (lat, lon) = if doc.doc_type == DocType::Place {
            (number_field(fm, "lat"), number_field(fm, "lon"))
        } else {
            (None, None)
        };
        let label = label_for(
            doc.doc_type,
            &doc.title,
            &text[doc.body_offset.min(text.len())..],
        );
        tx.execute(
            "INSERT INTO documents(id, path, title, title_norm, label, type, mtime, frontmatter, text, body_offset, book, chapter, verse, lat, lon)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![id, path, doc.title, norm(&doc.title), label, doc.doc_type.as_str(), mtime, Value::Object(fm.clone()).to_string(), text, doc.body_offset as i64, book, chapter, verse, lat, lon],
        )?;
        for a in &doc.aliases {
            tx.execute(
                "INSERT INTO aliases(doc_id, alias, norm) VALUES(?1, ?2, ?3)",
                params![id, a, norm(a)],
            )?;
        }
        for l in &doc.links {
            tx.execute(
                "INSERT INTO links(from_id, target, norm, alias, embed, start, end, property) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, l.target, norm(last_segment(&l.target)), l.alias, l.embed as i64, l.start as i64, l.end as i64, l.property],
            )?;
        }
        // Frontmatter order, so a page lists its Dates as written.
        for (name, value) in fm.iter().filter(|(k, _)| date_names.contains(&k.as_str())) {
            let raw = match value {
                Value::String(s) => s.trim().to_string(),
                Value::Number(n) => n.to_string(),
                _ => continue,
            };
            if raw.is_empty() {
                continue;
            }
            let parsed = BibleDate::parse(&raw);
            tx.execute(
                "INSERT INTO dates(doc_id, name, text, year, month, day, approx, sort_key) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    name,
                    raw,
                    parsed.map(|d| d.year as i64),
                    parsed.and_then(|d| d.month).map(|m| m as i64),
                    parsed.and_then(|d| d.day).map(|d| d as i64),
                    parsed.map(|d| d.approx as i64),
                    parsed.map(|d| d.sort_key()),
                ],
            )?;
        }
        for t in &doc.tags {
            tx.execute(
                "INSERT INTO tags(doc_id, tag, norm, start, end, in_frontmatter) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, t.name, norm(&t.name), t.start as i64, t.end as i64, t.in_frontmatter as i64],
            )?;
        }
        {
            let mut st = tx.prepare(
                "INSERT INTO mentions(doc_id, verse_id, book, chapter, verse, p_start_ch, p_start_v, p_end_ch, p_end_v, start, end, inferred)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            )?;
            for d in &doc.references {
                for p in &d.passages {
                    for v in p.verses() {
                        st.execute(params![
                            id,
                            v.0 as i64,
                            v.book() as i64,
                            v.chapter() as i64,
                            v.verse() as i64,
                            p.start_chapter as i64,
                            p.start_verse.map(|x| x as i64),
                            p.end_chapter as i64,
                            p.end_verse.map(|x| x as i64),
                            d.start as i64,
                            d.end as i64,
                            d.inferred as i64
                        ])?;
                    }
                }
            }
        }
        tx.execute(
            "INSERT INTO docs_fts(id, title, body) VALUES(?1, ?2, ?3)",
            params![id, doc.title, &text[doc.body_offset.min(text.len())..]],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn remove_path(&mut self, path: &str) -> Result<()> {
        let id: Option<String> = self
            .conn
            .query_row("SELECT id FROM documents WHERE path = ?1", [path], |r| {
                r.get(0)
            })
            .optional()?;
        if let Some(id) = id {
            self.remove_id(&id)?;
        }
        Ok(())
    }

    pub fn remove_id(&mut self, id: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        for t in ["aliases", "tags", "mentions"] {
            tx.execute(&format!("DELETE FROM {t} WHERE doc_id = ?1"), [id])?;
        }
        tx.execute("DELETE FROM links WHERE from_id = ?1", [id])?;
        tx.execute("DELETE FROM docs_fts WHERE id = ?1", [id])?;
        tx.execute("DELETE FROM documents WHERE id = ?1", [id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<DocSummary>> {
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {SUMMARY_COLS} FROM documents d WHERE d.id = ?1"),
                [id],
                row_summary,
            )
            .optional()?)
    }

    pub fn get_by_path(&self, path: &str) -> Result<Option<DocSummary>> {
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {SUMMARY_COLS} FROM documents d WHERE d.path = ?1"),
                [path],
                row_summary,
            )
            .optional()?)
    }

    pub fn text_of(&self, id: &str) -> Result<Option<(String, String)>> {
        Ok(self
            .conn
            .query_row(
                "SELECT text, frontmatter FROM documents WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?)
    }

    pub fn list(&self, doc_type: Option<DocType>) -> Result<Vec<DocSummary>> {
        let mut out = Vec::new();
        match doc_type {
            Some(t) => {
                let mut st = self.conn.prepare(&format!("SELECT {SUMMARY_COLS} FROM documents d WHERE d.type = ?1 ORDER BY d.book, d.chapter, d.verse, d.title COLLATE NOCASE"))?;
                for r in st.query_map([t.as_str()], row_summary)? {
                    out.push(r?);
                }
            }
            None => {
                let mut st = self.conn.prepare(&format!(
                    "SELECT {SUMMARY_COLS} FROM documents d ORDER BY d.path COLLATE NOCASE"
                ))?;
                for r in st.query_map([], row_summary)? {
                    out.push(r?);
                }
            }
        }
        Ok(out)
    }

    pub fn scripture_doc(
        &self,
        book: u8,
        chapter: Option<u16>,
        verse: Option<u16>,
    ) -> Result<Option<DocSummary>> {
        let t = match (chapter, verse) {
            (None, _) => "book",
            (Some(_), None) => "chapter",
            (Some(_), Some(_)) => "verse",
        };
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {SUMMARY_COLS} FROM documents d WHERE d.type = ?1 AND d.book = ?2 AND (d.chapter IS ?3) AND (d.verse IS ?4)"),
                params![t, book as i64, chapter.map(|c| c as i64), verse.map(|v| v as i64)],
                row_summary,
            )
            .optional()?)
    }

    /// Resolve a link target (title, alias, or vault path) to a document.
    pub fn resolve(&self, target: &str) -> Result<Option<DocSummary>> {
        let target = target.trim();
        if target.is_empty() {
            return Ok(None);
        }
        if target.contains('/') {
            let p = format!("{}.md", target.trim_end_matches(".md"));
            if let Some(d) = self
                .conn
                .query_row(
                    &format!(
                        "SELECT {SUMMARY_COLS} FROM documents d WHERE lower(d.path) = lower(?1)"
                    ),
                    [&p],
                    row_summary,
                )
                .optional()?
            {
                return Ok(Some(d));
            }
        }
        let n = norm(last_segment(target));
        if let Some(d) = self
            .conn
            .query_row(&format!("SELECT {SUMMARY_COLS} FROM documents d WHERE d.title_norm = ?1 ORDER BY length(d.path) LIMIT 1"), [&n], row_summary)
            .optional()?
        {
            return Ok(Some(d));
        }
        if let Some(d) = self
            .conn
            .query_row(
                &format!("SELECT {SUMMARY_COLS} FROM documents d JOIN aliases a ON a.doc_id = d.id WHERE a.norm = ?1 LIMIT 1"),
                [&n],
                row_summary,
            )
            .optional()?
        {
            return Ok(Some(d));
        }
        // Last resort: the file stem, for documents whose `title` property differs from it.
        let stem = last_segment(target).trim().to_lowercase();
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {SUMMARY_COLS} FROM documents d WHERE lower(d.path) = ?1 OR lower(d.path) LIKE ?2 ORDER BY length(d.path) LIMIT 1"),
                [format!("{stem}.md"), format!("%/{stem}.md")],
                row_summary,
            )
            .optional()?)
    }

    pub fn aliases_of(&self, id: &str) -> Result<Vec<String>> {
        let mut st = self
            .conn
            .prepare("SELECT alias FROM aliases WHERE doc_id = ?1")?;
        let rows = st.query_map([id], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn names_of(&self, doc: &DocSummary) -> Result<Vec<String>> {
        let mut names = vec![norm(&doc.title)];
        let mut st = self
            .conn
            .prepare("SELECT norm FROM aliases WHERE doc_id = ?1")?;
        for r in st.query_map([&doc.id], |r| r.get::<_, String>(0))? {
            names.push(r?);
        }
        names.sort();
        names.dedup();
        Ok(names)
    }

    fn placeholders(n: usize) -> String {
        (0..n).map(|_| "?").collect::<Vec<_>>().join(",")
    }

    /// The Board excerpt for each of `paths`, keyed by path.
    ///
    /// One call per Board rather than one per card: a forty-node Board would
    /// otherwise make forty round trips and read forty whole documents to show
    /// a hundred characters each (PLAN §17.12). Body text comes from the FTS
    /// row that indexing already wrote, so nothing is re-read or re-parsed.
    ///
    /// A path that is not in the Vault is simply absent from the result: the
    /// card already renders that as missing, and it is not this method's job
    /// to say so twice.
    ///
    /// Keyed by [`board_excerpt_key`], not by path: a Board may hold both a
    /// whole document and one of its sections.
    pub fn board_excerpts(
        &self,
        paths: &[(String, Option<String>)],
    ) -> Result<HashMap<String, BoardExcerpt>> {
        let mut out = HashMap::new();
        let mut st = self.conn.prepare(
            "SELECT d.id, d.title, d.type, f.body FROM documents d
             JOIN docs_fts f ON f.id = d.id WHERE d.path = ?1",
        )?;
        for (path, subpath) in paths {
            let row = st
                .query_row([path], |r| {
                    Ok((
                        r.get::<_, String>("id")?,
                        r.get::<_, String>("title")?,
                        r.get::<_, String>("type")?,
                        r.get::<_, String>("body")?,
                    ))
                })
                .optional()?;
            let (id, title, ty, body) = match row {
                Some(v) => v,
                None => continue,
            };
            let ex = excerpt::excerpt(&body, &title, subpath.as_deref());
            // A Subject Hub's substance is what links to it, not its body
            // (PLAN §17.12). Only a fallback: a Concept page that does open
            // with a real paragraph shows the paragraph.
            let is_hub = DocType::parse(&ty).unwrap_or(DocType::Other).is_subject();
            let mentions = if ex.text.is_empty() && is_hub {
                Some(self.backlink_count(&id)?)
            } else {
                None
            };
            out.insert(
                board_excerpt_key(path, subpath.as_deref()),
                BoardExcerpt {
                    text: ex.text,
                    subpath_missing: ex.subpath_missing,
                    mentions,
                },
            );
        }
        Ok(out)
    }

    /// How many documents point at `id`, under any of its names.
    fn backlink_count(&self, id: &str) -> Result<usize> {
        let doc = match self.get(id)? {
            Some(d) => d,
            None => return Ok(0),
        };
        let names = self.names_of(&doc)?;
        let ph = Self::placeholders(names.len());
        let sql = format!(
            "SELECT COUNT(DISTINCT from_id) FROM links WHERE norm IN ({ph}) AND from_id != ?{}",
            names.len() + 1
        );
        let mut args: Vec<&dyn rusqlite::ToSql> =
            names.iter().map(|n| n as &dyn rusqlite::ToSql).collect();
        args.push(&id);
        let n: i64 = self
            .conn
            .query_row(&sql, args.as_slice(), |r| r.get(0))?;
        Ok(n as usize)
    }

    /// Everything that points at `id`: links, embeds, property links, tags and
    /// (for Scripture pages) Mentions collapsed to the Passage as written.
    pub fn backlinks(&self, id: &str, lang: Lang) -> Result<Vec<Backlink>> {
        let doc = match self.get(id)? {
            Some(d) => d,
            None => return Ok(vec![]),
        };
        let names = self.names_of(&doc)?;
        let ph = Self::placeholders(names.len());
        let mut out = Vec::new();
        let mut st = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLS}, l.embed, l.property, l.start, d.text FROM links l JOIN documents d ON d.id = l.from_id WHERE l.norm IN ({ph}) AND l.from_id != ?{}",
            names.len() + 1
        ))?;
        let mut args: Vec<&dyn rusqlite::ToSql> =
            names.iter().map(|n| n as &dyn rusqlite::ToSql).collect();
        args.push(&id);
        let rows = st.query_map(args.as_slice(), |r| {
            let d = row_summary(r)?;
            let embed: i64 = r.get("embed")?;
            let property: Option<String> = r.get("property")?;
            let start: i64 = r.get("start")?;
            let text: String = r.get("text")?;
            Ok((d, embed == 1, property, start as usize, text))
        })?;
        for r in rows {
            let (d, embed, property, start, text) = r?;
            let kind = if property.is_some() {
                BacklinkKind::Property
            } else if embed {
                BacklinkKind::Embed
            } else {
                BacklinkKind::Link
            };
            let excerpt = if property.is_some() {
                String::new()
            } else {
                excerpt_at(&text, start)
            };
            out.push(Backlink {
                doc: d,
                kind,
                via: None,
                property,
                excerpt,
                start,
                inferred: false,
            });
        }
        let mut st = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLS}, t.start, t.in_frontmatter, d.text FROM tags t JOIN documents d ON d.id = t.doc_id WHERE t.norm IN ({ph}) AND t.doc_id != ?{}",
            names.len() + 1
        ))?;
        let rows = st.query_map(args.as_slice(), |r| {
            let d = row_summary(r)?;
            let start: i64 = r.get("start")?;
            let fm: i64 = r.get("in_frontmatter")?;
            let text: String = r.get("text")?;
            Ok((d, start as usize, fm == 1, text))
        })?;
        for r in rows {
            let (d, start, fm, text) = r?;
            let excerpt = if fm {
                String::new()
            } else {
                excerpt_at(&text, start)
            };
            out.push(Backlink {
                doc: d,
                kind: BacklinkKind::Tag,
                via: None,
                property: None,
                excerpt,
                start,
                inferred: false,
            });
        }
        if doc.doc_type.is_scripture() {
            if let Some(book) = doc.book {
                out.extend(self.mentions_of(book, doc.chapter, doc.verse, lang, Some(id))?);
            }
        }
        // Dedupe identical (doc, start) pairs and order: by kind then title.
        out.sort_by(|a, b| {
            a.doc
                .first_verse
                .cmp(&b.doc.first_verse)
                .then(a.doc.title.cmp(&b.doc.title))
                .then(a.start.cmp(&b.start))
        });
        out.dedup_by(|a, b| a.doc.id == b.doc.id && a.start == b.start && a.kind == b.kind);
        Ok(out)
    }

    /// Mentions covering a Book, Chapter or Verse, one row per Passage as written.
    pub fn mentions_of(
        &self,
        book: u8,
        chapter: Option<u16>,
        verse: Option<u16>,
        lang: Lang,
        exclude: Option<&str>,
    ) -> Result<Vec<Backlink>> {
        let sql = format!(
            "SELECT {SUMMARY_COLS}, m.start, m.p_start_ch, m.p_start_v, m.p_end_ch, m.p_end_v, m.inferred, d.text
             FROM mentions m JOIN documents d ON d.id = m.doc_id
             WHERE m.book = ?1 AND (?2 IS NULL OR m.chapter = ?2) AND (?3 IS NULL OR m.verse = ?3) AND (?4 IS NULL OR m.doc_id != ?4)
             GROUP BY m.doc_id, m.start, m.p_start_ch, m.p_start_v, m.p_end_ch, m.p_end_v
             ORDER BY d.title COLLATE NOCASE, m.start"
        );
        let mut st = self.conn.prepare(&sql)?;
        let rows = st.query_map(
            params![
                book as i64,
                chapter.map(|c| c as i64),
                verse.map(|v| v as i64),
                exclude
            ],
            |r| {
                let d = row_summary(r)?;
                let start: i64 = r.get("start")?;
                let p = Passage {
                    book,
                    start_chapter: r.get::<_, i64>("p_start_ch")? as u16,
                    start_verse: r.get::<_, Option<i64>>("p_start_v")?.map(|x| x as u16),
                    end_chapter: r.get::<_, i64>("p_end_ch")? as u16,
                    end_verse: r.get::<_, Option<i64>>("p_end_v")?.map(|x| x as u16),
                };
                let inferred: i64 = r.get("inferred")?;
                let text: String = r.get("text")?;
                Ok((d, start as usize, p, inferred == 1, text))
            },
        )?;
        let mut out = Vec::new();
        for r in rows {
            let (d, start, p, inferred, text) = r?;
            out.push(Backlink {
                doc: d,
                kind: BacklinkKind::Mention,
                via: Some(p.display(lang)),
                property: None,
                excerpt: excerpt_at(&text, start),
                start,
                inferred,
            });
        }
        Ok(out)
    }

    pub fn coverage(&self) -> Result<Vec<CoverageCell>> {
        let mut st = self.conn.prepare(
            "SELECT book, chapter, COUNT(DISTINCT doc_id) FROM mentions GROUP BY book, chapter",
        )?;
        let rows = st.query_map([], |r| {
            Ok(CoverageCell {
                book: r.get::<_, i64>(0)? as u8,
                chapter: r.get::<_, i64>(1)? as u16,
                count: r.get::<_, i64>(2)? as u32,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Documents mentioning each verse of one chapter, for the verse strip on a Chapter Hub.
    pub fn verse_coverage(&self, book: u8, chapter: u16) -> Result<Vec<(u16, u32)>> {
        let mut st = self.conn.prepare("SELECT verse, COUNT(DISTINCT doc_id) FROM mentions WHERE book = ?1 AND chapter = ?2 GROUP BY verse ORDER BY verse")?;
        let rows = st.query_map([book as i64, chapter as i64], |r| {
            Ok((r.get::<_, i64>(0)? as u16, r.get::<_, i64>(1)? as u32))
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn scripture_node_id(level: GraphLevel, book: u8, chapter: u16, verse: u16) -> String {
        match level {
            GraphLevel::Book => format!("s:{book}"),
            GraphLevel::Chapter => format!("s:{book}:{chapter}"),
            GraphLevel::Verse => format!("s:{book}:{chapter}:{verse}"),
        }
    }

    fn scripture_node_label(
        level: GraphLevel,
        book: u8,
        chapter: u16,
        verse: u16,
        lang: Lang,
    ) -> String {
        let name = names::book_name(book, lang);
        match level {
            GraphLevel::Book => name.to_string(),
            GraphLevel::Chapter => format!("{name} {chapter}"),
            GraphLevel::Verse => format!("{name} {chapter}:{verse}"),
        }
    }

    /// The whole vault as a graph. Scripture collapses to `level`.
    pub fn graph(&self, level: GraphLevel, lang: Lang) -> Result<Graph> {
        let mut nodes: HashMap<String, GraphNode> = HashMap::new();
        let mut edges: HashSet<(String, String)> = HashSet::new();
        // Documents that are not Scripture pages.
        let mut doc_node: HashMap<String, String> = HashMap::new(); // doc id -> node id
        for d in self.list(None)? {
            let node_id = if d.doc_type.is_scripture() {
                match (d.book, d.chapter, d.verse) {
                    (Some(b), c, v) => {
                        let (ch, vs) = (c.unwrap_or(0), v.unwrap_or(0));
                        // A Book page collapses to its book node, etc.
                        let lvl = match (level, d.doc_type) {
                            (GraphLevel::Verse, DocType::Verse) => GraphLevel::Verse,
                            (GraphLevel::Verse, DocType::Chapter)
                            | (GraphLevel::Chapter, DocType::Chapter | DocType::Verse) => {
                                GraphLevel::Chapter
                            }
                            _ => GraphLevel::Book,
                        };
                        let nid = Self::scripture_node_id(lvl, b, ch, vs);
                        let entry = nodes.entry(nid.clone()).or_insert_with(|| GraphNode {
                            id: nid.clone(),
                            label: Self::scripture_node_label(lvl, b, ch, vs, lang),
                            doc_type: match lvl {
                                GraphLevel::Book => DocType::Book,
                                GraphLevel::Chapter => DocType::Chapter,
                                GraphLevel::Verse => DocType::Verse,
                            },
                            doc_id: None,
                            degree: 0,
                        });
                        // The page for exactly this unit owns the node.
                        let owns = matches!(
                            (lvl, d.doc_type),
                            (GraphLevel::Book, DocType::Book)
                                | (GraphLevel::Chapter, DocType::Chapter)
                                | (GraphLevel::Verse, DocType::Verse)
                        );
                        if owns {
                            entry.doc_id = Some(d.id.clone());
                        }
                        nid
                    }
                    _ => d.id.clone(),
                }
            } else {
                nodes.insert(
                    d.id.clone(),
                    GraphNode {
                        id: d.id.clone(),
                        label: graph_label(&d),
                        doc_type: d.doc_type,
                        doc_id: Some(d.id.clone()),
                        degree: 0,
                    },
                );
                d.id.clone()
            };
            doc_node.insert(d.id.clone(), node_id);
        }
        // Links and tags, resolved.
        let mut st = self
            .conn
            .prepare("SELECT from_id, target FROM links UNION SELECT doc_id, tag FROM tags")?;
        let rows: Vec<(String, String)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let mut cache: HashMap<String, Option<String>> = HashMap::new();
        for (from, target) in rows {
            let to = cache
                .entry(target.clone())
                .or_insert_with(|| {
                    self.resolve(&target)
                        .ok()
                        .flatten()
                        .and_then(|d| doc_node.get(&d.id).cloned())
                })
                .clone();
            if let (Some(a), Some(b)) = (doc_node.get(&from), to) {
                if *a != b {
                    edges.insert((a.clone(), b));
                }
            }
        }
        // Mentions.
        let mut st = self
            .conn
            .prepare("SELECT DISTINCT doc_id, book, chapter, verse FROM mentions")?;
        let rows: Vec<(String, i64, i64, i64)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (doc_id, b, c, v) in rows {
            let (b, c, v) = (b as u8, c as u16, v as u16);
            let nid = Self::scripture_node_id(level, b, c, v);
            nodes.entry(nid.clone()).or_insert_with(|| GraphNode {
                id: nid.clone(),
                label: Self::scripture_node_label(level, b, c, v, lang),
                doc_type: match level {
                    GraphLevel::Book => DocType::Book,
                    GraphLevel::Chapter => DocType::Chapter,
                    GraphLevel::Verse => DocType::Verse,
                },
                doc_id: None,
                degree: 0,
            });
            if let Some(a) = doc_node.get(&doc_id) {
                if *a != nid {
                    edges.insert((a.clone(), nid));
                }
            }
        }
        for (a, b) in &edges {
            if let Some(n) = nodes.get_mut(a) {
                n.degree += 1;
            }
            if let Some(n) = nodes.get_mut(b) {
                n.degree += 1;
            }
        }
        let mut nodes: Vec<GraphNode> = nodes.into_values().collect();
        nodes.sort_by(|a, b| a.id.cmp(&b.id));
        let mut edges: Vec<GraphEdge> = edges
            .into_iter()
            .map(|(source, target)| GraphEdge { source, target })
            .collect();
        edges.sort_by(|a, b| a.source.cmp(&b.source).then(a.target.cmp(&b.target)));
        Ok(Graph { nodes, edges })
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let terms: Vec<String> = query
            .split_whitespace()
            .map(|t| t.replace('"', ""))
            .filter(|t| !t.is_empty())
            .collect();
        if terms.is_empty() {
            return Ok(vec![]);
        }
        let n = terms.len();
        let fts: Vec<String> = terms
            .iter()
            .enumerate()
            .map(|(i, t)| {
                if i + 1 == n {
                    format!("\"{t}\"*")
                } else {
                    format!("\"{t}\"")
                }
            })
            .collect();
        let q = fts.join(" ");
        let mut st = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLS}, snippet(docs_fts, 2, '[', ']', '…', 14) AS snip FROM docs_fts f JOIN documents d ON d.id = f.id WHERE docs_fts MATCH ?1 ORDER BY bm25(docs_fts, 0, 5.0, 1.0) LIMIT ?2"
        ))?;
        let rows = st.query_map(params![q, limit as i64], |r| {
            Ok(SearchHit {
                doc: row_summary(r)?,
                snippet: r.get("snip")?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Title / alias prefix matches for link autocomplete.
    pub fn suggest(&self, prefix: &str, limit: usize) -> Result<Vec<DocSummary>> {
        let n = norm(prefix);
        let like = format!("{}%", n.replace('%', "").replace('_', ""));
        let mut st = self.conn.prepare(&format!(
            "SELECT DISTINCT {SUMMARY_COLS} FROM documents d LEFT JOIN aliases a ON a.doc_id = d.id
             WHERE d.title_norm LIKE ?1 OR a.norm LIKE ?1 OR d.title_norm LIKE ?2 ORDER BY length(d.title) LIMIT ?3"
        ))?;
        let contains = format!("% {}%", n.replace('%', ""));
        let rows = st.query_map(params![like, contains, limit as i64], row_summary)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn tags(&self) -> Result<Vec<(String, u32)>> {
        let mut st = self.conn.prepare(
            "SELECT tag, COUNT(DISTINCT doc_id) FROM tags GROUP BY norm ORDER BY 2 DESC, tag",
        )?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u32)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Documents carrying `tag` (frontmatter or inline), newest first.
    pub fn tagged(&self, tag: &str) -> Result<Vec<DocSummary>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLS} FROM documents d WHERE d.id IN (SELECT doc_id FROM tags WHERE norm = ?1) ORDER BY d.mtime DESC, d.title"
        ))?;
        let rows = st.query_map([norm(tag)], row_summary)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn dated_rows(&self, sql: &str, args: &[&dyn rusqlite::ToSql]) -> Result<Vec<DatedProperty>> {
        let mut st = self.conn.prepare(sql)?;
        let rows = st.query_map(args, |r| {
            let doc = row_summary(r)?;
            let year: Option<i64> = r.get("year")?;
            let date = year.map(|y| BibleDate {
                year: y as i32,
                month: r
                    .get::<_, Option<i64>>("month")
                    .ok()
                    .flatten()
                    .map(|m| m as u8),
                day: r
                    .get::<_, Option<i64>>("day")
                    .ok()
                    .flatten()
                    .map(|d| d as u8),
                approx: r
                    .get::<_, Option<i64>>("approx")
                    .ok()
                    .flatten()
                    .unwrap_or(0)
                    != 0,
            });
            Ok(DatedProperty {
                doc,
                name: r.get("name")?,
                text: r.get("text")?,
                precision: date.map(|d| d.precision()),
                date,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Every Date-typed Property on one document, parsed or not, in frontmatter order.
    pub fn dates_of(&self, id: &str) -> Result<Vec<DatedProperty>> {
        self.dated_rows(
            &format!("SELECT {SUMMARY_COLS}, x.name, x.text, x.year, x.month, x.day, x.approx FROM dates x JOIN documents d ON d.id = x.doc_id WHERE x.doc_id = ?1 ORDER BY x.rowid"),
            &[&id],
        )
    }

    /// Every parsed Date on every Subject, earliest first: the Timeline's data.
    pub fn timeline(&self) -> Result<Vec<DatedProperty>> {
        self.dated_rows(
            &format!("SELECT {SUMMARY_COLS}, x.name, x.text, x.year, x.month, x.day, x.approx FROM dates x JOIN documents d ON d.id = x.doc_id WHERE x.year IS NOT NULL ORDER BY x.sort_key, d.title, x.rowid"),
            &[],
        )
    }

    /// Every (Event, Subject) pair from Events' `place` and `characters` Properties.
    pub fn event_links(&self) -> Result<Vec<EventLink>> {
        let mut st = self.conn.prepare(
            "SELECT l.from_id, l.target FROM links l JOIN documents e ON e.id = l.from_id WHERE e.type = 'event' AND l.property IN ('place', 'characters') ORDER BY l.from_id, l.rowid",
        )?;
        let pairs: Vec<(String, String)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let mut out = Vec::new();
        for (event, target) in pairs {
            if let Some(d) = self.resolve(&target)? {
                let link = EventLink {
                    event,
                    subject: d.id,
                };
                if !out.contains(&link) {
                    out.push(link);
                }
            }
        }
        Ok(out)
    }

    /// Every (document, Tag) pair over documents carrying a parsed Date: the
    /// Timeline's Tag filter only ever offers Tags that can match a Lane.
    pub fn timeline_tags(&self) -> Result<Vec<DocTag>> {
        let mut st = self.conn.prepare(
            "SELECT t.doc_id, MIN(t.tag) FROM tags t              WHERE t.doc_id IN (SELECT doc_id FROM dates WHERE year IS NOT NULL)              GROUP BY t.doc_id, t.norm ORDER BY t.norm, t.doc_id",
        )?;
        let rows = st.query_map([], |r| {
            Ok(DocTag {
                doc: r.get(0)?,
                tag: r.get(1)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Events whose `place` or `characters` Property names this document, in
    /// chronological order of their `start`; Events whose `start` is missing or
    /// unparseable come last, alphabetically.
    pub fn events_naming(&self, id: &str) -> Result<Vec<DocSummary>> {
        let doc = match self.get(id)? {
            Some(d) => d,
            None => return Ok(vec![]),
        };
        let names = self.names_of(&doc)?;
        let ph = Self::placeholders(names.len());
        let mut st = self.conn.prepare(&format!(
            "SELECT DISTINCT {SUMMARY_COLS}, (SELECT sk.sort_key FROM dates sk WHERE sk.doc_id = d.id AND sk.name = 'start' LIMIT 1) AS start_sort FROM links l JOIN documents d ON d.id = l.from_id WHERE d.type = 'event' AND l.property IN ('place', 'characters') AND l.norm IN ({ph}) ORDER BY start_sort IS NULL, start_sort, d.title COLLATE NOCASE"
        ))?;
        let args: Vec<&dyn rusqlite::ToSql> =
            names.iter().map(|n| n as &dyn rusqlite::ToSql).collect();
        let rows = st.query_map(args.as_slice(), row_summary)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn places(&self) -> Result<Vec<DocSummary>> {
        let mut st = self.conn.prepare(&format!("SELECT {SUMMARY_COLS} FROM documents d WHERE d.type = 'place' AND d.lat IS NOT NULL AND d.lon IS NOT NULL ORDER BY d.title"))?;
        let rows = st.query_map([], row_summary)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Every Journey with its Stops in travel order (ADR 0010, PLAN §19.9).
    ///
    /// Order comes from the order the `places` Property's links were indexed,
    /// which is `links.rowid` — the same insertion-order guarantee
    /// `event_links` relies on. That ordering is load-bearing: rewriting those
    /// rows in another order would silently reverse a Journey.
    pub fn journeys(&self) -> Result<Vec<Journey>> {
        let mut out = Vec::new();
        let mut st = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLS} FROM documents d WHERE d.type = 'journey' ORDER BY d.title"
        ))?;
        let docs: Vec<DocSummary> = st
            .query_map([], row_summary)?
            .collect::<rusqlite::Result<_>>()?;
        let mut targets = self.conn.prepare(
            "SELECT target FROM links WHERE from_id = ?1 AND property = 'places' ORDER BY rowid",
        )?;
        for doc in docs {
            let mut stops = Vec::new();
            for row in targets.query_map([&doc.id], |r| r.get::<_, String>(0))? {
                let target = row?;
                let found = self.resolve(&target)?;
                let status = match &found {
                    None => StopStatus::Unresolved,
                    Some(d) if d.doc_type != DocType::Place => StopStatus::NotAPlace,
                    Some(d) if d.lat.is_none() || d.lon.is_none() => StopStatus::NoCoords,
                    Some(_) => StopStatus::Ok,
                };
                stops.push(JourneyStop {
                    target,
                    doc: found,
                    status,
                });
            }
            out.push(Journey { doc, stops });
        }
        Ok(out)
    }

    /// Tags, Books and mention counts for every Place, for the Map's filters
    /// (PLAN §19.5). Places with no facts are returned with empty lists, so the
    /// UI can tell "nothing mentions this" from "not indexed yet".
    ///
    /// Only prose links count towards a mention: material placed on a Board is
    /// not a claim about a Place (PLAN §17.6), so it must not make a Place look
    /// written-about.
    pub fn place_facts(&self) -> Result<Vec<PlaceFact>> {
        let mut facts: Vec<PlaceFact> = Vec::new();
        let mut at: HashMap<String, usize> = HashMap::new();
        let mut st = self
            .conn
            .prepare("SELECT d.id FROM documents d WHERE d.type = 'place' ORDER BY d.title")?;
        for row in st.query_map([], |r| r.get::<_, String>(0))? {
            let id = row?;
            at.insert(id.clone(), facts.len());
            facts.push(PlaceFact {
                doc: id,
                tags: Vec::new(),
                books: Vec::new(),
                mentions: 0,
            });
        }

        // The Place's own Tags, deduplicated by norm the way the Timeline's
        // chips are, so "Kings" and "kings" offer one chip.
        let mut st = self.conn.prepare(
            "SELECT t.doc_id, MIN(t.tag) FROM tags t JOIN documents d ON d.id = t.doc_id \
             WHERE d.type = 'place' GROUP BY t.doc_id, t.norm ORDER BY t.norm",
        )?;
        for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (doc, tag) = row?;
            if let Some(&i) = at.get(&doc) {
                facts[i].tags.push(tag);
            }
        }

        // Books reached through the documents that link to the Place, and how
        // many documents link to it. `norm` is how a link addresses a target,
        // so the join goes through the Place's own norm and its aliases.
        let mut st = self.conn.prepare(
            "SELECT p.id, m.book FROM documents p \
             JOIN links l ON l.kind = 'prose' AND l.norm IN ( \
               SELECT p.title_norm UNION SELECT a.norm FROM aliases a WHERE a.doc_id = p.id) \
             JOIN mentions m ON m.doc_id = l.from_id \
             WHERE p.type = 'place' GROUP BY p.id, m.book ORDER BY p.id, m.book",
        )?;
        for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            let (doc, book) = row?;
            if let Some(&i) = at.get(&doc) {
                facts[i].books.push(book as u8);
            }
        }

        let mut st = self.conn.prepare(
            "SELECT p.id, COUNT(DISTINCT l.from_id) FROM documents p \
             JOIN links l ON l.kind = 'prose' AND l.norm IN ( \
               SELECT p.title_norm UNION SELECT a.norm FROM aliases a WHERE a.doc_id = p.id) \
             WHERE p.type = 'place' GROUP BY p.id",
        )?;
        for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            let (doc, n) = row?;
            if let Some(&i) = at.get(&doc) {
                facts[i].mentions = n as u32;
            }
        }
        Ok(facts)
    }

    /// Documents sharing Tags or Verses with `id`, for the Composition sidebar.
    pub fn candidates(&self, id: &str, lang: Lang, limit: usize) -> Result<Vec<Candidate>> {
        let mut by_doc: HashMap<String, (Vec<String>, Vec<String>)> = HashMap::new();
        let mut st = self.conn.prepare(
            "SELECT o.doc_id, o.tag FROM tags o WHERE o.norm IN (SELECT norm FROM tags WHERE doc_id = ?1) AND o.doc_id != ?1 GROUP BY o.doc_id, o.norm",
        )?;
        for r in st.query_map([id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })? {
            let (d, t) = r?;
            by_doc.entry(d).or_default().0.push(t);
        }
        let mut st = self.conn.prepare(
            "SELECT o.doc_id, o.book, o.p_start_ch, o.p_start_v, o.p_end_ch, o.p_end_v FROM mentions o
             WHERE o.verse_id IN (SELECT verse_id FROM mentions WHERE doc_id = ?1) AND o.doc_id != ?1
             GROUP BY o.doc_id, o.start",
        )?;
        for r in st.query_map([id], |r| {
            let p = Passage {
                book: r.get::<_, i64>(1)? as u8,
                start_chapter: r.get::<_, i64>(2)? as u16,
                start_verse: r.get::<_, Option<i64>>(3)?.map(|x| x as u16),
                end_chapter: r.get::<_, i64>(4)? as u16,
                end_verse: r.get::<_, Option<i64>>(5)?.map(|x| x as u16),
            };
            Ok((r.get::<_, String>(0)?, p))
        })? {
            let (d, p) = r?;
            let e = by_doc.entry(d).or_default();
            let s = p.display(lang);
            if !e.1.contains(&s) {
                e.1.push(s);
            }
        }
        // Names the Composition itself points at in its prose: link targets
        // (inline and Embed) and Tags. Board refs are deliberately excluded —
        // material on the Board is placed, not used (PLAN §17.6).
        let mut linked: HashSet<String> = HashSet::new();
        let mut st = self.conn.prepare(
            "SELECT norm FROM links WHERE from_id = ?1 AND kind = 'prose' UNION SELECT norm FROM tags WHERE doc_id = ?1",
        )?;
        for r in st.query_map([id], |r| r.get::<_, String>(0))? {
            linked.insert(r?);
        }
        let on_board: HashSet<String> = self.board_targets(id)?.into_iter().collect();
        let mut out = Vec::new();
        for (doc_id, (tags, passages)) in by_doc {
            if let Some(doc) = self.get(&doc_id)? {
                if doc.doc_type.is_scripture() {
                    continue;
                }
                let used = self.names_of(&doc)?.iter().any(|n| linked.contains(n));
                let placed = on_board.contains(&doc.id);
                let score = (tags.len() * 2 + passages.len()) as u32;
                out.push(Candidate {
                    doc,
                    shared_tags: tags,
                    shared_passages: passages,
                    score,
                    used,
                    on_board: placed,
                });
            }
        }
        // Untouched material first, then what is on the Board, then what the
        // prose already uses: the order in which the writer still has a
        // decision to make about each.
        out.sort_by(|a, b| {
            a.used
                .cmp(&b.used)
                .then(a.on_board.cmp(&b.on_board))
                .then(b.score.cmp(&a.score))
                .then(a.doc.title.cmp(&b.doc.title))
        });
        out.truncate(limit);
        Ok(out)
    }

    /// Replace a Composition's Board refs: the documents its Board's `file`
    /// nodes point at (PLAN §17.6).
    ///
    /// Targets are vault-relative paths, since that is what JSON Canvas
    /// stores; a path naming no document is skipped rather than recorded, so a
    /// node left dangling by a delete never becomes a phantom backlink. The
    /// node itself stays on the Board, rendered as missing (PLAN §17.13).
    pub fn set_board_refs(&mut self, id: &str, targets: &[String]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM links WHERE from_id = ?1 AND kind = 'board'",
            [id],
        )?;
        for t in targets {
            let doc: Option<String> = tx
                .query_row("SELECT id FROM documents WHERE path = ?1", [t], |r| r.get(0))
                .optional()?;
            let Some(doc_id) = doc else { continue };
            tx.execute(
                "INSERT INTO links(from_id, target, norm, alias, embed, start, end, property, kind)
                 VALUES(?1, ?2, ?3, NULL, 0, 0, 0, NULL, 'board')",
                params![id, doc_id, norm(&doc_id)],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Document ids on a Composition's Board.
    pub fn board_targets(&self, id: &str) -> Result<Vec<String>> {
        let mut st = self
            .conn
            .prepare("SELECT target FROM links WHERE from_id = ?1 AND kind = 'board'")?;
        let rows = st.query_map([id], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Compositions whose Board references this document — the "Boards" line
    /// on a Hub, so material placed on a Board is visible from both ends.
    pub fn boards_referencing(&self, id: &str) -> Result<Vec<DocSummary>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLS} FROM documents d
             JOIN links l ON l.from_id = d.id
             WHERE l.target = ?1 AND l.kind = 'board'
             GROUP BY d.id ORDER BY d.title"
        ))?;
        let rows = st.query_map([id], row_summary)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Child Sources of a Source (via the `parent` property), recursively.
    pub fn source_descendants(&self, id: &str) -> Result<Vec<DocSummary>> {
        let mut st = self
            .conn
            .prepare("SELECT from_id, target FROM links WHERE property = 'parent'")?;
        let rows: Vec<(String, String)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let mut children: HashMap<String, Vec<String>> = HashMap::new();
        for (from, target) in rows {
            if let Some(parent) = self.resolve(&target)? {
                children.entry(parent.id).or_default().push(from);
            }
        }
        let mut out = Vec::new();
        let mut stack = vec![id.to_string()];
        let mut seen = HashSet::new();
        while let Some(cur) = stack.pop() {
            for c in children.get(&cur).cloned().unwrap_or_default() {
                if seen.insert(c.clone()) {
                    if let Some(d) = self.get(&c)? {
                        out.push(d);
                    }
                    stack.push(c);
                }
            }
        }
        // Natural, not lexicographic: chapters and issues are numbered, so
        // plain `cmp` files "Chapter 10" before "Chapter 2" and a Contains
        // list of a dozen chapters reads scrambled.
        out.sort_by(|a, b| natural_cmp(&a.title, &b.title));
        Ok(out)
    }

    /// Every Source, with what the Library needs to draw a Shelf of Covers.
    ///
    /// One call for the whole view: `DocSummary` carries none of `kind`,
    /// `cover` or `date` (they live in the frontmatter blob), and a child
    /// count needs the `links` table, so the alternative is a round-trip per
    /// Source. Which Shelf an entry lands on is the UI's decision (ADR 0012);
    /// this only reports what each Source says about itself.
    pub fn library(&self) -> Result<Vec<LibraryEntry>> {
        // Resolve every `parent` link once, so a child can name its parent by
        // id rather than by the title it happened to be written with.
        let mut st = self
            .conn
            .prepare("SELECT from_id, target FROM links WHERE property = 'parent'")?;
        let rows: Vec<(String, String)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let mut parent_of: HashMap<String, String> = HashMap::new();
        let mut child_count: HashMap<String, usize> = HashMap::new();
        for (from, target) in rows {
            // An unresolved parent leaves the child parentless on purpose: a
            // dangling `[[Book]]` means the book is not in the vault, and the
            // chapter belongs on Unshelved where the user will see it.
            if let Some(parent) = self.resolve(&target)? {
                *child_count.entry(parent.id.clone()).or_default() += 1;
                parent_of.insert(from, parent.id);
            }
        }

        let mut st = self
            .conn
            .prepare("SELECT id, title, frontmatter FROM documents WHERE type = 'source'")?;
        let rows: Vec<(String, String, String)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<_>>()?;

        let mut out: Vec<LibraryEntry> = rows
            .into_iter()
            .map(|(id, title, fm)| {
                let fm: Value = serde_json::from_str(&fm).unwrap_or(Value::Null);
                // A bare `date: 1988` is a YAML integer, not a string, so a
                // number is read as written rather than dropped — the same
                // leniency `source_trail` gives a Locator.
                let text = |k: &str| match fm.get(k) {
                    Some(Value::String(s)) => s.trim().to_string(),
                    Some(Value::Number(n)) => n.to_string(),
                    _ => String::new(),
                };
                LibraryEntry {
                    child_count: child_count.get(&id).copied().unwrap_or(0),
                    parent_id: parent_of.get(&id).cloned(),
                    kind: text("kind"),
                    cover: text("cover"),
                    date: text("date"),
                    id,
                    title,
                }
            })
            .collect();
        // Natural, for the same reason the Contains list is: a Shelf of
        // numbered issues should not read 1, 10, 11, 2.
        out.sort_by(|a, b| natural_cmp(&a.title, &b.title));
        Ok(out)
    }

    /// Everything cited from a Source or its descendants, ordered by Locator.
    pub fn source_trail(&self, id: &str) -> Result<Vec<TrailEntry>> {
        let mut sources = vec![match self.get(id)? {
            Some(d) => d,
            None => return Ok(vec![]),
        }];
        sources.extend(self.source_descendants(id)?);
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for s in &sources {
            let names = self.names_of(s)?;
            let ph = Self::placeholders(names.len());
            let mut st = self.conn.prepare(&format!(
                "SELECT DISTINCT {SUMMARY_COLS}, d.frontmatter FROM links l JOIN documents d ON d.id = l.from_id WHERE l.norm IN ({ph}) AND l.from_id != ?{} AND d.type != 'source'",
                names.len() + 1
            ))?;
            let mut args: Vec<&dyn rusqlite::ToSql> =
                names.iter().map(|n| n as &dyn rusqlite::ToSql).collect();
            args.push(&s.id);
            let rows = st.query_map(args.as_slice(), |r| {
                let d = row_summary(r)?;
                let fm: String = r.get("frontmatter")?;
                Ok((d, fm))
            })?;
            for r in rows {
                let (d, fm) = r?;
                if !seen.insert(d.id.clone()) {
                    continue;
                }
                let locator = serde_json::from_str::<Value>(&fm)
                    .ok()
                    .and_then(|v| v.get("locator").cloned())
                    .and_then(|v| match v {
                        Value::String(s) if !s.trim().is_empty() => Some(s),
                        Value::Number(n) => Some(n.to_string()),
                        _ => None,
                    });
                out.push(TrailEntry {
                    doc: d,
                    source: s.clone(),
                    locator,
                });
            }
        }
        out.sort_by(|a, b| {
            a.source
                .title
                .cmp(&b.source.title)
                .then_with(|| {
                    natural_cmp(
                        a.locator.as_deref().unwrap_or(""),
                        b.locator.as_deref().unwrap_or(""),
                    )
                })
                .then(a.doc.title.cmp(&b.doc.title))
        });
        Ok(out)
    }

    /// Every Clipping with the Citation it names, newest first.
    ///
    /// The Clippings view's one query (ADR 0013). A Clipping's Source is a
    /// frontmatter link rather than a column, so the join goes through `links`
    /// on `property = 'source'` — the property, not any mention of the Source,
    /// because a Clipping names exactly one and that is the one named here.
    /// `source_id` narrows to one Source *and its descendants*, for its Hub's
    /// Clippings section: a periodical's page gathers what was kept from its
    /// articles, the same rolling-up the reading trail does.
    pub fn clippings(&self, source_id: Option<&str>) -> Result<Vec<TrailEntry>> {
        // A Clipping cites its Source by name, so the join resolves that name
        // the way `resolve` does: `links.norm` against the Source's
        // `title_norm`, plus its aliases.
        let mut st = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLS}, d.frontmatter, s.id AS src_id
             FROM documents d
             JOIN links l ON l.from_id = d.id AND l.property = 'source' AND l.kind = 'prose'
             JOIN documents s ON s.type = 'source'
               AND (s.title_norm = l.norm
                    OR EXISTS (SELECT 1 FROM aliases a WHERE a.doc_id = s.id AND a.norm = l.norm))
             WHERE d.type = 'clipping'
             ORDER BY d.mtime DESC"
        ))?;
        let rows: Vec<(DocSummary, String, String)> = st
            .query_map([], |r| {
                Ok((row_summary(r)?, r.get("frontmatter")?, r.get("src_id")?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        // A Source's own Clippings plus everything kept from its parts.
        let wanted: Option<HashSet<String>> = match source_id {
            Some(id) => {
                let mut set: HashSet<String> = HashSet::new();
                set.insert(id.to_string());
                set.extend(self.source_descendants(id)?.into_iter().map(|d| d.id));
                Some(set)
            }
            None => None,
        };
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for (doc, fm, sid) in rows {
            // One row per Clipping: a Source named by both its title and an
            // alias would otherwise join twice.
            if !seen.insert(doc.id.clone()) {
                continue;
            }
            if wanted.as_ref().is_some_and(|w| !w.contains(&sid)) {
                continue;
            }
            let source = match self.get(&sid)? {
                Some(s) => s,
                None => continue,
            };
            let locator = serde_json::from_str::<Value>(&fm)
                .ok()
                .and_then(|v| v.get("locator").cloned())
                .and_then(|v| match v {
                    Value::String(s) if !s.trim().is_empty() => Some(s),
                    Value::Number(n) => Some(n.to_string()),
                    _ => None,
                });
            out.push(TrailEntry {
                doc,
                source,
                locator,
            });
        }
        Ok(out)
    }

    /// The Tags on each of `ids`, for filtering a list the caller already has.
    pub fn tags_of(&self, ids: &[String]) -> Result<HashMap<String, Vec<String>>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let ph = Self::placeholders(ids.len());
        let mut st = self.conn.prepare(&format!(
            "SELECT doc_id, tag FROM tags WHERE doc_id IN ({ph}) ORDER BY doc_id, tag"
        ))?;
        let args: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|i| i as &dyn rusqlite::ToSql).collect();
        let rows = st.query_map(args.as_slice(), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut out: HashMap<String, Vec<String>> = HashMap::new();
        for row in rows {
            let (id, tag) = row?;
            let list = out.entry(id).or_default();
            // A Tag written both in the body and in frontmatter is one Tag.
            if !list.contains(&tag) {
                list.push(tag);
            }
        }
        Ok(out)
    }

    pub fn unresolved(&self) -> Result<Vec<UnresolvedLink>> {
        let mut st = self
            .conn
            .prepare("SELECT target, COUNT(*) FROM links GROUP BY norm ORDER BY 2 DESC")?;
        let rows: Vec<(String, i64)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let mut out = Vec::new();
        for (target, count) in rows {
            if self.resolve(&target)?.is_none() {
                out.push(UnresolvedLink {
                    target,
                    count: count as u32,
                });
            }
        }
        Ok(out)
    }

    pub fn verse_count_in_index(&self) -> Result<u32> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM mentions", [], |r| r.get::<_, i64>(0))?
            as u32)
    }

    pub fn document_count(&self) -> Result<u32> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM documents", [], |r| r.get::<_, i64>(0))?
            as u32)
    }

    pub fn first_verse_of(&self, id: &str) -> Result<Option<VerseId>> {
        Ok(self
            .conn
            .query_row(
                "SELECT MIN(verse_id) FROM mentions WHERE doc_id = ?1",
                [id],
                |r| r.get::<_, Option<i64>>(0),
            )?
            .map(|v| VerseId(v as u32)))
    }

    /// Documents whose prose writes this document's name without linking it
    /// (ADR 0011).
    ///
    /// FTS narrows the vault to the documents that contain the word at all,
    /// then each of those is matched properly to find the real offsets: the
    /// FTS tokeniser is close enough to pick candidates and too loose to be
    /// trusted for "is this genuinely an unlinked mention".
    ///
    /// Documents that already Mention this one are absent entirely, so an
    /// Unlinked mention and a Backlink are never the same document. Most
    /// recently edited first, since that is the material being worked on.
    pub fn unlinked_mentions(&self, id: &str, limit: usize) -> Result<UnlinkedMentions> {
        let doc = match self.get(id)? {
            Some(d) => d,
            None => return Ok(UnlinkedMentions::default()),
        };
        if !doc.doc_type.is_linkable_target() {
            return Ok(UnlinkedMentions::default());
        }
        let mut names = vec![doc.title.clone()];
        names.extend(self.aliases_of(id)?);
        names.retain(|n| !n.trim().is_empty());
        if names.is_empty() {
            return Ok(UnlinkedMentions::default());
        }
        // Documents already pointing here are out of scope by definition, and
        // so is this document itself.
        let linked = self.linking_docs(&doc)?;
        let matcher = unlinked::Matcher::new(&names);
        let mut hits: Vec<(i64, UnlinkedMention)> = Vec::new();
        let mut total = 0usize;
        let mut st = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLS}, f.body FROM docs_fts f JOIN documents d ON d.id = f.id
             WHERE docs_fts MATCH ?1 ORDER BY d.mtime DESC"
        ))?;
        let query = fts_any_phrase(&names);
        let rows = st.query_map(params![query], |r| {
            Ok((row_summary(r)?, r.get::<_, String>("body")?))
        })?;
        for row in rows {
            let (d, body) = row?;
            if d.id == id || linked.contains(&d.id) {
                continue;
            }
            for occ in matcher.find(&body) {
                total += 1;
                if hits.len() < limit {
                    hits.push((
                        d.mtime,
                        UnlinkedMention {
                            doc: d.clone(),
                            start: occ.start,
                            end: occ.end,
                            matched: occ.matched,
                            excerpt: excerpt_at(&body, occ.start),
                        },
                    ));
                }
            }
        }
        hits.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then(a.1.doc.title.cmp(&b.1.doc.title))
                .then(a.1.start.cmp(&b.1.start))
        });
        Ok(UnlinkedMentions {
            items: hits.into_iter().map(|(_, m)| m).collect(),
            total: total as u32,
        })
    }

    /// Ids of every document that already Mentions `doc`, by link, Tag or —
    /// for Scripture — a detected Passage.
    fn linking_docs(&self, doc: &DocSummary) -> Result<HashSet<String>> {
        let names = self.names_of(doc)?;
        let ph = Self::placeholders(names.len());
        let args: Vec<&dyn rusqlite::ToSql> =
            names.iter().map(|n| n as &dyn rusqlite::ToSql).collect();
        let mut out = HashSet::new();
        for sql in [
            format!("SELECT from_id FROM links WHERE norm IN ({ph})"),
            format!("SELECT doc_id FROM tags WHERE norm IN ({ph})"),
        ] {
            let mut st = self.conn.prepare(&sql)?;
            for r in st.query_map(args.as_slice(), |r| r.get::<_, String>(0))? {
                out.insert(r?);
            }
        }
        Ok(out)
    }

    /// Names in `body` that match a Topical Subject or Source and are not yet
    /// Mentions: the Linkable side of ADR 0011.
    ///
    /// `body` is the live editor text, which is why this takes a string rather
    /// than an id: the text being asked about has usually not been saved.
    /// Grouped one row per target, because the decision the writer is making
    /// is "should this document link to Barnabas", asked once.
    pub fn linkables(&self, exclude_id: &str, body: &str, limit: usize) -> Result<Vec<Linkable>> {
        let targets = self.linkable_targets(exclude_id)?;
        if targets.is_empty() {
            return Ok(vec![]);
        }
        let names: Vec<&str> = targets.iter().map(|(n, _)| n.as_str()).collect();
        let matcher = unlinked::Matcher::new(&names);
        let mut by_doc: HashMap<String, Linkable> = HashMap::new();
        let mut order: Vec<String> = Vec::new();
        for occ in matcher.find(body) {
            let (_, doc) = &targets[occ.name_index];
            let e = by_doc.entry(doc.id.clone()).or_insert_with(|| {
                order.push(doc.id.clone());
                Linkable {
                    doc: doc.clone(),
                    count: 0,
                    start: occ.start,
                    end: occ.end,
                    matched: occ.matched.clone(),
                    ambiguous: vec![],
                }
            });
            e.count += 1;
        }
        // A target the writer has already linked anywhere in this document is
        // done with: the decision "should this document link to Barnabas" was
        // made, and asking again for every later mention turns one choice into
        // a chore (ADR 0011). Obsidian's convention is the same — link the
        // first mention, leave the rest as prose.
        let mut linked: HashSet<String> = HashSet::new();
        for t in unlinked::link_targets(body) {
            if let Some(d) = self.resolve(&t)? {
                linked.insert(d.id);
            }
        }
        let mut out: Vec<Linkable> = order
            .into_iter()
            .filter(|id| !linked.contains(id))
            .filter_map(|id| by_doc.remove(&id))
            .collect();
        out.sort_by(|a, b| a.start.cmp(&b.start));
        out.truncate(limit);
        // Only now, for the few rows that survive, ask whether the title is
        // shared: the app must never pick between two documents of the same
        // name on the user's behalf.
        for l in &mut out {
            let same = self.docs_titled(&l.doc.title)?;
            if same.len() > 1 {
                l.ambiguous = same;
            }
        }
        Ok(out)
    }

    /// Every name that may be offered as a Linkable, paired with its document.
    /// One row per name, so a document with aliases appears several times.
    fn linkable_targets(&self, exclude_id: &str) -> Result<Vec<(String, DocSummary)>> {
        let mut out = Vec::new();
        let mut st = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLS} FROM documents d WHERE d.id != ?1"
        ))?;
        let rows = st.query_map([exclude_id], row_summary)?;
        for r in rows {
            let d = r?;
            if !d.doc_type.is_linkable_target() || d.title.trim().is_empty() {
                continue;
            }
            for name in std::iter::once(d.title.clone()).chain(self.aliases_of(&d.id)?) {
                if !name.trim().is_empty() {
                    out.push((name, d.clone()));
                }
            }
        }
        Ok(out)
    }

    /// Every document carrying `title`, for telling an ambiguous name apart.
    fn docs_titled(&self, title: &str) -> Result<Vec<DocSummary>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLS} FROM documents d WHERE d.title_norm = ?1 ORDER BY d.path"
        ))?;
        let rows = st.query_map([norm(title)], row_summary)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Titles shared by more than one document.
    ///
    /// `resolve()` sends such a title to the shortest path and says nothing,
    /// which is tolerable for a link the user typed and not for one the app
    /// offers to insert. Surfaced beside unresolved links so the user can fix
    /// the collision rather than discover it through a wrong link.
    pub fn ambiguous_titles(&self) -> Result<Vec<AmbiguousTitle>> {
        let mut st = self.conn.prepare(
            "SELECT title_norm FROM documents GROUP BY title_norm HAVING COUNT(*) > 1",
        )?;
        let norms: Vec<String> = st
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        let mut out = Vec::new();
        for n in norms {
            let docs = self.docs_titled(&n)?;
            if let Some(first) = docs.first() {
                out.push(AmbiguousTitle {
                    title: first.title.clone(),
                    docs,
                });
            }
        }
        out.sort_by(|a, b| natural_cmp(&a.title, &b.title));
        Ok(out)
    }
}

/// An FTS query matching any of `names`, each as a phrase.
///
/// Phrases, not bare terms, so a multi-word name narrows on the whole name
/// rather than on every document containing either word.
fn fts_any_phrase(names: &[String]) -> String {
    names
        .iter()
        .map(|n| {
            let cleaned: String = n
                .chars()
                .map(|c| if c.is_alphanumeric() { c } else { ' ' })
                .collect();
            format!("\"{}\"", cleaned.split_whitespace().collect::<Vec<_>>().join(" "))
        })
        .filter(|q| q.len() > 2)
        .collect::<Vec<_>>()
        .join(" OR ")
}

/// "p. 3" < "p. 12"; "14:32" < "1:02:00" is not handled, but digits sort numerically.
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, _) => return std::cmp::Ordering::Less,
            (_, None) => return std::cmp::Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let mut na = 0u64;
                while let Some(c) = ai.peek().copied().filter(|c| c.is_ascii_digit()) {
                    na = na * 10 + c.to_digit(10).unwrap() as u64;
                    ai.next();
                }
                let mut nb = 0u64;
                while let Some(c) = bi.peek().copied().filter(|c| c.is_ascii_digit()) {
                    nb = nb * 10 + c.to_digit(10).unwrap() as u64;
                    bi.next();
                }
                if na != nb {
                    return na.cmp(&nb);
                }
            }
            (Some(x), Some(y)) => {
                let (lx, ly) = (
                    x.to_lowercase().next().unwrap(),
                    y.to_lowercase().next().unwrap(),
                );
                if lx != ly {
                    return lx.cmp(&ly);
                }
                ai.next();
                bi.next();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document;

    /// ADR 0013: a Clipping names itself on the Graph with its own words, cut
    /// to something drawable rather than laid across its neighbours.
    #[test]
    fn a_long_label_is_cut_on_a_word_boundary_for_the_graph() {
        let summary = |label: &str| DocSummary {
            id: "x".into(),
            path: "Clippings/x.md".into(),
            title: "x".into(),
            label: label.into(),
            doc_type: DocType::Clipping,
            mtime: 0,
            book: None,
            chapter: None,
            verse: None,
            lat: None,
            lon: None,
            first_verse: None,
            start: None,
            end: None,
        };
        // Short enough to draw: left exactly as it is, with no ellipsis.
        assert_eq!(graph_label(&summary("Endurance")), "Endurance");
        let long = graph_label(&summary(
            "Endurance is not merely putting up with a trial; it is remaining steadfast.",
        ));
        assert!(long.ends_with('…'), "got {long}");
        assert!(long.chars().count() <= GRAPH_LABEL_CHARS + 1, "got {long}");
        // Cut between words, so the tail is not half a word.
        assert_eq!(long, "Endurance is not merely putting up with…");
        // A single unbroken run has no boundary to cut on, and is still cut.
        let unbroken = graph_label(&summary(&"a".repeat(80)));
        assert_eq!(unbroken.chars().count(), GRAPH_LABEL_CHARS + 1);
    }

    /// ADR 0013: the Clippings view's one query, and the Source Hub's section.
    #[test]
    fn clippings_carry_their_citation_and_narrow_to_one_source() {
        let idx = idx_with(&[
            (
                "s1",
                "Sources/keep enduring with joy.md",
                "---\ntype: source\ntitle: Keep Enduring with Joy\nparent: \"[[The Watchtower]]\"\n---\n",
            ),
            (
                "s2",
                "Sources/the watchtower.md",
                "---\ntype: source\ntitle: The Watchtower\n---\n",
            ),
            (
                "c1",
                "Clippings/keep enduring with joy par. 12 2026-08-05 20.10.md",
                "---\ntype: clipping\nsource: \"[[Keep Enduring with Joy]]\"\nlocator: \"par. 12\"\n---\n> Endurance is remaining steadfast.",
            ),
            (
                "c2",
                "Clippings/the watchtower p. 3 2026-08-06 09.00.md",
                "---\ntype: clipping\nsource: \"[[The Watchtower]]\"\n---\n> Another borrowed line.",
            ),
            // A Note citing a Source is not a Clipping and never appears here.
            (
                "n1",
                "Notes/on endurance.md",
                "---\ntype: note\nsource: \"[[Keep Enduring with Joy]]\"\n---\nMy own thinking.",
            ),
        ]);

        let all = idx.clippings(None).unwrap();
        assert_eq!(all.len(), 2, "only Clippings, never the Note");
        let c1 = all.iter().find(|e| e.doc.id == "c1").unwrap();
        assert_eq!(c1.source.title, "Keep Enduring with Joy");
        assert_eq!(c1.locator.as_deref(), Some("par. 12"));
        // The label is the quote, not the file's Citation-shaped name.
        assert_eq!(c1.doc.label, "Endurance is remaining steadfast.");
        // A Locator is optional.
        let c2 = all.iter().find(|e| e.doc.id == "c2").unwrap();
        assert_eq!(c2.locator, None);

        let one = idx.clippings(Some("s1")).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].doc.id, "c1");

        // A parent Source gathers what was kept from its parts, the way the
        // reading trail does: "s2" is the periodical "s1" is an article in.
        let rolled = idx.clippings(Some("s2")).unwrap();
        let ids: HashSet<&str> = rolled.iter().map(|e| e.doc.id.as_str()).collect();
        assert_eq!(ids, HashSet::from(["c1", "c2"]), "the article's Clipping rolls up");
    }

    fn idx_with(docs: &[(&str, &str, &str)]) -> Index {
        let mut idx = Index::in_memory().unwrap();
        for (id, path, text) in docs {
            let parsed = document::parse(path, text);
            idx.upsert(
                id,
                path,
                1,
                text,
                &parsed,
                &["start", "end", "born", "died", "anointed"],
            )
            .unwrap();
        }
        idx
    }

    /// A Journey whose route exercises every Stop status, plus a Place visited
    /// twice so the repeat-visit case (ADR 0010) is covered.
    fn journey_vault() -> Vec<(&'static str, &'static str, &'static str)> {
        vec![
            (
                "a",
                "Places/antioch.md",
                "---
type: place
title: Antioch
lat: 36.2
lon: 36.16
---
",
            ),
            (
                "e",
                "Places/ephesus.md",
                "---
type: place
title: Ephesus
lat: 37.9391
lon: 27.3407
---
",
            ),
            // A Place the user made but never located: real, not drawable.
            (
                "d",
                "Places/derbe.md",
                "---
type: place
title: Derbe
---
",
            ),
            // Not a Place at all.
            (
                "p",
                "Characters/paul.md",
                "---
type: character
title: Paul
---
",
            ),
            (
                "j",
                "Journeys/second missionary journey.md",
                "---
type: journey
title: Second missionary journey
start: c. 49 CE
end: c. 52 CE
places: [\"[[Antioch]]\", \"[[Derbe]]\", \"[[Ephesus]]\", \"[[Nowhere]]\", \"[[Paul]]\", \"[[Antioch]]\"]
---
",
            ),
        ]
    }

    #[test]
    fn journeys_keep_route_order_and_report_every_stop() {
        let idx = idx_with(&journey_vault());
        let journeys = idx.journeys().unwrap();
        assert_eq!(journeys.len(), 1);
        let j = &journeys[0];
        assert_eq!(j.doc.title, "Second missionary journey");

        // Travel order, exactly as written — not alphabetical, not by id.
        let names: Vec<&str> = j.stops.iter().map(|s| s.target.as_str()).collect();
        assert_eq!(
            names,
            vec!["Antioch", "Derbe", "Ephesus", "Nowhere", "Paul", "Antioch"]
        );

        let statuses: Vec<StopStatus> = j.stops.iter().map(|s| s.status).collect();
        assert_eq!(
            statuses,
            vec![
                StopStatus::Ok,
                StopStatus::NoCoords,
                StopStatus::Ok,
                StopStatus::Unresolved,
                StopStatus::NotAPlace,
                StopStatus::Ok,
            ]
        );

        // An unresolved Stop still names what the user wrote.
        assert!(j.stops[3].doc.is_none());
        // A Place visited twice is the same document at two positions.
        assert_eq!(
            j.stops[0].doc.as_ref().unwrap().id,
            j.stops[5].doc.as_ref().unwrap().id
        );
    }

    #[test]
    fn journey_route_order_survives_a_reindex() {
        // The order is `links.rowid`, so re-indexing the Journey (an edit, an
        // external change, a rebuild) must not reverse or shuffle the route.
        let docs = journey_vault();
        let mut idx = idx_with(&docs);
        let before: Vec<String> = idx.journeys().unwrap()[0]
            .stops
            .iter()
            .map(|s| s.target.clone())
            .collect();

        let (id, path, text) = docs.iter().find(|(id, _, _)| *id == "j").unwrap();
        let parsed = document::parse(path, text);
        idx.upsert(id, path, 2, text, &parsed, &["start", "end"])
            .unwrap();

        let after: Vec<String> = idx.journeys().unwrap()[0]
            .stops
            .iter()
            .map(|s| s.target.clone())
            .collect();
        assert_eq!(before, after, "route order survives a re-index");
    }

    #[test]
    fn place_facts_reach_books_through_the_documents_that_link_to_a_place() {
        let idx = idx_with(&[
            (
                "e",
                "Places/ephesus.md",
                "---
type: place
title: Ephesus
lat: 37.9391
lon: 27.3407
tags: [travel, Travel]
---
",
            ),
            (
                "b",
                "Places/babylon.md",
                "---
type: place
title: Babylon
lat: 32.5
lon: 44.4
---
",
            ),
            // Links to Ephesus and cites Acts 20:31, so Ephesus reaches book 44.
            (
                "n1",
                "Notes/paul at ephesus.md",
                "---
type: note
---
[[Ephesus]] — Paul spent three years here (Ac 20:31).
",
            ),
            // A second document, citing Revelation 2:1: Ephesus reaches book 66
            // too, and its mention count rises to two.
            (
                "n2",
                "Notes/letters.md",
                "---
type: note
---
To the congregation in [[Ephesus]] (Re 2:1).
",
            ),
        ]);
        let facts = idx.place_facts().unwrap();
        let by = |id: &str| facts.iter().find(|f| f.doc == id).unwrap().clone();

        let e = by("e");
        assert_eq!(e.books, vec![44, 66], "Acts and Revelation, through citers");
        assert_eq!(e.mentions, 2);
        // Deduplicated by norm: "travel" and "Travel" offer one chip.
        assert_eq!(e.tags.len(), 1, "tags deduplicated by norm: {:?}", e.tags);

        // A Place nothing links to is still returned, with empty facts, so the
        // UI can tell it apart from a Place that was never indexed.
        let b = by("b");
        assert!(b.books.is_empty());
        assert_eq!(b.mentions, 0);
        assert!(b.tags.is_empty());
    }

    #[test]
    fn place_facts_ignore_board_refs() {
        let mut idx = Index::in_memory().unwrap();
        let place = "---
type: place
title: Corinth
lat: 37.9
lon: 22.8
---
";
        let parsed = document::parse("Places/corinth.md", place);
        idx.upsert("c", "Places/corinth.md", 1, place, &parsed, &[])
            .unwrap();
        // A Board ref to Corinth, recorded with kind 'board' (PLAN §17.6).
        idx.conn
            .execute(
                "INSERT INTO links(from_id, target, norm, alias, embed, start, end, property, kind) \
                 VALUES('t', 'Corinth', 'corinth', NULL, 0, 0, 0, NULL, 'board')",
                [],
            )
            .unwrap();
        let facts = idx.place_facts().unwrap();
        let c = facts.iter().find(|f| f.doc == "c").unwrap();
        assert_eq!(
            c.mentions, 0,
            "material on a Board is not a claim about a Place"
        );
    }

    #[test]
    fn timeline_tags_covers_dated_documents_only() {
        let idx = idx_with(&[
            (
                "d",
                "Characters/David.md",
                "---
type: character
born: c. 1107 BCE
tags: [kings, Kings]
---
",
            ),
            (
                "p",
                "Characters/Paul.md",
                "---
type: character
born: 5 CE
tags: [apostles]
---
",
            ),
            // Tagged, but carries no Date: never a Lane, so never a chip.
            (
                "m",
                "Characters/Moses.md",
                "---
type: character
tags: [prophets]
---
",
            ),
            // Dated, but its Date does not parse, so it is off the Timeline too.
            (
                "f",
                "Events/Flood.md",
                "---
type: event
start: not a date
tags: [judgment]
---
",
            ),
        ]);
        let tags = idx.timeline_tags().unwrap();
        let pairs: Vec<(&str, &str)> = tags
            .iter()
            .map(|x| (x.doc.as_str(), x.tag.as_str()))
            .collect();
        // Two spellings of one Tag group by norm into a single pair, as `tags()` does.
        assert_eq!(pairs, vec![("p", "apostles"), ("d", "Kings")]);
    }

    #[test]
    fn dates_are_indexed_from_typed_properties() {
        let idx = idx_with(&[
            ("d", "Characters/David.md", "---\ntype: character\nborn: c. 1107 BCE\nanointed: c. 1077 BCE\ndied: 1037 BCE\nmodern_name: 33 CE\n---\n"),
            ("e", "Events/Exodus.md", "---\ntype: event\nstart: 1513 BCE\nplace: \"[[Egypt]]\"\ncharacters: [\"[[Moses]]\", \"[[David]]\"]\n---\n"),
            ("f", "Events/Flood.md", "---\ntype: event\nstart: 2370 BCE\nend: not a date\n---\n"),
            ("m", "Characters/Moses.md", "---\ntype: character\n---\n"),
        ]);
        // modern_name is not a Date-typed name, so "33 CE" there is ignored.
        let d = idx.dates_of("d").unwrap();
        let names: Vec<_> = d.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(names, vec!["born", "anointed", "died"]);
        assert!(d.iter().all(|x| x.date.is_some()));
        assert!(d[0].date.unwrap().approx);
        // Unparseable values are kept, flagged by a missing date, and off the Timeline.
        let f = idx.dates_of("f").unwrap();
        assert_eq!(f.len(), 2);
        assert!(f[1].date.is_none());
        assert_eq!(f[1].text, "not a date");
        let tl = idx.timeline().unwrap();
        let order: Vec<(&str, &str)> = tl
            .iter()
            .map(|x| (x.doc.id.as_str(), x.name.as_str()))
            .collect();
        assert_eq!(
            order,
            vec![
                ("f", "start"),
                ("e", "start"),
                ("d", "born"),
                ("d", "anointed"),
                ("d", "died")
            ]
        );
        // Events name their Characters and Place through link Properties.
        let ev: Vec<_> = idx
            .events_naming("m")
            .unwrap()
            .into_iter()
            .map(|x| x.id)
            .collect();
        assert_eq!(ev, vec!["e"]);
        let ev: Vec<_> = idx
            .events_naming("d")
            .unwrap()
            .into_iter()
            .map(|x| x.id)
            .collect();
        assert_eq!(ev, vec!["e"]);
        // Egypt has no page, so only the resolved links remain.
        let links = idx.event_links().unwrap();
        assert_eq!(
            links,
            vec![
                EventLink {
                    event: "e".into(),
                    subject: "m".into()
                },
                EventLink {
                    event: "e".into(),
                    subject: "d".into()
                }
            ]
        );
        // An Event's summary carries its Dates as written, so any list can show
        // them without a second query; other types carry none.
        let e = idx.get("e").unwrap().unwrap();
        assert_eq!(e.start.as_deref(), Some("1513 BCE"));
        assert_eq!(e.end, None);
        let f = idx.get("f").unwrap().unwrap();
        assert_eq!(f.start.as_deref(), Some("2370 BCE"));
        assert_eq!(f.end.as_deref(), Some("not a date"));
        let d = idx.get("d").unwrap().unwrap();
        assert_eq!((d.start, d.end), (None, None));
    }

    #[test]
    fn events_naming_is_chronological_with_undated_last() {
        let idx = idx_with(&[
            ("m", "Characters/Moses.md", "---\ntype: character\n---\n"),
            // Alphabetically first, chronologically last.
            ("a", "Events/Aaron dies.md", "---\ntype: event\ntitle: Aaron dies\nstart: 1473 BCE\ncharacters: [\"[[Moses]]\"]\n---\n"),
            ("x", "Events/Exodus.md", "---\ntype: event\ntitle: The Exodus\nstart: 1513 BCE\ncharacters: [\"[[Moses]]\"]\n---\n"),
            ("b", "Events/Burning bush.md", "---\ntype: event\ntitle: Burning bush\nstart: c. 1514 BCE\ncharacters: [\"[[Moses]]\"]\n---\n"),
            // Unparseable and missing `start` sort last, by title.
            ("u", "Events/Undated.md", "---\ntype: event\ntitle: Zzz undated\ncharacters: [\"[[Moses]]\"]\n---\n"),
            ("n", "Events/Not a date.md", "---\ntype: event\ntitle: Not a date\nstart: sometime\ncharacters: [\"[[Moses]]\"]\n---\n"),
        ]);
        let ev: Vec<_> = idx
            .events_naming("m")
            .unwrap()
            .into_iter()
            .map(|x| x.id)
            .collect();
        assert_eq!(ev, vec!["b", "x", "a", "n", "u"]);
    }

    #[test]
    fn resolve_and_backlinks() {
        let idx = idx_with(&[
            ("p", "Characters/Paul.md", "---\ntype: character\naliases: [Saul]\n---\nApostle."),
            ("n1", "Notes/One.md", "[[Paul]] wrote Romans 8:28 and #paul"),
            ("n2", "Notes/Two.md", "See [[Saul|the man]] and Ro 8:28-30."),
            ("v", "Scripture/Romans/Romans 8/Romans 8.28.md", "---\ntype: verse\nbook: Romans\nbook_number: 45\nchapter: 8\nverse: 28\naliases:\n  - \"Romans 8:28\"\n---\n"),
        ]);
        assert_eq!(idx.resolve("paul").unwrap().unwrap().id, "p");
        assert_eq!(idx.resolve("Saul").unwrap().unwrap().id, "p");
        assert_eq!(idx.resolve("Characters/Paul").unwrap().unwrap().id, "p");
        assert_eq!(idx.resolve("Romans 8:28").unwrap().unwrap().id, "v");
        let bl = idx.backlinks("p", Lang::En).unwrap();
        let kinds: Vec<_> = bl.iter().map(|b| (b.doc.id.as_str(), b.kind)).collect();
        assert!(kinds.contains(&("n1", BacklinkKind::Link)));
        assert!(kinds.contains(&("n1", BacklinkKind::Tag)));
        assert!(kinds.contains(&("n2", BacklinkKind::Link)));
        let vb = idx.backlinks("v", Lang::En).unwrap();
        let via: Vec<_> = vb.iter().map(|b| b.via.clone().unwrap()).collect();
        assert!(via.contains(&"Romans 8:28".to_string()));
        assert!(via.contains(&"Romans 8:28-30".to_string()));
        assert_eq!(idx.coverage().unwrap()[0].count, 2);
    }

    #[test]
    fn graph_and_search() {
        let idx = idx_with(&[
            ("n1", "Notes/One.md", "[[Two]] and John 3:16 and John 3:17"),
            ("n2", "Notes/Two.md", "Endurance under trial. Jas 1:2"),
        ]);
        let g = idx.graph(GraphLevel::Chapter, Lang::En).unwrap();
        let ids: Vec<_> = g.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains(&"s:43:3"));
        assert!(ids.contains(&"s:59:1"));
        assert_eq!(g.edges.len(), 3);
        let g = idx.graph(GraphLevel::Verse, Lang::En).unwrap();
        assert_eq!(g.edges.len(), 4);
        let hits = idx.search("endur", 10).unwrap();
        assert_eq!(hits[0].doc.id, "n2");
        assert!(hits[0].snippet.contains("[Endurance]"));
    }

    #[test]
    fn candidates_and_trail() {
        let idx = idx_with(&[
            ("wt", "Sources/The Watchtower.md", "---\ntype: source\nkind: periodical\n---\n"),
            ("wt1", "Sources/The Watchtower 2024-03.md", "---\ntype: source\nparent: \"[[The Watchtower]]\"\n---\n"),
            ("c1", "Clippings/A.md", "---\ntype: clipping\nsource: \"[[The Watchtower 2024-03]]\"\nlocator: \"par. 12\"\n---\nQuote #endurance"),
            ("c2", "Clippings/B.md", "---\ntype: clipping\nsource: \"[[The Watchtower 2024-03]]\"\nlocator: \"par. 3\"\n---\nQuote two"),
            ("comp", "Compositions/Talk.md", "---\ntype: composition\n---\n#endurance Romans 5:3"),
            ("n", "Notes/N.md", "Ro 5:3-5 on endurance"),
        ]);
        let trail = idx.source_trail("wt").unwrap();
        let locs: Vec<_> = trail.iter().map(|t| t.locator.clone().unwrap()).collect();
        assert_eq!(locs, vec!["par. 3", "par. 12"]);
        let c = idx.candidates("comp", Lang::En, 10).unwrap();
        let ids: Vec<_> = c.iter().map(|x| x.doc.id.as_str()).collect();
        assert_eq!(ids, vec!["c1", "n"]);
        assert_eq!(c[1].shared_passages, vec!["Romans 5:3-5"]);
        assert!(c.iter().all(|x| !x.used));
    }

    #[test]
    fn unlinked_mentions_finds_prose_that_does_not_link() {
        let idx = idx_with(&[
            ("p", "Places/Antioch.md", "---\ntype: place\n---\n"),
            ("n1", "Notes/A.md", "The brothers in Antioch sent them on."),
            ("n2", "Notes/B.md", "They left [[Antioch]] at once."),
            ("n3", "Notes/C.md", "About Antiochus the king."),
        ]);
        let u = idx.unlinked_mentions("p", 50).unwrap();
        let ids: Vec<_> = u.items.iter().map(|m| m.doc.id.as_str()).collect();
        // n2 links it already, so it is a Backlink and not an Unlinked
        // mention; n3 only contains the name inside a longer word.
        assert_eq!(ids, vec!["n1"]);
        assert_eq!(u.total, 1);
        assert_eq!(u.items[0].matched, "Antioch");
        assert!(u.items[0].excerpt.contains("brothers in Antioch"));
    }

    #[test]
    fn a_document_that_links_anywhere_is_never_an_unlinked_mention() {
        // Exclusion 8 of ADR 0011: the two lists are disjoint, so a second
        // bare occurrence in a document that already links is not offered.
        let idx = idx_with(&[
            ("p", "Places/Antioch.md", "---\ntype: place\n---\n"),
            ("n", "Notes/A.md", "[[Antioch]] grew, and Antioch sent them."),
        ]);
        assert_eq!(idx.unlinked_mentions("p", 50).unwrap().total, 0);
    }

    #[test]
    fn a_tag_counts_as_linking_too() {
        let idx = idx_with(&[
            ("c", "Concepts/Endurance.md", "---\ntype: concept\n---\n"),
            ("n", "Notes/A.md", "---\ntags: [endurance]\n---\nOn endurance."),
        ]);
        assert_eq!(idx.unlinked_mentions("c", 50).unwrap().total, 0);
    }

    #[test]
    fn unlinked_mentions_match_aliases_and_keep_the_prose() {
        let idx = idx_with(&[
            (
                "ch",
                "Characters/Barnabas.md",
                "---\ntype: character\naliases: [Joseph]\n---\n",
            ),
            ("n", "Notes/A.md", "Joseph's encouragement was known."),
        ]);
        let u = idx.unlinked_mentions("ch", 50).unwrap();
        assert_eq!(u.items.len(), 1);
        assert_eq!(u.items[0].matched, "Joseph's");
        assert_eq!(
            unlinked::link_text("Barnabas", &u.items[0].matched, None),
            "[[Barnabas|Joseph's]]"
        );
    }

    #[test]
    fn scripture_and_writing_gather_no_unlinked_mentions() {
        let idx = idx_with(&[
            ("n1", "Notes/Endurance.md", "On endurance."),
            ("n2", "Notes/B.md", "More on Endurance here."),
        ]);
        // A Note is not a linkable target: the mirror rule of ADR 0011.
        assert_eq!(idx.unlinked_mentions("n1", 50).unwrap().total, 0);
    }

    #[test]
    fn unlinked_mentions_report_a_total_past_the_cap() {
        let idx = idx_with(&[
            ("p", "Places/Antioch.md", "---\ntype: place\n---\n"),
            ("n", "Notes/A.md", "Antioch. Antioch. Antioch. Antioch."),
        ]);
        let u = idx.unlinked_mentions("p", 2).unwrap();
        assert_eq!(u.items.len(), 2);
        assert_eq!(u.total, 4);
    }

    #[test]
    fn linkables_group_by_target_and_skip_what_is_linked() {
        let idx = idx_with(&[
            ("p", "Places/Antioch.md", "---\ntype: place\n---\n"),
            ("ch", "Characters/Paul.md", "---\ntype: character\n---\n"),
            ("v", "Scripture/John.md", "---\ntype: book\n---\n"),
            ("n", "Notes/A.md", ""),
        ]);
        let body = "Paul went to Antioch, and Antioch received him. John 3:16 was read.";
        let l = idx.linkables("n", body, 50).unwrap();
        let got: Vec<_> = l.iter().map(|x| (x.doc.id.as_str(), x.count)).collect();
        // Antioch twice but one row; Scripture is never a Linkable.
        assert_eq!(got, vec![("ch", 1), ("p", 2)]);
        assert_eq!(l[1].start, 13);
        assert_eq!(l[1].matched, "Antioch");
    }

    #[test]
    fn a_name_already_linked_in_the_text_is_not_linkable() {
        let idx = idx_with(&[
            ("p", "Places/Antioch.md", "---\ntype: place\n---\n"),
            ("n", "Notes/A.md", ""),
        ]);
        assert!(idx.linkables("n", "Left [[Antioch]] today.", 50).unwrap().is_empty());
        assert!(idx.linkables("n", "Left #Antioch today.", 50).unwrap().is_empty());
    }

    #[test]
    fn a_target_linked_once_stops_being_offered() {
        let idx = idx_with(&[
            ("p", "Places/Antioch.md", "---\ntype: place\n---\n"),
            ("ch", "Characters/Paul.md", "---\ntype: character\n---\n"),
            ("n", "Notes/A.md", ""),
        ]);
        // Antioch is linked once and written twice more; Paul is untouched.
        let body = "Paul left [[Antioch]]. Antioch grew, and Antioch sent him.";
        let l = idx.linkables("n", body, 50).unwrap();
        let got: Vec<_> = l.iter().map(|x| x.doc.id.as_str()).collect();
        assert_eq!(got, vec!["ch"], "the linked target is done with");
    }

    #[test]
    fn an_alias_link_retires_the_target_it_names() {
        let idx = idx_with(&[
            ("ch", "Characters/Paul.md", "---\ntype: character\naliases: [Saul]\n---\n"),
            ("n", "Notes/A.md", ""),
        ]);
        // Linked by its alias, then written by its title: still the same
        // document, so it is not offered again.
        assert!(idx
            .linkables("n", "[[Saul]] travelled. Paul wrote later.", 50)
            .unwrap()
            .is_empty());
        // And linked by path, with the prose kept as the alias.
        assert!(idx
            .linkables("n", "[[Characters/Paul|Saul]] went. Saul returned.", 50)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn an_ambiguous_title_is_reported_rather_than_guessed() {
        let idx = idx_with(&[
            ("p1", "Places/Antioch.md", "---\ntype: place\n---\n"),
            ("p2", "Places/Pisidia/Antioch.md", "---\ntype: place\n---\n"),
            ("n", "Notes/A.md", ""),
        ]);
        let l = idx.linkables("n", "Went to Antioch then.", 50).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].ambiguous.len(), 2);
        let amb = idx.ambiguous_titles().unwrap();
        assert_eq!(amb.len(), 1);
        assert_eq!(amb[0].docs.len(), 2);
    }

    #[test]
    fn board_refs_are_not_prose_links() {
        // Placing material on a Board marks it as on the Board, and leaves it
        // a Candidate: the Board is where nothing is committed (PLAN §17.6).
        let mut idx = idx_with(&[
            ("n1", "Notes/Steadfast.md", "---
tags: [endurance]
---
On endurance"),
            ("n2", "Notes/Patience.md", "---
tags: [endurance]
---
On patience"),
            (
                "comp",
                "Compositions/Talk.md",
                "---
type: composition
tags: [endurance]
---
Body",
            ),
        ]);
        idx.set_board_refs("comp", &["Notes/Steadfast.md".into()])
            .unwrap();

        let c = idx.candidates("comp", Lang::En, 10).unwrap();
        let steadfast = c.iter().find(|x| x.doc.id == "n1").unwrap();
        let patience = c.iter().find(|x| x.doc.id == "n2").unwrap();
        assert!(steadfast.on_board, "board ref not reported");
        assert!(!steadfast.used, "board ref wrongly counted as used");
        assert!(!patience.on_board);
        assert!(!patience.used);
        // Untouched material sorts before what is already on the Board.
        let order: Vec<&str> = c.iter().map(|x| x.doc.id.as_str()).collect();
        assert_eq!(order, vec!["n2", "n1"]);

        // And the Composition is findable from the document's side.
        let boards = idx.boards_referencing("n1").unwrap();
        assert_eq!(boards.len(), 1);
        assert_eq!(boards[0].id, "comp");
        assert!(idx.boards_referencing("n2").unwrap().is_empty());
    }

    /// Opening an index written before Boards existed must migrate it rather
    /// than fail. Every other test builds a fresh database, which is how a
    /// `CREATE INDEX` on a column older databases lack reached a release.
    #[test]
    fn an_index_predating_boards_opens_and_migrates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.sqlite");
        // The `links` table exactly as a pre-Boards build wrote it: no `kind`.
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE links(from_id TEXT NOT NULL, target TEXT NOT NULL, norm TEXT NOT NULL,
                   alias TEXT, embed INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
                   property TEXT);
                 INSERT INTO links(from_id, target, norm, alias, embed, start, end, property)
                   VALUES('a', 'Notes/b.md', 'b', NULL, 0, 0, 0, NULL);",
            )
            .unwrap();
        }

        let idx = Index::open(&path).unwrap();

        // The column arrived, the index on it exists, and the row that was
        // already there counts as prose rather than being lost or reclassified.
        let kind: String = idx
            .conn
            .query_row("SELECT kind FROM links WHERE from_id = 'a'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kind, "prose");
        let has_index: bool = idx
            .conn
            .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='links_kind'")
            .unwrap()
            .exists([])
            .unwrap();
        assert!(has_index, "links_kind index not created");

        // And opening it again is a no-op rather than a second migration.
        drop(idx);
        assert!(Index::open(&path).is_ok());
    }

    #[test]
    fn board_refs_survive_a_reindex_and_replace_cleanly() {
        let mut idx = idx_with(&[
            ("n1", "Notes/A.md", "A"),
            ("n2", "Notes/B.md", "B"),
            ("comp", "Compositions/Talk.md", "---
type: composition
---
Body"),
        ]);
        idx.set_board_refs("comp", &["Notes/A.md".into()]).unwrap();

        // Re-indexing the Composition's markdown must not drop refs that came
        // from the `.canvas` beside it.
        let text = "---
type: composition
---
Body edited";
        let parsed = document::parse("Compositions/Talk.md", text);
        idx.upsert("comp", "Compositions/Talk.md", 2, text, &parsed, &[])
            .unwrap();
        assert_eq!(idx.board_targets("comp").unwrap(), vec!["n1".to_string()]);

        // Setting refs replaces the previous set rather than adding to it.
        idx.set_board_refs("comp", &["Notes/B.md".into()]).unwrap();
        assert_eq!(idx.board_targets("comp").unwrap(), vec!["n2".to_string()]);

        // A path naming no document is skipped, never a phantom backlink.
        idx.set_board_refs("comp", &["Notes/gone.md".into()]).unwrap();
        assert!(idx.board_targets("comp").unwrap().is_empty());
    }

    #[test]
    fn candidates_mark_used_material() {
        // Embedding, linking (by alias) or tagging a document makes it used; sharing a Tag alone does not.
        let idx = idx_with(&[
            (
                "c1",
                "Clippings/A.md",
                "---
type: clipping
tags: [endurance]
---
Quote",
            ),
            (
                "c2",
                "Clippings/B.md",
                "---
type: clipping
tags: [endurance]
---
Quote two",
            ),
            (
                "n1",
                "Notes/Steadfast.md",
                "---
tags: [endurance]
aliases: [Hypomone]
---
Ro 5:3",
            ),
            (
                "n2",
                "Notes/Other.md",
                "---
tags: [endurance]
---
unrelated",
            ),
            (
                "k",
                "Concepts/Endurance.md",
                "---
type: concept
tags: [endurance]
---
",
            ),
            (
                "comp",
                "Compositions/Talk.md",
                "---
type: composition
tags: [endurance]
---
![[A]] and [[hypomone]] #Endurance
Ro 5:3",
            ),
        ]);
        let c = idx.candidates("comp", Lang::En, 10).unwrap();
        let rows: Vec<(&str, bool)> = c.iter().map(|x| (x.doc.id.as_str(), x.used)).collect();
        // Unused first, then used; within each, by score (n1 also shares the Passage) then title.
        assert_eq!(
            rows,
            vec![
                ("c2", false),
                ("n2", false),
                ("n1", true),
                ("c1", true),
                ("k", true)
            ]
        );
    }

    #[test]
    fn natural_order() {
        assert_eq!(natural_cmp("p. 3", "p. 12"), std::cmp::Ordering::Less);
        assert_eq!(natural_cmp("ch. 2", "ch. 10"), std::cmp::Ordering::Less);
    }

    fn board_vault() -> Index {
        idx_with(&[
            (
                "C1",
                "Clippings/steadfast.md",
                "---
type: clipping
title: Endurance is steadfastness
---
> Endurance is remaining steadfast with the right attitude.",
            ),
            (
                "N1",
                "Notes/trials.md",
                "---
type: note
title: Endurance in trials
---
# Endurance in trials

Jas 1:2-4 says to consider it all joy.

## Cross-references

Ro 5:3-5 links tribulation and hope.",
            ),
            (
                "P1",
                "Characters/paul.md",
                "---
type: character
title: Paul
---
",
            ),
            (
                "L1",
                "Notes/letter.md",
                "---
type: note
title: A letter
---
Written by [[Paul]] from prison.",
            ),
        ])
    }

    fn ask(idx: &Index, path: &str, sub: Option<&str>) -> BoardExcerpt {
        idx.board_excerpts(&[(path.to_string(), sub.map(str::to_string))])
            .unwrap()
            .remove(&board_excerpt_key(path, sub))
            .unwrap()
    }

    #[test]
    fn the_same_document_twice_keeps_its_two_excerpts_apart() {
        // A Board may hold the whole Note and one of its sections. Keyed by
        // path alone, the second would overwrite the first and both cards
        // would show the same text.
        let idx = board_vault();
        let path = "Notes/trials.md".to_string();
        let got = idx
            .board_excerpts(&[
                (path.clone(), None),
                (path.clone(), Some("#Cross-references".into())),
            ])
            .unwrap();
        assert_eq!(got.len(), 2, "the two cards collapsed into one");
        assert_eq!(
            got[&board_excerpt_key(&path, None)].text,
            "Jas 1:2-4 says to consider it all joy."
        );
        assert_eq!(
            got[&board_excerpt_key(&path, Some("#Cross-references"))].text,
            "Ro 5:3-5 links tribulation and hope."
        );
    }

    #[test]
    fn a_board_card_shows_body_text_not_just_a_type() {
        // The bug this feature fixes: cards showed only "Clipping" / "Note".
        let idx = board_vault();
        assert_eq!(
            ask(&idx, "Clippings/steadfast.md", None).text,
            "Endurance is remaining steadfast with the right attitude."
        );
        // The Note skips the heading repeating its title.
        assert_eq!(
            ask(&idx, "Notes/trials.md", None).text,
            "Jas 1:2-4 says to consider it all joy."
        );
    }

    #[test]
    fn a_subpath_node_shows_that_section() {
        let got = ask(&board_vault(), "Notes/trials.md", Some("#Cross-references"));
        assert_eq!(got.text, "Ro 5:3-5 links tribulation and hope.");
        assert!(!got.subpath_missing);
    }

    #[test]
    fn an_unresolvable_subpath_is_flagged() {
        let got = ask(&board_vault(), "Notes/trials.md", Some("#Gone"));
        assert!(got.subpath_missing);
        assert_eq!(got.text, "Jas 1:2-4 says to consider it all joy.");
    }

    #[test]
    fn a_subject_hub_with_no_body_falls_back_to_its_mention_count() {
        // PLAN §17.12: a Hub shows its type and mention count. Only when the
        // body says nothing — the fallback, not a second rule.
        let got = ask(&board_vault(), "Characters/paul.md", None);
        assert_eq!(got.text, "");
        assert_eq!(got.mentions, Some(1), "the letter links to Paul");
    }

    #[test]
    fn an_ordinary_document_never_reports_a_mention_count() {
        assert_eq!(ask(&board_vault(), "Notes/letter.md", None).mentions, None);
    }

    #[test]
    fn a_path_outside_the_vault_is_simply_absent() {
        // The card renders that as missing already; saying so twice is not
        // this method's job.
        let idx = board_vault();
        let got = idx
            .board_excerpts(&[("Notes/gone.md".to_string(), None)])
            .unwrap();
        assert!(got.is_empty());
    }

    #[test]
    fn one_call_answers_a_whole_board() {
        let idx = board_vault();
        let got = idx
            .board_excerpts(&[
                ("Clippings/steadfast.md".to_string(), None),
                ("Notes/trials.md".to_string(), Some("#Cross-references".into())),
                ("Notes/gone.md".to_string(), None),
            ])
            .unwrap();
        assert_eq!(got.len(), 2, "the missing path is skipped, the rest answered");
    }

    /// The demo vault's nesting: a periodical holding an issue holding an
    /// article, a book holding a chapter, and a standalone video.
    fn library_vault() -> Index {
        idx_with(&[
            (
                "wt",
                "Sources/the watchtower.md",
                "---\ntype: source\ntitle: The Watchtower\nkind: periodical\nurl: https://example.org/wt\n---\n",
            ),
            (
                "wt3",
                "Sources/the watchtower 2024-03.md",
                "---\ntype: source\ntitle: The Watchtower 2024-03\nkind: issue\ndate: 2024-03\nparent: \"[[The Watchtower]]\"\n---\n",
            ),
            (
                "joy",
                "Sources/keep enduring with joy.md",
                "---\ntype: source\ntitle: Keep Enduring with Joy\nkind: article\nparent: \"[[The Watchtower 2024-03]]\"\n---\n",
            ),
            (
                "ins",
                "Sources/insight.md",
                "---\ntype: source\ntitle: Insight\nkind: book\ncover: Attachments/insight.jpg\ndate: 1988\n---\n",
            ),
            (
                "eph",
                "Sources/insight ephesus.md",
                "---\ntype: source\ntitle: \"Insight: Ephesus\"\nkind: chapter\nparent: \"[[Insight]]\"\n---\n",
            ),
            (
                "mw",
                "Sources/morning worship.md",
                "---\ntype: source\ntitle: Morning Worship\nkind: video\ncover: https://example.org/mw.jpg\n---\n",
            ),
            // Not a Source: the Library must not list it.
            (
                "n",
                "Notes/trials.md",
                "---\ntype: note\ntitle: Trials\n---\nSomething about [[Insight]].\n",
            ),
        ])
    }

    fn entry<'a>(lib: &'a [LibraryEntry], id: &str) -> &'a LibraryEntry {
        lib.iter().find(|e| e.id == id).expect("entry missing")
    }

    #[test]
    fn library_reports_every_source_and_nothing_else() {
        let lib = library_vault().library().unwrap();
        let mut ids: Vec<_> = lib.iter().map(|e| e.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec!["eph", "ins", "joy", "mw", "wt", "wt3"]);
    }

    #[test]
    fn library_carries_what_a_card_needs() {
        let lib = library_vault().library().unwrap();
        let ins = entry(&lib, "ins");
        assert_eq!(ins.kind, "book");
        assert_eq!(ins.cover, "Attachments/insight.jpg");
        assert_eq!(ins.date, "1988");
        assert_eq!(ins.parent_id, None);
        // A remote Cover is reported as written; resolving it is the UI's job.
        assert_eq!(entry(&lib, "mw").cover, "https://example.org/mw.jpg");
        // Absent properties come back empty rather than missing.
        let wt = entry(&lib, "wt");
        assert_eq!(wt.date, "");
        assert_eq!(wt.cover, "");
    }

    #[test]
    fn library_resolves_the_parent_to_an_id() {
        let lib = library_vault().library().unwrap();
        // Written as a title, reported as an id, so a rename cannot orphan it.
        assert_eq!(entry(&lib, "wt3").parent_id.as_deref(), Some("wt"));
        assert_eq!(entry(&lib, "joy").parent_id.as_deref(), Some("wt3"));
        assert_eq!(entry(&lib, "eph").parent_id.as_deref(), Some("ins"));
    }

    #[test]
    fn library_counts_direct_children_not_descendants() {
        let lib = library_vault().library().unwrap();
        // The periodical holds one issue; the article underneath it is the
        // issue's child, not the periodical's. The card says "1 issue".
        assert_eq!(entry(&lib, "wt").child_count, 1);
        assert_eq!(entry(&lib, "wt3").child_count, 1);
        assert_eq!(entry(&lib, "ins").child_count, 1);
        assert_eq!(entry(&lib, "joy").child_count, 0);
        assert_eq!(entry(&lib, "mw").child_count, 0);
    }

    #[test]
    fn a_dangling_parent_leaves_the_child_top_level() {
        // The book is not in the vault, so the chapter has nothing to sit
        // inside. It stays parentless on purpose: the UI shelves it as
        // Unshelved, where the user can see it needs filing (ADR 0012).
        let idx = idx_with(&[(
            "c",
            "Sources/ch1.md",
            "---\ntype: source\ntitle: Chapter 1\nkind: chapter\nparent: \"[[Missing Book]]\"\n---\n",
        )]);
        let lib = idx.library().unwrap();
        assert_eq!(lib.len(), 1);
        assert_eq!(lib[0].parent_id, None);
        assert_eq!(lib[0].kind, "chapter");
    }

    #[test]
    fn library_sorts_numbered_titles_naturally() {
        let idx = idx_with(&[
            (
                "b",
                "Sources/ch10.md",
                "---\ntype: source\ntitle: Chapter 10\nkind: book\n---\n",
            ),
            (
                "a",
                "Sources/ch2.md",
                "---\ntype: source\ntitle: Chapter 2\nkind: book\n---\n",
            ),
        ]);
        let titles: Vec<_> = idx
            .library()
            .unwrap()
            .into_iter()
            .map(|e| e.title)
            .collect();
        assert_eq!(titles, vec!["Chapter 2", "Chapter 10"]);
    }

    #[test]
    fn an_unknown_kind_is_reported_rather_than_rejected() {
        // ADR 0003: the vault is hand-editable. The engine passes `kind`
        // through untouched and lets the UI decide it belongs on Unshelved.
        let idx = idx_with(&[(
            "s",
            "Sources/talk.md",
            "---\ntype: source\ntitle: A Sermon\nkind: sermon\n---\n",
        )]);
        let lib = idx.library().unwrap();
        assert_eq!(lib[0].kind, "sermon");
    }

    #[test]
    fn a_bare_year_is_read_as_a_date() {
        // `date: 1988` with no quotes is a YAML integer. Reading the property
        // as a string only would drop it, and the card would lose its year.
        let idx = idx_with(&[(
            "s",
            "Sources/insight.md",
            "---\ntype: source\ntitle: Insight\nkind: book\ndate: 1988\n---\n",
        )]);
        assert_eq!(idx.library().unwrap()[0].date, "1988");
    }

    #[test]
    fn a_source_with_no_kind_at_all_still_appears() {
        let idx = idx_with(&[(
            "s",
            "Sources/bare.md",
            "---\ntype: source\ntitle: Bare\n---\n",
        )]);
        let lib = idx.library().unwrap();
        assert_eq!(lib.len(), 1);
        assert_eq!(lib[0].kind, "");
    }

    #[test]
    fn child_sources_are_listed_in_natural_order() {
        // Plain `cmp` files "Chapter 10" before "Chapter 2", which makes a
        // Contains list of a dozen chapters read scrambled.
        let idx = idx_with(&[
            (
                "bk",
                "Sources/book.md",
                "---\ntype: source\ntitle: Book\nkind: book\n---\n",
            ),
            (
                "c10",
                "Sources/c10.md",
                "---\ntype: source\ntitle: Chapter 10\nkind: chapter\nparent: \"[[Book]]\"\n---\n",
            ),
            (
                "c2",
                "Sources/c2.md",
                "---\ntype: source\ntitle: Chapter 2\nkind: chapter\nparent: \"[[Book]]\"\n---\n",
            ),
        ]);
        let titles: Vec<_> = idx
            .source_descendants("bk")
            .unwrap()
            .into_iter()
            .map(|d| d.title)
            .collect();
        assert_eq!(titles, vec!["Chapter 2", "Chapter 10"]);
    }
}
