//! The demo vault's region (ADR 0023): the Tutorials and the Cypress walks
//! ask "prophets in Judah", so Judah's Border must take in the Places they
//! name. Opened on a copy, never the checked-in folder.

use engine::query::{Answer, Query};
use engine::vault::Vault;
use std::fs;
use std::path::Path;

fn copy(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for e in fs::read_dir(from).unwrap().flatten() {
        let name = e.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let (src, dst) = (e.path(), to.join(&name));
        if src.is_dir() {
            copy(&src, &dst);
        } else {
            fs::copy(&src, &dst).unwrap();
        }
    }
}

#[test]
fn judah_takes_in_the_places_inside_its_border() {
    let demo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/demo-vault");
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    copy(&demo, &root);
    let v = Vault::open(&root, &dir.path().join("data"), engine::scripture::Lang::En).unwrap();
    let title = |id: &str| v.get(id).unwrap().unwrap().title;
    let members = match v.query(Query::Regions).unwrap() {
        Answer::Regions(r) => r,
        other => panic!("{other:?}"),
    };
    let mut inside: Vec<String> = members
        .iter()
        .filter(|m| title(&m.region) == "Judah")
        .map(|m| title(&m.place))
        .collect();
    inside.sort();
    assert_eq!(inside, ["Anathoth", "Bethlehem", "Gethsemane", "Jerusalem"]);
    // Egypt and Patmos are regions without a Border: they contain nothing.
    assert!(members.iter().all(|m| title(&m.region) == "Judah"));
}
