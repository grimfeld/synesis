//! Two devices sharing one folder (what a cloud-synced vault looks like once
//! the provider has copied everything). Each device has its own data dir.
use engine::canvas::{Canvas, Node, NodeKind};
use engine::document::DocType;
use engine::query::{Answer, Query};
use engine::scripture::Lang;
use engine::Vault;
use serde_json::Map;
use std::fs;

/// The Compositions whose Board holds this document, through the one read seam.
fn boards_referencing(v: &Vault, id: &str) -> Vec<engine::index::DocSummary> {
    match v.query(Query::BoardsReferencing { id: id.to_string() }).unwrap() {
        Answer::Docs(d) => d,
        other => panic!("unexpected answer: {other:?}"),
    }
}

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
    // The file name is the lowercased title, so ask the document for its path
    // rather than guessing (case matters on Linux).
    let file = root.join(&doc.summary.path);
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
    assert!(!fs::read_to_string(&file).unwrap().contains("A line"));

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
    assert_eq!(fs::read_to_string(&file).unwrap(), merged_a);

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
    let summary = a
        .create(DocType::Note, "N", &Map::new(), "v1")
        .unwrap()
        .summary;
    let (id, file) = (summary.id, root.join(&summary.path));
    let mut b = open(&root, &tmp.path().join("devB"));
    // A edits; the provider delivers A's snapshot but the markdown file is still the old one.
    let old = fs::read_to_string(&file).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    a.write(&id, &old.replace("v1", "v2")).unwrap();
    fs::write(&file, &old).unwrap();
    // Make the stale file older than the snapshot.
    let past = filetime_ago(2);
    let _ = std::process::Command::new("touch")
        .arg("-t")
        .arg(&past)
        .arg(&file)
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
    let b = open(&root, &tmp.path().join("devB"));
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

/// Two Devices drag two different nodes of the same Board while offline.
/// Both drags must survive: this is the whole reason a Board is a node-keyed
/// map rather than text (ADR 0009).
#[test]
fn concurrent_drags_of_different_nodes_both_win() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let (da, db) = (tmp.path().join("devA"), tmp.path().join("devB"));

    let mut a = open(&root, &da);
    let doc = a
        .create(DocType::Composition, "Talk", &Map::new(), "Body.")
        .unwrap();
    let id = doc.summary.id.clone();

    let mut board = Canvas::default();
    board.nodes.push(Node::new("n1", NodeKind::Text, 0, 0, 200, 100));
    board.nodes.push(Node::new("n2", NodeKind::Text, 400, 0, 200, 100));
    a.write_board(&id, &board).unwrap();

    // B comes online and sees the Board.
    let mut b = open(&root, &db);
    let on_b = b.read_board(&id).unwrap().unwrap();
    assert_eq!(on_b.nodes.len(), 2);

    // Offline: A drags n1 down, B drags n2 up. B's file write clobbers A's.
    let mut ba = a.read_board(&id).unwrap().unwrap();
    ba.nodes[0].y = 500;
    a.write_board(&id, &ba).unwrap();

    let mut bb = b.read_board(&id).unwrap().unwrap();
    bb.nodes[1].y = -500;
    b.write_board(&id, &bb).unwrap();

    a.apply_remote().unwrap();
    b.apply_remote().unwrap();

    let merged = a.read_board(&id).unwrap().unwrap();
    assert_eq!(merged.node("n1").unwrap().y, 500, "A's drag lost");
    assert_eq!(merged.node("n2").unwrap().y, -500, "B's drag lost");

    // And the two Devices agree.
    let merged_b = b.read_board(&id).unwrap().unwrap();
    assert_eq!(merged.node("n1").unwrap().y, merged_b.node("n1").unwrap().y);
    assert_eq!(merged.node("n2").unwrap().y, merged_b.node("n2").unwrap().y);
}

/// A Board edited in Obsidian is folded in structurally, and the fields
/// Synesis does not understand survive (PLAN §17.8, §17.14).
#[test]
fn an_external_edit_folds_in_and_keeps_unknown_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let mut a = open(&root, &tmp.path().join("devA"));
    let doc = a
        .create(DocType::Composition, "Talk", &Map::new(), "Body.")
        .unwrap();
    let id = doc.summary.id.clone();

    let mut board = Canvas::default();
    board.nodes.push(Node::new("n1", NodeKind::Text, 0, 0, 200, 100));
    a.write_board(&id, &board).unwrap();

    // Obsidian adds a node carrying a key this app knows nothing about.
    let file = root.join(engine::canvas::board_path(&doc.summary.path));
    let raw = fs::read_to_string(&file).unwrap();
    let mut parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    parsed["nodes"].as_array_mut().unwrap().push(serde_json::json!({
        "id": "n2", "type": "text", "text": "added in Obsidian",
        "x": 300, "y": 0, "width": 200, "height": 100,
        "styleAttributes": {"shape": "diamond"}
    }));
    fs::write(&file, serde_json::to_string_pretty(&parsed).unwrap()).unwrap();

    let board = a.read_board(&id).unwrap().unwrap();
    assert_eq!(board.nodes.len(), 2, "external node not folded in");
    let n2 = board.node("n2").unwrap();
    assert_eq!(n2.text.as_deref(), Some("added in Obsidian"));
    assert_eq!(n2.extra["styleAttributes"]["shape"], "diamond");

    // Saving from Synesis must not destroy the key it never understood.
    a.write_board(&id, &board).unwrap();
    let after = fs::read_to_string(&file).unwrap();
    assert!(after.contains("diamond"), "unknown field destroyed on save");
}

/// A node deleted on one Device is deleted everywhere, rather than coming
/// back from the other Device's copy of the map.
#[test]
fn a_deleted_node_stays_deleted_after_sync() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let (da, db) = (tmp.path().join("devA"), tmp.path().join("devB"));

    let mut a = open(&root, &da);
    let doc = a
        .create(DocType::Composition, "Talk", &Map::new(), "Body.")
        .unwrap();
    let id = doc.summary.id.clone();

    let mut board = Canvas::default();
    board.nodes.push(Node::new("n1", NodeKind::Text, 0, 0, 200, 100));
    board.nodes.push(Node::new("n2", NodeKind::Text, 400, 0, 200, 100));
    a.write_board(&id, &board).unwrap();

    let mut b = open(&root, &db);
    assert_eq!(b.read_board(&id).unwrap().unwrap().nodes.len(), 2);

    let mut ba = a.read_board(&id).unwrap().unwrap();
    ba.nodes.retain(|n| n.id != "n2");
    a.write_board(&id, &ba).unwrap();

    b.apply_remote().unwrap();
    let on_b = b.read_board(&id).unwrap().unwrap();
    assert_eq!(on_b.nodes.len(), 1, "deleted node came back");
    assert!(on_b.node("n2").is_none());
}

/// A Composition that never got a Board writes no `.canvas` file: opening the
/// Board tab must not litter the vault.
#[test]
fn an_empty_board_writes_no_file() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let mut a = open(&root, &tmp.path().join("devA"));
    let doc = a
        .create(DocType::Composition, "Talk", &Map::new(), "Body.")
        .unwrap();
    let id = doc.summary.id.clone();

    assert!(a.read_board(&id).unwrap().is_none());
    a.write_board(&id, &Canvas::default()).unwrap();
    assert!(!root.join(engine::canvas::board_path(&doc.summary.path)).exists());
    assert!(a.read_board(&id).unwrap().is_none());
}

/// Renaming a document rewrites the `file` nodes of every Board that pointed
/// at it, and a Composition's own Board follows it (PLAN §16.13).
#[test]
fn renaming_follows_boards() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let mut a = open(&root, &tmp.path().join("devA"));

    let note = a
        .create(DocType::Note, "Steadfast", &Map::new(), "On endurance.")
        .unwrap();
    let comp = a
        .create(DocType::Composition, "Talk", &Map::new(), "Body.")
        .unwrap();
    let (note_id, comp_id) = (note.summary.id.clone(), comp.summary.id.clone());

    let mut board = Canvas::default();
    let mut n = Node::new("n1", NodeKind::File, 0, 0, 300, 120);
    n.file = Some(note.summary.path.clone());
    board.nodes.push(n);
    a.write_board(&comp_id, &board).unwrap();

    // The Note is on the Board, and the Composition is findable from the Note.
    assert_eq!(boards_referencing(&a, &note_id).len(), 1);

    // Rename the Note: the node must follow it, not dangle.
    let renamed = a.rename(&note_id, "Steadfastness").unwrap();
    assert_ne!(renamed.summary.path, note.summary.path);
    let after = a.read_board(&comp_id).unwrap().unwrap();
    assert_eq!(
        after.node("n1").unwrap().file.as_deref(),
        Some(renamed.summary.path.as_str()),
        "board node left pointing at the old path"
    );
    assert_eq!(boards_referencing(&a, &note_id).len(), 1);

    // Rename the Composition: its own Board file moves with it.
    let moved = a.rename(&comp_id, "Talk on endurance").unwrap();
    assert!(
        root.join(engine::canvas::board_path(&moved.summary.path)).exists(),
        "board file did not follow its Composition"
    );
    assert!(!root.join(engine::canvas::board_path(&comp.summary.path)).exists());
    assert_eq!(a.read_board(&comp_id).unwrap().unwrap().nodes.len(), 1);
}

/// A document deleted out from under a Board leaves its node in place, to be
/// rendered as missing. Never silently remove what the user placed.
#[test]
fn deleting_a_target_leaves_the_node_as_missing() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let mut a = open(&root, &tmp.path().join("devA"));

    let note = a
        .create(DocType::Note, "Steadfast", &Map::new(), "On endurance.")
        .unwrap();
    let comp = a
        .create(DocType::Composition, "Talk", &Map::new(), "Body.")
        .unwrap();
    let comp_id = comp.summary.id.clone();

    let mut board = Canvas::default();
    let mut n = Node::new("n1", NodeKind::File, 0, 0, 300, 120);
    n.file = Some(note.summary.path.clone());
    board.nodes.push(n);
    a.write_board(&comp_id, &board).unwrap();

    a.delete(&note.summary.id).unwrap();

    let after = a.read_board(&comp_id).unwrap().unwrap();
    assert_eq!(after.nodes.len(), 1, "node removed when its target was deleted");
    assert_eq!(
        after.node("n1").unwrap().file.as_deref(),
        Some(note.summary.path.as_str())
    );
    // The ref itself is gone from the index: it names no document any more.
    assert!(boards_referencing(&a, &note.summary.id).is_empty());
}

/// Deleting a Composition takes its Board with it.
#[test]
fn deleting_a_composition_removes_its_board() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let mut a = open(&root, &tmp.path().join("devA"));
    let comp = a
        .create(DocType::Composition, "Talk", &Map::new(), "Body.")
        .unwrap();

    let mut board = Canvas::default();
    board.nodes.push(Node::new("n1", NodeKind::Text, 0, 0, 200, 100));
    a.write_board(&comp.summary.id, &board).unwrap();
    let file = root.join(engine::canvas::board_path(&comp.summary.path));
    assert!(file.exists());

    a.delete(&comp.summary.id).unwrap();
    assert!(!file.exists(), "board outlived its Composition");
}

/// Opening a Vault whose index was written before Boards existed. This is the
/// upgrade path a user takes on installing a new release, and it reaches the
/// schema through `Vault::open` rather than `Index::open` alone.
#[test]
fn a_vault_indexed_by_an_older_build_still_opens() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    let data = tmp.path().join("data");
    fs::create_dir_all(&root).unwrap();

    // A vault with one Note and one Clipping, indexed by the current build.
    let clipping_id = {
        let mut v = open(&root, &data);
        v.create(DocType::Note, "Steadfast", &Map::new(), "On endurance.")
            .unwrap();
        let mut fields = Map::new();
        fields.insert("source".into(), "[[The Watchtower]]".into());
        fields.insert("locator".into(), "par. 12".into());
        v.create(
            DocType::Clipping,
            "",
            &fields,
            "> Endurance is remaining steadfast.",
        )
        .unwrap()
        .summary
        .id
    };

    // Rewrite `links` the way a pre-Boards build had it: no `kind` column.
    let index = engine::vault::local_dir_for(&data, &root).join("index.sqlite");
    {
        let conn = rusqlite::Connection::open(&index).unwrap();
        conn.execute_batch(
            "DROP INDEX IF EXISTS links_kind;
             CREATE TABLE links_old(from_id TEXT NOT NULL, target TEXT NOT NULL, norm TEXT NOT NULL,
               alias TEXT, embed INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
               property TEXT);
             INSERT INTO links_old SELECT from_id, target, norm, alias, embed, start, end, property FROM links;
             DROP TABLE links;
             ALTER TABLE links_old RENAME TO links;",
        )
        .unwrap();
        // And drop `documents.label`, the way a build before ADR 0013 had it.
        conn.execute_batch("ALTER TABLE documents DROP COLUMN label")
            .unwrap();
    }

    // The upgrade: opening it must migrate rather than fail.
    let mut v = open(&root, &data);
    assert!(!v.list(None).unwrap().is_empty(), "vault came back empty");
    // The backfill: a Note labels itself with its title, a Clipping with its
    // own words, without re-reading a single file (ADR 0013).
    let labelled = v.list(None).unwrap();
    let note = labelled.iter().find(|d| d.title == "Steadfast").unwrap();
    assert_eq!(note.label, "Steadfast");
    let clip = labelled.iter().find(|d| d.id == clipping_id).unwrap();
    assert_eq!(clip.label, "Endurance is remaining steadfast.");

    // And Boards work on it afterwards.
    let comp = v
        .create(DocType::Composition, "Talk", &Map::new(), "Body.")
        .unwrap();
    let mut board = Canvas::default();
    board.nodes.push(Node::new("n1", NodeKind::Text, 0, 0, 200, 100));
    v.write_board(&comp.summary.id, &board).unwrap();
    assert_eq!(v.read_board(&comp.summary.id).unwrap().unwrap().nodes.len(), 1);
}

// ---- a retired Device's folder (step 1 of removing a Vault from a Device) ---

/// Write the pairing roster `sync::Roster` reads, marking `removed` as retired.
///
/// The real one is written by `p2p::Membership`; only the removed device ids
/// matter here, and `#[serde(default)]` on the rest is what lets this be small.
fn retire(data: &std::path::Path, root: &std::path::Path, removed: &[&str]) {
    let local = engine::vault::local_dir_for(data, root);
    fs::create_dir_all(&local).unwrap();
    let json = serde_json::json!({ "removed_devices": removed });
    fs::write(local.join("pairing.json"), json.to_string()).unwrap();
}

/// The bug this exists for: a phone left the Vault, its snapshots stayed in
/// `sync/`, and the next device to open the Vault materialised documents the
/// Vault no longer had. A folder is not a claim.
#[test]
fn a_retired_devices_snapshots_are_not_imported() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let (da, db) = (tmp.path().join("devA"), tmp.path().join("devB"));

    // B publishes a document, then its folder is all that is left of it.
    let mut b = open(&root, &db);
    let doc = b.create(DocType::Note, "From the phone", &Map::new(), "Gone.").unwrap();
    let id = doc.summary.id.clone();
    let path = doc.summary.path.clone();
    let retired = b.device_id().unwrap().to_string();
    drop(b);
    // The document is removed from the Vault the way losing the phone leaves it:
    // the file is gone, the snapshot is not.
    fs::remove_file(root.join(&path)).unwrap();
    assert!(root.join(engine::vault::HIDDEN_DIR).join("sync").join(&retired).join(format!("{id}.loro")).is_file());

    // A, with B retired, must not bring the file back.
    retire(&da, &root, &[&retired]);
    let mut a = open(&root, &da);
    assert!(a.apply_remote().unwrap().is_empty(), "a retired Device's snapshots were imported");
    assert!(!root.join(&path).exists(), "a retired Device's document was materialised");
    assert!(a.read(&id).is_err(), "a retired Device's document reached the index");
}

/// The other half: a Device that is merely unknown to the roster is still
/// trusted. That is what every folder-synced Vault looks like (no roster at
/// all), and what a Device paired while this one was offline looks like before
/// the two memberships meet.
#[test]
fn an_unknown_device_is_still_trusted() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let (da, db) = (tmp.path().join("devA"), tmp.path().join("devB"));

    let mut b = open(&root, &db);
    let doc = b.create(DocType::Note, "From a new device", &Map::new(), "Here.").unwrap();
    let id = doc.summary.id.clone();

    // A's roster names some other Device as retired, not B.
    retire(&da, &root, &["01SOMEOTHERDEVICE"]);
    let a = open(&root, &da);
    assert!(a.read(&id).unwrap().text.contains("Here."), "an unknown Device was refused");
}

/// A Vault with no roster is unpaired (Syncthing, iCloud, a plain folder) and
/// behaves exactly as it did before trust existed.
#[test]
fn without_a_roster_every_folder_is_trusted() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let (da, db) = (tmp.path().join("devA"), tmp.path().join("devB"));

    let mut b = open(&root, &db);
    let doc = b.create(DocType::Note, "Folder synced", &Map::new(), "Plain.").unwrap();
    let id = doc.summary.id.clone();

    let a = open(&root, &da);
    assert!(!engine::vault::local_dir_for(&da, &root).join("pairing.json").exists());
    assert!(a.read(&id).unwrap().text.contains("Plain."));
}

/// A removal that lands while the Vault is open takes effect on the next
/// import: the roster is re-read, not cached from open.
#[test]
fn a_removal_takes_effect_without_reopening_the_vault() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let (da, db) = (tmp.path().join("devA"), tmp.path().join("devB"));

    let mut b = open(&root, &db);
    let first = b.create(DocType::Note, "Before", &Map::new(), "Before.").unwrap();
    let retired = b.device_id().unwrap().to_string();

    // A opens unpaired and imports normally.
    let mut a = open(&root, &da);
    assert!(a.read(&first.summary.id).unwrap().text.contains("Before."));

    // B publishes again, and only then is it retired.
    let second = b.create(DocType::Note, "After", &Map::new(), "After.").unwrap();
    let second_path = second.summary.path.clone();
    fs::remove_file(root.join(&second_path)).unwrap();
    retire(&da, &root, &[&retired]);

    assert!(a.apply_remote().unwrap().is_empty(), "the roster was cached from open");
    assert!(!root.join(&second_path).exists());
}

/// Evicting a Device removes its folder from the Vault. Its documents stay:
/// a Device leaving takes its history with it, not the work.
#[test]
fn forgetting_a_device_removes_its_folder_and_keeps_the_documents() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let (da, db) = (tmp.path().join("devA"), tmp.path().join("devB"));

    let mut b = open(&root, &db);
    let doc = b.create(DocType::Note, "From the phone", &Map::new(), "Kept.").unwrap();
    let id = doc.summary.id.clone();
    let retired = b.device_id().unwrap().to_string();
    drop(b);

    let mut a = open(&root, &da);
    assert!(a.read(&id).unwrap().text.contains("Kept."), "A never saw the document");
    let folder = root.join(engine::vault::HIDDEN_DIR).join("sync").join(&retired);
    assert!(folder.is_dir());

    assert!(a.forget_device(&retired).unwrap(), "the folder was reported missing");
    assert!(!folder.exists(), "the retired Device's folder survived");
    assert!(a.read(&id).unwrap().text.contains("Kept."), "forgetting a Device took its documents");
    // Idempotent: nothing left to remove.
    assert!(!a.forget_device(&retired).unwrap());
}

/// Forgetting a Device drops what this one had imported from it, so nothing is
/// resumed from a stamp that no longer describes anything once the Device is
/// re-admitted. Re-admission itself is the pairing roster's business
/// (`p2p::Node::approve`); here the manifest is what must be clean.
#[test]
fn forgetting_a_device_clears_what_was_imported_from_it() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let (da, db) = (tmp.path().join("devA"), tmp.path().join("devB"));

    let mut b = open(&root, &db);
    let doc = b.create(DocType::Note, "Shared", &Map::new(), "First.").unwrap();
    let id = doc.summary.id.clone();
    let device = b.device_id().unwrap().to_string();

    let mut a = open(&root, &da);
    assert!(a.read(&id).unwrap().text.contains("First."));
    let manifest = engine::vault::local_dir_for(&da, &root).join("crdt").join("imported.json");
    assert!(fs::read_to_string(&manifest).unwrap().contains(&device), "A never recorded the import");

    a.forget_device(&device).unwrap();
    assert!(!fs::read_to_string(&manifest).unwrap().contains(&device), "the import manifest still names the forgotten Device");
}

/// A Device cannot forget itself: leaving a Vault is its own operation with
/// its own order, and doing it through this path would drop the folder while
/// the CRDT went on publishing into it.
#[test]
fn a_device_cannot_forget_itself() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let mut a = open(&root, &tmp.path().join("devA"));
    let me = a.device_id().unwrap().to_string();
    assert!(a.forget_device(&me).is_err());
    assert!(root.join(engine::vault::HIDDEN_DIR).join("sync").join(&me).is_dir());
}

// ---- leaving a Vault (step 3) ----------------------------------------------

/// Leaving without deleting: sync stops, the folder is left as Obsidian would
/// find it (ADR 0003), and the other Devices stop mirroring this one.
#[test]
fn leaving_a_vault_keeps_the_documents_and_withdraws_the_snapshots() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let (da, db) = (tmp.path().join("devA"), tmp.path().join("devB"));

    let mut a = open(&root, &da);
    let doc = a.create(DocType::Note, "My work", &Map::new(), "Mine.").unwrap();
    let file = root.join(&doc.summary.path);
    let leaving = a.device_id().unwrap().to_string();
    let own = root.join(engine::vault::HIDDEN_DIR).join("sync").join(&leaving);
    assert!(own.is_dir());
    let local = engine::vault::local_dir_for(&da, &root);
    assert!(local.is_dir());

    a.leave(false).unwrap();

    assert!(!own.exists(), "the leaving Device kept publishing into the Vault");
    assert!(!local.exists(), "this Device's state for the Vault survived");
    assert!(file.is_file(), "leaving took the documents with it");
    assert_eq!(fs::read_to_string(&file).unwrap().contains("Mine."), true);

    // B still has the Vault, and no longer sees A as a Device in it.
    let b = open(&root, &db);
    assert!(!b.devices().iter().any(|d| d.id == leaving), "the Vault still lists the Device that left");
}

/// Leaving with the documents: the Vault is gone from this Device entirely.
#[test]
fn leaving_a_vault_can_take_the_documents_too() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let da = tmp.path().join("devA");

    let mut a = open(&root, &da);
    a.create(DocType::Note, "My work", &Map::new(), "Mine.").unwrap();
    let local = engine::vault::local_dir_for(&da, &root);

    a.leave(true).unwrap();

    assert!(!root.exists(), "the Vault folder survived a leave that asked for it");
    assert!(!local.exists());
}

/// A Vault left and then reopened at the same folder is a fresh start for this
/// Device: no snapshots of its own, no imported history, and the documents
/// read from disk. It keeps its identity, because the folder is still the same
/// Vault (ADR 0014).
#[test]
fn a_vault_reopened_after_leaving_starts_clean() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let da = tmp.path().join("devA");

    let mut a = open(&root, &da);
    let doc = a.create(DocType::Note, "Kept", &Map::new(), "Still here.").unwrap();
    let id = doc.summary.id.clone();
    let was = a.meta().id.clone();
    a.leave(false).unwrap();

    let mut again = open(&root, &da);
    assert_eq!(again.meta().id, was, "reopening the folder invented a new Vault");
    assert!(again.read(&id).unwrap().text.contains("Still here."), "the document did not come back from disk");
    assert!(again.versions(&id).unwrap().is_empty(), "history survived leaving");
}

/// Eviction has to stick with sync switched off, which is exactly where a
/// stale folder sits unnoticed: the roster is written by the engine, not by a
/// running pairing node, so a folder that comes back is not trusted again.
#[test]
fn forgetting_a_device_survives_the_folder_coming_back() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let (da, db) = (tmp.path().join("devA"), tmp.path().join("devB"));

    let mut b = open(&root, &db);
    let doc = b.create(DocType::Note, "From the phone", &Map::new(), "Ghost.").unwrap();
    let id = doc.summary.id.clone();
    let path = doc.summary.path.clone();
    let retired = b.device_id().unwrap().to_string();
    let folder = root.join(engine::vault::HIDDEN_DIR).join("sync").join(&retired);
    let snapshot = folder.join(format!("{id}.loro"));
    let bytes = fs::read(&snapshot).unwrap();
    drop(b);

    let mut a = open(&root, &da);
    a.forget_device(&retired).unwrap();
    assert!(!folder.exists());

    // A provider (or a peer that had not merged the removal) puts it back, and
    // the document is gone from disk the way losing the phone leaves it.
    fs::create_dir_all(&folder).unwrap();
    fs::write(&snapshot, &bytes).unwrap();
    fs::remove_file(root.join(&path)).unwrap();

    assert!(a.apply_remote().unwrap().is_empty(), "a retired Device's folder was trusted again");
    assert!(!root.join(&path).exists(), "the ghost document came back");

    // And it is still refused by a Device opening the Vault afresh.
    let mut again = open(&root, &da);
    assert!(again.apply_remote().unwrap().is_empty(), "the retirement did not persist");
}

/// A paired Device whose clock runs ahead stamps its snapshots in this
/// Device's future (P2P keeps the sender's mtime). A save made through the app
/// is the user's newest text all the same: it must not be mistaken for a stale
/// copy and replaced by the older merged text. On Android this read as typing
/// that vanished, then a reload from disk with the caret at the start.
#[test]
fn a_save_survives_a_snapshot_from_a_clock_that_runs_ahead() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let a = open(&root, &tmp.path().join("devA"));
    let summary = {
        let mut a = a;
        let s = a
            .create(DocType::Note, "Skew", &Map::new(), "First.")
            .unwrap()
            .summary;
        // A edits once more so it has a published snapshot of its own.
        let text = a.read(&s.id).unwrap().text;
        a.write(&s.id, &text.replace("First.", "First, from A.")).unwrap();
        s
    };
    let (id, file) = (summary.id, root.join(&summary.path));

    let mut b = open(&root, &tmp.path().join("devB"));
    b.apply_remote().unwrap();
    // A's snapshots carry A's clock, a minute ahead of B's.
    let ahead = std::time::SystemTime::now() + std::time::Duration::from_secs(60);
    let sync_dir = root.join(engine::vault::HIDDEN_DIR).join("sync");
    for dev in fs::read_dir(&sync_dir).unwrap().flatten() {
        let snap = dev.path().join(format!("{id}.loro"));
        if dev.file_name().to_string_lossy() != b.device_id().unwrap() && snap.is_file() {
            fs::File::options()
                .write(true)
                .open(&snap)
                .unwrap()
                .set_modified(ahead)
                .unwrap();
        }
    }

    let before = b.read(&id).unwrap().text;
    let typed = before.replace("First, from A.", "First, from A. Then B typed this.");
    let saved = b.write(&id, &typed).unwrap();
    assert!(saved.text.contains("Then B typed this."), "{}", saved.text);
    assert!(
        fs::read_to_string(&file).unwrap().contains("Then B typed this."),
        "the save was replaced by the older merged text"
    );
    // A second save in the same window, with the CRDT now a step behind again.
    let more = typed.replace("typed this.", "typed this, and more.");
    b.write(&id, &more).unwrap();
    assert!(fs::read_to_string(&file).unwrap().contains("and more."));
}
