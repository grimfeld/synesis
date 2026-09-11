//! Two devices sharing one folder (what a cloud-synced vault looks like once
//! the provider has copied everything). Each device has its own data dir.
use engine::document::DocType;
use engine::scripture::Lang;
use engine::Vault;
use serde_json::Map;
use std::fs;

fn open(root: &std::path::Path, data: &std::path::Path) -> Vault {
    Vault::open(root, data, Lang::En).unwrap()
}

#[test]
fn concurrent_edits_merge_and_converge() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let (da, db) = (tmp.path().join("devA"), tmp.path().join("devB"));

    let mut a = open(&root, &da);
    let doc = a
        .create(DocType::Note, "Shared", &Map::new(), "Base line.")
        .unwrap();
    let id = doc.summary.id.clone();
    assert_ne!(a.device_id(), None);

    // B comes online, sees the file and A's snapshot.
    let mut b = open(&root, &db);
    assert_ne!(a.device_id(), b.device_id());
    let on_b = b.read(&id).unwrap();
    assert!(on_b.text.ends_with("Base line.\n"));

    // Both edit while "offline" (no import in between). B's file write clobbers A's.
    let base = on_b.text.clone();
    a.write(&id, &format!("{base}A line.\n")).unwrap();
    b.write(&id, &format!("{base}B line.\n")).unwrap();
    assert!(!fs::read_to_string(root.join("Notes/Shared.md"))
        .unwrap()
        .contains("A line"));

    // Sync: each device imports the other's snapshot; the merged text is materialised.
    let changed = a.apply_remote().unwrap();
    assert_eq!(changed.len(), 1);
    let merged_a = a.read(&id).unwrap().text;
    assert!(
        merged_a.contains("A line.") && merged_a.contains("B line."),
        "{merged_a}"
    );
    b.apply_remote().unwrap();
    let merged_b = b.read(&id).unwrap().text;
    assert_eq!(merged_a, merged_b);
    assert_eq!(
        fs::read_to_string(root.join("Notes/Shared.md")).unwrap(),
        merged_a
    );

    // Nothing more to import.
    assert!(a.apply_remote().unwrap().is_empty());
    assert!(b.apply_remote().unwrap().is_empty());
}

#[test]
fn rename_and_delete_propagate() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let mut a = open(&root, &tmp.path().join("devA"));
    let id = a
        .create(
            DocType::Concept,
            "Grace",
            &Map::new(),
            "Undeserved kindness.",
        )
        .unwrap()
        .summary
        .id;
    let mut b = open(&root, &tmp.path().join("devB"));
    assert!(b.get(&id).unwrap().is_some());

    a.rename(&id, "Undeserved kindness").unwrap();
    // Simulate the provider having synced only the snapshot, not yet the rename.
    b.apply_remote().unwrap();
    assert_eq!(
        b.get(&id).unwrap().unwrap().path,
        "Concepts/undeserved kindness.md"
    );
    assert!(root.join("Concepts/undeserved kindness.md").exists());

    a.delete(&id).unwrap();
    b.apply_remote().unwrap();
    assert!(b.get(&id).unwrap().is_none());
    assert!(!root.join("Concepts/undeserved kindness.md").exists());
}

#[test]
fn stale_file_is_replaced_by_newer_snapshot() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let mut a = open(&root, &tmp.path().join("devA"));
    let id = a
        .create(DocType::Note, "N", &Map::new(), "v1")
        .unwrap()
        .summary
        .id;
    let mut b = open(&root, &tmp.path().join("devB"));
    // A edits; the provider delivers A's snapshot but the markdown file is still the old one.
    let old = fs::read_to_string(root.join("Notes/N.md")).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    a.write(&id, &old.replace("v1", "v2")).unwrap();
    fs::write(root.join("Notes/N.md"), &old).unwrap();
    // Make the stale file older than the snapshot.
    let past = filetime_ago(2);
    let _ = std::process::Command::new("touch")
        .arg("-t")
        .arg(&past)
        .arg(root.join("Notes/N.md"))
        .status();
    b.scan().unwrap();
    assert!(b.read(&id).unwrap().text.contains("v2"));
}

fn filetime_ago(minutes: i64) -> String {
    let t = chrono::Local::now() - chrono::Duration::minutes(minutes);
    t.format("%Y%m%d%H%M.%S").to_string()
}

#[test]
fn versions_travel_with_the_document() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let mut a = open(&root, &tmp.path().join("devA"));
    let id = a
        .create(DocType::Composition, "Talk", &Map::new(), "First draft.")
        .unwrap()
        .summary
        .id;
    let v1 = a.read(&id).unwrap().text;

    // Name the moment, then keep editing.
    let saved = a.save_version(&id, "As delivered").unwrap();
    assert_eq!(saved.label, "As delivered");
    a.write(&id, &v1.replace("First draft.", "Second draft."))
        .unwrap();
    let now = a.read(&id).unwrap().text;
    assert!(now.contains("Second draft."));

    // The Version still reads as the text of that moment; history has both moments.
    let list = a.versions(&id).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(a.text_at(&id, &list[0].frontier).unwrap(), v1);
    let hist = a.history(&id).unwrap();
    assert!(hist.len() >= 2, "{hist:?}");
    assert!(hist
        .iter()
        .any(|h| a.text_at(&id, &h.frontier).unwrap() == v1));
    assert_eq!(a.text_at(&id, &hist[0].frontier).unwrap(), now);

    // Another device sees the Version after importing the snapshot.
    let mut b = open(&root, &tmp.path().join("devB"));
    b.apply_remote().unwrap();
    let on_b = b.versions(&id).unwrap();
    assert_eq!(on_b, list);
    assert_eq!(b.text_at(&id, &on_b[0].frontier).unwrap(), v1);

    // Deleting on B reaches A; restoring is an ordinary new edit.
    b.delete_version(&id, &on_b[0].key).unwrap();
    a.apply_remote().unwrap();
    assert!(a.versions(&id).unwrap().is_empty());
    a.write(&id, &v1).unwrap();
    assert_eq!(a.read(&id).unwrap().text, v1);
    assert!(a.history(&id).unwrap().len() >= 3);
}

#[test]
fn newer_file_survives_a_first_import() {
    // The file was edited (by hand, or on a device that never imported the
    // snapshot) after the remote snapshot arrived: the edit must win and be
    // folded into the merged state, not overwritten by the older snapshot.
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let mut a = open(&root, &tmp.path().join("devA"));
    let id = a
        .create(DocType::Character, "David", &Map::new(), "Shepherd.")
        .unwrap()
        .summary
        .id;
    let path = root.join("Characters/david.md");
    let v1 = fs::read_to_string(&path).unwrap();

    // Hand edit after A's snapshot was published; make sure the file is newer.
    let v2 = v1.replace(
        "---
Shepherd.",
        "born: \"c. 1107 BCE\"
---
Shepherd.",
    );
    assert_ne!(v1, v2);
    fs::write(&path, &v2).unwrap();
    let later = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(later)
        .unwrap();

    // A device that has never seen this document opens the folder.
    let mut b = open(&root, &tmp.path().join("devB"));
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        v2,
        "file overwritten by stale snapshot"
    );
    assert_eq!(b.read(&id).unwrap().text, v2);

    // The edit reached B's history and therefore A after a sync.
    a.apply_remote().unwrap();
    assert_eq!(a.read(&id).unwrap().text, v2);
}
