//! The Vault: a folder of markdown files plus the index that describes it.
//! All file access in the app goes through here (ADR 0004).

use crate::document::{self, DocType, Link, ParsedDoc, TagRef};
use crate::index::{self, Backlink, Candidate, CoverageCell, DocSummary, Graph, GraphLevel, Index, SearchHit, TrailEntry, UnresolvedLink};
use crate::parser::Detected;
use crate::scripture::{Lang, Passage};
use crate::sync::{RemoteChange, Sync};
use crate::templates;
use crate::{Error, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const HIDDEN_DIR: &str = ".bible-study";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentView {
    pub summary: DocSummary,
    pub text: String,
    pub frontmatter: Map<String, Value>,
    pub body_offset: usize,
    pub links: Vec<Link>,
    pub tags: Vec<TagRef>,
    pub references: Vec<Detected>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultInfo {
    pub root: String,
    pub documents: u32,
}

pub struct Vault {
    root: PathBuf,
    index: Index,
    lang: Lang,
    sync: Option<Sync>,
}

/// Where per-device state for a vault lives: `<data_dir>/vaults/<hash of root>/`.
pub fn local_dir_for(data_dir: &Path, root: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};
    let h = Sha256::digest(root.to_string_lossy().as_bytes());
    data_dir.join("vaults").join(hex::encode(&h[..8]))
}

fn new_id() -> String {
    ulid::Ulid::new().to_string()
}

fn mtime_of(p: &Path) -> i64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Make a title safe as a file name on every platform.
pub fn sanitize_title(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned = cleaned.trim_start_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "Untitled".into()
    } else {
        cleaned
    }
}

fn write_atomic(path: &Path, text: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("md.tmp-{}", ulid::Ulid::new()));
    fs::write(&tmp, text)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

impl Vault {
    /// Open a vault. `data_dir` is the app's per-device data directory: the
    /// index and CRDT state live there, never inside the synced folder.
    pub fn open(root: impl Into<PathBuf>, data_dir: &Path, lang: Lang) -> Result<Vault> {
        let root: PathBuf = root.into();
        if !root.is_dir() {
            return Err(Error::Invalid(format!("not a folder: {}", root.display())));
        }
        fs::create_dir_all(root.join(HIDDEN_DIR))?;
        let local = local_dir_for(data_dir, &root);
        fs::create_dir_all(&local)?;
        let index = Index::open(&local.join("index.sqlite"))?;
        let sync = Sync::open(&root, data_dir, &local)?;
        let mut v = Vault { root, index, lang, sync: Some(sync) };
        v.scan()?;
        Ok(v)
    }

    pub fn device_id(&self) -> Option<&str> {
        self.sync.as_ref().map(|s| s.device_id())
    }

    /// Merge every new snapshot from other devices and materialise the result
    /// to disk. Returns the documents that changed.
    pub fn apply_remote(&mut self) -> Result<Vec<DocSummary>> {
        let changes: Vec<RemoteChange> = match self.sync.as_mut() {
            Some(s) => s.import_remote()?,
            None => return Ok(vec![]),
        };
        let mut out = Vec::new();
        for c in changes {
            let current = self.index.get(&c.id)?;
            if c.deleted {
                if let Some(d) = current {
                    let p = self.abs(&d.path);
                    if p.exists() {
                        fs::remove_file(p)?;
                    }
                    self.index.remove_id(&c.id)?;
                }
                continue;
            }
            let rel = match (c.path.clone(), current.as_ref()) {
                (Some(p), _) => p,
                (None, Some(d)) => d.path.clone(),
                (None, None) => continue,
            };
            if let Some(d) = current.as_ref() {
                if d.path != rel && self.abs(&d.path).exists() {
                    if let Some(parent) = self.abs(&rel).parent() {
                        fs::create_dir_all(parent)?;
                    }
                    fs::rename(self.abs(&d.path), self.abs(&rel))?;
                    self.index.remove_path(&d.path)?;
                }
            }
            let on_disk = fs::read_to_string(self.abs(&rel)).unwrap_or_default();
            if on_disk != c.text {
                write_atomic(&self.abs(&rel), &c.text)?;
            }
            if let Some(d) = self.index_file(&rel)? {
                out.push(d);
            }
        }
        Ok(out)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn lang(&self) -> Lang {
        self.lang
    }

    pub fn set_lang(&mut self, lang: Lang) {
        self.lang = lang;
    }

    pub fn info(&self) -> Result<VaultInfo> {
        Ok(VaultInfo { root: self.root.display().to_string(), documents: self.index.document_count()? })
    }

    fn abs(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    fn rel(&self, abs: &Path) -> Option<String> {
        abs.strip_prefix(&self.root).ok().map(|p| p.to_string_lossy().replace('\\', "/"))
    }

    /// Walk the folder and bring the index up to date. Files whose mtime is
    /// unchanged are skipped; files that vanished are forgotten.
    pub fn scan(&mut self) -> Result<Vec<DocSummary>> {
        let mut seen = std::collections::HashSet::new();
        let mut changed = self.apply_remote()?;
        let mut files = Vec::new();
        for entry in walkdir::WalkDir::new(&self.root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !(e.depth() > 0 && e.file_name().to_string_lossy().starts_with('.')))
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() && entry.path().extension().map_or(false, |x| x == "md") {
                if let Some(rel) = self.rel(entry.path()) {
                    files.push((rel, mtime_of(entry.path())));
                }
            }
        }
        for (rel, mtime) in files {
            seen.insert(rel.clone());
            if self.index.mtime_of(&rel)? == Some(mtime) {
                continue;
            }
            if let Some(d) = self.index_file(&rel)? {
                changed.push(d);
            }
        }
        // Forget files that vanished. Scripture pages materialised during this
        // scan are not in `seen`, so check the disk rather than the set.
        for path in self.index.all_paths()? {
            if !seen.contains(&path) && !self.abs(&path).is_file() {
                self.index.remove_path(&path)?;
            }
        }
        Ok(changed)
    }

    /// Parse one file into the index, assigning an id if it has none and
    /// materialising any Scripture pages it mentions.
    pub fn index_file(&mut self, rel: &str) -> Result<Option<DocSummary>> {
        let abs = self.abs(rel);
        let text = match fs::read_to_string(&abs) {
            Ok(t) => t,
            Err(_) => {
                self.index.remove_path(rel)?;
                return Ok(None);
            }
        };
        let (mut text, mut parsed) = self.ensure_id(rel, text)?;
        let id = parsed.id.clone().expect("id ensured");
        let mut mtime = mtime_of(&abs);
        if let Some(sync) = self.sync.as_mut() {
            // A file older than another device's snapshot is a stale copy the
            // cloud has not finished replacing: prefer the merged CRDT text.
            if let Some(crdt) = sync.text_of(&id) {
                if crdt != text && sync.remote_mtime(&id).map_or(false, |m| m > mtime) {
                    write_atomic(&abs, &crdt)?;
                    text = crdt;
                    parsed = document::parse(rel, &text);
                    mtime = mtime_of(&abs);
                }
            }
            sync.record_local(&id, &text, rel)?;
        }
        self.index.upsert(&id, rel, mtime, &text, &parsed)?;
        let passages: Vec<Passage> = parsed.references.iter().flat_map(|d| d.passages.iter().copied()).collect();
        self.materialise(&passages)?;
        self.index.get(&id)
    }

    fn ensure_id(&self, rel: &str, text: String) -> Result<(String, ParsedDoc)> {
        let parsed = document::parse(rel, &text);
        if parsed.id.is_some() {
            return Ok((text, parsed));
        }
        let id = new_id();
        let text = document::with_frontmatter_fields(&text, &[("id", &id)]);
        write_atomic(&self.abs(rel), &text)?;
        let parsed = document::parse(rel, &text);
        Ok((text, parsed))
    }

    /// Create the Book / Chapter / Verse pages a set of Passages implies.
    pub fn materialise(&mut self, passages: &[Passage]) -> Result<Vec<DocSummary>> {
        let mut created = Vec::new();
        let mut wanted: Vec<(u8, Option<u16>, Option<u16>)> = passages.iter().flat_map(templates::pages_for).collect();
        wanted.sort();
        wanted.dedup();
        for (b, c, v) in wanted {
            let rel = templates::scripture_path(b, c, v);
            if self.index.get_by_path(&rel)?.is_some() || self.abs(&rel).exists() {
                continue;
            }
            let id = new_id();
            write_atomic(&self.abs(&rel), &templates::scripture_page(&id, b, c, v))?;
            if let Some(d) = self.index_file(&rel)? {
                created.push(d);
            }
        }
        Ok(created)
    }

    pub fn forget(&mut self, rel: &str) -> Result<()> {
        self.index.remove_path(rel)
    }

    pub fn read(&self, id: &str) -> Result<DocumentView> {
        let summary = self.index.get(id)?.ok_or_else(|| Error::NotFound(id.into()))?;
        let text = fs::read_to_string(self.abs(&summary.path))?;
        let parsed = document::parse(&summary.path, &text);
        Ok(DocumentView {
            summary,
            text,
            frontmatter: parsed.frontmatter,
            body_offset: parsed.body_offset,
            links: parsed.links,
            tags: parsed.tags,
            references: parsed.references,
        })
    }

    /// Replace a document's full text (frontmatter included) and re-index it.
    pub fn write(&mut self, id: &str, text: &str) -> Result<DocumentView> {
        let summary = self.index.get(id)?.ok_or_else(|| Error::NotFound(id.into()))?;
        // Never let a save drop the id.
        let text = document::with_frontmatter_fields(text, &[("id", id)]);
        write_atomic(&self.abs(&summary.path), &text)?;
        self.index_file(&summary.path)?;
        self.read(id)
    }

    fn unique_path(&self, folder: &str, title: &str) -> String {
        let base = sanitize_title(title);
        let mut n = 1;
        loop {
            let name = if n == 1 { base.clone() } else { format!("{base} {n}") };
            let rel = if folder.is_empty() { format!("{name}.md") } else { format!("{folder}/{name}.md") };
            if !self.abs(&rel).exists() {
                return rel;
            }
            n += 1;
        }
    }

    /// Create a new document from its type's template.
    pub fn create(&mut self, doc_type: DocType, title: &str, fields: &Map<String, Value>, body: &str) -> Result<DocumentView> {
        if doc_type.is_scripture() {
            return Err(Error::Invalid("Scripture pages are created by mentioning them".into()));
        }
        let folder = fields.get("folder").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| doc_type.default_folder().to_string());
        let mut fields = fields.clone();
        fields.remove("folder");
        let rel = self.unique_path(&folder, title);
        let id = new_id();
        write_atomic(&self.abs(&rel), &templates::new_document(&id, doc_type, &fields, body))?;
        self.index_file(&rel)?;
        self.read(&id)
    }

    /// Rename a document and rewrite `[[Old]]` links across the vault.
    pub fn rename(&mut self, id: &str, new_title: &str) -> Result<DocumentView> {
        let summary = self.index.get(id)?.ok_or_else(|| Error::NotFound(id.into()))?;
        let new_title = sanitize_title(new_title);
        if new_title == summary.title {
            return self.read(id);
        }
        // Collect who links here before the title changes.
        let backlinks = self.index.backlinks(id, self.lang)?;
        let folder = summary.path.rsplit_once('/').map(|(f, _)| f.to_string()).unwrap_or_default();
        let new_rel = self.unique_path(&folder, &new_title);
        fs::rename(self.abs(&summary.path), self.abs(&new_rel))?;
        self.index.remove_path(&summary.path)?;
        self.index_file(&new_rel)?;
        // Update links in every document that pointed at the old title.
        let old = regex::escape(&summary.title);
        let re = Regex::new(&format!(r"(?i)\[\[\s*{old}\s*(?P<rest>(?:#[^\]\|]*)?(?:\|[^\]]*)?)\]\]")).unwrap();
        let final_title = document::title_from_path(&new_rel);
        for bl in backlinks {
            if bl.kind == index::BacklinkKind::Mention || bl.kind == index::BacklinkKind::Tag {
                continue;
            }
            let p = self.abs(&bl.doc.path);
            let text = fs::read_to_string(&p)?;
            let updated = re.replace_all(&text, |c: &regex::Captures| format!("[[{final_title}{}]]", &c["rest"]));
            if updated != text {
                write_atomic(&p, &updated)?;
                self.index_file(&bl.doc.path)?;
            }
        }
        self.read(id)
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        let summary = self.index.get(id)?.ok_or_else(|| Error::NotFound(id.into()))?;
        let p = self.abs(&summary.path);
        if p.exists() {
            fs::remove_file(p)?;
        }
        if let Some(sync) = self.sync.as_mut() {
            sync.record_delete(id)?;
        }
        self.index.remove_id(id)
    }

    // ---- read-only queries -------------------------------------------------

    pub fn list(&self, doc_type: Option<DocType>) -> Result<Vec<DocSummary>> {
        self.index.list(doc_type)
    }
    pub fn get(&self, id: &str) -> Result<Option<DocSummary>> {
        self.index.get(id)
    }
    pub fn get_by_path(&self, rel: &str) -> Result<Option<DocSummary>> {
        self.index.get_by_path(rel)
    }
    pub fn resolve(&self, target: &str) -> Result<Option<DocSummary>> {
        self.index.resolve(target)
    }
    pub fn aliases_of(&self, id: &str) -> Result<Vec<String>> {
        self.index.aliases_of(id)
    }
    pub fn backlinks(&self, id: &str) -> Result<Vec<Backlink>> {
        self.index.backlinks(id, self.lang)
    }
    pub fn verse_mentions(&self, book: u8, chapter: Option<u16>, verse: Option<u16>) -> Result<Vec<Backlink>> {
        self.index.mentions_of(book, chapter, verse, self.lang, None)
    }
    pub fn scripture_doc(&self, book: u8, chapter: Option<u16>, verse: Option<u16>) -> Result<Option<DocSummary>> {
        self.index.scripture_doc(book, chapter, verse)
    }
    pub fn coverage(&self) -> Result<Vec<CoverageCell>> {
        self.index.coverage()
    }
    pub fn graph(&self, level: GraphLevel) -> Result<Graph> {
        self.index.graph(level, self.lang)
    }
    pub fn search(&self, q: &str, limit: usize) -> Result<Vec<SearchHit>> {
        self.index.search(q, limit)
    }
    pub fn suggest(&self, prefix: &str, limit: usize) -> Result<Vec<DocSummary>> {
        self.index.suggest(prefix, limit)
    }
    pub fn tags(&self) -> Result<Vec<(String, u32)>> {
        self.index.tags()
    }
    pub fn places(&self) -> Result<Vec<DocSummary>> {
        self.index.places()
    }
    pub fn candidates(&self, id: &str) -> Result<Vec<Candidate>> {
        self.index.candidates(id, self.lang, 50)
    }
    pub fn source_trail(&self, id: &str) -> Result<Vec<TrailEntry>> {
        self.index.source_trail(id)
    }
    pub fn source_children(&self, id: &str) -> Result<Vec<DocSummary>> {
        self.index.source_descendants(id)
    }
    pub fn unresolved(&self) -> Result<Vec<UnresolvedLink>> {
        self.index.unresolved()
    }
    /// Find a document by URL (Sources are deduplicated by URL).
    pub fn find_by_url(&self, url: &str) -> Result<Option<DocSummary>> {
        let url = url.trim().trim_end_matches('/');
        for d in self.index.list(Some(DocType::Source))? {
            if let Some((_, fm)) = self.index.text_of(&d.id)? {
                if let Ok(Value::Object(m)) = serde_json::from_str::<Value>(&fm) {
                    if m.get("url").and_then(Value::as_str).map(|u| u.trim().trim_end_matches('/')) == Some(url) {
                        return Ok(Some(d));
                    }
                }
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Notes")).unwrap();
        fs::write(dir.path().join("Notes/First.md"), "Meditation on Romans 8:28 with [[Paul]].\n").unwrap();
        let data = dir.path().join(".data");
        let v = Vault::open(dir.path().join("."), &data, Lang::En).unwrap();
        (dir, v)
    }

    #[test]
    fn open_assigns_ids_and_materialises_scripture() {
        let (dir, v) = vault();
        let text = fs::read_to_string(dir.path().join("Notes/First.md")).unwrap();
        assert!(text.starts_with("---\nid: "));
        assert!(text.ends_with("Meditation on Romans 8:28 with [[Paul]].\n"));
        assert!(dir.path().join("Scripture/Romans/Romans.md").exists());
        assert!(dir.path().join("Scripture/Romans/Romans 8/Romans 8.md").exists());
        assert!(dir.path().join("Scripture/Romans/Romans 8/Romans 8.28.md").exists());
        let verse = v.resolve("Romans 8:28").unwrap().unwrap();
        assert_eq!(verse.doc_type, DocType::Verse);
        let bl = v.backlinks(&verse.id).unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].doc.title, "First");
        assert!(v.resolve("Paul").unwrap().is_none());
        assert_eq!(v.unresolved().unwrap()[0].target, "Paul");
    }

    #[test]
    fn create_write_rename_delete() {
        let (dir, mut v) = vault();
        let paul = v.create(DocType::Character, "Paul", &Map::new(), "The apostle.").unwrap();
        assert_eq!(paul.summary.path, "Characters/Paul.md");
        assert!(v.resolve("paul").unwrap().is_some());
        let first = v.get_by_path("Notes/First.md").unwrap().unwrap();
        assert_eq!(v.backlinks(&paul.summary.id).unwrap()[0].doc.id, first.id);

        let renamed = v.rename(&paul.summary.id, "Paul of Tarsus").unwrap();
        assert_eq!(renamed.summary.path, "Characters/Paul of Tarsus.md");
        let t = fs::read_to_string(dir.path().join("Notes/First.md")).unwrap();
        assert!(t.contains("[[Paul of Tarsus]]"));

        let updated = v.write(&first.id, "no frontmatter at all, John 3:16").unwrap();
        assert!(updated.text.starts_with("---\nid: "));
        assert_eq!(updated.references.len(), 1);
        assert!(dir.path().join("Scripture/John/John 3/John 3.16.md").exists());

        v.delete(&renamed.summary.id).unwrap();
        assert!(v.resolve("Paul of Tarsus").unwrap().is_none());
        assert!(!dir.path().join("Characters/Paul of Tarsus.md").exists());
    }

    #[test]
    fn duplicate_titles_get_suffix_and_sanitised() {
        let (_dir, mut v) = vault();
        let a = v.create(DocType::Note, "Ro 8:28 / thoughts?", &Map::new(), "").unwrap();
        assert_eq!(a.summary.path, "Notes/Ro 8 28 thoughts.md");
        let b = v.create(DocType::Note, "Ro 8:28 / thoughts?", &Map::new(), "").unwrap();
        assert_eq!(b.summary.path, "Notes/Ro 8 28 thoughts 2.md");
    }

    #[test]
    fn rescan_picks_up_external_changes() {
        let (dir, mut v) = vault();
        fs::write(dir.path().join("Notes/External.md"), "Made in Obsidian. #grace\n").unwrap();
        let changed = v.scan().unwrap();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].title, "External");
        assert!(fs::read_to_string(dir.path().join("Notes/External.md")).unwrap().starts_with("---\nid: "));
        fs::remove_file(dir.path().join("Notes/External.md")).unwrap();
        v.scan().unwrap();
        assert!(v.get_by_path("Notes/External.md").unwrap().is_none());
    }
}
