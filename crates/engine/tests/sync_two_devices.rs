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
    let doc = a.create(DocType::Note, "Shared", &Map::new(), "Base line.").unwrap();
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
    assert!(!fs::read_to_string(root.join("Notes/Shared.md")).unwrap().contains("A line"));

    // Sync: each device imports the other's snapshot; the merged text is materialised.
    let changed = a.apply_remote().unwrap();
    assert_eq!(changed.len(), 1);
    let merged_a = a.read(&id).unwrap().text;
    assert!(merged_a.contains("A line.") && merged_a.contains("B line."), "{merged_a}");
    b.apply_remote().unwrap();
    let merged_b = b.read(&id).unwrap().text;
    assert_eq!(merged_a, merged_b);
    assert_eq!(fs::read_to_string(root.join("Notes/Shared.md")).unwrap(), merged_a);

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
    let id = a.create(DocType::Concept, "Grace", &Map::new(), "Undeserved kindness.").unwrap().summary.id;
    let mut b = open(&root, &tmp.path().join("devB"));
    assert!(b.get(&id).unwrap().is_some());

    a.rename(&id, "Undeserved kindness").unwrap();
    // Simulate the provider having synced only the snapshot, not yet the rename.
    b.apply_remote().unwrap();
    assert_eq!(b.get(&id).unwrap().unwrap().path, "Concepts/Undeserved kindness.md");
    assert!(root.join("Concepts/Undeserved kindness.md").exists());

    a.delete(&id).unwrap();
    b.apply_remote().unwrap();
    assert!(b.get(&id).unwrap().is_none());
    assert!(!root.join("Concepts/Undeserved kindness.md").exists());
}

#[test]
fn stale_file_is_replaced_by_newer_snapshot() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let mut a = open(&root, &tmp.path().join("devA"));
    let id = a.create(DocType::Note, "N", &Map::new(), "v1").unwrap().summary.id;
    let mut b = open(&root, &tmp.path().join("devB"));
    // A edits; the provider delivers A's snapshot but the markdown file is still the old one.
    let old = fs::read_to_string(root.join("Notes/N.md")).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    a.write(&id, &old.replace("v1", "v2")).unwrap();
    fs::write(root.join("Notes/N.md"), &old).unwrap();
    // Make the stale file older than the snapshot.
    let past = filetime_ago(2);
    let _ = std::process::Command::new("touch").arg("-t").arg(&past).arg(root.join("Notes/N.md")).status();
    b.scan().unwrap();
    assert!(b.read(&id).unwrap().text.contains("v2"));
}

fn filetime_ago(minutes: i64) -> String {
    let t = chrono::Local::now() - chrono::Duration::minutes(minutes);
    t.format("%Y%m%d%H%M.%S").to_string()
}
