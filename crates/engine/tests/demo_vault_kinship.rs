//! The demo vault's patriarchs (ADR 0024): the Family section, its Tutorial
//! and the Cypress walks read Jacob's family, so every tie must be readable
//! and none reported. Opened on a copy, never the checked-in folder.

use engine::kinship::Relation;
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
fn the_patriarchs_kinship_reads_without_a_warning() {
    let demo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/demo-vault");
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    copy(&demo, &root);
    let v = Vault::open(&root, &dir.path().join("data"), engine::scripture::Lang::En).unwrap();
    let k = match v.query(Query::Kinship).unwrap() {
        Answer::Kinship(k) => k,
        other => panic!("{other:?}"),
    };
    assert!(k.warnings.is_empty(), "{:?}", k.warnings);
    let named = |who: &str, rel: Relation| -> Vec<&str> {
        k.edges
            .iter()
            .filter(|e| e.character.title == who && e.relation == rel)
            .map(|e| e.kin.title.as_str())
            .collect()
    };
    assert_eq!(named("Jacob", Relation::Father), ["Isaac"]);
    assert_eq!(named("Jacob", Relation::Mother), ["Rebekah"]);
    assert_eq!(
        named("Jacob", Relation::Spouse),
        ["Leah", "Rachel", "Bilhah", "Zilpah"]
    );
    // Isaac names neither of his sons, nor his wife: their files name him.
    assert!(named("Isaac", Relation::Spouse).is_empty());
    let mut children: Vec<&str> = k
        .edges
        .iter()
        .filter(|e| e.kin.title == "Isaac" && e.relation == Relation::Father)
        .map(|e| e.character.title.as_str())
        .collect();
    children.sort();
    assert_eq!(children, ["Esau", "Jacob"]);
    // Every mother of Jacob's children is one of his spouses.
    let mut mothers: Vec<&str> = k
        .edges
        .iter()
        .filter(|e| e.relation == Relation::Mother)
        .filter(|e| named(&e.character.title, Relation::Father) == ["Jacob"])
        .map(|e| e.kin.title.as_str())
        .collect();
    mothers.sort();
    mothers.dedup();
    assert_eq!(mothers, ["Bilhah", "Leah", "Rachel", "Zilpah"]);
}
