//! SQLite index over the vault: documents, aliases, links, tags, Scripture
//! Mentions and full-text search. Rebuilt from files; never the source of truth.

use crate::document::{DocType, ParsedDoc};
use crate::names;
use crate::scripture::{Lang, Passage, VerseId};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candidate {
    pub doc: DocSummary,
    pub shared_tags: Vec<String>,
    pub shared_passages: Vec<String>,
    pub score: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrailEntry {
    pub doc: DocSummary,
    pub source: DocSummary,
    pub locator: Option<String>,
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
CREATE TABLE IF NOT EXISTS links(from_id TEXT NOT NULL, target TEXT NOT NULL, norm TEXT NOT NULL, alias TEXT, embed INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, property TEXT);
CREATE INDEX IF NOT EXISTS links_norm ON links(norm);
CREATE INDEX IF NOT EXISTS links_from ON links(from_id);
CREATE TABLE IF NOT EXISTS tags(doc_id TEXT NOT NULL, tag TEXT NOT NULL, norm TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, in_frontmatter INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS tags_norm ON tags(norm);
CREATE INDEX IF NOT EXISTS tags_doc ON tags(doc_id);
CREATE TABLE IF NOT EXISTS mentions(doc_id TEXT NOT NULL, verse_id INTEGER NOT NULL, book INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
  p_start_ch INTEGER NOT NULL, p_start_v INTEGER, p_end_ch INTEGER NOT NULL, p_end_v INTEGER, start INTEGER NOT NULL, end INTEGER NOT NULL, inferred INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mentions_verse ON mentions(verse_id);
CREATE INDEX IF NOT EXISTS mentions_bc ON mentions(book, chapter);
CREATE INDEX IF NOT EXISTS mentions_doc ON mentions(doc_id);
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2');
"#;

fn row_summary(r: &Row) -> rusqlite::Result<DocSummary> {
    Ok(DocSummary {
        id: r.get("id")?,
        path: r.get("path")?,
        title: r.get("title")?,
        doc_type: DocType::parse(&r.get::<_, String>("type")?).unwrap_or(DocType::Other),
        mtime: r.get("mtime")?,
        book: r.get::<_, Option<i64>>("book")?.map(|x| x as u8),
        chapter: r.get::<_, Option<i64>>("chapter")?.map(|x| x as u16),
        verse: r.get::<_, Option<i64>>("verse")?.map(|x| x as u16),
        lat: r.get("lat")?,
        lon: r.get("lon")?,
        first_verse: r.get::<_, Option<i64>>("first_verse")?.map(|x| x as u32),
    })
}

const SUMMARY_COLS: &str = "d.id, d.path, d.title, d.type, d.mtime, d.book, d.chapter, d.verse, d.lat, d.lon, (SELECT MIN(verse_id) FROM mentions m WHERE m.doc_id = d.id) AS first_verse";

fn excerpt_at(text: &str, start: usize) -> String {
    let start = start.min(text.len());
    let line_start = text[..start].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let line_end = text[start..].find('\n').map(|i| start + i).unwrap_or(text.len());
    let line = text[line_start..line_end].trim();
    if line.chars().count() > 220 {
        let rel = start - line_start;
        let from = line.char_indices().map(|(i, _)| i).filter(|&i| i <= rel.saturating_sub(80)).last().unwrap_or(0);
        let to = line.char_indices().map(|(i, _)| i).find(|&i| i >= rel + 140).unwrap_or(line.len());
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
        Ok(Index { conn })
    }

    pub fn in_memory() -> Result<Index> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(Index { conn })
    }

    pub fn mtime_of(&self, path: &str) -> Result<Option<i64>> {
        Ok(self.conn.query_row("SELECT mtime FROM documents WHERE path = ?1", [path], |r| r.get(0)).optional()?)
    }

    pub fn all_paths(&self) -> Result<Vec<String>> {
        let mut st = self.conn.prepare("SELECT path FROM documents")?;
        let rows = st.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Replace everything the index knows about one document.
    pub fn upsert(&mut self, id: &str, path: &str, mtime: i64, text: &str, doc: &ParsedDoc) -> Result<()> {
        let tx = self.conn.transaction()?;
        // A different document may previously have lived at this path.
        let old_id: Option<String> = tx.query_row("SELECT id FROM documents WHERE path = ?1", [path], |r| r.get(0)).optional()?;
        for victim in [Some(id.to_string()), old_id].into_iter().flatten() {
            for t in ["aliases", "tags", "mentions"] {
                tx.execute(&format!("DELETE FROM {t} WHERE doc_id = ?1"), [&victim])?;
            }
            tx.execute("DELETE FROM links WHERE from_id = ?1", [&victim])?;
            tx.execute("DELETE FROM docs_fts WHERE id = ?1", [&victim])?;
            tx.execute("DELETE FROM documents WHERE id = ?1", [&victim])?;
        }
        let fm = &doc.frontmatter;
        let book = number_field(fm, "book_number").map(|x| x as i64);
        let chapter = number_field(fm, "chapter").map(|x| x as i64);
        let verse = number_field(fm, "verse").map(|x| x as i64);
        let (lat, lon) = if doc.doc_type == DocType::Place { (number_field(fm, "lat"), number_field(fm, "lon")) } else { (None, None) };
        tx.execute(
            "INSERT INTO documents(id, path, title, title_norm, type, mtime, frontmatter, text, body_offset, book, chapter, verse, lat, lon)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![id, path, doc.title, norm(&doc.title), doc.doc_type.as_str(), mtime, Value::Object(fm.clone()).to_string(), text, doc.body_offset as i64, book, chapter, verse, lat, lon],
        )?;
        for a in &doc.aliases {
            tx.execute("INSERT INTO aliases(doc_id, alias, norm) VALUES(?1, ?2, ?3)", params![id, a, norm(a)])?;
        }
        for l in &doc.links {
            tx.execute(
                "INSERT INTO links(from_id, target, norm, alias, embed, start, end, property) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, l.target, norm(last_segment(&l.target)), l.alias, l.embed as i64, l.start as i64, l.end as i64, l.property],
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
        tx.execute("INSERT INTO docs_fts(id, title, body) VALUES(?1, ?2, ?3)", params![id, doc.title, &text[doc.body_offset.min(text.len())..]])?;
        tx.commit()?;
        Ok(())
    }

    pub fn remove_path(&mut self, path: &str) -> Result<()> {
        let id: Option<String> = self.conn.query_row("SELECT id FROM documents WHERE path = ?1", [path], |r| r.get(0)).optional()?;
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
            .query_row(&format!("SELECT {SUMMARY_COLS} FROM documents d WHERE d.id = ?1"), [id], row_summary)
            .optional()?)
    }

    pub fn get_by_path(&self, path: &str) -> Result<Option<DocSummary>> {
        Ok(self
            .conn
            .query_row(&format!("SELECT {SUMMARY_COLS} FROM documents d WHERE d.path = ?1"), [path], row_summary)
            .optional()?)
    }

    pub fn text_of(&self, id: &str) -> Result<Option<(String, String)>> {
        Ok(self
            .conn
            .query_row("SELECT text, frontmatter FROM documents WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
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
                let mut st = self.conn.prepare(&format!("SELECT {SUMMARY_COLS} FROM documents d ORDER BY d.path COLLATE NOCASE"))?;
                for r in st.query_map([], row_summary)? {
                    out.push(r?);
                }
            }
        }
        Ok(out)
    }

    pub fn scripture_doc(&self, book: u8, chapter: Option<u16>, verse: Option<u16>) -> Result<Option<DocSummary>> {
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
                .query_row(&format!("SELECT {SUMMARY_COLS} FROM documents d WHERE lower(d.path) = lower(?1)"), [&p], row_summary)
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
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {SUMMARY_COLS} FROM documents d JOIN aliases a ON a.doc_id = d.id WHERE a.norm = ?1 LIMIT 1"),
                [&n],
                row_summary,
            )
            .optional()?)
    }

    pub fn aliases_of(&self, id: &str) -> Result<Vec<String>> {
        let mut st = self.conn.prepare("SELECT alias FROM aliases WHERE doc_id = ?1")?;
        let rows = st.query_map([id], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn names_of(&self, doc: &DocSummary) -> Result<Vec<String>> {
        let mut names = vec![norm(&doc.title)];
        let mut st = self.conn.prepare("SELECT norm FROM aliases WHERE doc_id = ?1")?;
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
        let mut args: Vec<&dyn rusqlite::ToSql> = names.iter().map(|n| n as &dyn rusqlite::ToSql).collect();
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
            let excerpt = if property.is_some() { String::new() } else { excerpt_at(&text, start) };
            out.push(Backlink { doc: d, kind, via: None, property, excerpt, start, inferred: false });
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
            let excerpt = if fm { String::new() } else { excerpt_at(&text, start) };
            out.push(Backlink { doc: d, kind: BacklinkKind::Tag, via: None, property: None, excerpt, start, inferred: false });
        }
        if doc.doc_type.is_scripture() {
            if let Some(book) = doc.book {
                out.extend(self.mentions_of(book, doc.chapter, doc.verse, lang, Some(id))?);
            }
        }
        // Dedupe identical (doc, start) pairs and order: by kind then title.
        out.sort_by(|a, b| a.doc.first_verse.cmp(&b.doc.first_verse).then(a.doc.title.cmp(&b.doc.title)).then(a.start.cmp(&b.start)));
        out.dedup_by(|a, b| a.doc.id == b.doc.id && a.start == b.start && a.kind == b.kind);
        Ok(out)
    }

    /// Mentions covering a Book, Chapter or Verse, one row per Passage as written.
    pub fn mentions_of(&self, book: u8, chapter: Option<u16>, verse: Option<u16>, lang: Lang, exclude: Option<&str>) -> Result<Vec<Backlink>> {
        let sql = format!(
            "SELECT {SUMMARY_COLS}, m.start, m.p_start_ch, m.p_start_v, m.p_end_ch, m.p_end_v, m.inferred, d.text
             FROM mentions m JOIN documents d ON d.id = m.doc_id
             WHERE m.book = ?1 AND (?2 IS NULL OR m.chapter = ?2) AND (?3 IS NULL OR m.verse = ?3) AND (?4 IS NULL OR m.doc_id != ?4)
             GROUP BY m.doc_id, m.start, m.p_start_ch, m.p_start_v, m.p_end_ch, m.p_end_v
             ORDER BY d.title COLLATE NOCASE, m.start"
        );
        let mut st = self.conn.prepare(&sql)?;
        let rows = st.query_map(params![book as i64, chapter.map(|c| c as i64), verse.map(|v| v as i64), exclude], |r| {
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
        })?;
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
        let mut st = self.conn.prepare("SELECT book, chapter, COUNT(DISTINCT doc_id) FROM mentions GROUP BY book, chapter")?;
        let rows = st.query_map([], |r| Ok(CoverageCell { book: r.get::<_, i64>(0)? as u8, chapter: r.get::<_, i64>(1)? as u16, count: r.get::<_, i64>(2)? as u32 }))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn scripture_node_id(level: GraphLevel, book: u8, chapter: u16, verse: u16) -> String {
        match level {
            GraphLevel::Book => format!("s:{book}"),
            GraphLevel::Chapter => format!("s:{book}:{chapter}"),
            GraphLevel::Verse => format!("s:{book}:{chapter}:{verse}"),
        }
    }

    fn scripture_node_label(level: GraphLevel, book: u8, chapter: u16, verse: u16, lang: Lang) -> String {
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
                            (GraphLevel::Verse, DocType::Chapter) | (GraphLevel::Chapter, DocType::Chapter | DocType::Verse) => GraphLevel::Chapter,
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
                        let owns = matches!((lvl, d.doc_type), (GraphLevel::Book, DocType::Book) | (GraphLevel::Chapter, DocType::Chapter) | (GraphLevel::Verse, DocType::Verse));
                        if owns {
                            entry.doc_id = Some(d.id.clone());
                        }
                        nid
                    }
                    _ => d.id.clone(),
                }
            } else {
                nodes.insert(d.id.clone(), GraphNode { id: d.id.clone(), label: d.title.clone(), doc_type: d.doc_type, doc_id: Some(d.id.clone()), degree: 0 });
                d.id.clone()
            };
            doc_node.insert(d.id.clone(), node_id);
        }
        // Links and tags, resolved.
        let mut st = self.conn.prepare("SELECT from_id, target FROM links UNION SELECT doc_id, tag FROM tags")?;
        let rows: Vec<(String, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
        let mut cache: HashMap<String, Option<String>> = HashMap::new();
        for (from, target) in rows {
            let to = cache
                .entry(target.clone())
                .or_insert_with(|| self.resolve(&target).ok().flatten().and_then(|d| doc_node.get(&d.id).cloned()))
                .clone();
            if let (Some(a), Some(b)) = (doc_node.get(&from), to) {
                if *a != b {
                    edges.insert((a.clone(), b));
                }
            }
        }
        // Mentions.
        let mut st = self.conn.prepare("SELECT DISTINCT doc_id, book, chapter, verse FROM mentions")?;
        let rows: Vec<(String, i64, i64, i64)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<rusqlite::Result<_>>()?;
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
        let mut edges: Vec<GraphEdge> = edges.into_iter().map(|(source, target)| GraphEdge { source, target }).collect();
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
        let fts: Vec<String> = terms.iter().enumerate().map(|(i, t)| if i + 1 == n { format!("\"{t}\"*") } else { format!("\"{t}\"") }).collect();
        let q = fts.join(" ");
        let mut st = self.conn.prepare(&format!(
            "SELECT {SUMMARY_COLS}, snippet(docs_fts, 2, '[', ']', '…', 14) AS snip FROM docs_fts f JOIN documents d ON d.id = f.id WHERE docs_fts MATCH ?1 ORDER BY bm25(docs_fts, 0, 5.0, 1.0) LIMIT ?2"
        ))?;
        let rows = st.query_map(params![q, limit as i64], |r| Ok(SearchHit { doc: row_summary(r)?, snippet: r.get("snip")? }))?;
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
        let mut st = self.conn.prepare("SELECT tag, COUNT(DISTINCT doc_id) FROM tags GROUP BY norm ORDER BY 2 DESC, tag")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u32)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn places(&self) -> Result<Vec<DocSummary>> {
        let mut st = self.conn.prepare(&format!("SELECT {SUMMARY_COLS} FROM documents d WHERE d.type = 'place' AND d.lat IS NOT NULL AND d.lon IS NOT NULL ORDER BY d.title"))?;
        let rows = st.query_map([], row_summary)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Documents sharing Tags or Verses with `id`, for the Composition sidebar.
    pub fn candidates(&self, id: &str, lang: Lang, limit: usize) -> Result<Vec<Candidate>> {
        let mut by_doc: HashMap<String, (Vec<String>, Vec<String>)> = HashMap::new();
        let mut st = self.conn.prepare(
            "SELECT o.doc_id, o.tag FROM tags o WHERE o.norm IN (SELECT norm FROM tags WHERE doc_id = ?1) AND o.doc_id != ?1 GROUP BY o.doc_id, o.norm",
        )?;
        for r in st.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
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
        let mut out = Vec::new();
        for (doc_id, (tags, passages)) in by_doc {
            if let Some(doc) = self.get(&doc_id)? {
                if doc.doc_type.is_scripture() {
                    continue;
                }
                let score = (tags.len() * 2 + passages.len()) as u32;
                out.push(Candidate { doc, shared_tags: tags, shared_passages: passages, score });
            }
        }
        out.sort_by(|a, b| b.score.cmp(&a.score).then(a.doc.title.cmp(&b.doc.title)));
        out.truncate(limit);
        Ok(out)
    }

    /// Child Sources of a Source (via the `parent` property), recursively.
    pub fn source_descendants(&self, id: &str) -> Result<Vec<DocSummary>> {
        let mut st = self.conn.prepare("SELECT from_id, target FROM links WHERE property = 'parent'")?;
        let rows: Vec<(String, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
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
        out.sort_by(|a, b| a.title.cmp(&b.title));
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
            let mut args: Vec<&dyn rusqlite::ToSql> = names.iter().map(|n| n as &dyn rusqlite::ToSql).collect();
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
                out.push(TrailEntry { doc: d, source: s.clone(), locator });
            }
        }
        out.sort_by(|a, b| a.source.title.cmp(&b.source.title).then_with(|| natural_cmp(a.locator.as_deref().unwrap_or(""), b.locator.as_deref().unwrap_or(""))).then(a.doc.title.cmp(&b.doc.title)));
        Ok(out)
    }

    pub fn unresolved(&self) -> Result<Vec<UnresolvedLink>> {
        let mut st = self.conn.prepare("SELECT target, COUNT(*) FROM links GROUP BY norm ORDER BY 2 DESC")?;
        let rows: Vec<(String, i64)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
        let mut out = Vec::new();
        for (target, count) in rows {
            if self.resolve(&target)?.is_none() {
                out.push(UnresolvedLink { target, count: count as u32 });
            }
        }
        Ok(out)
    }

    pub fn verse_count_in_index(&self) -> Result<u32> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM mentions", [], |r| r.get::<_, i64>(0))? as u32)
    }

    pub fn document_count(&self) -> Result<u32> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM documents", [], |r| r.get::<_, i64>(0))? as u32)
    }

    pub fn first_verse_of(&self, id: &str) -> Result<Option<VerseId>> {
        Ok(self
            .conn
            .query_row("SELECT MIN(verse_id) FROM mentions WHERE doc_id = ?1", [id], |r| r.get::<_, Option<i64>>(0))?
            .map(|v| VerseId(v as u32)))
    }
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
                let (lx, ly) = (x.to_lowercase().next().unwrap(), y.to_lowercase().next().unwrap());
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

    fn idx_with(docs: &[(&str, &str, &str)]) -> Index {
        let mut idx = Index::in_memory().unwrap();
        for (id, path, text) in docs {
            let parsed = document::parse(path, text);
            idx.upsert(id, path, 1, text, &parsed).unwrap();
        }
        idx
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
    }

    #[test]
    fn natural_order() {
        assert_eq!(natural_cmp("p. 3", "p. 12"), std::cmp::Ordering::Less);
        assert_eq!(natural_cmp("ch. 2", "ch. 10"), std::cmp::Ordering::Less);
    }
}
