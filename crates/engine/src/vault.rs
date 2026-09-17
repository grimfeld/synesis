//! The Vault: a folder of markdown files plus the index that describes it.
//! All file access in the app goes through here (ADR 0004).

use crate::canvas::{self, Canvas};
use crate::document::{self, DocType, Link, ParsedDoc, TagRef};
use crate::index::{
    self, Backlink, Candidate, CoverageCell, DocSummary, Graph, GraphLevel, Index, Linkable,
    SearchHit, UnlinkedMentions, UnresolvedLink,
};
use crate::parser::Detected;
use crate::meta::VaultMeta;
use crate::properties::{PropertySchema, PropertyType};
use crate::query::{Answer, Query};
use crate::scripture::{Lang, Passage};
use crate::sync::{HistoryPoint, RemoteChange, Sync, Version};
use crate::templates;
use crate::unlinked;
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
    /// What this Vault is and what to call it (ADR 0014).
    pub meta: VaultMeta,
    /// What each document type is, so the UI asks rather than restates.
    pub doc_types: Vec<DocTypeInfo>,
}

/// What the engine knows about one document type.
///
/// The UI used to keep six arrays of its own saying which types are Subjects,
/// which open in the editor, which may be created and so on — facts the engine
/// already computes, mirrored by hand and drifting quietly. It sends them
/// instead. The table is the same for every vault, so it rides along with
/// `VaultInfo` and is in the store before the first view renders.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocTypeInfo {
    #[serde(rename = "type")]
    pub doc_type: DocType,
    pub is_scripture: bool,
    pub is_subject: bool,
    pub is_hub: bool,
    pub is_writing: bool,
    pub is_creatable: bool,
    pub is_linkable_target: bool,
    pub folder: String,
}

impl DocTypeInfo {
    fn of(t: DocType) -> Self {
        DocTypeInfo {
            doc_type: t,
            is_scripture: t.is_scripture(),
            is_subject: t.is_subject(),
            is_hub: t.is_hub(),
            is_writing: t.is_writing(),
            is_creatable: t.is_creatable(),
            is_linkable_target: t.is_linkable_target(),
            folder: t.default_folder().to_string(),
        }
    }

    /// Every type the app knows, in the order the UI offers them.
    pub fn all() -> Vec<DocTypeInfo> {
        DocType::ALL.iter().copied().map(DocTypeInfo::of).collect()
    }
}

pub struct Vault {
    root: PathBuf,
    meta: VaultMeta,
    index: Index,
    lang: Lang,
    sync: Option<Sync>,
    schema: PropertySchema,
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
        // Give the folder an identity before anything reads it, so a Vault
        // that predates ids has one from here on (ADR 0014).
        let meta = VaultMeta::adopt(&root)?;
        let local = local_dir_for(data_dir, &root);
        fs::create_dir_all(&local)?;
        let index = Index::open(&local.join("index.sqlite"))?;
        let sync = Sync::open(&root, data_dir, &local)?;
        let schema = PropertySchema::load(&root.join(HIDDEN_DIR));
        let mut v = Vault {
            root,
            meta,
            index,
            lang,
            sync: Some(sync),
            schema,
        };
        v.scan()?;
        Ok(v)
    }

    /// What this Vault is and what to call it (ADR 0014).
    pub fn meta(&self) -> &VaultMeta {
        &self.meta
    }

    /// Rename the Vault. The name travels with it, so every Device that holds
    /// it sees the new one; the folder is untouched.
    pub fn set_name(&mut self, name: &str) -> Result<VaultMeta> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::Invalid("a Vault needs a name".into()));
        }
        self.meta.name = name.to_string();
        self.meta.write(&self.root)?;
        Ok(self.meta.clone())
    }

    /// Take on the identity of the Vault being joined (ADR 0014).
    ///
    /// The folder was free, so whatever id it adopted on open was a local
    /// invention; from here it is the Vault the Invite named, on every Device.
    pub fn adopt_identity(&mut self, id: &str, name: &str) -> Result<()> {
        self.meta = VaultMeta {
            id: id.to_string(),
            name: name.trim().to_string(),
        };
        self.meta.write(&self.root)
    }

    /// The vault's Property schema: built-ins plus what `.bible-study/properties.json` declares.
    pub fn property_schema(&self) -> &PropertySchema {
        &self.schema
    }

    /// Declare or change a Property name's type and persist the schema. When
    /// the change touches the Date type the whole vault is re-indexed, since
    /// which values are Dates has changed.
    pub fn set_property_type(&mut self, name: &str, t: PropertyType) -> Result<PropertySchema> {
        let before = self.schema.type_of(name);
        self.schema.set(name, t)?;
        self.schema.save(&self.root.join(HIDDEN_DIR))?;
        if before != t && (before == PropertyType::Date || t == PropertyType::Date) {
            self.reindex_all()?;
        }
        Ok(self.schema.clone())
    }

    /// Re-parse every file regardless of mtime.
    pub fn reindex_all(&mut self) -> Result<()> {
        for path in self.index.all_paths()? {
            self.index_file(&path)?;
        }
        Ok(())
    }

    fn sync_mut(&mut self) -> Result<&mut Sync> {
        self.sync
            .as_mut()
            .ok_or_else(|| Error::Invalid("sync unavailable".into()))
    }

    /// Named Versions of a document (ADR 0007), newest first.
    pub fn versions(&mut self, id: &str) -> Result<Vec<Version>> {
        Ok(self.sync_mut()?.versions(id))
    }

    /// Label the document's current state as a Version. Unsaved text should be
    /// written first; the caller saves before calling.
    pub fn save_version(&mut self, id: &str, label: &str) -> Result<Version> {
        self.sync_mut()?.save_version(id, label)
    }

    pub fn delete_version(&mut self, id: &str, key: &str) -> Result<()> {
        self.sync_mut()?.delete_version(id, key)
    }

    /// The Board at a Version's or history point's frontier, so a Version
    /// covers the talk and its Board as one moment (PLAN §17.17).
    pub fn board_at(&mut self, id: &str, frontier: &str) -> Result<Option<Canvas>> {
        self.sync_mut()?.canvas_at(id, frontier)
    }

    /// The document's full text at a Version's or history point's frontier.
    pub fn text_at(&mut self, id: &str, frontier: &str) -> Result<String> {
        self.sync_mut()?.text_at(id, frontier)
    }

    /// Every change in the document's history, newest first.
    pub fn history(&mut self, id: &str) -> Result<Vec<HistoryPoint>> {
        self.sync_mut()?.history(id)
    }

    /// Publish a snapshot for every document that has none yet, so a Device
    /// that pairs (or a cloud folder that starts syncing) receives the whole
    /// vault and not only what was edited since sync began.
    pub fn publish_missing(&mut self) -> Result<usize> {
        let docs = self.index.list(None)?;
        let mut n = 0;
        for d in docs {
            let missing = self.sync.as_ref().map_or(false, |s| !s.is_published(&d.id));
            if !missing {
                continue;
            }
            let Ok(text) = fs::read_to_string(self.abs(&d.path)) else { continue };
            if let Some(sync) = self.sync.as_mut() {
                sync.republish(&d.id, &text, &d.path)?;
                n += 1;
            }
        }
        Ok(n)
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
            let abs = self.abs(&rel);
            let on_disk = fs::read_to_string(&abs).unwrap_or_default();
            if on_disk != c.text {
                // A file edited after the newest remote snapshot arrived (in
                // Obsidian, or while this device had never imported it) holds
                // the user's latest words: fold it into the merged state as a
                // diff instead of overwriting it. Only a file older than the
                // snapshot is a stale copy the provider has not replaced yet.
                let file_newer = abs.is_file()
                    && !on_disk.is_empty()
                    && self
                        .sync
                        .as_ref()
                        .and_then(|s| s.remote_mtime(&c.id))
                        .map_or(false, |m| mtime_of(&abs) > m);
                if file_newer {
                    if let Some(sync) = self.sync.as_mut() {
                        sync.record_local(&c.id, &on_disk, &rel)?;
                    }
                } else {
                    write_atomic(&abs, &c.text)?;
                }
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
        Ok(VaultInfo {
            root: self.root.display().to_string(),
            documents: self.index.document_count()?,
            meta: self.meta.clone(),
            doc_types: DocTypeInfo::all(),
        })
    }

    fn abs(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    fn rel(&self, abs: &Path) -> Option<String> {
        abs.strip_prefix(&self.root)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
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
            if entry.file_type().is_file() && entry.path().extension().map_or(false, |x| x == "md")
            {
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
        self.index_boards()?;
        Ok(changed)
    }

    /// Record the Board refs of every Composition that has a Board.
    ///
    /// Runs after the file walk rather than inside it: a `file` node names a
    /// path, and a path only resolves once the document it names has been
    /// indexed. Without this a Board's refs would appear only after the user
    /// happened to open it, so material sitting on a Board would show as
    /// untouched Candidate material until then.
    fn index_boards(&mut self) -> Result<()> {
        for comp in self.index.list(Some(DocType::Composition))? {
            let rel = canvas::board_path(&comp.path);
            let abs = self.abs(&rel);
            if !abs.exists() {
                continue;
            }
            let Ok(text) = fs::read_to_string(&abs) else { continue };
            // A canvas this app cannot parse is left alone rather than
            // reported: it is the user's file, and the Board view will say so.
            let Ok(board) = Canvas::parse(&text) else { continue };
            if let Some(sync) = self.sync.as_mut() {
                sync.record_canvas(&comp.id, &board)?;
            }
            self.record_board_refs(&comp.id, &board)?;
        }
        Ok(())
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
        let date_names = self.schema.date_names();
        self.index
            .upsert(&id, rel, mtime, &text, &parsed, &date_names)?;
        let passages: Vec<Passage> = parsed
            .references
            .iter()
            .flat_map(|d| d.passages.iter().copied())
            .collect();
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
        let mut wanted: Vec<(u8, Option<u16>, Option<u16>)> =
            passages.iter().flat_map(templates::pages_for).collect();
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
        let summary = self
            .index
            .get(id)?
            .ok_or_else(|| Error::NotFound(id.into()))?;
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
        let summary = self
            .index
            .get(id)?
            .ok_or_else(|| Error::NotFound(id.into()))?;
        // Never let a save drop the id.
        let text = document::with_frontmatter_fields(text, &[("id", id)]);
        write_atomic(&self.abs(&summary.path), &text)?;
        self.index_file(&summary.path)?;
        self.read(id)
    }

    /// The Board of a Composition, or `None` when it has none yet.
    ///
    /// A Board has no id of its own: it is the `.canvas` beside the
    /// Composition's `.md` (ADR 0009). The file on disk wins over the CRDT the
    /// same way a document's text does — it may have been edited in Obsidian
    /// since this Device last looked — so reading folds the file in first.
    pub fn read_board(&mut self, id: &str) -> Result<Option<Canvas>> {
        let summary = self
            .index
            .get(id)?
            .ok_or_else(|| Error::NotFound(id.into()))?;
        let rel = canvas::board_path(&summary.path);
        let abs = self.abs(&rel);
        if !abs.exists() {
            // No file: the CRDT may still hold a Board another Device made,
            // not yet materialised here.
            return Ok(self.sync.as_mut().and_then(|s| s.canvas_of(id)));
        }
        let parsed = Canvas::parse(&fs::read_to_string(&abs)?)?;
        let board = if let Some(sync) = self.sync.as_mut() {
            // Structural reconcile (PLAN §17.14): diff the file against the
            // map node by node, so an untouched node records no operation and
            // a concurrent remote edit to it survives.
            sync.record_canvas(id, &parsed)?;
            match sync.canvas_of(id) {
                Some(merged) => {
                    if merged != parsed {
                        write_atomic(&abs, &merged.to_json())?;
                    }
                    merged
                }
                None => parsed,
            }
        } else {
            parsed
        };
        // An edit made elsewhere — Obsidian, or another Device — changes what
        // the Board references, so the refs are recorded on read as well as on
        // write.
        self.record_board_refs(id, &board)?;
        Ok(Some(board))
    }

    /// Record which documents a Board references, so they show as on the Board
    /// rather than as untouched Candidates (PLAN §17.6).
    fn record_board_refs(&mut self, id: &str, board: &Canvas) -> Result<()> {
        let targets: Vec<String> = board.targets().into_iter().map(str::to_string).collect();
        self.index.set_board_refs(id, &targets)
    }

    /// Replace a Composition's Board, writing the `.canvas` file and folding
    /// it into the CRDT. An empty Board writes no file: a Composition that was
    /// only ever opened should not litter the vault with empty canvases.
    pub fn write_board(&mut self, id: &str, board: &Canvas) -> Result<()> {
        let summary = self
            .index
            .get(id)?
            .ok_or_else(|| Error::NotFound(id.into()))?;
        let rel = canvas::board_path(&summary.path);
        let abs = self.abs(&rel);
        if let Some(sync) = self.sync.as_mut() {
            sync.record_canvas(id, board)?;
        }
        self.record_board_refs(id, board)?;
        if board.is_empty() && !abs.exists() {
            return Ok(());
        }
        write_atomic(&abs, &board.to_json())?;
        Ok(())
    }

    /// Compositions whose Board references this document.

    /// The Board excerpt for each `(path, subpath)` a Board references.
    /// File name for a title: lowercase, filesystem-safe, unique within `folder`.
    /// `keep` is the document's own path, so renaming a file to a different
    /// casing of itself is not a clash (case-insensitive file systems would
    /// otherwise report it as existing and append " 2").
    fn unique_path(&self, folder: &str, title: &str, keep: Option<&str>) -> String {
        let base = sanitize_title(title).to_lowercase();
        let mut n = 1;
        loop {
            let name = if n == 1 {
                base.clone()
            } else {
                format!("{base} {n}")
            };
            let rel = if folder.is_empty() {
                format!("{name}.md")
            } else {
                format!("{folder}/{name}.md")
            };
            if keep.is_some_and(|k| k.to_lowercase() == rel.to_lowercase())
                || !self.abs(&rel).exists()
            {
                return rel;
            }
            n += 1;
        }
    }

    /// Whether the display title needs a `title` property, i.e. it carries
    /// capitalisation the lowercase file stem cannot reproduce.
    fn needs_title_field(rel: &str, title: &str) -> bool {
        document::display_title(&document::title_from_path(rel)) != title
    }

    /// The moment a Clipping was kept, as a file name may spell it: dots
    /// rather than colons, which no Windows path may contain (and which
    /// `sanitize_title` would strip anyway).
    fn stamp_now() -> String {
        chrono::Local::now().format("%Y-%m-%d %H.%M").to_string()
    }

    /// A Clipping's file name: its Citation, plus the moment it was kept.
    ///
    /// A Clipping has no title (ADR 0013), so the Source and Locator it names
    /// are what identify it — the one label for an excerpt that is not
    /// invented. The timestamp is what makes it unique: two Clippings from one
    /// paragraph are ordinary, and `unique_path`'s " 2" would tell them apart
    /// by nothing a reader could use. It also unties the name from the
    /// Source's title, so renaming a Source cannot make two stems collide.
    fn citation_stem(fields: &Map<String, Value>, stamp: &str) -> String {
        let text = |k: &str| {
            fields
                .get(k)
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default()
        };
        // `source` arrives as a wikilink, since that is what is written to
        // frontmatter; the stem wants the Source's name alone.
        let source = text("source")
            .trim_start_matches("[[")
            .trim_end_matches("]]")
            .split('|')
            .next()
            .unwrap_or_default()
            .trim()
            .to_string();
        let parts = [source.as_str(), text("locator"), stamp];
        parts
            .iter()
            .filter(|p| !p.is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Create a new document from its type's template.
    pub fn create(
        &mut self,
        doc_type: DocType,
        title: &str,
        fields: &Map<String, Value>,
        body: &str,
    ) -> Result<DocumentView> {
        if doc_type.is_scripture() {
            return Err(Error::Invalid(
                "Scripture pages are created by mentioning them".into(),
            ));
        }
        let folder = fields
            .get("folder")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| doc_type.default_folder().to_string());
        let mut fields = fields.clone();
        fields.remove("folder");
        // A Clipping is named by its Citation and never carries a title
        // (ADR 0013); the `title` argument is ignored for one, and a `title`
        // field a caller passed is dropped rather than written.
        let title = if doc_type == DocType::Clipping {
            fields.remove("title");
            Self::citation_stem(&fields, &Self::stamp_now())
        } else {
            document::display_title(&sanitize_title(title))
        };
        let rel = self.unique_path(&folder, &title, None);
        if doc_type != DocType::Clipping
            && !fields.contains_key("title")
            && Self::needs_title_field(&rel, &title)
        {
            fields.insert("title".into(), Value::String(title.clone()));
        }
        let id = new_id();
        write_atomic(
            &self.abs(&rel),
            &templates::new_document(&id, doc_type, &fields, body),
        )?;
        self.index_file(&rel)?;
        self.read(&id)
    }

    /// Rename a document and rewrite `[[Old]]` links across the vault.
    pub fn rename(&mut self, id: &str, new_title: &str) -> Result<DocumentView> {
        let summary = self
            .index
            .get(id)?
            .ok_or_else(|| Error::NotFound(id.into()))?;
        if summary.doc_type == DocType::Clipping {
            // A Clipping has no title to change (ADR 0013). Refusing beats
            // quietly writing one back: the caller has misunderstood what it
            // holds, and the file name is a Citation the app derives.
            return Err(Error::Invalid("A Clipping has no title".into()));
        }
        let new_title = document::display_title(&sanitize_title(new_title));
        if new_title == summary.title {
            return self.read(id);
        }
        // Collect who links here before the title changes.
        let backlinks = self.index.backlinks(id, self.lang)?;
        let folder = summary
            .path
            .rsplit_once('/')
            .map(|(f, _)| f.to_string())
            .unwrap_or_default();
        let new_rel = self.unique_path(&folder, &new_title, Some(&summary.path));
        if new_rel != summary.path {
            fs::rename(self.abs(&summary.path), self.abs(&new_rel))?;
            // A Board is identified by its pairing, so it moves with the
            // Composition or it stops being that Composition's (ADR 0009).
            let (old_board, new_board) = (
                self.abs(&canvas::board_path(&summary.path)),
                self.abs(&canvas::board_path(&new_rel)),
            );
            if old_board.exists() {
                fs::rename(&old_board, &new_board)?;
            }
            self.index.remove_path(&summary.path)?;
        }
        // The file stem is lowercase; keep the typed capitalisation in `title` when it differs.
        let p = self.abs(&new_rel);
        let text = fs::read_to_string(&p)?;
        let updated = document::set_frontmatter_field(
            &text,
            "title",
            Self::needs_title_field(&new_rel, &new_title).then_some(new_title.as_str()),
        );
        if updated != text {
            write_atomic(&p, &updated)?;
        }
        self.index_file(&new_rel)?;
        // Update links in every document that pointed at the old title.
        let old = regex::escape(&summary.title);
        let re = Regex::new(&format!(
            r"(?i)\[\[\s*{old}\s*(?P<rest>(?:#[^\]\|]*)?(?:\|[^\]]*)?)\]\]"
        ))
        .unwrap();
        let final_title = self
            .index
            .get(id)?
            .map(|d| d.title)
            .unwrap_or_else(|| new_title.clone());
        for bl in backlinks {
            if bl.kind == index::BacklinkKind::Mention || bl.kind == index::BacklinkKind::Tag {
                continue;
            }
            let p = self.abs(&bl.doc.path);
            let text = fs::read_to_string(&p)?;
            let updated = re.replace_all(&text, |c: &regex::Captures| {
                format!("[[{final_title}{}]]", &c["rest"])
            });
            if updated != text {
                write_atomic(&p, &updated)?;
                self.index_file(&bl.doc.path)?;
            }
        }
        if new_rel != summary.path {
            self.rewrite_boards(id, &summary.path, &new_rel)?;
        }
        self.read(id)
    }

    /// Point every Board that referenced `from` at `to`.
    ///
    /// JSON Canvas stores a path, not an id, so a rename breaks a `file` node
    /// unless the paths are rewritten (PLAN §17.13). The document is named by
    /// id rather than by its old path, which no longer resolves once the
    /// rename has re-indexed it. Boards are found through the index rather
    /// than by scanning the vault, so this costs one query.
    fn rewrite_boards(&mut self, id: &str, from: &str, to: &str) -> Result<()> {
        for comp in self.index.boards_referencing(id)? {
            let Some(mut board) = self.read_board(&comp.id)? else { continue };
            if board.rewrite_path(from, to) {
                self.write_board(&comp.id, &board)?;
            }
        }
        Ok(())
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        let summary = self
            .index
            .get(id)?
            .ok_or_else(|| Error::NotFound(id.into()))?;
        let p = self.abs(&summary.path);
        if p.exists() {
            fs::remove_file(p)?;
        }
        // The Board belongs to the Composition, so it goes too. Nodes on
        // *other* Boards that pointed here are left alone and render as
        // missing: never silently remove what the user placed (PLAN §17.13).
        let board = self.abs(&canvas::board_path(&summary.path));
        if board.exists() {
            fs::remove_file(board)?;
        }
        if let Some(sync) = self.sync.as_mut() {
            sync.record_delete(id)?;
        }
        self.index.remove_id(id)
    }

    // ---- read-only queries -------------------------------------------------

    /// Answer a question from the UI (`crate::query`).
    ///
    /// The whole read surface of the index behind one method, so a new
    /// question is a variant rather than a forward here, a command, a bridge
    /// arm and a method in `api.ts`. The Device's display language is filled
    /// in here: it is state this Vault holds, not part of the question.
    pub fn query(&self, q: Query) -> Result<Answer> {
        Ok(match q {
            Query::List { doc_type } => Answer::Docs(self.index.list(doc_type)?),
            Query::Places => Answer::Docs(self.index.places()?),
            Query::Library => Answer::Library(self.index.library()?),
            Query::Clippings { source_id } => {
                Answer::Entries(self.index.clippings(source_id.as_deref())?)
            }
            Query::Backlinks { id } => Answer::Backlinks(self.index.backlinks(&id, self.lang)?),
            Query::SourceTrail { id } => Answer::Entries(self.index.source_trail(&id)?),
            Query::SourceChildren { id } => Answer::Docs(self.index.source_descendants(&id)?),
            Query::TagsOf { ids } => Answer::TagsOf(self.index.tags_of(&ids)?),
            Query::UnresolvedLinks => Answer::UnresolvedLinks(self.index.unresolved()?),
            Query::BoardsReferencing { id } => {
                Answer::Docs(self.index.boards_referencing(&id)?)
            }
            Query::BoardExcerpts { refs } => {
                let pairs: Vec<(String, Option<String>)> =
                    refs.into_iter().map(|r| (r.path, r.subpath)).collect();
                Answer::BoardExcerpts(self.index.board_excerpts(&pairs)?)
            }
            Query::UnlinkedMentions { id, limit } => {
                Answer::UnlinkedMentions(self.index.unlinked_mentions(&id, limit)?)
            }
            Query::AmbiguousTitles => Answer::AmbiguousTitles(self.index.ambiguous_titles()?),
            Query::Candidates { id, limit } => {
                Answer::Candidates(self.index.candidates(&id, self.lang, limit)?)
            }
            Query::Graph { level } => Answer::Graph(self.index.graph(level, self.lang)?),
            Query::Search { text, limit } => Answer::Search(self.index.search(&text, limit)?),
            Query::Suggest { prefix, limit } => {
                Answer::Docs(self.index.suggest(&prefix, limit)?)
            }
            Query::Tags => Answer::Tags(
                self.index
                    .tags()?
                    .into_iter()
                    .map(|(tag, count)| crate::query::TagCount { tag, count })
                    .collect(),
            ),
            Query::Tagged { tag } => Answer::Docs(self.index.tagged(&tag)?),
            Query::Coverage => Answer::Coverage(self.index.coverage()?),
            Query::VerseCoverage { book, chapter } => Answer::VerseCoverage(
                self.index
                    .verse_coverage(book, chapter)?
                    .into_iter()
                    .map(|(verse, count)| crate::query::VerseCount { verse, count })
                    .collect(),
            ),
            Query::VerseMentions {
                book,
                chapter,
                verse,
            } => Answer::Backlinks(
                self.index
                    .mentions_of(book, chapter, verse, self.lang, None)?,
            ),
            Query::ScripturePage {
                book,
                chapter,
                verse,
            } => Answer::Doc(self.index.scripture_doc(book, chapter, verse)?),
            Query::DatesOf { id } => Answer::Dates(self.index.dates_of(&id)?),
            Query::Timeline => Answer::Dates(self.index.timeline()?),
            Query::EventsNaming { id } => Answer::Docs(self.index.events_naming(&id)?),
            Query::EventLinks => Answer::EventLinks(self.index.event_links()?),
            Query::TimelineTags => Answer::DocTags(self.index.timeline_tags()?),
            Query::Journeys => Answer::Journeys(self.index.journeys()?),
            Query::PlaceFacts => Answer::PlaceFacts(self.index.place_facts()?),
        })
    }

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
    pub fn scripture_doc(
        &self,
        book: u8,
        chapter: Option<u16>,
        verse: Option<u16>,
    ) -> Result<Option<DocSummary>> {
        self.index.scripture_doc(book, chapter, verse)
    }
    pub fn coverage(&self) -> Result<Vec<CoverageCell>> {
        self.index.coverage()
    }
    pub fn verse_coverage(&self, book: u8, chapter: u16) -> Result<Vec<(u16, u32)>> {
        self.index.verse_coverage(book, chapter)
    }
    /// Devices seen in the sync folder (ADR 0001); empty when sync is off.
    pub fn devices(&self) -> Vec<crate::sync::DeviceInfo> {
        self.sync.as_ref().map(|s| s.devices()).unwrap_or_default()
    }
    /// Names in the document being written that match a Hub and are not yet
    /// Mentions (ADR 0011).
    ///
    /// Not a `Query`: the offsets are re-projected to UTF-16 for CodeMirror by
    /// the caller, which is a conversion for one consumer rather than a
    /// question the index answers.
    pub fn linkables(&self, id: &str, body: &str) -> Result<Vec<Linkable>> {
        self.index.linkables(id, body, crate::query::LINKABLE_LIMIT)
    }
    pub fn graph(&self, level: GraphLevel) -> Result<Graph> {
        self.index.graph(level, self.lang)
    }
    pub fn search(&self, q: &str, limit: usize) -> Result<Vec<SearchHit>> {
        self.index.search(q, limit)
    }
    pub fn tags(&self) -> Result<Vec<(String, u32)>> {
        self.index.tags()
    }
    /// Every Journey with its Stops in travel order (ADR 0010).
    pub fn candidates(&self, id: &str) -> Result<Vec<Candidate>> {
        self.index.candidates(id, self.lang, 50)
    }
    /// Every Clipping with its Citation, or those of one Source (ADR 0013).
    /// The Tags on each of `ids`, for filtering a list the caller already has.
    pub fn unresolved(&self) -> Result<Vec<UnresolvedLink>> {
        self.index.unresolved()
    }
    pub fn unlinked_mentions(&self, id: &str) -> Result<UnlinkedMentions> {
        self.index.unlinked_mentions(id, 200)
    }

    /// Turn one Unlinked mention into a Mention, in the document that wrote it.
    ///
    /// `start`/`end` are offsets into `doc_id`'s **body**, as returned by
    /// [`Index::unlinked_mentions`]; the file on disk is re-read and the text
    /// at those offsets checked against `expect` before anything is written,
    /// because the index reflects the last save and Obsidian or a sync may
    /// have edited the file since (ADR 0011).
    ///
    /// Returns the document's text as it was *before* the edit, so a batch can
    /// be undone.
    pub fn link_mention(
        &mut self,
        doc_id: &str,
        start: usize,
        end: usize,
        expect: &str,
        target_id: &str,
    ) -> Result<String> {
        let view = self.read(doc_id)?;
        let target = self
            .index
            .get(target_id)?
            .ok_or_else(|| Error::NotFound(target_id.into()))?;
        // The target is known here — the user is standing on its Hub — so an
        // ambiguous title is qualified by path rather than left to resolve().
        let path = if self.index.ambiguous_titles()?.iter().any(|a| {
            a.docs.iter().any(|d| d.id == target_id)
        }) {
            Some(target.path.as_str())
        } else {
            None
        };
        let replacement = unlinked::link_text(&target.title, expect, path);
        let (s, e) = (view.body_offset + start, view.body_offset + end);
        let next = unlinked::splice(&view.text, s, e, expect, &replacement).ok_or_else(|| {
            Error::Invalid(format!(
                "{} changed since it was indexed; nothing was written",
                view.summary.path
            ))
        })?;
        let before = view.text.clone();
        self.write(doc_id, &next)?;
        Ok(before)
    }

    /// Restore documents to the text they held before a batch of links.
    ///
    /// Used by Undo after "Link all": the batch keeps each document's previous
    /// text, and putting it back is an ordinary write, so it syncs and is
    /// itself undoable through history.
    pub fn restore_texts(&mut self, texts: &[(String, String)]) -> Result<()> {
        for (id, text) in texts {
            self.write(id, text)?;
        }
        Ok(())
    }
    /// Find a document by URL (Sources are deduplicated by URL).
    pub fn find_by_url(&self, url: &str) -> Result<Option<DocSummary>> {
        let url = url.trim().trim_end_matches('/');
        for d in self.index.list(Some(DocType::Source))? {
            if let Some((_, fm)) = self.index.text_of(&d.id)? {
                if let Ok(Value::Object(m)) = serde_json::from_str::<Value>(&fm) {
                    if m.get("url")
                        .and_then(Value::as_str)
                        .map(|u| u.trim().trim_end_matches('/'))
                        == Some(url)
                    {
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
        fs::write(
            dir.path().join("Notes/First.md"),
            "Meditation on Romans 8:28 with [[Paul]].\n",
        )
        .unwrap();
        let data = dir.path().join(".data");
        let v = Vault::open(dir.path().join("."), &data, Lang::En).unwrap();
        (dir, v)
    }

    #[test]
    fn linking_an_unlinked_mention_rewrites_only_the_brackets() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Notes")).unwrap();
        fs::create_dir_all(dir.path().join("Places")).unwrap();
        fs::write(
            dir.path().join("Places/antioch.md"),
            "---\ntype: place\ntitle: \"Antioch\"\n---\n",
        )
        .unwrap();
        fs::write(
            dir.path().join("Notes/brothers.md"),
            "# The brothers\n\nAntioch is where they met.\n",
        )
        .unwrap();
        let data = dir.path().join(".data");
        let mut v = Vault::open(dir.path().join("."), &data, Lang::En).unwrap();

        let place = v.resolve("Antioch").unwrap().unwrap();
        let u = v.unlinked_mentions(&place.id).unwrap();
        assert_eq!(u.total, 1, "the prose mention is found");
        let m = &u.items[0];
        assert_eq!(m.matched, "Antioch");

        let before = v
            .link_mention(&m.doc.id, m.start, m.end, &m.matched, &place.id)
            .unwrap();
        let after = fs::read_to_string(dir.path().join("Notes/brothers.md")).unwrap();
        assert!(
            after.contains("[[Antioch]] is where they met."),
            "spliced at the right offset: {after:?}"
        );
        // Everything else is untouched, frontmatter included.
        assert_eq!(after, before.replace("Antioch is", "[[Antioch]] is"));

        // It is a Backlink now, and no longer an Unlinked mention.
        assert_eq!(v.unlinked_mentions(&place.id).unwrap().total, 0);
        assert_eq!(v.backlinks(&place.id).unwrap().len(), 1);

        // Undo puts the words back.
        v.restore_texts(&[(m.doc.id.clone(), before)]).unwrap();
        assert_eq!(v.unlinked_mentions(&place.id).unwrap().total, 1);
    }

    #[test]
    fn linking_works_on_a_crlf_file() {
        // Windows-authored documents are CRLF throughout. The index measures
        // the file as it is on disk and the splice reads the same bytes back,
        // so the offsets agree and the prose keeps its line endings.
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Notes")).unwrap();
        fs::create_dir_all(dir.path().join("Places")).unwrap();
        fs::write(
            dir.path().join("Places/antioch.md"),
            "---
type: place
title: \"Antioch\"
---
",
        )
        .unwrap();
        fs::write(
            dir.path().join("Notes/brothers.md"),
            "# The brothers

One line.
Two line.

Antioch is where they met.
",
        )
        .unwrap();
        let data = dir.path().join(".data");
        let mut v = Vault::open(dir.path().join("."), &data, Lang::En).unwrap();

        let place = v.resolve("Antioch").unwrap().unwrap();
        let u = v.unlinked_mentions(&place.id).unwrap();
        assert_eq!(u.total, 1);
        let m = &u.items[0];
        v.link_mention(&m.doc.id, m.start, m.end, &m.matched, &place.id)
            .unwrap();
        let after = fs::read_to_string(dir.path().join("Notes/brothers.md")).unwrap();
        assert!(
            after.contains("[[Antioch]] is where they met."),
            "spliced at the right offset in a CRLF file: {after:?}"
        );
        assert!(after.contains("One line.
"), "line endings are untouched");
    }

    #[test]
    fn open_assigns_ids_and_materialises_scripture() {
        let (dir, v) = vault();
        let text = fs::read_to_string(dir.path().join("Notes/First.md")).unwrap();
        assert!(text.starts_with("---\nid: "));
        assert!(text.ends_with("Meditation on Romans 8:28 with [[Paul]].\n"));
        assert!(dir.path().join("Scripture/Romans/romans.md").exists());
        assert!(dir
            .path()
            .join("Scripture/Romans/Romans 8/romans 8.md")
            .exists());
        assert!(dir
            .path()
            .join("Scripture/Romans/Romans 8/romans 8.28.md")
            .exists());
        let verse = v.resolve("Romans 8:28").unwrap().unwrap();
        assert_eq!(verse.doc_type, DocType::Verse);
        let bl = v.backlinks(&verse.id).unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].doc.title, "First");
        assert!(v.resolve("Paul").unwrap().is_none());
        assert_eq!(v.unresolved().unwrap()[0].target, "Paul");
    }

    /// ADR 0013: a Clipping is named by its Citation and carries no title.
    #[test]
    fn a_clipping_is_named_by_its_citation_and_has_no_title() {
        let (_dir, mut v) = vault();
        let mut fields = Map::new();
        fields.insert("source".into(), "[[Keep Enduring with Joy]]".into());
        fields.insert("locator".into(), "par. 12".into());
        let c = v
            .create(
                DocType::Clipping,
                // Ignored: a caller cannot name a Clipping.
                "Endurance is steadfastness",
                &fields,
                "> Endurance is remaining steadfast.",
            )
            .unwrap();

        assert!(
            c.summary
                .path
                .starts_with("Clippings/keep enduring with joy par. 12 "),
            "named by its Citation, got {}",
            c.summary.path
        );
        assert!(
            !c.text.contains("title:"),
            "a Clipping carries no title property, got:\n{}",
            c.text
        );
        assert!(
            !c.summary.path.contains("endurance is steadfastness"),
            "the title argument must not reach the file name"
        );
        // The label is the quote, with the `>` gone.
        assert_eq!(c.summary.label, "Endurance is remaining steadfast.");
        // Every other type's label is simply its title.
        let paul = v
            .create(DocType::Character, "Paul", &Map::new(), "The apostle.")
            .unwrap();
        assert_eq!(paul.summary.label, "Paul");

        // A Clipping has no title, so it cannot be renamed.
        assert!(v.rename(&c.summary.id, "Anything").is_err());
    }

    /// The timestamp, not `unique_path`'s " 2", is what tells two Clippings
    /// from one paragraph apart (ADR 0013).
    #[test]
    fn two_clippings_from_one_locator_get_distinct_names() {
        let (_dir, mut v) = vault();
        let mut fields = Map::new();
        fields.insert("source".into(), "[[The Watchtower]]".into());
        fields.insert("locator".into(), "par. 3".into());
        let a = v
            .create(DocType::Clipping, "", &fields, "> First half.")
            .unwrap();
        let b = v
            .create(DocType::Clipping, "", &fields, "> Second half.")
            .unwrap();
        assert_ne!(a.summary.path, b.summary.path);
        for c in [&a, &b] {
            assert!(c.summary.path.starts_with("Clippings/the watchtower par. 3 "));
        }
    }

    /// A Locator is optional, so the stem drops the empty part rather than
    /// leaving a double space.
    #[test]
    fn a_clipping_without_a_locator_is_named_by_source_and_time() {
        let (_dir, mut v) = vault();
        let mut fields = Map::new();
        fields.insert("source".into(), "[[Insight: Ephesus]]".into());
        let c = v
            .create(DocType::Clipping, "", &fields, "> The great theater.")
            .unwrap();
        // `sanitize_title` takes the colon out; the stem is still readable.
        assert!(
            c.summary.path.starts_with("Clippings/insight ephesus 20"),
            "got {}",
            c.summary.path
        );
        assert!(!c.summary.path.contains("  "), "no gap where the Locator was");
    }

    #[test]
    fn create_write_rename_delete() {
        let (dir, mut v) = vault();
        let paul = v
            .create(DocType::Character, "Paul", &Map::new(), "The apostle.")
            .unwrap();
        assert_eq!(paul.summary.path, "Characters/paul.md");
        assert_eq!(paul.summary.title, "Paul");
        assert!(
            !paul.text.contains("title:"),
            "plain capitalisation needs no title property"
        );
        assert!(v.resolve("paul").unwrap().is_some());
        let first = v.get_by_path("Notes/First.md").unwrap().unwrap();
        assert_eq!(v.backlinks(&paul.summary.id).unwrap()[0].doc.id, first.id);

        let renamed = v.rename(&paul.summary.id, "Paul of Tarsus").unwrap();
        assert_eq!(renamed.summary.path, "Characters/paul of tarsus.md");
        assert_eq!(renamed.summary.title, "Paul of Tarsus");
        assert!(
            renamed.text.contains("title: Paul of Tarsus"),
            "inner capitals live in the title property"
        );
        let t = fs::read_to_string(dir.path().join("Notes/First.md")).unwrap();
        assert!(t.contains("[[Paul of Tarsus]]"));
        assert_eq!(
            v.resolve("paul of tarsus").unwrap().unwrap().id,
            paul.summary.id
        );

        // A case-only rename keeps the file and must not get a " 2" suffix.
        let shouted = v.rename(&paul.summary.id, "PAUL OF TARSUS").unwrap();
        assert_eq!(shouted.summary.path, "Characters/paul of tarsus.md");
        assert_eq!(shouted.summary.title, "PAUL OF TARSUS");
        // Back to the stem's own capitalisation: the property goes away.
        let plain = v.rename(&paul.summary.id, "paul of tarsus").unwrap();
        assert_eq!(plain.summary.title, "Paul of tarsus");
        assert!(!plain.text.contains("title:"));
        let renamed = v.rename(&paul.summary.id, "Paul of Tarsus").unwrap();

        let updated = v
            .write(&first.id, "no frontmatter at all, John 3:16")
            .unwrap();
        assert!(updated.text.starts_with("---\nid: "));
        assert_eq!(updated.references.len(), 1);
        assert!(dir
            .path()
            .join("Scripture/John/John 3/john 3.16.md")
            .exists());

        v.delete(&renamed.summary.id).unwrap();
        assert!(v.resolve("Paul of Tarsus").unwrap().is_none());
        assert!(!dir.path().join("Characters/paul of tarsus.md").exists());
    }

    #[test]
    fn publish_missing_snapshots_every_document() {
        let (dir, mut v) = vault();
        // A file that arrived outside the app (Obsidian, a cloud folder) gets its snapshot at scan time;
        // a lost snapshot (older app data, wiped folder) is what publish_missing repairs.
        fs::write(dir.path().join("Notes/External.md"), "Written elsewhere.
").unwrap();
        v.scan().unwrap();
        let ext = v.get_by_path("Notes/External.md").unwrap().unwrap().id;
        let dev = v.device_id().unwrap().to_string();
        let snap = dir.path().join(HIDDEN_DIR).join("sync").join(&dev).join(format!("{ext}.loro"));
        assert!(snap.exists(), "scan snapshots new files");
        assert_eq!(v.publish_missing().unwrap(), 0, "nothing missing after a scan");
        fs::remove_file(&snap).unwrap();
        let n = v.publish_missing().unwrap();
        assert!(n >= 1, "the missing snapshot is republished");
        assert!(snap.exists());
        assert_eq!(v.publish_missing().unwrap(), 0, "second call publishes nothing new");
    }

    #[test]
    fn duplicate_titles_get_suffix_and_sanitised() {
        let (_dir, mut v) = vault();
        let a = v
            .create(DocType::Note, "Ro 8:28 / thoughts?", &Map::new(), "")
            .unwrap();
        assert_eq!(a.summary.path, "Notes/ro 8 28 thoughts.md");
        assert_eq!(a.summary.title, "Ro 8 28 thoughts");
        let b = v
            .create(DocType::Note, "Ro 8:28 / thoughts?", &Map::new(), "")
            .unwrap();
        assert_eq!(b.summary.path, "Notes/ro 8 28 thoughts 2.md");
    }

    #[test]
    fn rescan_picks_up_external_changes() {
        let (dir, mut v) = vault();
        fs::write(
            dir.path().join("Notes/External.md"),
            "Made in Obsidian. #grace\n",
        )
        .unwrap();
        let changed = v.scan().unwrap();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].title, "External");
        assert!(fs::read_to_string(dir.path().join("Notes/External.md"))
            .unwrap()
            .starts_with("---\nid: "));
        fs::remove_file(dir.path().join("Notes/External.md")).unwrap();
        v.scan().unwrap();
        assert!(v.get_by_path("Notes/External.md").unwrap().is_none());
    }
}
