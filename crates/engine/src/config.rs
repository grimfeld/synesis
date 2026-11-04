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
pub const TOP_FILES: &[&str] = &[crate::properties::FILE_NAME, "appearance.json", crate::place_kinds::FILE];
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

/// How far ahead of this Device's clock a peer's stamp or snapshot time may
/// run. Anything later would win every round from then on, and a time that
/// far out does not fit in a file's modification time everywhere.
pub(crate) const MAX_SKEW_MS: i64 = 24 * 60 * 60 * 1000;

/// Whether a peer's stamp lies between the epoch and a day past this clock.
pub(crate) fn plausible(stamp: i64) -> bool {
    plausible_at(stamp, now_ms())
}

fn plausible_at(stamp: i64, now: i64) -> bool {
    (0..=now.saturating_add(MAX_SKEW_MS)).contains(&stamp)
}

/// A peer's stamp brought into range: a clock that runs fast still syncs,
/// but never further ahead than a day.
pub(crate) fn clamp_stamp(stamp: i64) -> i64 {
    clamp_stamp_at(stamp, now_ms())
}

fn clamp_stamp_at(stamp: i64, now: i64) -> i64 {
    stamp.clamp(0, now.saturating_add(MAX_SKEW_MS))
}

/// The stamp for a write here: after `previous`, but never past what a peer
/// would accept, so a file already stamped far ahead can still be edited.
pub(crate) fn next_stamp(previous: i64) -> i64 {
    next_stamp_at(previous, now_ms())
}

fn next_stamp_at(previous: i64, now: i64) -> i64 {
    now.max(previous.saturating_add(1)).min(now.saturating_add(MAX_SKEW_MS))
}

/// `ms` after the epoch as a file time, or `None` where it does not fit.
pub(crate) fn file_time(ms: i64) -> Option<SystemTime> {
    UNIX_EPOCH.checked_add(Duration::from_millis(u64::try_from(ms).ok()?))
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

pub(crate) fn mtime_ms(p: &Path) -> i64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The `updated` stamp of these bytes, if they are JSON carrying one.
pub(crate) fn stamp_of(bytes: &[u8]) -> Option<i64> {
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
    mine.is_none_or(|m| theirs.stamp > m.stamp || (theirs.stamp == m.stamp && theirs.size > m.size))
}

/// Take a file from a peer when it is newer than what is here. Refuses names
/// that do not sync and bytes that are not JSON. Returns whether it was written.
pub fn accept(hidden: &Path, name: &str, bytes: &[u8]) -> bool {
    accept_at(hidden, name, bytes, now_ms())
}

/// `accept` with this Device's clock reading `now`.
fn accept_at(hidden: &Path, name: &str, bytes: &[u8], now: i64) -> bool {
    if !is_synced(name) || serde_json::from_slice::<Value>(bytes).is_err() {
        return false;
    }
    let p = path(hidden, name);
    // Never written over while iCloud holds it (see `cloud`).
    if crate::cloud::is_evicted(&p) {
        return false;
    }
    // A stamp from a clock far ahead would outrank every later edit here, for
    // good if it is near `i64::MAX`. Such a file is still taken when there is
    // none here (a new Skin from a Device whose clock runs fast), stamped a
    // day past this clock, in the file too; it never replaces a file this
    // Device holds, or it would win again on every round.
    let clamped;
    let bytes = match stamp_of(bytes) {
        Some(stamp) if !plausible_at(stamp, now) => {
            if p.exists() {
                return false;
            }
            let Ok(Value::Object(mut map)) = serde_json::from_slice::<Value>(bytes) else { return false };
            map.insert("updated".into(), Value::from(clamp_stamp_at(stamp, now)));
            let Ok(text) = serde_json::to_string_pretty(&map) else { return false };
            clamped = text + "\n";
            clamped.as_bytes()
        }
        _ => bytes,
    };
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
        if let Some(t) = file_time(incoming.stamp) {
            let _ = fs::File::options().write(true).open(&p).and_then(|f| f.set_modified(t));
        }
    }
    ok
}

/// Write a config object, stamping it newer than whatever is on disk so a
/// clock that lags a peer's still wins for a deliberate local edit.
pub fn write(hidden: &Path, name: &str, value: Value) -> Result<()> {
    write_at(hidden, name, value, now_ms())
}

/// `write` with this Device's clock reading `now`.
fn write_at(hidden: &Path, name: &str, mut value: Value, now: i64) -> Result<()> {
    let p = path(hidden, name);
    if crate::cloud::is_evicted(&p) {
        return Err(crate::cloud::downloading(&p));
    }
    let previous = fs::read(&p).ok().map(|b| stamp_at(&p, &b)).unwrap_or(0);
    if let Value::Object(map) = &mut value {
        map.insert("updated".into(), Value::from(next_stamp_at(previous, now)));
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

    /// An arbitrary clock reading, so the tests never depend on the real one.
    const NOW: i64 = 1_800_000_000_000;

    #[test]
    fn a_far_future_stamp_never_locks_a_file() {
        let d = tempfile::tempdir().unwrap();
        write_at(d.path(), "appearance.json", serde_json::json!({ "name": "mine" }), NOW).unwrap();
        let poison = serde_json::json!({ "name": "peer", "updated": i64::MAX });
        assert!(!accept_at(d.path(), "appearance.json", poison.to_string().as_bytes(), NOW));
        assert!(fs::read_to_string(d.path().join("appearance.json")).unwrap().contains("mine"));
        // A file this Device lacks still arrives, pulled back to a day ahead.
        assert!(accept_at(d.path(), "skins/x.json", poison.to_string().as_bytes(), NOW));
        let stamp = stamp_of(&read(d.path(), "skins/x.json").unwrap()).unwrap();
        assert_eq!(stamp, NOW + MAX_SKEW_MS);
        // And is not taken again over the edit made after it, a minute later.
        write_at(d.path(), "skins/x.json", serde_json::json!({ "name": "edited" }), NOW + 60_000).unwrap();
        assert!(!accept_at(d.path(), "skins/x.json", poison.to_string().as_bytes(), NOW + 60_000));
        assert!(fs::read_to_string(d.path().join("skins/x.json")).unwrap().contains("edited"));
    }

    #[test]
    fn a_file_stamped_at_the_limit_can_still_be_edited() {
        let d = tempfile::tempdir().unwrap();
        // Written before stamps were checked: the next edit must not overflow.
        let poisoned = serde_json::json!({ "name": "poisoned", "updated": i64::MAX });
        fs::write(d.path().join("appearance.json"), poisoned.to_string()).unwrap();
        write_at(d.path(), "appearance.json", serde_json::json!({ "name": "mine" }), NOW).unwrap();
        let stamp = stamp_of(&read(d.path(), "appearance.json").unwrap()).unwrap();
        assert_eq!(stamp, NOW + MAX_SKEW_MS);
        // A peer's ordinary edit a second later gets through again.
        let later = serde_json::json!({ "name": "peer", "updated": NOW + 1_000 + MAX_SKEW_MS });
        assert!(accept_at(d.path(), "appearance.json", later.to_string().as_bytes(), NOW + 1_000));
    }
}
