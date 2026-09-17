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
