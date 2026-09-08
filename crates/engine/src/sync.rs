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

use crate::Result;
use loro::{ExportMode, LoroDoc, LoroValue, UpdateOptions, ValueOrContainer};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const SYNC_DIR: &str = "sync";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteChange {
    pub id: String,
    pub text: String,
    pub path: Option<String>,
    pub deleted: bool,
}

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
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
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
    matches!(doc.get_map("meta").get(key), Some(ValueOrContainer::Value(LoroValue::Bool(true))))
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
        let manifest = fs::read_to_string(local_dir.join("imported.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        Ok(Sync { device_id, peer, vault_sync_dir: vault_root.join(crate::vault::HIDDEN_DIR).join(SYNC_DIR), local_dir, docs: HashMap::new(), manifest })
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    fn local_snapshot_path(&self, id: &str) -> PathBuf {
        self.local_dir.join(format!("{id}.loro"))
    }

    fn published_path(&self, id: &str) -> PathBuf {
        self.vault_sync_dir.join(&self.device_id).join(format!("{id}.loro"))
    }

    fn doc(&mut self, id: &str) -> &LoroDoc {
        if !self.docs.contains_key(id) {
            let doc = LoroDoc::new();
            let _ = doc.set_peer_id(self.peer);
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
        let bytes = doc.export(ExportMode::Snapshot).map_err(|e| crate::Error::Invalid(e.to_string()))?;
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
    pub fn record_local(&mut self, id: &str, text: &str, path: &str) -> Result<bool> {
        let doc = self.doc(id);
        let body = doc.get_text("body");
        let meta = doc.get_map("meta");
        let mut changed = false;
        if body.to_string() != text {
            body.update(text, UpdateOptions::default()).map_err(|e| crate::Error::Invalid(e.to_string()))?;
            changed = true;
        }
        if map_string(doc, "path").as_deref() != Some(path) {
            meta.insert("path", path).map_err(|e| crate::Error::Invalid(e.to_string()))?;
            changed = true;
        }
        if map_bool(doc, "deleted") {
            meta.insert("deleted", false).map_err(|e| crate::Error::Invalid(e.to_string()))?;
            changed = true;
        }
        if changed {
            self.persist(id, true)?;
        }
        Ok(changed)
    }

    pub fn record_delete(&mut self, id: &str) -> Result<()> {
        let doc = self.doc(id);
        if map_bool(doc, "deleted") {
            return Ok(());
        }
        doc.get_map("meta").insert("deleted", true).map_err(|e| crate::Error::Invalid(e.to_string()))?;
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
                    (doc.get_text("body").to_string(), map_string(doc, "path"), map_bool(doc, "deleted"))
                };
                let doc = self.doc(&id);
                if doc.import(&bytes).is_err() {
                    continue;
                }
                self.manifest.imported.insert(key, stamp);
                let after = {
                    let doc = &self.docs[&id];
                    (doc.get_text("body").to_string(), map_string(doc, "path"), map_bool(doc, "deleted"))
                };
                self.persist(&id, false)?;
                if before != after && !touched.contains(&id) {
                    touched.push(id.clone());
                    out.push(RemoteChange { id, text: after.0, path: after.1, deleted: after.2 });
                }
            }
        }
        write_atomic(&self.local_dir.join("imported.json"), serde_json::to_string(&self.manifest)?.as_bytes())?;
        Ok(out)
    }
}
