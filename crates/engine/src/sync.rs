//! Conflict-free sync over any folder (ADR 0001).
//!
//! Every document is a Loro CRDT holding the full file text and a small
//! metadata map (path, deleted). Each device publishes a snapshot of every
//! document it has changed into `<vault>/.bible-study/sync/<device>/<id>.loro`
//! and never writes into another device's folder, so the cloud provider that
//! syncs the vault never sees a conflict. Importing another device's snapshot
//! merges its history; the merged text is then materialised back to the
//! markdown file, which restores edits the provider's last-writer-wins file
//! sync would otherwise have lost.
//!
//! Per-device state (device id, local snapshots, import manifest) lives in the
//! app data directory, never inside the vault.

use crate::canvas::{self, Canvas};
use crate::Result;
use loro::{ExportMode, Frontiers, LoroDoc, LoroValue, UpdateOptions, ValueOrContainer, ID};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const SYNC_DIR: &str = "sync";
const DEVICE_FILE: &str = "device.json";

/// What a Device writes about itself into its sync folder, so other Devices
/// can name it ("synced from Paul's MacBook").
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DeviceCard {
    name: String,
    platform: String,
}

/// A Device seen in the vault's sync folder.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub platform: String,
    /// Newest snapshot in milliseconds since the epoch; 0 when none yet.
    pub last_snapshot: i64,
    pub is_self: bool,
}

/// A vault folder found while looking for one synced from another Device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoundVault {
    pub path: String,
    pub devices: Vec<DeviceInfo>,
}

/// This Device as other Devices see it: (name, platform).
pub fn this_device() -> (String, String) {
    let c = this_device_card();
    (c.name, c.platform)
}

fn this_device_card() -> DeviceCard {
    let os = std::env::consts::OS;
    let host = hostname::get().ok().and_then(|h| h.into_string().ok());
    DeviceCard { name: device_name(host, product_name(), os), platform: os.to_string() }
}

/// A human name for this Device. Phones report a hostname of `localhost`, so
/// the product name (Android's `ro.product.*`) wins over the hostname, and a
/// meaningless hostname falls back to the platform.
pub fn device_name(hostname: Option<String>, product: Option<String>, os: &str) -> String {
    let clean = |s: Option<String>| s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && !matches!(s.to_ascii_lowercase().as_str(), "localhost" | "unknown" | "android" | "device"));
    if let Some(p) = clean(product) {
        return p;
    }
    if let Some(h) = clean(hostname) {
        return h;
    }
    match os {
        "android" => "Android device",
        "ios" => "iPhone",
        "macos" => "Mac",
        "windows" => "Windows PC",
        "linux" => "Linux PC",
        _ => "device",
    }
    .to_string()
}

/// Android: the marketing name when the vendor sets one, else "<Manufacturer> <Model>".
#[cfg(target_os = "android")]
fn product_name() -> Option<String> {
    fn prop(key: &str) -> Option<String> {
        let out = std::process::Command::new("getprop").arg(key).output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!s.is_empty()).then_some(s)
    }
    prop("ro.product.marketname").or_else(|| prop("ro.product.vendor.marketname")).or_else(|| {
        let model = prop("ro.product.model")?;
        Some(match prop("ro.product.manufacturer") {
            Some(m) if !model.to_ascii_lowercase().starts_with(&m.to_ascii_lowercase()) => {
                let mut c = m.chars();
                let m = c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or(m);
                format!("{m} {model}")
            }
            _ => model,
        })
    })
}

#[cfg(not(target_os = "android"))]
fn product_name() -> Option<String> {
    None
}

fn mtime_ms_of(p: &Path) -> i64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Devices that have published into `<vault>/.bible-study/sync/`.
pub fn devices_in(vault_root: &Path, self_id: Option<&str>) -> Vec<DeviceInfo> {
    let dir = vault_root.join(crate::vault::HIDDEN_DIR).join(SYNC_DIR);
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else { return out };
    for e in entries.flatten() {
        if !e.path().is_dir() {
            continue;
        }
        let id = e.file_name().to_string_lossy().to_string();
        let card: Option<DeviceCard> = fs::read_to_string(e.path().join(DEVICE_FILE)).ok().and_then(|s| serde_json::from_str(&s).ok());
        let mut last = 0;
        if let Ok(files) = fs::read_dir(e.path()) {
            for f in files.flatten() {
                if f.path().extension().map_or(false, |x| x == "loro") {
                    last = last.max(mtime_ms_of(&f.path()));
                }
            }
        }
        if last == 0 {
            last = mtime_ms_of(&e.path().join(DEVICE_FILE));
        }
        out.push(DeviceInfo {
            is_self: self_id == Some(id.as_str()),
            id,
            name: card.as_ref().map(|c| c.name.clone()).unwrap_or_default(),
            platform: card.map(|c| c.platform).unwrap_or_default(),
            last_snapshot: last,
        });
    }
    out.sort_by(|a, b| b.last_snapshot.cmp(&a.last_snapshot));
    out
}

/// Vault folders under each of `roots`: the root itself and its direct
/// children. A folder is a vault when it contains `.bible-study/`.
pub fn find_vaults(roots: &[PathBuf], self_id: Option<&str>) -> Vec<FoundVault> {
    let mut out: Vec<FoundVault> = Vec::new();
    let mut consider = |p: PathBuf| {
        if p.join(crate::vault::HIDDEN_DIR).is_dir() && !out.iter().any(|v| v.path == p.to_string_lossy()) {
            out.push(FoundVault { path: p.to_string_lossy().to_string(), devices: devices_in(&p, self_id) });
        }
    };
    for root in roots {
        if !root.is_dir() {
            continue;
        }
        consider(root.clone());
        if let Ok(entries) = fs::read_dir(root) {
            for e in entries.flatten() {
                if e.path().is_dir() {
                    consider(e.path());
                }
            }
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteChange {
    pub id: String,
    pub text: String,
    pub path: Option<String>,
    pub deleted: bool,
}

/// A named moment in a document's history (ADR 0007). Lives in the Loro
/// document itself, so it syncs with it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Version {
    pub key: String,
    pub label: String,
    /// Unix milliseconds.
    pub created: i64,
    /// Hex-encoded Loro frontier.
    pub frontier: String,
}

/// One change in a document's history, for browsing unnamed history.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryPoint {
    pub frontier: String,
    /// Unix seconds, 0 when the change carries no timestamp.
    pub timestamp: i64,
    pub lamport: u32,
    pub peer: String,
    pub ops: usize,
}

const VERSIONS: &str = "versions";

/// The Composition's Board (ADR 0009), a map keyed by node and edge id so two
/// Devices moving two different nodes both win. Edge keys are prefixed to keep
/// them from colliding with node ids, which the spec does not forbid sharing.
const CANVAS: &str = "canvas";
const EDGE_PREFIX: &str = "e:";
/// The order nodes were read in, which is their z-index. Held as one key
/// because reordering is a whole-Board act, not a per-node one.
const CANVAS_ORDER: &str = "#order";
/// Root-level keys of the canvas file that the spec does not define.
const CANVAS_EXTRA: &str = "#extra";

#[derive(Default, Serialize, Deserialize)]
struct Manifest {
    /// "<device>/<file>" -> (mtime ms, len)
    imported: HashMap<String, (i64, u64)>,
}

pub struct Sync {
    device_id: String,
    peer: u64,
    vault_sync_dir: PathBuf,
    local_dir: PathBuf,
    docs: HashMap<String, LoroDoc>,
    manifest: Manifest,
}

fn mtime_ms(p: &Path) -> i64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", ulid::Ulid::new()));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn map_string(doc: &LoroDoc, key: &str) -> Option<String> {
    match doc.get_map("meta").get(key) {
        Some(ValueOrContainer::Value(LoroValue::String(s))) => Some(s.to_string()),
        _ => None,
    }
}

fn map_bool(doc: &LoroDoc, key: &str) -> bool {
    matches!(
        doc.get_map("meta").get(key),
        Some(ValueOrContainer::Value(LoroValue::Bool(true)))
    )
}

impl Sync {
    /// `device_dir` holds the device id (shared by all vaults on this device);
    /// `vault_local_dir` holds this vault's local CRDT state.
    pub fn open(vault_root: &Path, device_dir: &Path, vault_local_dir: &Path) -> Result<Sync> {
        fs::create_dir_all(device_dir)?;
        let id_path = device_dir.join("device.id");
        let device_id = match fs::read_to_string(&id_path) {
            Ok(s) if !s.trim().is_empty() => s.trim().to_string(),
            _ => {
                let id = ulid::Ulid::new().to_string();
                fs::write(&id_path, &id)?;
                id
            }
        };
        let digest = Sha256::digest(device_id.as_bytes());
        let peer = u64::from_le_bytes(digest[..8].try_into().unwrap()) | 1;
        let local_dir = vault_local_dir.join("crdt");
        fs::create_dir_all(&local_dir)?;
        let manifest = fs::read_to_string(local_dir.join("imported.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let vault_sync_dir = vault_root.join(crate::vault::HIDDEN_DIR).join(SYNC_DIR);
        // Announce this Device to the others (name + platform); harmless if it fails.
        let mine = vault_sync_dir.join(&device_id);
        if fs::create_dir_all(&mine).is_ok() {
            if let Ok(json) = serde_json::to_string_pretty(&this_device_card()) {
                let _ = fs::write(mine.join(DEVICE_FILE), json);
            }
        }
        Ok(Sync {
            device_id,
            peer,
            vault_sync_dir,
            local_dir,
            docs: HashMap::new(),
            manifest,
        })
    }

    /// Every Device that has published into this vault, newest first.
    pub fn devices(&self) -> Vec<DeviceInfo> {
        let root = self.vault_sync_dir.parent().and_then(|p| p.parent()).map(Path::to_path_buf).unwrap_or_default();
        devices_in(&root, Some(&self.device_id))
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    fn local_snapshot_path(&self, id: &str) -> PathBuf {
        self.local_dir.join(format!("{id}.loro"))
    }

    fn published_path(&self, id: &str) -> PathBuf {
        self.vault_sync_dir
            .join(&self.device_id)
            .join(format!("{id}.loro"))
    }

    fn doc(&mut self, id: &str) -> &LoroDoc {
        if !self.docs.contains_key(id) {
            let doc = LoroDoc::new();
            let _ = doc.set_peer_id(self.peer);
            doc.set_record_timestamp(true);
            // Every save is its own change, so history can be browsed save by save.
            doc.set_change_merge_interval(-1);
            if let Ok(bytes) = fs::read(self.local_snapshot_path(id)) {
                let _ = doc.import(&bytes);
                let _ = doc.set_peer_id(self.peer);
            }
            self.docs.insert(id.to_string(), doc);
        }
        &self.docs[id]
    }

    fn persist(&self, id: &str, publish: bool) -> Result<()> {
        let doc = &self.docs[id];
        doc.commit();
        let bytes = doc
            .export(ExportMode::Snapshot)
            .map_err(|e| crate::Error::Invalid(e.to_string()))?;
        write_atomic(&self.local_snapshot_path(id), &bytes)?;
        if publish {
            write_atomic(&self.published_path(id), &bytes)?;
        }
        Ok(())
    }

    /// The text this device's CRDT currently holds, if the document is known.
    pub fn text_of(&mut self, id: &str) -> Option<String> {
        if !self.docs.contains_key(id) && !self.local_snapshot_path(id).exists() {
            return None;
        }
        let doc = self.doc(id);
        let t = doc.get_text("body");
        if t.is_empty() && map_string(doc, "path").is_none() {
            return None;
        }
        Some(t.to_string())
    }

    /// Record the current file text and path as this device's state.
    /// No-op (and no publish) when nothing changed.
    /// Whether this Device has ever published a snapshot for `id`.
    pub fn is_published(&self, id: &str) -> bool {
        self.published_path(id).exists()
    }

    /// Record the text like `record_local`, then make sure the published
    /// snapshot exists even when nothing changed (a lost or never-written file).
    pub fn republish(&mut self, id: &str, text: &str, path: &str) -> Result<()> {
        if !self.record_local(id, text, path)? {
            self.persist(id, true)?;
        }
        Ok(())
    }

    pub fn record_local(&mut self, id: &str, text: &str, path: &str) -> Result<bool> {
        let doc = self.doc(id);
        let body = doc.get_text("body");
        let meta = doc.get_map("meta");
        let mut changed = false;
        if body.to_string() != text {
            body.update(text, UpdateOptions::default())
                .map_err(|e| crate::Error::Invalid(e.to_string()))?;
            changed = true;
        }
        if map_string(doc, "path").as_deref() != Some(path) {
            meta.insert("path", path)
                .map_err(|e| crate::Error::Invalid(e.to_string()))?;
            changed = true;
        }
        if map_bool(doc, "deleted") {
            meta.insert("deleted", false)
                .map_err(|e| crate::Error::Invalid(e.to_string()))?;
            changed = true;
        }
        if changed {
            self.persist(id, true)?;
        }
        Ok(changed)
    }

    fn known(&self, id: &str) -> bool {
        self.docs.contains_key(id) || self.local_snapshot_path(id).exists()
    }

    /// The Board this device's CRDT currently holds for a Composition.
    ///
    /// Stored as a map keyed by node and edge id rather than as text: two
    /// Devices dragging two different nodes touch two different keys and both
    /// win, where a text CRDT over JSON would interleave into an invalid file
    /// (ADR 0009). Two Devices dragging the *same* node fall to Loro's per-key
    /// last-writer-wins, which is the right answer for a coordinate.
    pub fn canvas_of(&mut self, id: &str) -> Option<Canvas> {
        if !self.known(id) {
            return None;
        }
        canvas_in(self.doc(id))
    }

    /// The Board at a frontier (a Version's or a history point's), so a
    /// Version covers the talk and its Board as one moment (PLAN §17.17).
    pub fn canvas_at(&mut self, id: &str, frontier_hex: &str) -> Result<Option<Canvas>> {
        if !self.known(id) {
            return Ok(None);
        }
        let bytes = hex::decode(frontier_hex).map_err(|e| crate::Error::Invalid(e.to_string()))?;
        let f = Frontiers::decode(&bytes).map_err(|e| crate::Error::Invalid(e.to_string()))?;
        let doc = self.doc(id);
        doc.commit();
        let old = doc
            .fork_at(&f)
            .map_err(|e| crate::Error::Invalid(e.to_string()))?;
        Ok(canvas_in(&old))
    }
}

/// Read a Board out of a Loro document's `canvas` map.
///
/// Free-standing so it can read a fork as easily as the live document, which
/// is what makes a Board recoverable at a Version's frontier.
fn canvas_in(doc: &LoroDoc) -> Option<Canvas> {
    let m = match doc.get_map(CANVAS).get_value() {
        LoroValue::Map(m) => m,
        _ => return None,
    };
    if m.is_empty() {
        return None;
    }
    let str_at = |key: &str| match m.get(key) {
        Some(LoroValue::String(s)) => Some(s.to_string()),
        _ => None,
    };
    // The order key is the z-index; ids it does not name are appended in
    // map order so a node added by another Device is never dropped.
    let order: Vec<String> = str_at(CANVAS_ORDER)
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default();
    let mut nodes: Vec<canvas::Node> = Vec::new();
    let mut edges: Vec<canvas::Edge> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let push = |key: &str, nodes: &mut Vec<canvas::Node>, edges: &mut Vec<canvas::Edge>| {
        let Some(raw) = (match m.get(key) {
            Some(LoroValue::String(s)) => Some(s.to_string()),
            _ => None,
        }) else {
            return;
        };
        if let Some(eid) = key.strip_prefix(EDGE_PREFIX) {
            if let Ok(mut e) = serde_json::from_str::<canvas::Edge>(&raw) {
                e.id = eid.to_string();
                edges.push(e);
            }
        } else if let Ok(mut n) = serde_json::from_str::<canvas::Node>(&raw) {
            n.id = key.to_string();
            nodes.push(n);
        }
    };
    for key in &order {
        if m.contains_key(key.as_str()) {
            push(key, &mut nodes, &mut edges);
            seen.push(key.clone());
        }
    }
    for key in m.keys() {
        if key == CANVAS_ORDER || key == CANVAS_EXTRA || seen.contains(key) {
            continue;
        }
        push(key, &mut nodes, &mut edges);
    }
    let extra: serde_json::Map<String, serde_json::Value> = str_at(CANVAS_EXTRA)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    // Bookkeeping keys alone are not a Board: a Composition whose every
    // node was deleted has none, the same as one that never had one.
    if nodes.is_empty() && edges.is_empty() && extra.is_empty() {
        return None;
    }
    Some(Canvas { nodes, edges, extra })
}

impl Sync {
    /// Fold a Board into the CRDT, node by node.
    ///
    /// This is the structural reconcile the plan requires for external edits
    /// (PLAN §17.14): whatever the source — this app's editor or Obsidian
    /// writing the `.canvas` file — the incoming Board is diffed against the
    /// map and only genuine differences are written, so an untouched node
    /// records no operation and a concurrent remote edit to it survives.
    /// Returns whether anything changed.
    pub fn record_canvas(&mut self, id: &str, canvas: &Canvas) -> Result<bool> {
        let doc = self.doc(id);
        let map = doc.get_map(CANVAS);
        let current = match map.get_value() {
            LoroValue::Map(m) => m,
            _ => Default::default(),
        };
        let at = |key: &str| match current.get(key) {
            Some(LoroValue::String(s)) => Some(s.to_string()),
            _ => None,
        };
        let mut changed = false;
        let mut wanted: Vec<String> = Vec::new();

        for n in &canvas.nodes {
            let key = n.id.clone();
            let json = serde_json::to_string(n)?;
            if at(&key).as_deref() != Some(json.as_str()) {
                map.insert(&key, json)
                    .map_err(|e| crate::Error::Invalid(e.to_string()))?;
                changed = true;
            }
            wanted.push(key);
        }
        for e in &canvas.edges {
            let key = format!("{EDGE_PREFIX}{}", e.id);
            let json = serde_json::to_string(e)?;
            if at(&key).as_deref() != Some(json.as_str()) {
                map.insert(&key, json)
                    .map_err(|e| crate::Error::Invalid(e.to_string()))?;
                changed = true;
            }
            wanted.push(key);
        }
        // A key the incoming Board no longer carries was deleted on this
        // Device. Deleting it here is what lets the deletion reach the others.
        for key in current.keys() {
            if key == CANVAS_ORDER || key == CANVAS_EXTRA || wanted.contains(key) {
                continue;
            }
            map.delete(key)
                .map_err(|e| crate::Error::Invalid(e.to_string()))?;
            changed = true;
        }

        let order = serde_json::to_string(
            &canvas.nodes.iter().map(|n| n.id.clone()).collect::<Vec<_>>(),
        )?;
        // Recording an empty Board into a map that holds nothing must leave it
        // empty: a Composition whose Board tab was merely opened has no Board,
        // and writing the order key alone would make `canvas_of` claim one.
        let empty_noop = canvas.is_empty() && current.is_empty();
        if !empty_noop && at(CANVAS_ORDER).as_deref() != Some(order.as_str()) {
            map.insert(CANVAS_ORDER, order)
                .map_err(|e| crate::Error::Invalid(e.to_string()))?;
            changed = true;
        }
        let extra = serde_json::to_string(&canvas.extra)?;
        let extra_absent = canvas.extra.is_empty() && at(CANVAS_EXTRA).is_none();
        if !extra_absent && at(CANVAS_EXTRA).as_deref() != Some(extra.as_str()) {
            map.insert(CANVAS_EXTRA, extra)
                .map_err(|e| crate::Error::Invalid(e.to_string()))?;
            changed = true;
        }

        if changed {
            self.persist(id, true)?;
        }
        Ok(changed)
    }

    /// Named Versions of a document, newest first.
    pub fn versions(&mut self, id: &str) -> Vec<Version> {
        if !self.known(id) {
            return vec![];
        }
        let doc = self.doc(id);
        let mut out: Vec<Version> = match doc.get_map(VERSIONS).get_value() {
            LoroValue::Map(m) => m
                .values()
                .filter_map(|v| match v {
                    LoroValue::String(s) => serde_json::from_str::<Version>(s).ok(),
                    _ => None,
                })
                .collect(),
            _ => vec![],
        };
        out.sort_by(|a, b| b.created.cmp(&a.created).then(a.key.cmp(&b.key)));
        out
    }

    /// Label the document's current state as a Version.
    pub fn save_version(&mut self, id: &str, label: &str) -> Result<Version> {
        if !self.known(id) {
            return Err(crate::Error::Invalid(format!("no history for {id}")));
        }
        let doc = self.doc(id);
        doc.commit();
        let frontier = hex::encode(doc.oplog_frontiers().encode());
        let created = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let v = Version {
            key: ulid::Ulid::new().to_string(),
            label: label.trim().to_string(),
            created,
            frontier,
        };
        doc.get_map(VERSIONS)
            .insert(&v.key, serde_json::to_string(&v)?)
            .map_err(|e| crate::Error::Invalid(e.to_string()))?;
        self.persist(id, true)?;
        Ok(v)
    }

    pub fn delete_version(&mut self, id: &str, key: &str) -> Result<()> {
        if !self.known(id) {
            return Ok(());
        }
        let doc = self.doc(id);
        doc.get_map(VERSIONS)
            .delete(key)
            .map_err(|e| crate::Error::Invalid(e.to_string()))?;
        self.persist(id, true)
    }

    /// The document's text at a frontier (a Version's or a history point's).
    pub fn text_at(&mut self, id: &str, frontier_hex: &str) -> Result<String> {
        if !self.known(id) {
            return Err(crate::Error::Invalid(format!("no history for {id}")));
        }
        let bytes = hex::decode(frontier_hex).map_err(|e| crate::Error::Invalid(e.to_string()))?;
        let f = Frontiers::decode(&bytes).map_err(|e| crate::Error::Invalid(e.to_string()))?;
        let doc = self.doc(id);
        doc.commit();
        let old = doc
            .fork_at(&f)
            .map_err(|e| crate::Error::Invalid(e.to_string()))?;
        Ok(old.get_text("body").to_string())
    }

    /// Every change in the document's history, newest first.
    pub fn history(&mut self, id: &str) -> Result<Vec<HistoryPoint>> {
        if !self.known(id) {
            return Ok(vec![]);
        }
        let doc = self.doc(id);
        doc.commit();
        let ids: Vec<ID> = doc.oplog_frontiers().iter().collect();
        let mut out = Vec::new();
        doc.travel_change_ancestors(&ids, &mut |c| {
            let end = ID::new(c.id.peer, c.id.counter + c.len as i32 - 1);
            out.push(HistoryPoint {
                frontier: hex::encode(Frontiers::from_id(end).encode()),
                timestamp: c.timestamp,
                lamport: c.lamport,
                peer: c.id.peer.to_string(),
                ops: c.len,
            });
            ControlFlow::Continue(())
        })
        .map_err(|e| crate::Error::Invalid(format!("{e:?}")))?;
        out.sort_by(|a, b| {
            b.timestamp
                .cmp(&a.timestamp)
                .then(b.lamport.cmp(&a.lamport))
                .then(a.peer.cmp(&b.peer))
        });
        Ok(out)
    }

    pub fn record_delete(&mut self, id: &str) -> Result<()> {
        let doc = self.doc(id);
        if map_bool(doc, "deleted") {
            return Ok(());
        }
        doc.get_map("meta")
            .insert("deleted", true)
            .map_err(|e| crate::Error::Invalid(e.to_string()))?;
        self.persist(id, true)
    }

    /// Newest mtime among other devices' published snapshots for `id`.
    pub fn remote_mtime(&self, id: &str) -> Option<i64> {
        let mut best = None;
        for dev in fs::read_dir(&self.vault_sync_dir).ok()?.flatten() {
            if dev.file_name().to_string_lossy() == self.device_id {
                continue;
            }
            let p = dev.path().join(format!("{id}.loro"));
            if p.is_file() {
                let m = mtime_ms(&p);
                best = Some(best.map_or(m, |b: i64| b.max(m)));
            }
        }
        best
    }

    /// Import every new or changed snapshot from other devices. Returns the
    /// documents whose merged state differs from what this device last knew.
    pub fn import_remote(&mut self) -> Result<Vec<RemoteChange>> {
        let mut out = Vec::new();
        let devices = match fs::read_dir(&self.vault_sync_dir) {
            Ok(d) => d,
            Err(_) => return Ok(out),
        };
        let mut touched: Vec<String> = Vec::new();
        for dev in devices.flatten() {
            let dev_name = dev.file_name().to_string_lossy().to_string();
            if dev_name == self.device_id || !dev.path().is_dir() {
                continue;
            }
            for f in fs::read_dir(dev.path())?.flatten() {
                let name = f.file_name().to_string_lossy().to_string();
                let id = match name.strip_suffix(".loro") {
                    Some(id) => id.to_string(),
                    None => continue,
                };
                let key = format!("{dev_name}/{name}");
                let meta = match f.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let stamp = (mtime_ms(&f.path()), meta.len());
                if self.manifest.imported.get(&key) == Some(&stamp) {
                    continue;
                }
                let bytes = match fs::read(f.path()) {
                    Ok(b) => b,
                    Err(_) => continue,
                };
                let before = {
                    let doc = self.doc(&id);
                    (
                        doc.get_text("body").to_string(),
                        map_string(doc, "path"),
                        map_bool(doc, "deleted"),
                    )
                };
                let doc = self.doc(&id);
                if doc.import(&bytes).is_err() {
                    continue;
                }
                self.manifest.imported.insert(key, stamp);
                let after = {
                    let doc = &self.docs[&id];
                    (
                        doc.get_text("body").to_string(),
                        map_string(doc, "path"),
                        map_bool(doc, "deleted"),
                    )
                };
                self.persist(&id, false)?;
                if before != after && !touched.contains(&id) {
                    touched.push(id.clone());
                    out.push(RemoteChange {
                        id,
                        text: after.0,
                        path: after.1,
                        deleted: after.2,
                    });
                }
            }
        }
        write_atomic(
            &self.local_dir.join("imported.json"),
            serde_json::to_string(&self.manifest)?.as_bytes(),
        )?;
        Ok(out)
    }
}

#[cfg(test)]
mod device_name_tests {
    use super::device_name;

    #[test]
    fn device_name_prefers_product_then_hostname_then_platform() {
        assert_eq!(device_name(Some("localhost".into()), Some("Pixel 8".into()), "android"), "Pixel 8");
        assert_eq!(device_name(Some("localhost".into()), None, "android"), "Android device");
        assert_eq!(device_name(Some("  ".into()), None, "ios"), "iPhone");
        assert_eq!(device_name(Some("DESKTOP-42".into()), None, "windows"), "DESKTOP-42");
        assert_eq!(device_name(None, None, "linux"), "Linux PC");
    }
}
