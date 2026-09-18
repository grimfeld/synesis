//! Tauri shell: exposes the engine through a small, document-shaped command set
//! (ADR 0004), keeps the vault open in app state, watches the folder for
//! external edits and forwards changes to the UI as events.

use engine::canvas::Canvas;
use engine::document::DocType;
use engine::index::{DocSummary, GraphLevel, Linkable};
use engine::properties::{PropertySchema, PropertyType};
use engine::query::{Answer, Query};
use engine::scripture::{Lang, Passage};
use engine::sync::{HistoryPoint, Version};
use engine::vault::{DocumentView, VaultInfo, HIDDEN_DIR};
use engine::{parser, Vault};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(debug_assertions)]
mod devbridge;
mod pairing;
mod storage;
mod watch;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub vault_path: Option<String>,
    #[serde(default)]
    pub lang: Lang,
    #[serde(default)]
    pub recent: Vec<String>,
    /// The Vaults this Device holds (ADR 0014): what they are, what to call
    /// them, and where they sit here. Added when one is made or joined and
    /// removed deliberately — unlike `recent`, which is a history and can push
    /// a Vault you own off the end when you open others.
    #[serde(default)]
    pub vaults: Vec<KnownVault>,
    #[serde(default)]
    pub graph_level: Option<GraphLevel>,
    /// How this Device keeps the vault folder in sync: "icloud", "syncthing", "provider", "none".
    #[serde(default)]
    pub sync_method: Option<String>,
    /// Custom Iroh relay URL for Pairing; None = Iroh's public relays.
    #[serde(default)]
    pub relay_url: Option<String>,
    /// Desktop: keep syncing from the tray when the window is closed.
    #[serde(default = "default_true")]
    pub background_sync: bool,
    /// Timeline: Subject types hidden from the Lanes (PLAN §16).
    #[serde(default)]
    pub timeline_hidden_types: Vec<String>,
    /// Timeline: draw only the Lanes the current zoom covers.
    #[serde(default = "default_true")]
    pub timeline_in_view: bool,
    /// Map: Book numbers a Place must be mentioned in (PLAN §19.13).
    #[serde(default)]
    pub map_books: Vec<u8>,
    /// Map: hide Places nothing mentions.
    #[serde(default)]
    pub map_mentioned_only: bool,
}

fn default_true() -> bool {
    true
}

/// A Vault this Device holds (ADR 0014).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KnownVault {
    pub id: String,
    pub name: String,
    pub path: String,
}

pub struct AppState {
    vault: Mutex<Option<Vault>>,
    settings: Mutex<Settings>,
    settings_path: PathBuf,
    watcher: Mutex<Option<watch::Watcher>>,
    p2p: Mutex<Option<std::sync::Arc<engine::p2p::Node>>>,
    quitting: std::sync::atomic::AtomicBool,
}

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

impl AppState {
    fn with_vault<T>(&self, f: impl FnOnce(&Vault) -> engine::Result<T>) -> CmdResult<T> {
        let guard = self.vault.lock().map_err(err)?;
        let v = guard.as_ref().ok_or("no vault open")?;
        f(v).map_err(err)
    }
    fn with_vault_mut<T>(&self, f: impl FnOnce(&mut Vault) -> engine::Result<T>) -> CmdResult<T> {
        let mut guard = self.vault.lock().map_err(err)?;
        let v = guard.as_mut().ok_or("no vault open")?;
        f(v).map_err(err)
    }
    fn save_settings(&self) -> CmdResult<()> {
        let s = self.settings.lock().map_err(err)?;
        if let Some(p) = self.settings_path.parent() {
            std::fs::create_dir_all(p).map_err(err)?;
        }
        std::fs::write(
            &self.settings_path,
            serde_json::to_string_pretty(&*s).map_err(err)?,
        )
        .map_err(err)
    }
}

// ---- UTF-16 views for the editor ------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct PassageInfo {
    pub display: String,
    pub book: u8,
    pub start_chapter: u16,
    pub start_verse: Option<u16>,
    pub end_chapter: u16,
    pub end_verse: Option<u16>,
    pub unit: engine::Unit,
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

fn to_payload(v: &Vault, view: DocumentView) -> DocumentPayload {
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

// ---- commands ---------------------------------------------------------------

#[tauri::command]
fn get_settings(state: State<AppState>) -> CmdResult<Settings> {
    Ok(state.settings.lock().map_err(err)?.clone())
}

#[tauri::command]
fn set_language(state: State<AppState>, lang: Lang) -> CmdResult<()> {
    state.settings.lock().map_err(err)?.lang = lang;
    if let Some(v) = state.vault.lock().map_err(err)?.as_mut() {
        v.set_lang(lang);
    }
    state.save_settings()
}

#[tauri::command]
fn set_graph_level(state: State<AppState>, level: GraphLevel) -> CmdResult<()> {
    state.settings.lock().map_err(err)?.graph_level = Some(level);
    state.save_settings()
}

/// The Timeline filters that outlive a session (PLAN §16.5): the Tag, Property
/// and search filters stay in memory, since a Tag renamed in the Vault would
/// otherwise hide every Lane with nothing on screen to say why.
#[tauri::command]
fn set_timeline_filters(
    state: State<AppState>,
    hidden_types: Vec<String>,
    in_view: bool,
) -> CmdResult<()> {
    {
        let mut st = state.settings.lock().map_err(err)?;
        st.timeline_hidden_types = hidden_types;
        st.timeline_in_view = in_view;
    }
    state.save_settings()
}

/// The Map filters that persist (PLAN §19.13). Tag chips and the search stay
/// session-only: a Tag renamed in the Vault would otherwise silently hide
/// everything with no way to see why.
#[tauri::command]
fn set_map_filters(
    state: State<AppState>,
    books: Vec<u8>,
    mentioned_only: bool,
) -> CmdResult<()> {
    {
        let mut st = state.settings.lock().map_err(err)?;
        st.map_books = books;
        st.map_mentioned_only = mentioned_only;
    }
    state.save_settings()
}

/// Open (or create) the vault folder at `path`, or the last one from settings.
pub(crate) fn do_open_vault(app: AppHandle, state: &AppState, path: Option<String>) -> CmdResult<VaultInfo> {
    let lang = state.settings.lock().map_err(err)?.lang;
    let path = match path.or_else(|| {
        state
            .settings
            .lock()
            .ok()
            .and_then(|s| s.vault_path.clone())
    }) {
        Some(p) => p,
        None => return Err("no vault path".into()),
    };
    let root = PathBuf::from(&path);
    // Stop watching the previous vault before touching files.
    *state.watcher.lock().map_err(err)? = None;
    std::fs::create_dir_all(&root).map_err(err)?;
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
        std::fs::create_dir_all(root.join(folder)).map_err(err)?;
    }
    let data_dir = app.path().app_data_dir().map_err(err)?;
    let vault = Vault::open(&root, &data_dir, lang).map_err(err)?;
    let info = vault.info().map_err(err)?;
    *state.vault.lock().map_err(err)? = Some(vault);
    {
        let mut s = state.settings.lock().map_err(err)?;
        s.vault_path = Some(path.clone());
        s.recent.retain(|p| p != &path);
        s.recent.insert(0, path.clone());
        s.recent.truncate(8);
        // Remember the Vault itself, not just that this path was opened. Keyed
        // by id, so moving a Vault updates its entry rather than adding one.
        let known = KnownVault {
            id: info.meta.id.clone(),
            name: info.meta.name.clone(),
            path: path.clone(),
        };
        match s.vaults.iter_mut().find(|v| v.id == known.id) {
            Some(v) => *v = known,
            None => s.vaults.push(known),
        }
    }
    state.save_settings()?;
    *state.watcher.lock().map_err(err)? = watch::Watcher::start(app.clone(), root).ok();
    app.emit("vault:opened", &info).ok();
    Ok(info)
}

#[tauri::command]
fn open_vault(app: AppHandle, state: State<AppState>, path: Option<String>) -> CmdResult<VaultInfo> {
    tauri::async_runtime::block_on(pairing::stop(&state));
    let info = do_open_vault(app.clone(), &state, path)?;
    pairing::autostart(app);
    Ok(info)
}

#[tauri::command]
fn set_sync_method(state: State<AppState>, method: Option<String>) -> CmdResult<()> {
    state.settings.lock().map_err(err)?.sync_method = method;
    state.save_settings()
}

/// Devices that have published into the open vault's sync folder.
#[tauri::command]
fn sync_status(state: State<AppState>) -> CmdResult<Vec<engine::sync::DeviceInfo>> {
    state.with_vault(|v| Ok(v.devices()))
}

#[derive(Serialize)]
pub struct SyncLocation {
    /// "icloud", "syncthing", "onedrive", "gdrive", "dropbox".
    pub method: String,
    /// The folder the sync tool keeps in sync, when it exists on this Device.
    pub root: String,
    pub exists: bool,
    /// Where the wizard proposes to create the vault.
    pub suggested: String,
}

#[derive(Serialize)]
pub struct SyncLocations {
    pub platform: String,
    /// Where new vaults go by default: `<Documents>/Synesis` everywhere, which
    /// on Android is the shared folder the Files app browses when the user has
    /// granted all-files access, and the app's private storage when they have
    /// not (ADR 0015).
    pub home: String,
    /// Desktop only: mobile has no folder picker, and the app chooses the path.
    pub can_pick_folder: bool,
    /// Mobile: the path is derived from the Vault's name, never typed.
    pub app_decides_path: bool,
    /// Whether this Device may write where the user can find the Vault.
    pub storage: storage::StorageAccess,
    pub locations: Vec<SyncLocation>,
    /// Vaults already present in those folders (synced from another Device).
    pub found: Vec<engine::sync::FoundVault>,
}

/// Where the free sync tools keep their folders on this Device, and any vault already in them.
#[tauri::command]
fn sync_locations(app: AppHandle, state: State<AppState>) -> CmdResult<SyncLocations> {
    let platform = std::env::consts::OS.to_string();
    let mobile = matches!(platform.as_str(), "android" | "ios");
    // Where new Vaults go. Desktop still scans the sync tools' folders below
    // and may propose one of those instead (PLAN §21.3).
    let vaults_home = storage::vaults_parent(&app)?;
    // The sync tools keep their folders under the real home, which on mobile
    // is not a place the app can look.
    let home = if mobile { vaults_home.clone() } else { app.path().home_dir().map_err(err)? };
    let env_dir = |k: &str| std::env::var(k).ok().map(PathBuf::from);
    let mut candidates: Vec<(&str, PathBuf)> = Vec::new();
    match platform.as_str() {
        "windows" => {
            candidates.push(("icloud", home.join("iCloudDrive")));
            candidates.push(("onedrive", env_dir("OneDrive").unwrap_or_else(|| home.join("OneDrive"))));
            candidates.push(("gdrive", home.join("My Drive")));
            candidates.push(("gdrive", PathBuf::from("G:\\My Drive")));
            candidates.push(("dropbox", home.join("Dropbox")));
            candidates.push(("syncthing", home.join("Sync")));
        }
        "macos" => {
            candidates.push(("icloud", home.join("Library/Mobile Documents/com~apple~CloudDocs")));
            let cloud = home.join("Library/CloudStorage");
            if let Ok(entries) = std::fs::read_dir(&cloud) {
                for e in entries.flatten() {
                    let n = e.file_name().to_string_lossy().to_string();
                    let m = if n.starts_with("OneDrive") { "onedrive" } else if n.starts_with("GoogleDrive") { "gdrive" } else if n.starts_with("Dropbox") { "dropbox" } else { continue };
                    candidates.push((m, e.path()));
                }
            }
            candidates.push(("dropbox", home.join("Dropbox")));
            candidates.push(("syncthing", home.join("Sync")));
        }
        "android" => {
            candidates.push(("syncthing", PathBuf::from("/storage/emulated/0/Sync")));
        }
        "ios" => {
            if let Ok(d) = app.path().document_dir() {
                candidates.push(("icloud", d));
            }
        }
        _ => {
            candidates.push(("syncthing", home.join("Sync")));
            candidates.push(("dropbox", home.join("Dropbox")));
            candidates.push(("onedrive", home.join("OneDrive")));
            candidates.push(("gdrive", home.join("GoogleDrive")));
        }
    }
    let self_id = state.with_vault(|v| Ok(v.device_id().map(str::to_string))).ok().flatten();
    let roots: Vec<PathBuf> = candidates.iter().filter(|(_, p)| p.is_dir()).map(|(_, p)| p.clone()).collect();
    let found = engine::sync::find_vaults(&roots, self_id.as_deref());
    let locations = candidates
        .into_iter()
        .map(|(method, root)| SyncLocation { method: method.into(), exists: root.is_dir(), suggested: root.join("Synesis").to_string_lossy().to_string(), root: root.to_string_lossy().to_string() })
        .collect();
    let storage = storage::access(&app);
    Ok(SyncLocations {
        platform,
        home: vaults_home.to_string_lossy().to_string(),
        can_pick_folder: !mobile,
        app_decides_path: storage::app_decides_path(),
        storage,
        locations,
        found,
    })
}

/// Stop listing a Vault on this Device. The folder and its documents stay;
/// only this Device forgets where it was (ADR 0014).
#[tauri::command]
fn forget_vault(state: State<AppState>, id: String) -> CmdResult<Vec<KnownVault>> {
    {
        let mut s = state.settings.lock().map_err(err)?;
        s.vaults.retain(|v| v.id != id);
    }
    state.save_settings()?;
    Ok(state.settings.lock().map_err(err)?.vaults.clone())
}

/// The Vaults this Device holds that sit somewhere their owner cannot browse
/// (ADR 0015), by id. Asked rather than worked out in the UI, so the rule for
/// what counts as hidden lives in one place.
#[tauri::command]
fn hidden_vaults(app: AppHandle, state: State<AppState>) -> CmdResult<Vec<String>> {
    let vaults = state.settings.lock().map_err(err)?.vaults.clone();
    Ok(vaults.into_iter().filter(|v| storage::is_hidden_path(&app, &v.path)).map(|v| v.id).collect())
}

/// Move a Vault to the folder this Device would choose for it today, for the
/// Vaults made before the app chose (ADR 0015). Copies, then deletes: a phone
/// that sleeps half way through leaves the original where it was.
///
/// The Vault is closed first — a folder moving under a live CRDT and a running
/// watcher is not worth the cleverness — and reopened at its new path.
#[tauri::command]
fn move_vault(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<VaultInfo> {
    let known = {
        let s = state.settings.lock().map_err(err)?;
        s.vaults.iter().find(|v| v.id == id).cloned().ok_or("no such vault")?
    };
    let from = PathBuf::from(&known.path);
    if !from.is_dir() {
        return Err("the vault folder is gone".into());
    }
    let to = storage::vault_path(&app, &known.name)?;
    if to == from {
        return Err("the vault is already there".into());
    }
    let was_open = state.settings.lock().map_err(err)?.vault_path.as_deref() == Some(known.path.as_str());
    if was_open {
        close_vault(state.clone())?;
    }
    storage::copy_tree(&from, &to).map_err(err)?;
    std::fs::remove_dir_all(&from).map_err(err)?;
    {
        let mut s = state.settings.lock().map_err(err)?;
        if let Some(k) = s.vaults.iter_mut().find(|k| k.id == id) {
            k.path = to.to_string_lossy().to_string();
        }
        s.recent.retain(|p| p != &known.path);
    }
    state.save_settings()?;
    open_vault(app, state, Some(to.to_string_lossy().to_string()))
}

/// Rename the open Vault. The name travels with it, so every Device that holds
/// this Vault sees the new one; the folder is untouched.
#[tauri::command]
fn rename_vault(state: State<AppState>, name: String) -> CmdResult<VaultInfo> {
    let info = state.with_vault_mut(|v| {
        v.set_name(&name)?;
        v.info()
    })?;
    {
        let mut s = state.settings.lock().map_err(err)?;
        if let Some(k) = s.vaults.iter_mut().find(|k| k.id == info.meta.id) {
            k.name = info.meta.name.clone();
        }
    }
    state.save_settings()?;
    Ok(info)
}

/// Where a Vault called `name` could go on this Device, without disturbing
/// anything already there. What the mobile join offers instead of one fixed
/// folder for every Vault (ADR 0014), and what the whole mobile wizard uses
/// now that the app chooses the folder rather than asking (ADR 0015).
#[tauri::command]
fn suggest_vault_path(app: AppHandle, name: String) -> CmdResult<String> {
    Ok(storage::vault_path(&app, &name)?.display().to_string())
}

/// What an Invite is for, before accepting it: which Vault, and whether the
/// folder offered can receive it.
#[tauri::command]
fn inspect_invite(code: String, path: String) -> CmdResult<InviteInfo> {
    let invite = engine::p2p::Invite::decode(&code).ok_or("not a pairing code")?;
    let check = engine::meta::check_join(&std::path::Path::new(&path), &invite.vault_id);
    Ok(InviteInfo {
        vault_name: invite.vault_name,
        vault_id: invite.vault_id,
        check,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct InviteInfo {
    pub vault_name: String,
    pub vault_id: String,
    pub check: engine::meta::JoinCheck,
}

#[tauri::command]
fn close_vault(state: State<AppState>) -> CmdResult<()> {
    tauri::async_runtime::block_on(pairing::stop(&state));
    *state.watcher.lock().map_err(err)? = None;
    *state.vault.lock().map_err(err)? = None;
    state.settings.lock().map_err(err)?.vault_path = None;
    state.save_settings()
}

#[tauri::command]
fn vault_info(state: State<AppState>) -> CmdResult<VaultInfo> {
    state.with_vault(|v| v.info())
}

#[tauri::command]
fn rescan(state: State<AppState>) -> CmdResult<Vec<DocSummary>> {
    state.with_vault_mut(|v| v.scan())
}

/// Every read the index can answer, as one command (`engine::query`).
///
/// A read used to be written out in four places — a forward on `Vault`, a
/// command here, an arm in the debug bridge, and a method in `api.ts` naming
/// the command as a string — of which three carried nothing but the name.
/// Now the question is a value and only the last of those remains.
#[tauri::command]
fn query(state: State<AppState>, query: Query) -> CmdResult<Answer> {
    state.with_vault(|v| v.query(query))
}

#[tauri::command]
fn get_document(state: State<AppState>, id: String) -> CmdResult<DocumentPayload> {
    state.with_vault(|v| Ok(to_payload(v, v.read(&id)?)))
}

#[tauri::command]
fn save_document(state: State<AppState>, id: String, text: String) -> CmdResult<DocumentPayload> {
    let r = (|| {
    state.with_vault_mut(|v| {
        let view = v.write(&id, &text)?;
        Ok(to_payload(v, view))
    })
    })();
    if r.is_ok() {
        pairing::after_write(&state);
    }
    r
}

#[tauri::command]
fn create_document(
    state: State<AppState>,
    doc_type: DocType,
    title: String,
    fields: Option<Map<String, Value>>,
    body: Option<String>,
) -> CmdResult<DocumentPayload> {
    let r = (|| {
    state.with_vault_mut(|v| {
        let view = v.create(
            doc_type,
            &title,
            &fields.unwrap_or_default(),
            body.as_deref().unwrap_or(""),
        )?;
        Ok(to_payload(v, view))
    })
    })();
    if r.is_ok() {
        pairing::after_write(&state);
    }
    r
}

#[tauri::command]
fn rename_document(
    state: State<AppState>,
    id: String,
    title: String,
) -> CmdResult<DocumentPayload> {
    let r = (|| {
    state.with_vault_mut(|v| {
        let view = v.rename(&id, &title)?;
        Ok(to_payload(v, view))
    })
    })();
    if r.is_ok() {
        pairing::after_write(&state);
    }
    r
}

#[tauri::command]
fn delete_document(state: State<AppState>, id: String) -> CmdResult<()> {
    let r = (|| {
    state.with_vault_mut(|v| v.delete(&id))
    })();
    if r.is_ok() {
        pairing::after_write(&state);
    }
    r
}

#[tauri::command]
fn resolve_link(state: State<AppState>, target: String) -> CmdResult<Option<DocSummary>> {
    state.with_vault(|v| v.resolve(&target))
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
#[tauri::command]
fn names(state: State<AppState>) -> CmdResult<Vec<NameEntry>> {
    state.with_vault(|v| {
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
    })
}

#[tauri::command]
fn resolve_many(
    state: State<AppState>,
    targets: Vec<String>,
) -> CmdResult<Vec<Option<DocSummary>>> {
    state.with_vault(|v| targets.iter().map(|t| v.resolve(t)).collect())
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
#[tauri::command]
fn linkables(state: State<AppState>, id: String, text: String) -> CmdResult<Vec<Linkable>> {
    let mut out = state.with_vault(|v| v.linkables(&id, &text))?;
    for l in &mut out {
        l.start = parser::byte_to_utf16(&text, l.start);
        l.end = parser::byte_to_utf16(&text, l.end);
    }
    Ok(out)
}

/// What one linking edit restored, so a batch can be undone.
#[derive(serde::Serialize)]
struct LinkedEdit {
    id: String,
    /// The document's text before the edit.
    before: String,
}

/// The outcome of linking one or more Unlinked mentions.
#[derive(serde::Serialize)]
struct LinkResult {
    /// Documents actually rewritten, with the text to restore on undo.
    linked: Vec<LinkedEdit>,
    /// Documents skipped because the file had changed since it was indexed.
    skipped: Vec<String>,
}

/// One Unlinked mention to link, as the panel lists it.
#[derive(serde::Deserialize)]
struct MentionRef {
    doc_id: String,
    start: usize,
    end: usize,
    /// The matched text, checked against the file before anything is written.
    matched: String,
}

/// Link some Unlinked mentions of `target_id`.
///
/// One call whether the user clicked a single row or "Link all": a batch that
/// hits a stale offset skips that document and carries on rather than aborting
/// half-done, and reports what it skipped (ADR 0011).
#[tauri::command]
fn link_mentions(
    state: State<AppState>,
    target_id: String,
    mentions: Vec<MentionRef>,
) -> CmdResult<LinkResult> {
    let r = state.with_vault_mut(|v| {
        let mut linked = Vec::new();
        let mut skipped = Vec::new();
        for m in &mentions {
            match v.link_mention(&m.doc_id, m.start, m.end, &m.matched, &target_id) {
                Ok(before) => linked.push(LinkedEdit {
                    id: m.doc_id.clone(),
                    before,
                }),
                Err(_) => skipped.push(m.doc_id.clone()),
            }
        }
        Ok(LinkResult { linked, skipped })
    });
    if r.is_ok() {
        pairing::after_write(&state);
    }
    r
}

/// Put back the text of documents a batch of links rewrote.
#[tauri::command]
fn undo_link_mentions(state: State<AppState>, texts: Vec<(String, String)>) -> CmdResult<()> {
    let r = state.with_vault_mut(|v| v.restore_texts(&texts));
    if r.is_ok() {
        pairing::after_write(&state);
    }
    r
}

/// Materialise (and return) the page for a Scripture unit, e.g. when the user
/// clicks a detected Passage that has not been written on yet.
#[tauri::command]
fn ensure_scripture_page(
    state: State<AppState>,
    book: u8,
    chapter: Option<u16>,
    verse: Option<u16>,
) -> CmdResult<DocSummary> {
    state.with_vault_mut(|v| {
        let p = match (chapter, verse) {
            (None, _) => Passage::whole_book(book),
            (Some(c), None) => Passage::chapter(book, c),
            (Some(c), Some(vs)) => Passage::verse(book, c, vs),
        };
        v.materialise(&[p])?;
        v.scripture_doc(book, chapter, verse)?
            .ok_or_else(|| engine::Error::NotFound("scripture page".into()))
    })
}

#[tauri::command]
fn property_schema(state: State<AppState>) -> CmdResult<PropertySchema> {
    state.with_vault(|v| Ok(v.property_schema().clone()))
}

#[tauri::command]
fn set_property_type(
    state: State<AppState>,
    name: String,
    prop_type: PropertyType,
) -> CmdResult<PropertySchema> {
    state.with_vault_mut(|v| v.set_property_type(&name, prop_type))
}

#[tauri::command]
fn versions(state: State<AppState>, id: String) -> CmdResult<Vec<Version>> {
    state.with_vault_mut(|v| v.versions(&id))
}

#[tauri::command]
fn save_version(state: State<AppState>, id: String, label: String) -> CmdResult<Version> {
    state.with_vault_mut(|v| v.save_version(&id, &label))
}

#[tauri::command]
fn delete_version(state: State<AppState>, id: String, key: String) -> CmdResult<()> {
    state.with_vault_mut(|v| v.delete_version(&id, &key))
}

#[tauri::command]
fn text_at(state: State<AppState>, id: String, frontier: String) -> CmdResult<String> {
    state.with_vault_mut(|v| v.text_at(&id, &frontier))
}

#[tauri::command]
fn history(state: State<AppState>, id: String) -> CmdResult<Vec<HistoryPoint>> {
    state.with_vault_mut(|v| v.history(&id))
}

#[tauri::command]
fn gazetteer(query: String, limit: Option<usize>) -> Vec<engine::gazetteer::GazetteerHit> {
    engine::gazetteer::search(&query, limit.unwrap_or(8))
}

/// A Composition's Board, or null when it has none yet (ADR 0009).
#[tauri::command]
fn get_board(state: State<AppState>, id: String) -> CmdResult<Option<Canvas>> {
    state.with_vault_mut(|v| v.read_board(&id))
}

#[tauri::command]
fn save_board(state: State<AppState>, id: String, board: Canvas) -> CmdResult<()> {
    let r = state.with_vault_mut(|v| v.write_board(&id, &board));
    if r.is_ok() {
        pairing::after_write(&state);
    }
    r
}

/// The text each Board card shows for its document (PLAN §17.12).
///
/// One call per Board rather than one per card: a Board is read as a whole,
/// and forty cards must not mean forty round trips.
/// A Composition's Board as it stood at a Version's frontier.
#[tauri::command]
fn board_at(state: State<AppState>, id: String, frontier: String) -> CmdResult<Option<Canvas>> {
    state.with_vault_mut(|v| v.board_at(&id, &frontier))
}

/// Write an exported Board to a path the user picked.
///
/// The UI renders the SVG and rasterises the PNG, since it owns the styling;
/// the engine only puts bytes on disk, because the UI never touches files
/// (ADR 0004). `data` is base64 for PNG and plain text for SVG.
#[tauri::command]
fn export_board(path: String, data: String, base64: bool) -> CmdResult<()> {
    use base64::Engine as _;
    let bytes = if base64 {
        base64::engine::general_purpose::STANDARD
            .decode(data.as_bytes())
            .map_err(|e| e.to_string())?
    } else {
        data.into_bytes()
    };
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Compositions whose Board references this document.
/// Shrink a picture to a Cover and encode it, or hand back the original bytes
/// when it is already small enough and in a format we serve (ADR 0012).
fn to_cover(bytes: &[u8], ext: &str) -> Result<(Vec<u8>, String), String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("not an image: {e}"))?;
    let (w, h) = (img.width(), img.height());
    // Re-encode as PNG or JPEG only: a resized GIF loses its animation and a
    // WebP would need an encoder we do not ship, so the output format is not
    // always the input's.
    let keep_jpeg = matches!(ext, "jpg" | "jpeg");
    match engine::attachments::target_size(w, h, engine::attachments::MAX_EDGE) {
        None if keep_jpeg || ext == "png" => Ok((bytes.to_vec(), ext.to_string())),
        size => {
            let img = match size {
                Some((tw, th)) => img.resize(tw, th, image::imageops::FilterType::Lanczos3),
                None => img,
            };
            let mut out = std::io::Cursor::new(Vec::new());
            let (fmt, ext) = if keep_jpeg {
                (image::ImageFormat::Jpeg, "jpg")
            } else {
                (image::ImageFormat::Png, "png")
            };
            // JPEG has no alpha; flatten rather than fail on a transparent source.
            let img = if fmt == image::ImageFormat::Jpeg {
                image::DynamicImage::ImageRgb8(img.to_rgb8())
            } else {
                img
            };
            img.write_to(&mut out, fmt).map_err(err)?;
            Ok((out.into_inner(), ext.to_string()))
        }
    }
}

/// Copy a picture into `Attachments/`, downscaled, and return its
/// vault-relative path for the Source's `cover` property.
///
/// Copied rather than linked: a vault that points outside itself breaks on
/// sync and breaks in Obsidian (ADR 0012).
#[tauri::command]
fn attach_image(state: State<AppState>, title: String, path: String) -> CmdResult<String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if title.trim().is_empty() {
        // Checked before the file is read: the title is what names the
        // picture, so without one there is nothing to write (ADR 0012).
        return Err("a Cover needs the Source's title to be named after".into());
    }
    if !engine::attachments::is_supported(&path) {
        return Err(format!("not a picture we can store: {path}"));
    }
    let bytes = std::fs::read(&path).map_err(err)?;
    let (bytes, ext) = to_cover(&bytes, &ext)?;
    state.with_vault(|v| {
        let root = v.root().to_path_buf();
        let rel = engine::attachments::unique_path(&root, &title, &ext)?;
        let abs = root.join(&rel);
        if let Some(dir) = abs.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&abs, &bytes)?;
        Ok(rel)
    })
}

/// Download a remote Cover into `Attachments/` and return its vault-relative
/// path, so a picture that would rot when the site reorganises becomes one the
/// vault owns. Always the user's explicit choice, never a side effect of
/// fetching metadata (ADR 0012).
#[tauri::command]
async fn save_remote_cover(
    app: tauri::AppHandle,
    title: String,
    url: String,
) -> CmdResult<String> {
    if title.trim().is_empty() {
        return Err("a Cover needs the Source's title to be named after".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("Synesis/0.1 (+https://github.com/grimfeld/synesis)")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(err)?;
    let res = client.get(&url).send().await.map_err(err)?;
    let ext = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|t| match t.split(';').next()?.trim() {
            "image/jpeg" => Some("jpg"),
            "image/png" => Some("png"),
            "image/gif" => Some("gif"),
            "image/webp" => Some("webp"),
            _ => None,
        })
        // Fall back to the URL's own extension when the server is unhelpful.
        .or_else(|| {
            let path = url.split(['?', '#']).next()?;
            ["jpg", "jpeg", "png", "gif", "webp"]
                .into_iter()
                .find(|e| path.to_ascii_lowercase().ends_with(&format!(".{e}")))
        })
        .ok_or_else(|| format!("not a picture: {url}"))?
        .to_string();
    let bytes = res.bytes().await.map_err(err)?;
    let (bytes, ext) = to_cover(&bytes, &ext)?;
    let state = app.state::<AppState>();
    state.with_vault(|v| {
        let root = v.root().to_path_buf();
        let rel = engine::attachments::unique_path(&root, &title, &ext)?;
        let abs = root.join(&rel);
        if let Some(dir) = abs.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&abs, &bytes)?;
        Ok(rel)
    })
}

/// Read a stored picture back as a data URL.
///
/// The UI never touches files (ADR 0004), and Tauri's asset protocol does not
/// exist on the development bridge where every Cypress spec runs, so a Cover
/// that only rendered through it would be one no test ever sees (ADR 0012).
#[tauri::command]
fn read_attachment(state: State<AppState>, path: String) -> CmdResult<String> {
    use base64::Engine as _;
    let media = engine::attachments::media_type(&path)
        .ok_or_else(|| format!("not an image: {path}"))?;
    let bytes = state.with_vault(|v| {
        let abs = engine::attachments::safe_relative(v.root(), &path)?;
        Ok(std::fs::read(abs)?)
    })?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{media};base64,{b64}"))
}

#[tauri::command]
fn find_source_by_url(state: State<AppState>, url: String) -> CmdResult<Option<DocSummary>> {
    state.with_vault(|v| v.find_by_url(&url))
}

/// Live detection for the editor: runs on the text as typed.
#[tauri::command]
fn detect_passages(state: State<AppState>, text: String) -> CmdResult<Vec<DetectedRange>> {
    let lang = state.settings.lock().map_err(err)?.lang;
    Ok(parser::detect(&text)
        .into_iter()
        .map(|d| DetectedRange {
            from: parser::byte_to_utf16(&text, d.start),
            to: parser::byte_to_utf16(&text, d.end),
            passages: d.passages.iter().map(|p| passage_info(p, lang)).collect(),
            inferred: d.inferred,
        })
        .collect())
}

#[derive(Serialize)]
pub struct BookMeta {
    pub number: u8,
    pub name: String,
    pub english: String,
    pub chapters: Vec<u16>,
    pub hebrew_aramaic: bool,
}

#[tauri::command]
fn books(state: State<AppState>) -> CmdResult<Vec<BookMeta>> {
    let lang = state.settings.lock().map_err(err)?.lang;
    Ok(engine::versification::BOOKS
        .iter()
        .map(|b| BookMeta {
            number: b.number,
            name: engine::names::book_name(b.number, lang).to_string(),
            english: b.english.to_string(),
            chapters: b.chapters.to_vec(),
            hebrew_aramaic: engine::scripture::is_hebrew_aramaic(b.number),
        })
        .collect())
}

#[derive(Serialize, Default)]
pub struct UrlMeta {
    pub url: String,
    pub title: Option<String>,
    /// `og:image`, offered as a remote Cover (ADR 0012). Often a site logo
    /// rather than real cover art, so it is a suggestion, not an answer.
    pub image: Option<String>,
    pub site: Option<String>,
    pub date: Option<String>,
    pub description: Option<String>,
}

fn meta_content(html: &str, key: &str) -> Option<String> {
    // <meta property="og:title" content="..."> in either attribute order.
    let re1 = regex::Regex::new(&format!(
        r#"(?is)<meta[^>]+(?:property|name)\s*=\s*["']{}["'][^>]*content\s*=\s*["']([^"']*)["']"#,
        regex::escape(key)
    ))
    .ok()?;
    let re2 = regex::Regex::new(&format!(
        r#"(?is)<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*(?:property|name)\s*=\s*["']{}["']"#,
        regex::escape(key)
    ))
    .ok()?;
    re1.captures(html)
        .or_else(|| re2.captures(html))
        .map(|c| html_unescape(c[1].trim()))
}

fn html_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

#[tauri::command]
async fn fetch_url_metadata(url: String) -> CmdResult<UrlMeta> {
    let client = reqwest::Client::builder()
        .user_agent("Synesis/0.1 (+https://github.com/grimfeld/synesis)")
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(err)?;
    let html = client
        .get(&url)
        .send()
        .await
        .map_err(err)?
        .text()
        .await
        .map_err(err)?;
    let title_tag = regex::Regex::new(r"(?is)<title[^>]*>(.*?)</title>")
        .ok()
        .and_then(|re| re.captures(&html).map(|c| html_unescape(c[1].trim())));
    let title = meta_content(&html, "og:title").or(title_tag);
    let image = meta_content(&html, "og:image").or_else(|| meta_content(&html, "twitter:image"));
    let site = meta_content(&html, "og:site_name").or_else(|| {
        url.split('/')
            .nth(2)
            .map(|h| h.trim_start_matches("www.").to_string())
    });
    let date = meta_content(&html, "article:published_time")
        .or_else(|| meta_content(&html, "datePublished"))
        .or_else(|| meta_content(&html, "date"))
        .map(|d| d.chars().take(10).collect());
    let description =
        meta_content(&html, "og:description").or_else(|| meta_content(&html, "description"));
    Ok(UrlMeta {
        url,
        title,
        image,
        site,
        date,
        description,
    })
}

/// Webview errors, forwarded to the terminal in development.
#[tauri::command]
fn ui_log(level: String, message: String) {
    eprintln!("[ui:{level}] {message}");
}

#[tauri::command]
fn hidden_dir() -> String {
    HIDDEN_DIR.into()
}

fn settings_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("settings.json")
}

fn load_settings(p: &Path) -> Settings {
    std::fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(storage::plugin());
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = app.emit("quick-capture", ());
                }
            })
            .build(),
    );
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    builder
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if pairing::keep_in_background(&state) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(not(desktop))]
            let _ = (window, event);
        })
        .setup(|app| {
            let sp = settings_path(app.handle());
            let settings = load_settings(&sp);
            app.manage(AppState {
                vault: Mutex::new(None),
                settings: Mutex::new(settings),
                settings_path: sp,
                watcher: Mutex::new(None),
                p2p: Mutex::new(None),
                quitting: std::sync::atomic::AtomicBool::new(false),
            });
            #[cfg(desktop)]
            pairing::setup_tray(app.handle())?;
            pairing::autostart(app.handle().clone());
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                let _ = app.global_shortcut().register("CmdOrCtrl+Shift+N");
            }
            #[cfg(debug_assertions)]
            devbridge::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_language,
            set_graph_level,
            set_timeline_filters,
            set_sync_method,
            pairing::pairing_status,
            pairing::pairing_invite,
            pairing::pairing_revoke_invite,
            pairing::pairing_join,
            pairing::pairing_approve,
            pairing::pairing_remove,
            pairing::pairing_stop,
            pairing::pairing_sync_now,
            pairing::set_relay,
            pairing::set_background_sync,
            sync_status,
            sync_locations,
            storage::storage_access,
            storage::request_storage_access,
            open_vault,
            close_vault,
            inspect_invite,
            suggest_vault_path,
            rename_vault,
            forget_vault,
            move_vault,
            hidden_vaults,
            vault_info,
            rescan,
            query,
            get_document,
            save_document,
            create_document,
            rename_document,
            delete_document,
            resolve_link,
            resolve_many,
            names,
            linkables,
            link_mentions,
            undo_link_mentions,
            ensure_scripture_page,
            set_map_filters,
            property_schema,
            set_property_type,
            gazetteer,
            versions,
            save_version,
            delete_version,
            text_at,
            history,
            get_board,
            save_board,
            board_at,
            export_board,
            attach_image,
            save_remote_cover,
            read_attachment,
            find_source_by_url,
            detect_passages,
            books,
            fetch_url_metadata,
            hidden_dir,
            ui_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The pure parts of this layer: turning a picked picture into a Cover
/// (ADR 0012) and reading a page's own description of itself. Neither needs a
/// vault, a window or the network, and until now neither had a test.
#[cfg(test)]
mod tests {
    use super::*;

    /// A solid image of the given size, as PNG bytes.
    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([10, 20, 30]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    /// A half-transparent image, to prove JPEG gets a flattened copy.
    fn png_with_alpha(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([10, 20, 30, 128]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    fn size_of(bytes: &[u8]) -> (u32, u32) {
        let img = image::load_from_memory(bytes).unwrap();
        (img.width(), img.height())
    }

    #[test]
    fn a_small_picture_is_stored_exactly_as_it_arrived() {
        // Nothing to gain by re-encoding: the bytes the user picked are kept.
        let bytes = png(100, 80);
        let (out, ext) = to_cover(&bytes, "png").unwrap();
        assert_eq!(ext, "png");
        assert_eq!(out, bytes);
    }

    #[test]
    fn an_oversize_picture_is_shrunk_to_the_longest_edge() {
        let bytes = png(1800, 900);
        let (out, _) = to_cover(&bytes, "png").unwrap();
        let (w, h) = size_of(&out);
        assert_eq!(w, engine::attachments::MAX_EDGE);
        // The aspect ratio is kept, so a 2:1 picture stays 2:1.
        assert_eq!(h, engine::attachments::MAX_EDGE / 2);
    }

    #[test]
    fn a_jpeg_stays_a_jpeg_and_everything_else_becomes_a_png() {
        // A resized GIF would lose its animation and a WebP would need an
        // encoder we do not ship, so the output format is not the input's.
        let (_, ext) = to_cover(&png(1800, 900), "jpg").unwrap();
        assert_eq!(ext, "jpg");
        let (_, ext) = to_cover(&png(1800, 900), "gif").unwrap();
        assert_eq!(ext, "png");
        let (_, ext) = to_cover(&png(1800, 900), "webp").unwrap();
        assert_eq!(ext, "png");
    }

    #[test]
    fn a_transparent_picture_can_still_be_written_as_a_jpeg() {
        // JPEG has no alpha; flattening rather than failing is the rule.
        let (out, ext) = to_cover(&png_with_alpha(1200, 1200), "jpg").unwrap();
        assert_eq!(ext, "jpg");
        assert_eq!(size_of(&out).0, engine::attachments::MAX_EDGE);
    }

    #[test]
    fn something_that_is_not_a_picture_is_refused() {
        let err = to_cover(b"<html>not an image</html>", "png").unwrap_err();
        assert!(err.contains("not an image"), "{err}");
    }

    #[test]
    fn a_meta_tag_is_read_in_either_attribute_order() {
        let a = r#"<meta property="og:title" content="Keep Enduring">"#;
        let b = r#"<meta content="Keep Enduring" property="og:title">"#;
        assert_eq!(meta_content(a, "og:title").as_deref(), Some("Keep Enduring"));
        assert_eq!(meta_content(b, "og:title").as_deref(), Some("Keep Enduring"));
    }

    #[test]
    fn a_meta_tag_that_is_not_there_is_not_invented() {
        assert_eq!(meta_content("<html></html>", "og:title"), None);
    }

    #[test]
    fn entities_are_read_as_the_characters_they_stand_for() {
        let html = r#"<meta name="description" content="Faith &amp; works &#39;now&#39;">"#;
        assert_eq!(
            meta_content(html, "description").as_deref(),
            Some("Faith & works 'now'"),
        );
    }
}
