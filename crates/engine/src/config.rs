//! Vault config files (ADR 0016): the small JSON files in `.bible-study/`
//! that describe the Vault rather than hold its writing — the Property schema,
//! the Skins and which Skin the Vault wears. Pairing carries them whole, and
//! the newest write wins.
//!
//! "Newest" is the `updated` stamp the engine writes inside each file, not
//! the filesystem mtime: folder sync tools rewrite mtimes on arrival, which
//! would make a stale copy look fresh. A file without a stamp (hand-edited,
//! or written before this existed) falls back to its mtime.
//!
//! Deleting a synced file leaves a tombstone, `{"deleted": true, "updated": …}`,
//! so a Device that still holds the old file cannot bring it back.

use crate::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Top-level config files that sync. `vault.json` is not one: it names the
/// Vault's identity, which never changes after creation.
pub const TOP_FILES: &[&str] = &[crate::properties::FILE_NAME, "appearance.json"];
/// Folders whose `*.json` files all sync.
pub const DIRS: &[&str] = &["skins"];

/// One synced file as Pairing advertises it. `name` is relative to
/// `.bible-study/`, with `/` as the separator (`skins/sepia.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConfigEntry {
    pub name: String,
    pub stamp: i64,
    pub size: u64,
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Whether `name` is a config file that syncs, and safe to join onto the
/// hidden dir. Anything else a peer offers is ignored.
pub fn is_synced(name: &str) -> bool {
    if TOP_FILES.contains(&name) {
        return true;
    }
    let Some((dir, file)) = name.split_once('/') else { return false };
    DIRS.contains(&dir)
        && file.ends_with(".json")
        && file.len() > ".json".len()
        && !file.contains(['/', '\\'])
        && !file.starts_with('.')
}

fn path(hidden: &Path, name: &str) -> PathBuf {
    name.split('/').fold(hidden.to_path_buf(), |p, part| p.join(part))
}

fn mtime_ms(p: &Path) -> i64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The `updated` stamp of these bytes, if they are JSON carrying one.
fn stamp_of(bytes: &[u8]) -> Option<i64> {
    serde_json::from_slice::<Value>(bytes).ok()?.get("updated")?.as_i64()
}

fn stamp_at(p: &Path, bytes: &[u8]) -> i64 {
    stamp_of(bytes).unwrap_or_else(|| mtime_ms(p))
}

/// Every synced config file present in `hidden`, tombstones included.
pub fn manifest(hidden: &Path) -> Vec<ConfigEntry> {
    let mut names: Vec<String> = TOP_FILES.iter().map(|s| s.to_string()).collect();
    for dir in DIRS {
        if let Ok(files) = fs::read_dir(hidden.join(dir)) {
            for f in files.flatten() {
                names.push(format!("{dir}/{}", f.file_name().to_string_lossy()));
            }
        }
    }
    names
        .into_iter()
        .filter(|n| is_synced(n))
        .filter_map(|name| {
            let p = path(hidden, &name);
            let bytes = fs::read(&p).ok()?;
            Some(ConfigEntry { stamp: stamp_at(&p, &bytes), size: bytes.len() as u64, name })
        })
        .collect()
}

pub fn read(hidden: &Path, name: &str) -> Option<Vec<u8>> {
    if !is_synced(name) {
        return None;
    }
    fs::read(path(hidden, name)).ok()
}

/// Whether an entry a peer advertises should replace this Device's copy.
pub fn is_newer(theirs: &ConfigEntry, mine: Option<&ConfigEntry>) -> bool {
    mine.map_or(true, |m| theirs.stamp > m.stamp || (theirs.stamp == m.stamp && theirs.size > m.size))
}

/// Take a file from a peer when it is newer than what is here. Refuses names
/// that do not sync and bytes that are not JSON. Returns whether it was written.
pub fn accept(hidden: &Path, name: &str, bytes: &[u8]) -> bool {
    if !is_synced(name) || serde_json::from_slice::<Value>(bytes).is_err() {
        return false;
    }
    let p = path(hidden, name);
    let incoming = ConfigEntry { name: name.into(), stamp: stamp_at(&p, bytes), size: bytes.len() as u64 };
    let mine = fs::read(&p).ok().map(|b| ConfigEntry { name: name.into(), stamp: stamp_at(&p, &b), size: b.len() as u64 });
    if !is_newer(&incoming, mine.as_ref()) {
        return false;
    }
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp = p.with_extension("json.part");
    if fs::write(&tmp, bytes).is_err() {
        return false;
    }
    let ok = fs::rename(&tmp, &p).is_ok();
    if ok {
        // Keep the mtime in step with the stamp, for readers that fall back to it.
        let t = UNIX_EPOCH + Duration::from_millis(incoming.stamp.max(0) as u64);
        let _ = fs::File::open(&p).and_then(|f| f.set_modified(t));
    }
    ok
}

/// Write a config object, stamping it newer than whatever is on disk so a
/// clock that lags a peer's still wins for a deliberate local edit.
pub fn write(hidden: &Path, name: &str, mut value: Value) -> Result<()> {
    let p = path(hidden, name);
    let previous = fs::read(&p).ok().map(|b| stamp_at(&p, &b)).unwrap_or(0);
    if let Value::Object(map) = &mut value {
        map.insert("updated".into(), Value::from(now_ms().max(previous + 1)));
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&p, serde_json::to_string_pretty(&value)? + "\n")?;
    Ok(())
}

/// Replace a synced file with a tombstone.
pub fn delete(hidden: &Path, name: &str) -> Result<()> {
    write(hidden, name, serde_json::json!({ "deleted": true }))
}

pub fn is_tombstone(value: &Value) -> bool {
    value.get("deleted").and_then(Value::as_bool) == Some(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_names_sync() {
        assert!(is_synced("properties.json"));
        assert!(is_synced("appearance.json"));
        assert!(is_synced("skins/sepia.json"));
        assert!(!is_synced("vault.json"));
        assert!(!is_synced("skins/../vault.json"));
        assert!(!is_synced("skins/a/b.json"));
        assert!(!is_synced("skins/.json"));
        assert!(!is_synced("skins/x.txt"));
        assert!(!is_synced("sync/dev/DOC.loro"));
    }

    #[test]
    fn newest_stamp_wins_regardless_of_mtime() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        write(a.path(), "skins/x.json", serde_json::json!({ "name": "old" })).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        write(b.path(), "skins/x.json", serde_json::json!({ "name": "new" })).unwrap();
        let newer = read(b.path(), "skins/x.json").unwrap();
        let older = read(a.path(), "skins/x.json").unwrap();
        // Touch a's file so its mtime is the latest: the stamp still decides.
        fs::write(a.path().join("skins/x.json"), &older).unwrap();
        assert!(accept(a.path(), "skins/x.json", &newer));
        assert!(!accept(b.path(), "skins/x.json", &older), "an older stamp replaced a newer file");
        let text = fs::read_to_string(a.path().join("skins/x.json")).unwrap();
        assert!(text.contains("new"), "{text}");
    }

    #[test]
    fn a_local_write_outranks_a_stamp_from_a_fast_clock() {
        let d = tempfile::tempdir().unwrap();
        let future = serde_json::json!({ "name": "peer", "updated": now_ms() + 60_000 });
        assert!(accept(d.path(), "appearance.json", future.to_string().as_bytes()));
        write(d.path(), "appearance.json", serde_json::json!({ "name": "mine" })).unwrap();
        let m = manifest(d.path());
        let e = m.iter().find(|e| e.name == "appearance.json").unwrap();
        assert!(e.stamp > now_ms() + 59_000);
        assert!(fs::read_to_string(d.path().join("appearance.json")).unwrap().contains("mine"));
    }

    #[test]
    fn tombstones_travel_and_stay() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        write(a.path(), "skins/x.json", serde_json::json!({ "name": "x" })).unwrap();
        let live = read(a.path(), "skins/x.json").unwrap();
        assert!(accept(b.path(), "skins/x.json", &live));
        std::thread::sleep(Duration::from_millis(5));
        delete(a.path(), "skins/x.json").unwrap();
        let tomb = read(a.path(), "skins/x.json").unwrap();
        assert!(accept(b.path(), "skins/x.json", &tomb));
        assert!(!accept(b.path(), "skins/x.json", &live), "a deleted Skin came back");
        let v: Value = serde_json::from_slice(&read(b.path(), "skins/x.json").unwrap()).unwrap();
        assert!(is_tombstone(&v));
    }

    #[test]
    fn junk_is_refused() {
        let d = tempfile::tempdir().unwrap();
        assert!(!accept(d.path(), "skins/x.json", b"{nope"));
        assert!(!accept(d.path(), "vault.json", b"{}"));
        assert!(manifest(d.path()).is_empty());
    }
}
