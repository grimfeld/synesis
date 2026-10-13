//! A Vault in iCloud Drive, as iOS keeps it: files the system decided were
//! not needed are evicted and replaced by `.name.icloud` placeholders (see
//! `engine::cloud`). None of these may read as a deleted document.
use engine::document::DocType;
use engine::meta::{check_join, JoinCheck, VaultMeta};
use engine::scripture::Lang;
use engine::Vault;
use serde_json::Map;
use std::fs;
use std::path::{Path, PathBuf};

fn open(root: &Path, data: &Path) -> Vault {
    Vault::open(root, data, Lang::En).unwrap()
}

/// What iCloud does to a file it evicts: the file goes, a placeholder appears.
fn evict(file: &Path) -> PathBuf {
    let ph = engine::cloud::placeholder_of(file).unwrap();
    fs::write(&ph, b"bplist00 placeholder").unwrap();
    fs::remove_file(file).unwrap();
    ph
}

/// What iCloud does when the download finishes.
fn restore(file: &Path, text: &str) {
    fs::write(file, text).unwrap();
    let _ = fs::remove_file(engine::cloud::placeholder_of(file).unwrap());
}

fn setup() -> (tempfile::TempDir, PathBuf, Vault) {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let v = open(&root, &tmp.path().join("dev"));
    (tmp, root, v)
}

#[test]
fn an_evicted_document_stays_indexed_and_untouched() {
    let (_tmp, root, mut v) = setup();
    let doc = v.create(DocType::Note, "Grace", &Map::new(), "Kept.").unwrap();
    let id = doc.summary.id.clone();
    let file = root.join(&doc.summary.path);
    let text = fs::read_to_string(&file).unwrap();
    let ph = evict(&file);

    // A rescan neither forgets it nor indexes the placeholder.
    v.scan().unwrap();
    assert!(v.get(&id).unwrap().is_some(), "an evicted document is not a deleted one");
    assert_eq!(v.list(None).unwrap().iter().filter(|d| d.path.contains(".icloud")).count(), 0);
    // The watcher's removal event keeps it too.
    assert!(!v.vanished(&doc.summary.path).unwrap());
    assert!(v.get(&id).unwrap().is_some());
    assert_eq!(v.evicted(), vec![file.clone()]);

    // Nothing writes over it, renames it or deletes it while it is away.
    assert!(v.read(&id).is_err());
    assert!(v.write(&id, "overwrite").is_err());
    assert!(v.rename(&id, "Mercy").is_err());
    assert!(v.delete(&id).is_err());
    assert!(ph.is_file(), "the placeholder is iCloud's and is never removed");
    assert!(!file.exists(), "nothing was written beside the placeholder");

    // Its name is not free for a new document.
    let other = v.create(DocType::Note, "Grace", &Map::new(), "New.").unwrap();
    assert_ne!(other.summary.path, doc.summary.path);

    // Downloaded: indexed as ever.
    restore(&file, &text);
    v.scan().unwrap();
    assert!(v.read(&id).unwrap().text.contains("Kept."));
    assert!(v.evicted().is_empty());
}

#[test]
fn a_document_that_is_really_gone_is_forgotten() {
    let (_tmp, root, mut v) = setup();
    let doc = v.create(DocType::Note, "Gone", &Map::new(), "x").unwrap();
    fs::remove_file(root.join(&doc.summary.path)).unwrap();
    assert!(v.vanished(&doc.summary.path).unwrap());
    v.scan().unwrap();
    assert!(v.get(&doc.summary.id).unwrap().is_none());
}

#[test]
fn remote_edits_wait_for_an_evicted_file_instead_of_writing_beside_it() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let mut a = open(&root, &tmp.path().join("devA"));
    let mut b = open(&root, &tmp.path().join("devB"));
    let doc = a.create(DocType::Note, "Shared", &Map::new(), "Base.").unwrap();
    let id = doc.summary.id.clone();
    let file = root.join(&doc.summary.path);
    b.apply_remote().unwrap();
    let base = b.read(&id).unwrap().text;

    // A edits; on B's side iCloud has evicted the file.
    a.write(&id, &format!("{base}From A.\n")).unwrap();
    let old = fs::read_to_string(&file).unwrap();
    let ph = evict(&file);
    b.apply_remote().unwrap();
    assert!(!file.exists(), "the merge is not written beside the placeholder");
    assert!(ph.is_file());
    assert!(b.get(&id).unwrap().is_some());

    // iCloud brings back a copy older than A's snapshot (it keeps the file's
    // own modification date): the merged text wins once it is here.
    let _ = old;
    restore(&file, &base);
    let an_hour_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    fs::File::options().write(true).open(&file).unwrap().set_modified(an_hour_ago).unwrap();
    b.scan().unwrap();
    assert!(b.read(&id).unwrap().text.contains("From A."));
}

#[test]
fn an_evicted_snapshot_is_never_written_over_and_is_published_once_back() {
    let (_tmp, root, mut v) = setup();
    let doc = v.create(DocType::Note, "Snap", &Map::new(), "One.").unwrap();
    let id = doc.summary.id.clone();
    let dev = v.device_id().unwrap().to_string();
    let snap = root.join(".bible-study/sync").join(&dev).join(format!("{id}.loro"));
    let before = fs::read(&snap).unwrap();
    let ph = evict(&snap);
    assert!(v.evicted().contains(&snap));
    // Counted as published: publish_missing must not write over it either.
    assert_eq!(v.publish_missing().unwrap(), 0);

    let text = v.read(&id).unwrap().text;
    v.write(&id, &format!("{text}Two.\n")).unwrap();
    assert!(!snap.exists(), "the publish waits for the snapshot to come back");
    assert!(ph.is_file());

    // Back from iCloud: the next import round publishes the held-back state.
    fs::write(&snap, &before).unwrap();
    fs::remove_file(&ph).unwrap();
    v.apply_remote().unwrap();
    assert_ne!(fs::read(&snap).unwrap(), before, "the newer snapshot went out");
}

#[test]
fn an_evicted_vault_identity_is_not_replaced() {
    let (tmp, root, v) = setup();
    let id = v.meta().id.clone();
    drop(v);
    let meta = root.join(".bible-study/vault.json");
    let ph = evict(&meta);
    // Opening waits rather than inventing a second identity (ADR 0014).
    assert!(Vault::open(&root, &tmp.path().join("dev"), Lang::En).is_err());
    assert!(VaultMeta::adopt(&root).is_err());
    assert!(!meta.exists() && ph.is_file());
    // Nor may another Vault be joined into it.
    assert!(matches!(check_join(&root, "SOMETHING-ELSE"), JoinCheck::Occupied { .. }));
    restore(&meta, &format!("{{\"id\":\"{id}\",\"name\":\"vault\"}}"));
    assert_eq!(open(&root, &tmp.path().join("dev")).meta().id, id);
}
