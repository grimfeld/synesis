//! The Vault: a folder of markdown files plus the index that describes it.
//! All file access in the app goes through here (ADR 0004).

use crate::canvas::{self, Canvas};
use crate::cloud;
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
use crate::vault_path::VaultPath;
use crate::{Error, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const HIDDEN_DIR: &str = ".bible-study";

/// Whether a vault-relative path names a document `scan` would index: a
/// `.md` file reached through plain, visible folder names. Rejects anything
/// that could resolve outside the vault (`..`, an absolute path, a Windows
/// drive or stream `:`, a backslash) or into hidden folders such as
/// `.bible-study`.
pub fn is_document_path(rel: &str) -> bool {
    rel.ends_with(".md")
        && !rel.contains('\\')
        && !rel.contains(':')
        && rel
            .split('/')
            .all(|seg| !seg.is_empty() && !seg.starts_with('.'))
}

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

/// A Place with no kind that the gazetteer can give one (PLAN §27.13).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KindSuggestion {
    pub id: String,
    pub title: String,
    pub kind: String,
}

/// What "Fill in kinds" wrote, and which Places it left alone because they
/// gained a kind (or vanished) between the suggestion and the write.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FillResult {
    pub filled: Vec<String>,
    pub skipped: Vec<String>,
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
    /// Where this Device's state for this Vault lives (`local_dir_for`). Held
    /// so leaving cannot be pointed at another Vault's state by a caller that
    /// derived the path a second time.
    local_dir: PathBuf,
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

/// Whether the scan walks into `e`. Hidden entries are skipped, iCloud's
/// placeholders among them: an evicted document stays indexed because
/// `forget_vanished` asks the disk (see `cloud`), not because it was walked.
fn is_walked(e: &walkdir::DirEntry) -> bool {
    e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.')
}

fn is_markdown(p: &Path) -> bool {
    p.extension().is_some_and(|x| x == "md")
}

/// A stable id for a file the engine must not write an `id` into: the same
/// path gives the same id on every launch and every Device.
fn path_id(rel: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(rel.as_bytes());
    format!("path-{}", &hex::encode(digest)[..26])
}

fn mtime_of(p: &Path) -> i64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Make a title safe as a file name on every platform, and as a wikilink
/// target: `#`, `^`, `[` and `]` would make `[[Title]]` point at a heading, a
/// block or nothing, in Synesis and in Obsidian alike.
pub fn sanitize_title(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            '#' | '^' | '[' | ']' => ' ',
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

/// Remove `files` and `.bible-study/` from the Vault at `root`, then each
/// folder that is left empty, up to and including `root`. A folder that still
/// holds something is the user's and stays.
fn remove_owned(root: &Path, files: &[PathBuf]) -> Result<()> {
    let mut dirs = std::collections::BTreeSet::new();
    for f in files {
        // Removing a link removes the link, never its target; but a folder on
        // the way that links out of the Vault is not walked through.
        if !f.parent().is_some_and(|p| crate::vault_path::confined(root, p)) {
            continue;
        }
        match fs::remove_file(f) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        let mut dir = f.parent();
        while let Some(d) = dir.filter(|d| d.starts_with(root) && *d != root) {
            dirs.insert(d.to_path_buf());
            dir = d.parent();
        }
    }
    let hidden = root.join(HIDDEN_DIR);
    if hidden.is_dir() && !crate::vault_path::is_link(&hidden) {
        fs::remove_dir_all(&hidden)?;
    }
    // Deepest first, so a parent is tried once its children are gone.
    for d in dirs.iter().rev() {
        let _ = fs::remove_dir(d);
    }
    let _ = fs::remove_dir(root);
    Ok(())
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
            local_dir: local,
            meta,
            index,
            lang,
            sync: Some(sync),
            schema,
        };
        v.catch_up()?;
        Ok(v)
    }

    /// Bring the index up to date on open. An index written by an older
    /// parser is re-parsed in full, once: its unchanged files would otherwise
    /// keep the old rows forever.
    fn catch_up(&mut self) -> Result<()> {
        let stale = self.index.parser_stale()?;
        self.scan_files(stale)?;
        if stale {
            self.index.set_parser_version(index::PARSER_VERSION)?;
        }
        Ok(())
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

    /// Re-read the Property schema after another Device's copy arrived
    /// (ADR 0016). Re-indexes when the set of Date names moved.
    pub fn reload_property_schema(&mut self) -> Result<()> {
        let fresh = PropertySchema::load(&self.root.join(HIDDEN_DIR));
        let dates_moved = fresh.date_names() != self.schema.date_names();
        self.schema = fresh;
        if dates_moved {
            self.reindex_all()?;
        }
        Ok(())
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
            let missing = self.sync.as_ref().is_some_and(|s| !s.is_published(&d.id));
            if !missing {
                continue;
            }
            let Ok(abs) = self.abs(&d.path) else { continue };
            let Ok(text) = fs::read_to_string(abs) else { continue };
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
                    let p = self.abs(&d.path)?;
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
            // The path comes from another Device's snapshot: write and move
            // only to a place `scan` would index itself. The merged text stays
            // in the CRDT; this Device's next save puts its own path back.
            if !is_document_path(&rel) {
                continue;
            }
            // Never write over, or move, a file iCloud has evicted: the merged
            // text is in the CRDT, and `index_file` folds it in once the file
            // is back (a copy older than the snapshot is replaced there).
            let current_abs = current.as_ref().map(|d| self.abs(&d.path)).transpose()?;
            if cloud::is_evicted(&self.abs(&rel)?)
                || current_abs.as_deref().is_some_and(cloud::is_evicted)
            {
                continue;
            }
            if let Some(d) = current.as_ref() {
                if d.path != rel && self.abs(&d.path)?.exists() {
                    if let Some(parent) = self.abs(&rel)?.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    fs::rename(self.abs(&d.path)?, self.abs(&rel)?)?;
                    self.index.remove_path(&d.path)?;
                }
            }
            let abs = self.abs(&rel)?;
            let on_disk = fs::read_to_string(&abs).unwrap_or_default();
            if on_disk != c.text {
                // A file edited after the newest remote snapshot arrived (in
                // Obsidian, or while this device had never imported it) holds
                // the user's latest words: fold it into the merged state as a
                // diff instead of overwriting it. Only a file older than the
                // snapshot is a stale copy the provider has not replaced yet.
                // A file equal to what this Device held before the import is
                // its own last save, however recent: folding that back in
                // would delete every remote edit the merge just brought.
                let file_newer = abs.is_file()
                    && !on_disk.is_empty()
                    && on_disk != c.before
                    && self
                        .sync
                        .as_ref()
                        .and_then(|s| s.remote_mtime(&c.id))
                        .is_some_and(|m| mtime_of(&abs) > m);
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

    /// The Vault's per-Device folder, outside the synced one.
    pub fn local_dir(&self) -> &Path {
        &self.local_dir
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

    /// The file `rel` names, refused when it would lie outside the Vault
    /// (see [`VaultPath`]): every read and write of a document goes through here.
    fn abs(&self, rel: &str) -> Result<PathBuf> {
        VaultPath::parse(rel)?.under(&self.root)
    }

    fn rel(&self, abs: &Path) -> Option<String> {
        abs.strip_prefix(&self.root)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
    }

    /// Walk the folder and bring the index up to date. Files whose mtime is
    /// unchanged are skipped; files that vanished are forgotten.
    pub fn scan(&mut self) -> Result<Vec<DocSummary>> {
        self.scan_files(false)
    }

    /// [`Vault::scan`], re-parsing every file when `all` is set rather than
    /// only those whose mtime moved.
    fn scan_files(&mut self, all: bool) -> Result<Vec<DocSummary>> {
        let mut changed = self.apply_remote()?;
        let files = self.markdown_files();
        let walked: std::collections::HashSet<String> = files.iter().map(|(rel, _)| rel.clone()).collect();
        changed.extend(self.reindex(files, all)?);
        self.forget_vanished(&walked)?;
        self.index_boards()?;
        // A Border file can change while the app is closed, with its Place
        // untouched (another tool, Pairing, iCloud): every one is read again.
        self.refresh_borders()?;
        Ok(changed)
    }

    /// Parse each of `files` whose mtime moved since it was indexed, or
    /// every one when `all` is set.
    fn reindex(&mut self, mut files: Vec<(String, i64)>, all: bool) -> Result<Vec<DocSummary>> {
        // Oldest first, and of two files as old the shorter path, so that of a
        // document and its copy ("a.md", "a copy.md", "a 2.md") the document
        // is met first and keeps the id they share (`ensure_id`). A copy made
        // in Finder keeps the original's mtime, hence the tie-break.
        files.sort_by(|(a, ma), (b, mb)| ma.cmp(mb).then(a.len().cmp(&b.len())).then(a.cmp(b)));
        let mut changed = Vec::new();
        for (rel, mtime) in files {
            if !all && self.is_current(&rel, mtime)? {
                continue;
            }
            // The Border names are noted once, after the walk.
            if let Some(d) = self.index_file_as(&rel, false)? {
                changed.push(d);
            }
        }
        Ok(changed)
    }

    /// Every markdown file of the Vault, with its mtime.
    fn markdown_files(&self) -> Vec<(String, i64)> {
        walkdir::WalkDir::new(&self.root)
            .follow_links(false)
            .into_iter()
            .filter_entry(is_walked)
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file() && is_markdown(e.path()))
            .filter_map(|e| Some((self.rel(e.path())?, mtime_of(e.path()))))
            .collect()
    }

    /// Whether the index already holds `rel` as it was at `mtime`.
    fn is_current(&self, rel: &str, mtime: i64) -> Result<bool> {
        Ok(self.index.mtime_of(rel)? == Some(mtime))
    }

    /// Forget files that vanished. A file the walk just found is there; for
    /// the rest the disk decides: Scripture pages materialised during a scan
    /// were not walked, and a document iCloud has evicted is the user's still,
    /// kept until it really goes. Only those are looked up, not every file
    /// the index holds.
    fn forget_vanished(&mut self, walked: &std::collections::HashSet<String>) -> Result<()> {
        for path in self.index.all_paths()? {
            if walked.contains(&path) {
                continue;
            }
            // A path that now leads out of the Vault is not one of its files.
            let Ok(abs) = self.abs(&path) else {
                self.index.remove_path(&path)?;
                continue;
            };
            if !abs.is_file() && !cloud::is_evicted(&abs) {
                self.index.remove_path(&path)?;
            }
        }
        Ok(())
    }

    // ---- Containment (ADR 0023) ----------------------------------------------

    /// After a Place is indexed: its own Border, read and recorded (with the
    /// Places inside it recomputed when it changed), and the regions it lies
    /// inside, from its coordinates. Only a region has a Border.
    fn index_containment(&mut self, id: &str, rel: &str, fm: &Map<String, Value>) -> Result<()> {
        let border = fm.get(crate::border::PROPERTY).filter(|_| crate::border::is_region(fm.get("kind")));
        self.record_border(id, rel, border)?;
        self.index.locate_place(id)
    }

    /// `(id, path, border value)` for every region Place that sets `border`.
    /// A Place of another kind may carry the Property, written by hand; it is
    /// not a Border (ADR 0023).
    fn bordered_places(&self) -> Result<Vec<(String, String, Value)>> {
        let regions: std::collections::HashSet<String> = self
            .index
            .property_on(DocType::Place, "kind")?
            .into_iter()
            .filter(|(_, _, k)| crate::border::is_region(Some(k)))
            .map(|(id, _, _)| id)
            .collect();
        Ok(self
            .index
            .property_on(DocType::Place, crate::border::PROPERTY)?
            .into_iter()
            .filter(|(id, _, _)| regions.contains(id))
            .collect())
    }

    /// The region Places whose `border` names the file `rel`.
    pub fn places_naming_border(&self, rel: &str) -> Result<Vec<String>> {
        Ok(self
            .bordered_places()?
            .into_iter()
            .filter(|(_, path, value)| Self::border_path(path, value).as_deref() == Some(rel))
            .map(|(id, _, _)| id)
            .collect())
    }

    /// Tell Pairing which Border files the Vault's regions name: only those
    /// travel (ADR 0023).
    fn note_border_names(&self) -> Result<()> {
        let names = self
            .bordered_places()?
            .into_iter()
            .filter_map(|(_, path, value)| Self::border_path(&path, &value));
        crate::border::set_named(&self.local_dir, names)
    }

    /// Delete a Border file the Vault no longer wants, unless another region
    /// still names it, leaving a tombstone so a paired Device drops its copy
    /// rather than pushing it back. `except` is the Place letting it go.
    pub fn drop_border_file(&mut self, rel: &str, except: &str) -> Result<bool> {
        if self.places_naming_border(rel)?.iter().any(|id| id != except) {
            return Ok(false);
        }
        crate::border::remove(&self.root, &self.local_dir, rel)?;
        Ok(true)
    }

    /// Read one region's Border file into the index. A file iCloud has not
    /// downloaded yet keeps what was recorded before; one that is missing or
    /// malformed contains nothing, as a region without a Border does.
    fn record_border(&mut self, id: &str, place_path: &str, border: Option<&Value>) -> Result<bool> {
        let Some(rel) = border.and_then(|b| Self::border_path(place_path, b)) else {
            return self.index.set_region_border(id, None);
        };
        let b = crate::border::read(&self.root, id, &rel);
        match b.status {
            crate::border::BorderStatus::Downloading => Ok(false),
            crate::border::BorderStatus::Ok => self.index.set_region_border(id, Some(&b.polygons)),
            _ => self.index.set_region_border(id, None),
        }
    }

    /// Read every region's Border file again and recompute containment where
    /// one changed. Returns the regions that changed.
    fn refresh_borders(&mut self) -> Result<Vec<String>> {
        let mut changed = Vec::new();
        let named = self.bordered_places()?;
        let seen: std::collections::HashSet<String> = named.iter().map(|(id, _, _)| id.clone()).collect();
        for (id, path, value) in named {
            if self.record_border(&id, &path, Some(&value))? {
                changed.push(id);
            }
        }
        changed.extend(self.forget_unnamed_borders(&seen)?);
        self.note_border_names()?;
        Ok(changed)
    }

    /// Forget each Border on record whose Place no longer names one. Returns
    /// those regions.
    fn forget_unnamed_borders(&mut self, named: &std::collections::HashSet<String>) -> Result<Vec<String>> {
        let mut gone = Vec::new();
        for id in self.index.bordered_regions()? {
            if !named.contains(&id) && self.index.set_region_border(&id, None)? {
                gone.push(id);
            }
        }
        Ok(gone)
    }

    /// A `.geojson` file changed on disk without its Place changing (an edit
    /// in another tool, a Border from a paired Device, a Border command): the
    /// Places inside each region are recomputed. Returns the regions whose
    /// containment changed, for the views to ask again.
    pub fn border_file_changed(&mut self) -> Result<Vec<DocSummary>> {
        // Every Border is read, not only the one that changed: a file can be
        // named by more than one Place, and there are few regions in any Vault.
        let mut out = Vec::new();
        for id in self.refresh_borders()? {
            if let Some(d) = self.index.get(&id)? {
                out.push(d);
            }
        }
        Ok(out)
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
            let Ok(abs) = self.abs(&rel) else { continue };
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
        let d = self.index_file_as(rel, false)?;
        if d.as_ref().is_some_and(|d| d.doc_type == DocType::Place) {
            self.note_border_names()?;
        }
        Ok(d)
    }

    /// `index_file`, told whether the file was just written by this app from
    /// the user's own text. Such a file is never a stale copy, whatever the
    /// snapshots' mtimes say: those carry the sending Device's clock, and a
    /// clock that runs ahead would otherwise have the save replaced by the
    /// older merged text.
    fn index_file_as(&mut self, rel: &str, own_write: bool) -> Result<Option<DocSummary>> {
        // A link is not followed, as the walk does not follow one: read and
        // given an id, a link to a file outside the Vault would turn that file
        // into a Note and sync it to every Device (#86).
        let abs = match self.abs(rel) {
            Ok(abs) if !crate::vault_path::is_link(&abs) => abs,
            _ => {
                self.index.remove_path(rel)?;
                return Ok(None);
            }
        };
        let text = match fs::read_to_string(&abs) {
            Ok(t) => t,
            // Evicted, not deleted: keep what the index knows.
            Err(_) if cloud::is_evicted(&abs) => return Ok(None),
            Err(_) => {
                self.index.remove_path(rel)?;
                return Ok(None);
            }
        };
        let (mut text, mut parsed, id) = self.ensure_id(rel, text)?;
        let mut mtime = mtime_of(&abs);
        if let Some(sync) = self.sync.as_mut() {
            // A file older than another device's snapshot is a stale copy the
            // cloud has not finished replacing: prefer the merged CRDT text.
            if let Some(crdt) = sync.text_of(&id) {
                if !own_write
                    && crdt != text
                    && sync.remote_mtime(&id).is_some_and(|m| m > mtime)
                {
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
        if parsed.doc_type == DocType::Place {
            self.index_containment(&id, rel, &parsed.frontmatter)?;
        }
        let passages: Vec<Passage> = parsed
            .references
            .iter()
            .flat_map(|d| d.passages.iter().copied())
            .collect();
        self.materialise(&passages)?;
        self.index.get(&id)
    }

    /// The document's id, giving the file one when it has none. A file whose
    /// frontmatter cannot take an `id` line safely (YAML that does not parse,
    /// or an `id` key holding nothing usable) is never written to: it is
    /// known by an id derived from its path until the user fixes it.
    ///
    /// A file whose id another file already holds is a copy (#63): duplicated
    /// in Finder or Obsidian, the `id:` line came along. Two files on one id
    /// would share one index row and one history, each save replacing the
    /// other, so the copy gets an id of its own. The file the index already
    /// knows is the original; a walk over a new index finds the original first
    /// (`reindex` orders its files for that).
    fn ensure_id(&self, rel: &str, text: String) -> Result<(String, ParsedDoc, String)> {
        let mut parsed = document::parse(rel, &text);
        if let Some(id) = parsed.id.clone() {
            if !self.held_elsewhere(&id, rel)? {
                return Ok((text, parsed, id));
            }
            let id = new_id();
            let text = document::set_frontmatter_field(&text, "id", Some(&id));
            write_atomic(&self.abs(rel)?, &text)?;
            let mut parsed = document::parse(rel, &text);
            parsed.id = Some(id.clone());
            return Ok((text, parsed, id));
        }
        if !document::can_add_field(&text, "id") {
            let id = path_id(rel);
            parsed.id = Some(id.clone());
            return Ok((text, parsed, id));
        }
        let id = new_id();
        let text = document::with_frontmatter_fields(&text, &[("id", &id)]);
        write_atomic(&self.abs(rel)?, &text)?;
        let mut parsed = document::parse(rel, &text);
        parsed.id = Some(id.clone());
        Ok((text, parsed, id))
    }

    /// Whether `id` belongs to a file other than `rel` that is still there.
    /// One that is gone was renamed or moved, and `rel` is where it went.
    /// Paths differing only in case are taken as one file: on a
    /// case-insensitive disk they are.
    fn held_elsewhere(&self, id: &str, rel: &str) -> Result<bool> {
        let Some(other) = self.index.get(id)? else { return Ok(false) };
        if other.path.to_lowercase() == rel.to_lowercase() {
            return Ok(false);
        }
        Ok(self.abs(&other.path).is_ok_and(|p| cloud::occupied(&p)))
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
            if self.index.get_by_path(&rel)?.is_some() || cloud::occupied(&self.abs(&rel)?) {
                continue;
            }
            let id = new_id();
            write_atomic(&self.abs(&rel)?, &templates::scripture_page(&id, b, c, v))?;
            if let Some(d) = self.index_file(&rel)? {
                created.push(d);
            }
        }
        Ok(created)
    }

    pub fn forget(&mut self, rel: &str) -> Result<()> {
        self.index.remove_path(rel)?;
        self.note_border_names()
    }

    /// A file the watcher saw disappear. Forgotten if it is really gone;
    /// kept if iCloud only evicted it (see `cloud`). Returns whether it was
    /// forgotten.
    pub fn vanished(&mut self, rel: &str) -> Result<bool> {
        if self.abs(rel).is_ok_and(|abs| cloud::is_evicted(&abs)) {
            return Ok(false);
        }
        self.forget(rel)?;
        Ok(true)
    }

    /// Everything under the Vault that iCloud has evicted, by the path it
    /// will have once downloaded: documents, Boards, attachments and the sync
    /// snapshots alike. The shell asks iCloud for each.
    pub fn evicted(&self) -> Vec<PathBuf> {
        cloud::evicted_under(&self.root)
    }

    pub fn read(&self, id: &str) -> Result<DocumentView> {
        let summary = self
            .index
            .get(id)?
            .ok_or_else(|| Error::NotFound(id.into()))?;
        let abs = self.abs(&summary.path)?;
        if cloud::is_evicted(&abs) {
            return Err(cloud::downloading(&abs));
        }
        let text = fs::read_to_string(abs)?;
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
        if cloud::is_evicted(&self.abs(&summary.path)?) {
            return Err(cloud::downloading(&self.abs(&summary.path)?));
        }
        // Never let a save drop the id.
        let text = document::with_frontmatter_fields(text, &[("id", id)]);
        write_atomic(&self.abs(&summary.path)?, &text)?;
        self.index_file_as(&summary.path, true)?;
        if summary.doc_type == DocType::Place {
            self.note_border_names()?;
        }
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
        let abs = self.abs(&rel)?;
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

    /// Fold an outside edit to a `.canvas` file into its Composition's Board
    /// (PLAN §17.14, ADR 0009): the watcher's half of what `read_board` does
    /// on open, so a Board edited in Obsidian refreshes while it is on screen.
    ///
    /// Structural, like `read_board`: the file is diffed against the map node
    /// by node, so an untouched node records nothing. Returns the Composition
    /// when its Board actually changed, and `None` for a canvas that pairs
    /// with no Composition, one this app cannot parse, or the echo of this
    /// app's own `write_board` — which recorded the same Board already, so
    /// announcing it would only make the open Board reload what it just saved.
    pub fn fold_board_file(&mut self, rel: &str) -> Result<Option<DocSummary>> {
        let Some(md) = canvas::composition_path(rel) else { return Ok(None) };
        let Some(comp) = self.index.get_by_path(&md)? else { return Ok(None) };
        if comp.doc_type != DocType::Composition {
            return Ok(None);
        }
        let Ok(abs) = self.abs(rel) else { return Ok(None) };
        if crate::vault_path::is_link(&abs) {
            return Ok(None);
        }
        let Ok(text) = fs::read_to_string(&abs) else { return Ok(None) };
        let Ok(parsed) = Canvas::parse(&text) else { return Ok(None) };
        let (changed, board) = match self.sync.as_mut() {
            Some(sync) => {
                let changed = sync.record_canvas(&comp.id, &parsed)?;
                let merged = sync.canvas_of(&comp.id).unwrap_or_else(|| parsed.clone());
                if merged != parsed {
                    write_atomic(&abs, &merged.to_json())?;
                }
                (changed, merged)
            }
            None => (true, parsed),
        };
        if !changed {
            return Ok(None);
        }
        self.record_board_refs(&comp.id, &board)?;
        Ok(Some(comp))
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
        let abs = self.abs(&rel)?;
        if cloud::is_evicted(&abs) {
            return Err(cloud::downloading(&abs));
        }
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

    /// The Board excerpt for each `(path, subpath)` a Board references.
    /// File name for a title: lowercase, filesystem-safe, unique within `folder`.
    /// `keep` is the document's own path, so renaming a file to a different
    /// casing of itself is not a clash (case-insensitive file systems would
    /// otherwise report it as existing and append " 2").
    fn unique_path(&self, folder: &str, title: &str, keep: Option<&str>) -> Result<String> {
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
                || !cloud::occupied(&self.abs(&rel)?)
            {
                return Ok(rel);
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
        // A new document always goes in its type's folder. There is no field
        // to name another: a caller-chosen folder could name one outside the
        // Vault (#87), and `folder` is written as an ordinary Property.
        let folder = doc_type.default_folder();
        let mut fields = fields.clone();
        // A Clipping is named by its Citation and never carries a title
        // (ADR 0013); the `title` argument is ignored for one, and a `title`
        // field a caller passed is dropped rather than written.
        let title = if doc_type == DocType::Clipping {
            fields.remove("title");
            Self::citation_stem(&fields, &Self::stamp_now())
        } else {
            document::display_title(&sanitize_title(title))
        };
        let rel = self.unique_path(folder, &title, None)?;
        if doc_type != DocType::Clipping
            && !fields.contains_key("title")
            && Self::needs_title_field(&rel, &title)
        {
            fields.insert("title".into(), Value::String(title.clone()));
        }
        let id = new_id();
        write_atomic(
            &self.abs(&rel)?,
            &templates::new_document(&id, doc_type, &fields, body),
        )?;
        self.index_file(&rel)?;
        self.read(&id)
    }

    /// Copy a Composition into a new one titled `title` (PLAN §14.8, ADR 0007):
    /// the same body, Tags and Properties, a fresh id, and a copy of its Board.
    ///
    /// This is how a talk is adapted to a new occasion: a fork, not a Version,
    /// so the copy starts with no history and no Versions of its own. The
    /// Board comes along because a Version covers talk and Board together
    /// (ADR 0009) — the copy is of that moment, and a talk thought out on a
    /// Board would lose its outline otherwise. What belongs to the old
    /// occasion does not come along: `occasion` and `date` are emptied when
    /// present, and `created` is now.
    pub fn duplicate(&mut self, id: &str, title: &str) -> Result<DocumentView> {
        let summary = self
            .index
            .get(id)?
            .ok_or_else(|| Error::NotFound(id.into()))?;
        if summary.doc_type != DocType::Composition {
            return Err(Error::Invalid("Only a Composition can be duplicated".into()));
        }
        let title = document::display_title(&sanitize_title(title));
        let folder = summary
            .path
            .rsplit_once('/')
            .map(|(f, _)| f.to_string())
            .unwrap_or_default();
        let rel = self.unique_path(&folder, &title, None)?;
        let new = new_id();
        let mut text = fs::read_to_string(self.abs(&summary.path)?)?;
        text = document::set_frontmatter_field(&text, "id", Some(&new));
        text = document::set_frontmatter_field(
            &text,
            "title",
            Self::needs_title_field(&rel, &title).then_some(title.as_str()),
        );
        let created = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        text = document::set_frontmatter_field(&text, "created", Some(&created));
        for key in ["occasion", "date"] {
            if document::parse(&rel, &text).frontmatter.contains_key(key) {
                text = document::set_frontmatter_field(&text, key, Some(""));
            }
        }
        write_atomic(&self.abs(&rel)?, &text)?;
        self.index_file_as(&rel, true)?;
        if let Some(board) = self.read_board(id)? {
            if !board.is_empty() {
                self.write_board(&new, &board)?;
            }
        }
        self.read(&new)
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
        if cloud::is_evicted(&self.abs(&summary.path)?) {
            return Err(cloud::downloading(&self.abs(&summary.path)?));
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
        let new_rel = self.unique_path(&folder, &new_title, Some(&summary.path))?;
        if new_rel != summary.path {
            fs::rename(self.abs(&summary.path)?, self.abs(&new_rel)?)?;
            // A Board is identified by its pairing, so it moves with the
            // Composition or it stops being that Composition's (ADR 0009).
            let (old_board, new_board) = (
                self.abs(&canvas::board_path(&summary.path))?,
                self.abs(&canvas::board_path(&new_rel))?,
            );
            if old_board.exists() {
                fs::rename(&old_board, &new_board)?;
            }
            self.index.remove_path(&summary.path)?;
        }
        // The file stem is lowercase; keep the typed capitalisation in `title` when it differs.
        let p = self.abs(&new_rel)?;
        let text = fs::read_to_string(&p)?;
        let updated = document::set_frontmatter_field(
            &text,
            "title",
            Self::needs_title_field(&new_rel, &new_title).then_some(new_title.as_str()),
        );
        let written = updated != text;
        if written {
            write_atomic(&p, &updated)?;
        }
        self.index_file_as(&new_rel, written)?;
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
            let p = self.abs(&bl.doc.path)?;
            let text = fs::read_to_string(&p)?;
            let updated = re.replace_all(&text, |c: &regex::Captures| {
                format!("[[{final_title}{}]]", &c["rest"])
            });
            if updated != text {
                write_atomic(&p, &updated)?;
                self.index_file_as(&bl.doc.path, true)?;
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
        let p = self.abs(&summary.path)?;
        // Deleting the placeholder would leave the cloud copy to come back;
        // deleting through it is iCloud's job, once the file is here.
        if cloud::is_evicted(&p) {
            return Err(cloud::downloading(&p));
        }
        // A region's Border goes with it, as a Composition's Board does,
        // unless another region names the file too (ADR 0023). Before the
        // Place itself: while the Place is there, a delete that stopped
        // halfway, or was refused for a Border still downloading, can be
        // made again.
        let border = self
            .bordered_places()?
            .into_iter()
            .find(|(place, _, _)| place == id)
            .and_then(|(_, path, value)| Self::border_path(&path, &value));
        if let Some(rel) = border {
            self.drop_border_file(&rel, id)?;
        }
        if p.exists() {
            fs::remove_file(p)?;
        }
        // The Board belongs to the Composition, so it goes too. Nodes on
        // *other* Boards that pointed here are left alone and render as
        // missing: never silently remove what the user placed (PLAN §17.13).
        let board = self.abs(&canvas::board_path(&summary.path))?;
        if board.exists() {
            fs::remove_file(board)?;
        }
        if let Some(sync) = self.sync.as_mut() {
            sync.record_delete(id)?;
        }
        self.index.remove_id(id)?;
        self.refresh_borders()?;
        Ok(())
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
            Query::Search { text, types, limit } => {
                Answer::Search(self.index.search(&text, &types, limit)?)
            }
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
            Query::PlaceTies { id } => Answer::PlaceTies(self.index.place_ties(id.as_deref())?),
            Query::TimelineTags => Answer::DocTags(self.index.timeline_tags()?),
            Query::Journeys => Answer::Journeys(self.index.journeys()?),
            Query::PlaceFacts => Answer::PlaceFacts(self.index.place_facts()?),
            Query::KindSuggestions => Answer::KindSuggestions(self.kind_suggestions()?),
            Query::Borders => Answer::Borders(self.borders()?),
            Query::Regions => Answer::Regions(self.index.regions()?),
        })
    }

    pub fn list(&self, doc_type: Option<DocType>) -> Result<Vec<DocSummary>> {
        self.index.list(doc_type)
    }

    /// Every region that names a Border, with the Border read from its file
    /// (ADR 0023). Read on every ask rather than indexed: the file can change
    /// under the Place (Pairing, iCloud, another tool) without the Place
    /// itself changing. A `border` that names anything but a `.geojson` file
    /// in the Vault is reported, never read.
    pub fn borders(&self) -> Result<Vec<crate::border::Border>> {
        let mut out = Vec::new();
        for (id, path, value) in self.bordered_places()? {
            match Self::border_path(&path, &value) {
                Some(rel) => out.push(crate::border::read(&self.root, &id, &rel)),
                None => {
                    let Some(target) = crate::border::link_target(&value) else { continue };
                    out.push(crate::border::Border {
                        doc: id,
                        error: Some(crate::border::not_a_border(&target)),
                        path: target,
                        status: crate::border::BorderStatus::Malformed,
                        polygons: vec![],
                    });
                }
            }
        }
        Ok(out)
    }

    /// The vault-relative Border file a Place's `border` value names: a
    /// `.geojson` file inside the Vault, or nothing. A `border` naming a note
    /// or a path out of the Vault is never read, written or deleted.
    pub fn border_path(place_path: &str, value: &Value) -> Option<String> {
        let target = crate::border::link_target(value)?;
        crate::border::path_for(place_path, &target).filter(|rel| crate::border::is_synced(rel))
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
    /// Take this Device out of the Vault (ADR 0014).
    ///
    /// Consumes the Vault: the index and the CRDT are open files, and on
    /// Windows a directory holding one cannot be removed, so everything this
    /// Device knows has to be dropped before the folder that holds it.
    ///
    /// `delete_documents` is the user's call and is not recoverable: a Vault
    /// that syncs nowhere else, or that holds work no other Device has seen,
    /// goes with it. Without it the folder is left exactly as Obsidian would
    /// find it — plain markdown, sync stopped (ADR 0003).
    ///
    /// The order is deliberate. `withdraw` first, so the other Devices stop
    /// mirroring this one's snapshots; then this Device's own state; then, if
    /// asked, the documents. A crash part way through leaves a Vault that
    /// still syncs rather than a folder whose history is gone.
    ///
    /// Deleting removes what the Vault owns and nothing else (#91): every file
    /// the index knows, each Composition's Board and each Border a region
    /// names, the pictures in `Attachments/`, and `.bible-study/`; then every
    /// folder that leaves empty, the Vault's own included. Any other file stays
    /// where it was, with the folders that hold it. A Vault can be opened on any
    /// folder, a home folder by mistake among them, so removing the folder
    /// whole could take far more than the Vault.
    pub fn leave(mut self, delete_documents: bool) -> Result<()> {
        if let Some(sync) = self.sync.as_mut() {
            sync.withdraw()?;
        }
        let owned = if delete_documents { self.owned_files()? } else { vec![] };
        let root = self.root.clone();
        let local_dir = self.local_dir.clone();
        // Drop the index and the CRDT before removing what holds them.
        drop(self);
        if local_dir.is_dir() {
            fs::remove_dir_all(&local_dir)?;
        }
        if delete_documents && root.is_dir() {
            remove_owned(&root, &owned)?;
        }
        Ok(())
    }

    /// Every file under the Vault that the Vault itself accounts for, as the
    /// paths `leave` removes. `.bible-study/` is not listed: it is removed whole.
    fn owned_files(&self) -> Result<Vec<PathBuf>> {
        let mut rels = self.index.all_paths()?;
        for comp in self.index.list(Some(DocType::Composition))? {
            rels.push(canvas::board_path(&comp.path));
        }
        rels.extend(
            self.bordered_places()?
                .into_iter()
                .filter_map(|(_, path, value)| Self::border_path(&path, &value)),
        );
        let mut out = Vec::new();
        for rel in rels {
            let Ok(abs) = self.abs(&rel) else { continue };
            // An evicted file is its iCloud placeholder until it downloads.
            out.extend(cloud::placeholder_of(&abs));
            out.push(abs);
        }
        if let Ok(pictures) = fs::read_dir(self.root.join(crate::attachments::FOLDER)) {
            for f in pictures.flatten() {
                let name = f.file_name().to_string_lossy().to_string();
                let is_file = f.file_type().is_ok_and(|t| t.is_file());
                if is_file && crate::attachments::is_supported(&name) {
                    out.push(f.path());
                }
            }
        }
        Ok(out)
    }

    /// Stop holding another Device's snapshots in this Vault, and forget what
    /// this Device had imported from it. `true` when a folder was there.
    ///
    /// The Vault's own documents are untouched: a Device leaving takes its
    /// history with it, not the work. Whatever it had already merged into a
    /// document stays merged, because that is the document's history now.
    ///
    /// When a pairing node is running for this Vault, call
    /// `p2p::Node::forget_device` first and this second. The node holds the
    /// roster in memory and rewrites it on its next save, so a retirement
    /// written only here would be overwritten; told first, the node records it
    /// and the write here finds nothing left to do.
    pub fn forget_device(&mut self, device: &str) -> Result<bool> {
        self.sync_mut()?.forget_device(device)
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
        self.index.search(q, &[], limit)
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

    /// Places without a kind whose title the gazetteer knows, with the kind it
    /// gives them (PLAN §27.13). Read-only: nothing is written until the user
    /// confirms, through `fill_kinds`.
    pub fn kind_suggestions(&self) -> Result<Vec<KindSuggestion>> {
        let mut out = Vec::new();
        for fact in self.index.place_facts()? {
            if fact.kind.is_some() {
                continue;
            }
            let Some(doc) = self.index.get(&fact.doc)? else { continue };
            if let Some(kind) = crate::gazetteer::kind_for(&doc.title, doc.lat.zip(doc.lon)) {
                out.push(KindSuggestion { id: doc.id, title: doc.title, kind });
            }
        }
        Ok(out)
    }

    /// Write the kinds the user confirmed. Only ever adds a missing Property:
    /// a Place that has a kind by now keeps it, and is reported as skipped,
    /// and every other line of the file stays as it was.
    pub fn fill_kinds(&mut self, fills: &[KindSuggestion]) -> FillResult {
        let mut result = FillResult::default();
        for f in fills {
            let current = self.read(&f.id).ok();
            let unset = current.as_ref().is_some_and(|v| {
                v.summary.doc_type == DocType::Place
                    && v.frontmatter.get("kind").and_then(Value::as_str).is_none_or(|k| k.trim().is_empty())
            });
            let written = unset
                && current
                    .map(|v| document::set_frontmatter_field(&v.text, "kind", Some(&f.kind)))
                    .is_some_and(|next| self.write(&f.id, &next).is_ok());
            if written {
                result.filled.push(f.id.clone());
            } else {
                result.skipped.push(f.id.clone());
            }
        }
        result
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

    #[test]
    fn a_document_path_stays_inside_the_vault() {
        for ok in ["note.md", "Notes/First.md", "Characters/david.md", "a b/c d.md"] {
            assert!(is_document_path(ok), "{ok}");
        }
        for bad in [
            "",
            "../escaped.md",
            "Notes/../../escaped.md",
            "/etc/x.md",
            "C:/Windows/x.md",
            "C:x.md",
            "Notes\\..\\..\\x.md",
            "note.md:stream.md",
            ".bible-study/vault.json",
            ".bible-study/x.md",
            "Notes/.hidden.md",
            "Notes//x.md",
            "./x.md",
            "Notes/evil.sh",
            "Notes",
        ] {
            assert!(!is_document_path(bad), "{bad}");
        }
    }

    #[test]
    fn a_new_document_cannot_be_written_outside_the_vault() {
        // #87: `create` once took its folder from a `folder` field, verbatim.
        let (dir, mut v) = vault();
        let outside = tempfile::tempdir().unwrap();
        let escape = outside.path().join("x").display().to_string();
        for folder in [escape.as_str(), "../escaped", "Notes/../../escaped"] {
            let mut fields = Map::new();
            fields.insert("folder".into(), Value::String(folder.into()));
            let doc = v.create(DocType::Note, "Escape", &fields, "").unwrap();
            assert!(doc.summary.path.starts_with("Notes/"), "{folder}: {}", doc.summary.path);
        }
        assert!(!dir.path().parent().unwrap().join("escaped").exists());
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
        // And no path the engine is handed reaches past the root.
        assert!(v.abs("../escaped.md").is_err());
        assert!(v.abs(&escape).is_err());
    }

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
    fn fill_kinds_adds_only_missing_kinds_from_the_gazetteer() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Places")).unwrap();
        let write = |name: &str, text: &str| fs::write(dir.path().join("Places").join(name), text).unwrap();
        write("sinai.md", "---\ntype: place\ntitle: \"Mount Sinai\"\nlat: 28.54\nlon: 33.97\n---\nWhere the Law was given.\n");
        // Already has a kind: never suggested, never touched.
        write("jerusalem.md", "---\ntype: place\ntitle: Jerusalem\nkind: site\n---\n");
        // A kind left empty by the template counts as missing.
        write("egypt.md", "---\ntype: place\ntitle: Egypt\nkind: \"\"\n---\n");
        write("atlantis.md", "---\ntype: place\ntitle: Atlantis\n---\n");
        let data = dir.path().join(".data");
        let mut v = Vault::open(dir.path().join("."), &data, Lang::En).unwrap();

        let mut s = v.kind_suggestions().unwrap();
        s.sort_by(|a, b| a.title.cmp(&b.title));
        let pairs: Vec<(&str, &str)> = s.iter().map(|k| (k.title.as_str(), k.kind.as_str())).collect();
        assert_eq!(pairs, [("Egypt", "region"), ("Mount Sinai", "mountain")]);

        // Egypt gains a kind by hand between the suggestion and the write.
        let egypt = s.iter().find(|k| k.title == "Egypt").unwrap().id.clone();
        let text = fs::read_to_string(dir.path().join("Places/egypt.md")).unwrap();
        v.write(&egypt, &text.replace("kind: \"\"", "kind: land")).unwrap();

        let r = v.fill_kinds(&s);
        assert_eq!(r.filled.len(), 1);
        assert_eq!(r.skipped, vec![egypt]);
        let sinai = fs::read_to_string(dir.path().join("Places/sinai.md")).unwrap();
        assert!(sinai.contains("\nkind: mountain\n"), "{sinai}");
        assert!(sinai.contains("lat: 28.54\nlon: 33.97\n") && sinai.ends_with("Where the Law was given.\n"), "{sinai}");
        assert!(fs::read_to_string(dir.path().join("Places/egypt.md")).unwrap().contains("kind: land"));
        assert!(v.kind_suggestions().unwrap().is_empty());
    }

    /// Frontmatter the engine cannot add an `id` to (broken YAML, or an `id`
    /// that is not a usable value) must neither stop the Vault opening nor be
    /// rewritten: the file is indexed under an id derived from its path.
    #[test]
    fn a_file_that_cannot_take_an_id_opens_untouched() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Notes")).unwrap();
        let files = [
            ("Notes/broken.md", "---\ntitle: [unclosed\n---\nbody\n"),
            ("Notes/templater.md", "---\ncreated: <% tp.date.now() %>\ntags: [a\n---\nbody\n"),
            ("Notes/null.md", "---\nid:\ntype: note\n---\nbody\n"),
            ("Notes/list.md", "---\nid: [a]\n---\nbody\n"),
            ("Notes/empty.md", "---\nid: \"\"\n---\nbody\n"),
        ];
        for (rel, text) in files {
            fs::write(dir.path().join(rel), text).unwrap();
        }
        let data = dir.path().join(".data");
        for _ in 0..2 {
            let v = Vault::open(dir.path(), &data, Lang::En).unwrap();
            let listed = v.list(None).unwrap();
            for (rel, text) in files {
                assert_eq!(fs::read_to_string(dir.path().join(rel)).unwrap(), text, "{rel} was rewritten");
                assert!(listed.iter().any(|d| d.path == rel), "{rel} is not indexed");
            }
            let ids: std::collections::HashSet<_> = listed.iter().map(|d| d.id.clone()).collect();
            assert_eq!(ids.len(), listed.len(), "two documents share an id");
        }
    }

    #[test]
    fn a_place_made_from_the_template_is_offered_a_kind() {
        let (_dir, mut v) = vault();
        let mut fields = Map::new();
        fields.insert("lat".into(), Value::from(36.9165));
        fields.insert("lon".into(), Value::from(34.8951));
        let made = v.create(DocType::Place, "Tarsus", &fields, "").unwrap();
        let s = v.kind_suggestions().unwrap();
        assert_eq!(s.len(), 1, "{}\n{s:?}", made.text);
        assert_eq!(s[0].kind, "settlement");
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
    fn linking_after_a_french_elision_keeps_the_elision_outside_the_link() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Notes")).unwrap();
        fs::create_dir_all(dir.path().join("Places")).unwrap();
        fs::write(
            dir.path().join("Places/israel.md"),
            "---\ntype: place\ntitle: \"Israël\"\n---\n",
        )
        .unwrap();
        fs::write(
            dir.path().join("Notes/fils.md"),
            "# Les fils\n\nLes fils d'Israël sortirent.\n",
        )
        .unwrap();
        let data = dir.path().join(".data");
        let mut v = Vault::open(dir.path().join("."), &data, Lang::Fr).unwrap();

        let place = v.resolve("Israël").unwrap().unwrap();
        let u = v.unlinked_mentions(&place.id).unwrap();
        assert_eq!(u.total, 1, "the elided name is an Unlinked mention");
        let m = &u.items[0];
        assert_eq!(m.matched, "Israël");

        v.link_mention(&m.doc.id, m.start, m.end, &m.matched, &place.id)
            .unwrap();
        let after = fs::read_to_string(dir.path().join("Notes/fils.md")).unwrap();
        assert!(
            after.contains("Les fils d'[[Israël]] sortirent."),
            "only the name is linked: {after:?}"
        );
    }

    #[test]
    fn a_new_parser_version_reindexes_unchanged_files_once() {
        // Files whose mtime has not moved are skipped on open, so a change to
        // the parser would never reach them. The index records which parser
        // wrote it; a different one re-parses everything once.
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Notes")).unwrap();
        let note = dir.path().join("Notes/a.md");
        fs::write(&note, "Romans 8:28.\n").unwrap();
        let data = dir.path().join(".data");
        let on_29 = |v: &Vault| {
            v.index
                .mentions_of(45, Some(8), Some(29), Lang::En, None)
                .unwrap()
                .len()
        };
        let v = Vault::open(dir.path().join("."), &data, Lang::En).unwrap();
        assert_eq!(on_29(&v), 0);
        drop(v);

        // Change the text behind the index's back, keeping the mtime: the
        // index only learns of it through a full re-index.
        let when = fs::metadata(&note).unwrap().modified().unwrap();
        fs::write(&note, "Romans 8:28.\n\nv. 29\n").unwrap();
        fs::File::options()
            .write(true)
            .open(&note)
            .unwrap()
            .set_modified(when)
            .unwrap();

        let v = Vault::open(dir.path().join("."), &data, Lang::En).unwrap();
        assert_eq!(on_29(&v), 0, "same parser, unchanged mtime: skipped");
        v.index.set_parser_version(index::PARSER_VERSION - 1).unwrap();
        drop(v);

        let v = Vault::open(dir.path().join("."), &data, Lang::En).unwrap();
        assert_eq!(on_29(&v), 1, "an older parser's index is re-parsed");
        assert!(!v.index.parser_stale().unwrap());
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
    fn a_title_loses_what_would_break_a_link_to_it() {
        assert_eq!(sanitize_title("Acts #2"), "Acts 2");
        assert_eq!(sanitize_title("[[x]]"), "x");
        assert_eq!(sanitize_title("a^b"), "a b");
        let (_dir, mut v) = vault();
        let a = v.create(DocType::Note, "Acts #2 [draft]", &Map::new(), "").unwrap();
        assert_eq!(a.summary.title, "Acts 2 draft");
        assert_eq!(a.summary.path, "Notes/acts 2 draft.md");
        // The link Synesis writes to it reads back as a link to that title.
        let link = crate::unlinked::link_text(&a.summary.title, &a.summary.title, None);
        let parsed = document::parse("Notes/other.md", &format!("See {link}.\n"));
        assert_eq!(parsed.links.len(), 1);
        assert_eq!(parsed.links[0].target, "Acts 2 draft");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_folder_is_not_scanned() {
        // The Vault is the folder itself: a link to somewhere else would pull
        // outside files in, and a link back up would walk forever.
        let (dir, mut v) = vault();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("Elsewhere.md"), "Not the vault's.\n").unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("Linked")).unwrap();
        v.scan().unwrap();
        let paths: Vec<_> = v.list(None).unwrap().into_iter().map(|d| d.path).collect();
        assert!(paths.contains(&"Notes/First.md".to_string()), "{paths:?}");
        assert!(!paths.iter().any(|p| p.starts_with("Linked/")), "{paths:?}");
        assert_eq!(
            fs::read_to_string(outside.path().join("Elsewhere.md")).unwrap(),
            "Not the vault's.\n",
            "a file outside the Vault is never touched"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_note_is_never_read_or_rewritten() {
        // #86: the watcher hands over any path that changed. A link to a file
        // outside the Vault must not become a Note, get an id written into it,
        // or be published to the other Devices.
        let (dir, mut v) = vault();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("id_rsa");
        fs::write(&secret, "PRIVATE KEY\n").unwrap();
        let link = dir.path().join("Notes/key.md");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        // One inside the Vault is not followed either: it is the same Note twice.
        std::os::unix::fs::symlink(dir.path().join("Notes/First.md"), dir.path().join("Notes/again.md")).unwrap();

        assert!(v.index_file("Notes/key.md").unwrap().is_none());
        assert!(v.index_file("Notes/again.md").unwrap().is_none());
        v.scan().unwrap();
        let paths: Vec<_> = v.list(None).unwrap().into_iter().map(|d| d.path).collect();
        assert!(!paths.iter().any(|p| p == "Notes/key.md" || p == "Notes/again.md"), "{paths:?}");
        assert_eq!(fs::read_to_string(&secret).unwrap(), "PRIVATE KEY\n");
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        let published = walkdir::WalkDir::new(dir.path().join(HIDDEN_DIR))
            .into_iter()
            .flatten()
            .filter(|e| e.file_type().is_file())
            .any(|e| fs::read(e.path()).unwrap().windows(11).any(|w| w == b"PRIVATE KEY"));
        assert!(!published, "the target's text reached the sync folder");
    }

    #[test]
    fn a_copied_note_gets_an_id_of_its_own() {
        // #63: a Note duplicated in Finder or Obsidian keeps its `id:` line.
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Notes")).unwrap();
        let text = "---\nid: X1\n---\nGrace.\n";
        // The copy sorts first by name, and has the same mtime as a Finder copy.
        fs::write(dir.path().join("Notes/grace copy.md"), text).unwrap();
        fs::write(dir.path().join("Notes/grace.md"), text).unwrap();
        let t = std::time::SystemTime::now() - std::time::Duration::from_secs(60);
        for f in ["Notes/grace.md", "Notes/grace copy.md"] {
            fs::File::options().write(true).open(dir.path().join(f)).unwrap().set_modified(t).unwrap();
        }
        let data = dir.path().join(".data");
        let mut v = Vault::open(dir.path().join("."), &data, Lang::En).unwrap();

        let ids = |v: &Vault| {
            let mut docs: Vec<(String, String)> =
                v.list(None).unwrap().into_iter().map(|d| (d.path, d.id)).collect();
            docs.sort();
            docs
        };
        let first = ids(&v);
        assert_eq!(first.len(), 2, "{first:?}");
        assert_eq!(first[1], ("Notes/grace.md".into(), "X1".into()), "the original kept its id");
        assert_ne!(first[0].1, "X1");
        let copy = fs::read_to_string(dir.path().join("Notes/grace copy.md")).unwrap();
        assert_eq!(copy, format!("---\nid: {}\n---\nGrace.\n", first[0].1), "only the id line changed");

        v.scan().unwrap();
        assert_eq!(ids(&v), first, "a rescan moved an id");

        // A copy made while the Vault is open, as the watcher reports it.
        fs::write(dir.path().join("Notes/grace 2.md"), text).unwrap();
        let d = v.index_file("Notes/grace 2.md").unwrap().unwrap();
        assert_ne!(d.id, "X1");
        assert_eq!(v.get("X1").unwrap().unwrap().path, "Notes/grace.md");

        // A file moved outside the app is the same document, not a copy.
        fs::rename(dir.path().join("Notes/grace.md"), dir.path().join("Notes/moved.md")).unwrap();
        let d = v.index_file("Notes/moved.md").unwrap().unwrap();
        assert_eq!(d.id, "X1");
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

    /// A Composition and a Note, with a Board pairing the talk to the Note.
    fn talk_vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Notes")).unwrap();
        fs::create_dir_all(dir.path().join("Compositions")).unwrap();
        fs::write(dir.path().join("Notes/joy.md"), "Joy in trials.\n").unwrap();
        fs::write(
            dir.path().join("Compositions/talk on endurance.md"),
            "---\ntype: composition\noccasion: Circuit assembly\ndate: 2026-03-01\ntags: [endurance]\nduration: 30\n---\n# Talk on endurance\n\nEndurance, James 1:2.\n",
        )
        .unwrap();
        fs::write(
            dir.path().join("Compositions/talk on endurance.canvas"),
            r#"{"nodes":[{"id":"a","type":"text","text":"Opening","x":0,"y":0,"width":200,"height":100},{"id":"b","type":"file","file":"Notes/joy.md","x":300,"y":0,"width":200,"height":140}],"edges":[{"id":"e","fromNode":"a","toNode":"b"}]}"#,
        )
        .unwrap();
        let data = dir.path().join(".data");
        let v = Vault::open(dir.path().join("."), &data, Lang::En).unwrap();
        (dir, v)
    }

    fn boards_holding(v: &Vault, id: &str) -> Vec<String> {
        match v.query(Query::BoardsReferencing { id: id.into() }).unwrap() {
            Answer::Docs(d) => {
                let mut ids: Vec<String> = d.into_iter().map(|d| d.id).collect();
                ids.sort();
                ids
            }
            _ => unreachable!(),
        }
    }

    /// PLAN §14.8: "Duplicate as new Composition" forks a talk for a new
    /// occasion — same words and Board, its own id, none of the old occasion.
    #[test]
    fn duplicating_a_composition_copies_its_body_and_board_under_a_new_id() {
        let (dir, mut v) = talk_vault();
        let talk = v.resolve("Talk on endurance").unwrap().unwrap();
        let joy = v.resolve("joy").unwrap().unwrap();
        let before = fs::read_to_string(dir.path().join("Compositions/talk on endurance.md")).unwrap();

        let copy = v.duplicate(&talk.id, "Talk on endurance (copy)").unwrap();
        assert_ne!(copy.summary.id, talk.id);
        assert_eq!(copy.summary.doc_type, DocType::Composition);
        assert_eq!(copy.summary.title, "Talk on endurance (copy)");
        assert_eq!(copy.summary.path, "Compositions/talk on endurance (copy).md");
        // The same body, byte for byte.
        let original = v.read(&talk.id).unwrap();
        assert_eq!(
            &copy.text[copy.body_offset..],
            &original.text[original.body_offset..]
        );
        // Tags and Properties come along; the old occasion does not.
        assert_eq!(copy.frontmatter["duration"], Value::from(30));
        assert_eq!(copy.frontmatter["occasion"], Value::from(""));
        assert_eq!(copy.frontmatter["date"], Value::from(""));
        assert!(copy.tags.iter().any(|t| t.name == "endurance"), "{}", copy.text);
        assert_eq!(copy.frontmatter["id"], Value::from(copy.summary.id.clone()));
        // The original is untouched.
        assert_eq!(
            fs::read_to_string(dir.path().join("Compositions/talk on endurance.md")).unwrap(),
            before
        );

        // The Board is copied beside it, and the Note is on both Boards.
        let board = v.read_board(&copy.summary.id).unwrap().expect("board copied");
        assert_eq!(board.nodes.len(), 2);
        assert_eq!(board.edges.len(), 1);
        assert!(dir.path().join("Compositions/talk on endurance (copy).canvas").is_file());
        let mut both = vec![talk.id.clone(), copy.summary.id.clone()];
        both.sort();
        assert_eq!(boards_holding(&v, &joy.id), both);

        // A second copy with the same title does not overwrite the first.
        let again = v.duplicate(&talk.id, "Talk on endurance (copy)").unwrap();
        assert_eq!(again.summary.path, "Compositions/talk on endurance (copy) 2.md");

        // Only a Composition is duplicated.
        assert!(v.duplicate(&joy.id, "Joy (copy)").is_err());
    }

    /// A Composition without a Board is copied without inventing one.
    #[test]
    fn duplicating_a_composition_without_a_board_writes_no_canvas() {
        let (dir, mut v) = vault();
        let made = v
            .create(DocType::Composition, "Short talk", &Map::new(), "Body.\n")
            .unwrap();
        let copy = v.duplicate(&made.summary.id, "Short talk (copy)").unwrap();
        assert!(v.read_board(&copy.summary.id).unwrap().is_none_or(|b| b.is_empty()));
        assert!(!dir.path().join("Compositions/short talk (copy).canvas").exists());
    }

    /// PLAN §17.14: a Board edited outside the app (Obsidian) is folded in
    /// when the watcher sees it, and the app's own save is not re-announced.
    #[test]
    fn an_outside_edit_to_a_canvas_is_folded_into_the_board() {
        let (dir, mut v) = talk_vault();
        let talk = v.resolve("Talk on endurance").unwrap().unwrap();
        let joy = v.resolve("joy").unwrap().unwrap();
        let rel = "Compositions/talk on endurance.canvas";
        // Opening reads the Board in; nothing has changed since.
        let board = v.read_board(&talk.id).unwrap().unwrap();
        assert!(v.fold_board_file(rel).unwrap().is_none(), "nothing new on disk");

        // Obsidian removes the card for the Note and adds a bubble.
        fs::write(
            dir.path().join(rel),
            r#"{"nodes":[{"id":"a","type":"text","text":"Opening","x":0,"y":0,"width":200,"height":100},{"id":"c","type":"text","text":"Close","x":0,"y":200,"width":200,"height":100,"obsidianOnly":true}],"edges":[]}"#,
        )
        .unwrap();
        let folded = v.fold_board_file(rel).unwrap().expect("announced");
        assert_eq!(folded.id, talk.id);
        let now = v.read_board(&talk.id).unwrap().unwrap();
        let ids: Vec<&str> = now.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids, ["a", "c"]);
        // An unknown field survives the round trip (PLAN §17.8).
        assert!(now.to_json().contains("obsidianOnly"));
        // The Note left the Board, so its Board ref is gone too.
        assert!(boards_holding(&v, &joy.id).is_empty());

        // The app's own save is an echo, not news.
        v.write_board(&talk.id, &board).unwrap();
        assert!(v.fold_board_file(rel).unwrap().is_none());
        assert_eq!(boards_holding(&v, &joy.id), std::slice::from_ref(&talk.id));

        // A canvas beside no Composition, or one that does not parse, is left alone.
        fs::write(dir.path().join("Notes/loose.canvas"), r#"{"nodes":[],"edges":[]}"#).unwrap();
        assert!(v.fold_board_file("Notes/loose.canvas").unwrap().is_none());
        fs::write(dir.path().join(rel), "not json").unwrap();
        assert!(v.fold_board_file(rel).unwrap().is_none());
    }
}
