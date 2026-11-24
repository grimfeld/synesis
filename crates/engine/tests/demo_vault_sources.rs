//! The demo vault's Composition drawing on a Source (spec #205): "Talk on
//! endurance" draws on "Keep Enduring with Joy", and at least one Clipping is
//! a Candidate only through it. Opened on a copy, never the checked-in folder.

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
fn talk_on_endurance_has_a_clipping_only_through_its_source() {
    let demo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/demo-vault");
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    copy(&demo, &root);
    let v = Vault::open(&root, &dir.path().join("data"), engine::scripture::Lang::En).unwrap();
    let talk = v.resolve("Talk on endurance").unwrap().unwrap();
    let c = v.candidates(&talk.id).unwrap();
    assert_eq!(c.sources.len(), 1);
    let source = c.sources[0].doc.as_ref().expect("the Source resolves");
    assert_eq!(source.title, "Keep Enduring with Joy");
    let only_through_it: Vec<&str> = c
        .items
        .iter()
        .filter(|x| {
            x.doc.doc_type == engine::document::DocType::Clipping
                && !x.used
                && x.shared_tags.is_empty()
                && x.shared_passages.is_empty()
                && x.shared_sources == ["Keep Enduring with Joy"]
        })
        .map(|x| x.doc.id.as_str())
        .collect();
    assert!(!only_through_it.is_empty(), "{:?}", c.items);
    // The Source's page lists the talk in its backlinks.
    let back = v.backlinks(&source.id).unwrap();
    assert!(back.iter().any(|b| b.doc.id == talk.id));
}
