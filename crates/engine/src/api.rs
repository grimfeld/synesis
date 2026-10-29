//! What the UI receives: the shapes the commands answer with, and the commands
//! whose work is more than a call on `Vault`.
//!
//! Shared by the Tauri shell and the browser test build (`crates/web`), so the
//! two cannot drift apart. Offsets here are UTF-16, which is what the editor
//! counts in; the engine itself works in bytes.

use crate::document::DocType;
use crate::index::{DocSummary, Linkable};
use crate::scripture::{Lang, Passage, Unit};
use crate::vault::DocumentView;
use crate::{parser, Vault};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize)]
pub struct PassageInfo {
    pub display: String,
    pub book: u8,
    pub start_chapter: u16,
    pub start_verse: Option<u16>,
    pub end_chapter: u16,
    pub end_verse: Option<u16>,
    pub unit: Unit,
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedRange {
    pub from: usize,
    pub to: usize,
    pub passages: Vec<PassageInfo>,
    pub inferred: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkRange {
    pub from: usize,
    pub to: usize,
    pub target: String,
    pub alias: Option<String>,
    pub embed: bool,
    pub property: Option<String>,
    pub resolved: Option<DocSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagRange {
    pub from: usize,
    pub to: usize,
    pub name: String,
    pub in_frontmatter: bool,
    pub resolved: Option<DocSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocumentPayload {
    pub summary: DocSummary,
    pub text: String,
    pub frontmatter: Map<String, Value>,
    pub body_offset: usize,
    pub links: Vec<LinkRange>,
    pub tags: Vec<TagRange>,
    pub references: Vec<DetectedRange>,
}

fn passage_info(p: &Passage, lang: Lang) -> PassageInfo {
    PassageInfo {
        display: p.display(lang),
        book: p.book,
        start_chapter: p.start_chapter,
        start_verse: p.start_verse,
        end_chapter: p.end_chapter,
        end_verse: p.end_verse,
        unit: p.unit(),
    }
}

/// A document as the editor draws it: text plus every decoration, resolved.
pub fn payload(v: &Vault, view: DocumentView) -> DocumentPayload {
    let text = &view.text;
    let u16 = |b: usize| parser::byte_to_utf16(text, b);
    let lang = v.lang();
    DocumentPayload {
        links: view
            .links
            .iter()
            .map(|l| LinkRange {
                from: u16(l.start),
                to: u16(l.end),
                target: l.target.clone(),
                alias: l.alias.clone(),
                embed: l.embed,
                property: l.property.clone(),
                resolved: v.resolve(&l.target).ok().flatten(),
            })
            .collect(),
        tags: view
            .tags
            .iter()
            .map(|t| TagRange {
                from: u16(t.start),
                to: u16(t.end),
                name: t.name.clone(),
                in_frontmatter: t.in_frontmatter,
                resolved: v.resolve(&t.name).ok().flatten(),
            })
            .collect(),
        references: view
            .references
            .iter()
            .map(|d| DetectedRange {
                from: u16(d.start),
                to: u16(d.end),
                passages: d.passages.iter().map(|p| passage_info(p, lang)).collect(),
                inferred: d.inferred,
            })
            .collect(),
        body_offset: u16(view.body_offset),
        summary: view.summary,
        text: view.text,
        frontmatter: view.frontmatter,
    }
}

/// Live detection for the editor: runs on the text as typed.
pub fn detect_passages(text: &str, lang: Lang) -> Vec<DetectedRange> {
    parser::detect(text)
        .into_iter()
        .map(|d| DetectedRange {
            from: parser::byte_to_utf16(text, d.start),
            to: parser::byte_to_utf16(text, d.end),
            passages: d.passages.iter().map(|p| passage_info(p, lang)).collect(),
            inferred: d.inferred,
        })
        .collect()
}

#[derive(Serialize)]
pub struct NameEntry {
    pub name: String,
    pub id: String,
    #[serde(rename = "type")]
    pub doc_type: DocType,
    pub alias: bool,
}

/// Every title and alias in the vault, for client-side link resolution and autocomplete.
pub fn names(v: &Vault) -> crate::Result<Vec<NameEntry>> {
    let mut out = Vec::new();
    for d in v.list(None)? {
        out.push(NameEntry {
            name: d.title.clone(),
            id: d.id.clone(),
            doc_type: d.doc_type,
            alias: false,
        });
        for a in v.aliases_of(&d.id)? {
            out.push(NameEntry {
                name: a,
                id: d.id.clone(),
                doc_type: d.doc_type,
                alias: true,
            });
        }
    }
    Ok(out)
}

/// Names in the text being written that could become Mentions.
///
/// Takes the live editor body rather than an id: what the writer is looking at
/// has usually not been saved yet, and the caller splices into this exact
/// string, so the offsets come back measured against it — in UTF-16, which is
/// what the editor counts in.
///
/// The body is passed without frontmatter, which is also why a Property
/// holding a name is never offered as prose.
pub fn linkables(v: &Vault, id: &str, text: &str) -> crate::Result<Vec<Linkable>> {
    let mut out = v.linkables(id, text)?;
    for l in &mut out {
        l.start = parser::byte_to_utf16(text, l.start);
        l.end = parser::byte_to_utf16(text, l.end);
    }
    Ok(out)
}

/// What one linking edit restored, so a batch can be undone.
#[derive(Serialize)]
pub struct LinkedEdit {
    pub id: String,
    /// The document's text before the edit.
    pub before: String,
}

/// The outcome of linking one or more Unlinked mentions.
#[derive(Serialize)]
pub struct LinkResult {
    /// Documents actually rewritten, with the text to restore on undo.
    pub linked: Vec<LinkedEdit>,
    /// Documents skipped because the file had changed since it was indexed.
    pub skipped: Vec<String>,
}

/// One Unlinked mention to link, as the panel lists it.
#[derive(Deserialize)]
pub struct MentionRef {
    pub doc_id: String,
    pub start: usize,
    pub end: usize,
    /// The matched text, checked against the file before anything is written.
    pub matched: String,
}

/// Link some Unlinked mentions of `target_id`.
///
/// One call whether the user clicked a single row or "Link all": a batch that
/// hits a stale offset skips that document and carries on rather than aborting
/// half-done, and reports what it skipped (ADR 0011).
pub fn link_mentions(v: &mut Vault, target_id: &str, mentions: &[MentionRef]) -> LinkResult {
    let mut linked = Vec::new();
    let mut skipped = Vec::new();
    for m in mentions {
        match v.link_mention(&m.doc_id, m.start, m.end, &m.matched, target_id) {
            Ok(before) => linked.push(LinkedEdit {
                id: m.doc_id.clone(),
                before,
            }),
            Err(_) => skipped.push(m.doc_id.clone()),
        }
    }
    LinkResult { linked, skipped }
}

/// Materialise (and return) the page for a Scripture unit, e.g. when the user
/// clicks a detected Passage that has not been written on yet.
pub fn ensure_scripture_page(
    v: &mut Vault,
    book: u8,
    chapter: Option<u16>,
    verse: Option<u16>,
) -> crate::Result<DocSummary> {
    let p = match (chapter, verse) {
        (None, _) => Passage::whole_book(book),
        (Some(c), None) => Passage::chapter(book, c),
        (Some(c), Some(vs)) => Passage::verse(book, c, vs),
    };
    v.materialise(&[p])?;
    v.scripture_doc(book, chapter, verse)?
        .ok_or_else(|| crate::Error::NotFound("scripture page".into()))
}

#[derive(Serialize)]
pub struct BookMeta {
    pub number: u8,
    pub name: String,
    pub english: String,
    pub chapters: Vec<u16>,
    pub hebrew_aramaic: bool,
}

pub fn books(lang: Lang) -> Vec<BookMeta> {
    crate::versification::BOOKS
        .iter()
        .map(|b| BookMeta {
            number: b.number,
            name: crate::names::book_name(b.number, lang).to_string(),
            english: b.english.to_string(),
            chapters: b.chapters.to_vec(),
            hebrew_aramaic: crate::scripture::is_hebrew_aramaic(b.number),
        })
        .collect()
}

/// Copy a dropped, pasted or picked picture into `Attachments/` and return the
/// vault-relative path to write inside `![[…]]` (ADR 0019). `title` is the
/// document the Picture goes into; `file_name` only lends its extension.
pub fn attach_picture(
    root: &std::path::Path,
    title: &str,
    file_name: &str,
    data: &str,
) -> crate::Result<String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| crate::Error::Invalid(format!("not an image: {e}")))?;
    let now = chrono::Local::now().naive_local();
    crate::attachments::store_picture(root, title, file_name, &bytes, now)
}

/// A Picture's file as a data URL, or `None` when the vault does not hold it
/// (the editor draws "Picture not found" rather than failing).
pub fn read_picture(root: &std::path::Path, target: &str) -> crate::Result<Option<String>> {
    use base64::Engine as _;
    let Some(rel) = crate::attachments::locate_picture(root, target) else {
        return Ok(None);
    };
    let media = crate::attachments::media_type(&rel)
        .ok_or_else(|| crate::Error::Invalid(format!("not an image: {rel}")))?;
    let bytes = std::fs::read(crate::attachments::safe_relative(root, &rel)?)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:{media};base64,{b64}")))
}

/// The Place a Border command acts on, with its text and current Border file.
fn border_place(v: &Vault, id: &str) -> crate::Result<(DocumentView, Option<String>)> {
    let view = v.read(id)?;
    if view.summary.doc_type != DocType::Place {
        return Err(crate::Error::Invalid(format!(
            "only a Place has a Border, not {}",
            view.summary.title
        )));
    }
    let current = view
        .frontmatter
        .get(crate::border::PROPERTY)
        .and_then(|b| Vault::border_path(&view.summary.path, b));
    Ok((view, current))
}

/// Write a Border drawn on the Map: the corners, in the order placed, become
/// a `.geojson` file beside the Place, and `border` names it (ADR 0023). A
/// Place that already has a Border keeps its file and has it rewritten.
pub fn save_border(
    v: &mut Vault,
    id: &str,
    corners: &[crate::border::LatLon],
) -> crate::Result<DocumentPayload> {
    // Checked before anything is written, so a refused Border leaves no file.
    crate::border::drawn(corners, 0)?;
    put_border(v, id, |root, rel| crate::border::write(root, rel, corners))
}

/// Import a `.geojson` file picked from disk as a region's Border: copied
/// whole beside the Place, every piece kept, and `border` names it. A Place
/// that already has a Border has that file replaced. A file with no area in
/// it is refused, saying why, and nothing is written.
pub fn import_border(
    v: &mut Vault,
    id: &str,
    file_name: &str,
    text: &str,
) -> crate::Result<DocumentPayload> {
    if let Err(e) = crate::border::parse(text) {
        return Err(crate::Error::Invalid(format!("{file_name} is not a Border: {e}")));
    }
    put_border(v, id, |root, rel| crate::border::import(root, rel, text))
}

/// Write a Place's Border file with `write`, then name it in `border`. The
/// file is the one `border` already names, or a new one after the Place's
/// title beside it.
fn put_border(
    v: &mut Vault,
    id: &str,
    write: impl FnOnce(&std::path::Path, &str) -> crate::Result<()>,
) -> crate::Result<DocumentPayload> {
    let (view, current) = border_place(v, id)?;
    let root = v.root().to_path_buf();
    let rel = match current {
        Some(rel) => rel,
        None => {
            let name = crate::border::free_name(&root, &view.summary.path, &view.summary.title);
            crate::border::path_for(&view.summary.path, &name)
                .ok_or_else(|| crate::Error::Invalid(format!("no place for {name}")))?
        }
    };
    write(&root, &rel)?;
    let name = rel.rsplit('/').next().unwrap_or(&rel);
    // A link to a file elsewhere is spelled from the root, as Obsidian does.
    let beside = crate::border::path_for(&view.summary.path, name).as_deref() == Some(rel.as_str());
    let link = format!("[[{}]]", if beside { name } else { rel.as_str() });
    let wanted = Value::String(link.clone());
    let view = if view.frontmatter.get(crate::border::PROPERTY) == Some(&wanted) {
        view
    } else {
        let text = crate::document::set_frontmatter_field(&view.text, crate::border::PROPERTY, Some(&link));
        v.write(id, &text)?
    };
    // The Place may be unchanged (a Border rewritten in place): the Places
    // inside it are recomputed from the new file either way.
    v.border_file_changed(&rel)?;
    Ok(payload(v, view))
}

/// Remove a Place's Border: its file and its `border` Property.
pub fn delete_border(v: &mut Vault, id: &str) -> crate::Result<DocumentPayload> {
    let (view, current) = border_place(v, id)?;
    if let Some(rel) = current {
        let abs = v.root().join(&rel);
        if crate::cloud::is_evicted(&abs) {
            return Err(crate::cloud::downloading(&abs));
        }
        if abs.is_file() {
            std::fs::remove_file(abs)?;
        }
    }
    if !view.frontmatter.contains_key(crate::border::PROPERTY) {
        v.border_file_changed("")?;
        return Ok(payload(v, view));
    }
    let text = crate::document::set_frontmatter_field(&view.text, crate::border::PROPERTY, None);
    let view = v.write(id, &text)?;
    Ok(payload(v, view))
}

/// Make the vault folder and the folders each document type is written to.
pub fn prepare_vault_folder(root: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(root)?;
    for folder in [
        "Notes",
        "Clippings",
        "Compositions",
        "Sources",
        "Scripture",
        "Places",
        "Characters",
        "Concepts",
        "Events",
        "Journeys",
        // Pictures the vault owns (ADR 0012, 0019). Referenced by `cover` or
        // `![[…]]`, never indexed: the scanner still reads `.md` only.
        "Attachments",
    ] {
        std::fs::create_dir_all(root.join(folder))?;
    }
    Ok(())
}

#[cfg(test)]
mod border_tests {
    use super::*;
    use crate::border::BorderStatus;
    use crate::query::{Answer, Query};
    use std::fs;

    fn vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Places")).unwrap();
        fs::write(
            dir.path().join("Places/Judah.md"),
            "---\nid: judah\ntype: place\nkind: region\n---\nThe southern kingdom.\n",
        )
        .unwrap();
        let data = dir.path().join(".data");
        let v = Vault::open(dir.path().join("."), &data, Lang::En).unwrap();
        (dir, v)
    }

    fn borders(v: &Vault) -> Vec<crate::border::Border> {
        match v.query(Query::Borders).unwrap() {
            Answer::Borders(b) => b,
            other => panic!("{other:?}"),
        }
    }

    const CORNERS: [[f64; 2]; 3] = [[31.0, 35.0], [31.0, 35.5], [31.6, 35.2]];

    #[test]
    fn writing_a_border_puts_a_geojson_file_beside_the_place_and_links_it() {
        let (dir, mut v) = vault();
        let doc = save_border(&mut v, "judah", &CORNERS).unwrap();
        assert_eq!(doc.frontmatter["border"], "[[Judah.geojson]]");
        let text = fs::read_to_string(dir.path().join("Places/Judah.geojson")).unwrap();
        assert!(text.contains("\"Polygon\""), "{text}");
        // The body is untouched.
        assert!(doc.text.ends_with("The southern kingdom.\n"), "{}", doc.text);
        let b = borders(&v);
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].doc, "judah");
        assert_eq!(b[0].status, BorderStatus::Ok);
        assert_eq!(b[0].polygons[0][0][0], [31.0, 35.0]);
        // The link names a file, not a missing document.
        assert!(v.unresolved().unwrap().is_empty(), "{:?}", v.unresolved().unwrap());
    }

    #[test]
    fn editing_a_border_rewrites_the_same_file() {
        let (dir, mut v) = vault();
        save_border(&mut v, "judah", &CORNERS).unwrap();
        let moved = [[30.0, 35.0], [31.0, 35.5], [31.6, 35.2], [31.2, 34.8]];
        let doc = save_border(&mut v, "judah", &moved).unwrap();
        assert_eq!(doc.frontmatter["border"], "[[Judah.geojson]]");
        let files: Vec<_> = fs::read_dir(dir.path().join("Places")).unwrap().flatten().collect();
        assert_eq!(files.len(), 2, "a second Border file was made");
        assert_eq!(borders(&v)[0].polygons[0][0].len(), 5);
    }

    #[test]
    fn a_new_border_never_takes_another_file_s_name() {
        let (dir, mut v) = vault();
        fs::write(dir.path().join("Places/Judah.geojson"), "{}").unwrap();
        let doc = save_border(&mut v, "judah", &CORNERS).unwrap();
        assert_eq!(doc.frontmatter["border"], "[[Judah 2.geojson]]");
        assert_eq!(fs::read_to_string(dir.path().join("Places/Judah.geojson")).unwrap(), "{}");
    }

    #[test]
    fn deleting_a_border_removes_the_file_and_the_property() {
        let (dir, mut v) = vault();
        save_border(&mut v, "judah", &CORNERS).unwrap();
        let doc = delete_border(&mut v, "judah").unwrap();
        assert!(doc.frontmatter.get("border").is_none());
        assert!(!dir.path().join("Places/Judah.geojson").exists());
        assert!(borders(&v).is_empty());
    }

    #[test]
    fn a_malformed_border_is_reported_on_its_place() {
        let (dir, mut v) = vault();
        save_border(&mut v, "judah", &CORNERS).unwrap();
        fs::write(dir.path().join("Places/Judah.geojson"), "{\"type\":\"Polygon\"}").unwrap();
        let b = borders(&v);
        assert_eq!(b[0].status, BorderStatus::Malformed);
        assert!(b[0].error.as_deref().unwrap_or("").contains("coordinates"));
    }

    #[test]
    fn only_a_place_takes_a_border() {
        let (dir, mut v) = vault();
        fs::create_dir_all(dir.path().join("Notes")).unwrap();
        fs::write(dir.path().join("Notes/N.md"), "---\nid: n\n---\nx\n").unwrap();
        v.scan().unwrap();
        assert!(save_border(&mut v, "n", &CORNERS).is_err());
        assert!(save_border(&mut v, "judah", &CORNERS[..2]).is_err());
        assert!(!dir.path().join("Places/Judah.geojson").exists());
    }

    const ISLANDS: &str = r#"{"type":"FeatureCollection","features":[
        {"type":"Feature","properties":{"name":"Judah"},"geometry":{"type":"MultiPolygon","coordinates":[
            [[[35.0,31.0],[35.5,31.0],[35.2,31.6],[35.0,31.0]]],
            [[[34.0,30.0],[34.2,30.0],[34.1,30.2],[34.0,30.0]]]]}}]}"#;

    #[test]
    fn importing_a_border_copies_the_file_beside_the_place_and_keeps_every_piece() {
        let (dir, mut v) = vault();
        let doc = import_border(&mut v, "judah", "judah-kingdom.geojson", ISLANDS).unwrap();
        assert_eq!(doc.frontmatter["border"], "[[Judah.geojson]]");
        let text = fs::read_to_string(dir.path().join("Places/Judah.geojson")).unwrap();
        // A copy: the file's own members travel with it.
        assert!(text.contains("\"name\": \"Judah\""), "{text}");
        assert!(doc.text.ends_with("The southern kingdom.\n"), "{}", doc.text);
        let b = borders(&v);
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].status, BorderStatus::Ok);
        assert_eq!(b[0].polygons.len(), 2, "a piece of the region was lost");
        assert_eq!(b[0].polygons[1][0][0], [30.0, 34.0]);
    }

    #[test]
    fn an_invalid_file_is_refused_with_its_reason_and_nothing_is_written() {
        let (dir, mut v) = vault();
        for bad in ["{nope", r#"{"type":"Point","coordinates":[35,31]}"#] {
            let e = import_border(&mut v, "judah", "roads.geojson", bad).unwrap_err().to_string();
            assert!(e.contains("roads.geojson"), "{e}");
            assert!(e.contains("not JSON") || e.contains("no Polygon"), "{e}");
        }
        assert!(!dir.path().join("Places/Judah.geojson").exists());
        assert!(v.read("judah").unwrap().frontmatter.get("border").is_none());
    }

    #[test]
    fn importing_over_a_drawn_border_replaces_that_file_and_outranks_it_for_pairing() {
        let (dir, mut v) = vault();
        save_border(&mut v, "judah", &CORNERS).unwrap();
        let p = dir.path().join("Places/Judah.geojson");
        let drawn_stamp: i64 = serde_json::from_str::<Value>(&fs::read_to_string(&p).unwrap()).unwrap()["updated"]
            .as_i64()
            .unwrap();
        let doc = import_border(&mut v, "judah", "islands.geojson", ISLANDS).unwrap();
        assert_eq!(doc.frontmatter["border"], "[[Judah.geojson]]");
        let files: Vec<_> = fs::read_dir(dir.path().join("Places")).unwrap().flatten().collect();
        assert_eq!(files.len(), 2, "a second Border file was made");
        let copied: Value = serde_json::from_str(&fs::read_to_string(&p).unwrap()).unwrap();
        assert!(copied["updated"].as_i64().unwrap() > drawn_stamp);
        assert_eq!(borders(&v)[0].polygons.len(), 2);
    }

    #[test]
    fn only_a_place_takes_an_imported_border() {
        let (dir, mut v) = vault();
        fs::create_dir_all(dir.path().join("Notes")).unwrap();
        fs::write(dir.path().join("Notes/N.md"), "---\nid: n\n---\nx\n").unwrap();
        v.scan().unwrap();
        assert!(import_border(&mut v, "n", "islands.geojson", ISLANDS).is_err());
        assert!(!dir.path().join("Notes/N.geojson").exists());
    }

    // ---- Containment (ADR 0023): which Places lie inside a region's Border.

    fn place(dir: &std::path::Path, id: &str, lat: f64, lon: f64) {
        fs::write(
            dir.join(format!("Places/{id}.md")),
            format!("---\nid: {id}\ntype: place\nlat: {lat}\nlon: {lon}\n---\n"),
        )
        .unwrap();
    }

    /// The Places inside `region`, sorted.
    fn members(v: &Vault, region: &str) -> Vec<String> {
        let mut out: Vec<String> = match v.query(Query::Regions).unwrap() {
            Answer::Regions(r) => r.into_iter().filter(|m| m.region == region).map(|m| m.place).collect(),
            other => panic!("{other:?}"),
        };
        out.sort();
        out
    }

    /// Judah's Border is lat 31–32, lon 35–36.
    const SQUARE: [[f64; 2]; 4] = [[31.0, 35.0], [31.0, 36.0], [32.0, 36.0], [32.0, 35.0]];

    fn with_places() -> (tempfile::TempDir, Vault) {
        let (dir, mut v) = vault();
        place(dir.path(), "jerusalem", 31.5, 35.5);
        place(dir.path(), "babylon", 32.5, 44.4);
        place(dir.path(), "frontier", 31.0, 35.5);
        v.scan().unwrap();
        (dir, v)
    }

    #[test]
    fn a_region_contains_the_places_inside_and_on_its_border() {
        let (_dir, mut v) = with_places();
        save_border(&mut v, "judah", &SQUARE).unwrap();
        assert_eq!(members(&v, "judah"), ["frontier", "jerusalem"]);
    }

    #[test]
    fn a_region_without_a_border_contains_nothing() {
        let (_dir, v) = with_places();
        assert!(members(&v, "judah").is_empty());
    }

    #[test]
    fn every_piece_of_an_imported_multipolygon_contains() {
        let (dir, mut v) = with_places();
        place(dir.path(), "isle", 30.1, 34.1);
        v.scan().unwrap();
        import_border(&mut v, "judah", "islands.geojson", ISLANDS).unwrap();
        // The frontier town sits on a corner of the first piece; the isle
        // lies in the second.
        assert_eq!(members(&v, "judah"), ["frontier", "isle"]);
    }

    #[test]
    fn containment_follows_an_edited_border_and_a_moved_place() {
        let (dir, mut v) = with_places();
        save_border(&mut v, "judah", &SQUARE).unwrap();
        // Drawn again, smaller: the frontier town falls outside.
        save_border(&mut v, "judah", &[[31.2, 35.0], [31.2, 36.0], [32.0, 36.0], [32.0, 35.0]]).unwrap();
        assert_eq!(members(&v, "judah"), ["jerusalem"]);
        // Babylon moved into it, as an edit in Obsidian would.
        place(dir.path(), "babylon", 31.8, 35.8);
        v.index_file("Places/babylon.md").unwrap();
        assert_eq!(members(&v, "judah"), ["babylon", "jerusalem"]);
        // The Border file changed on disk, with the Place untouched.
        fs::write(
            dir.path().join("Places/Judah.geojson"),
            r#"{"type":"Polygon","coordinates":[[[35,31],[36,31],[36,31.6],[35,31.6],[35,31]]]}"#,
        )
        .unwrap();
        v.border_file_changed("Places/Judah.geojson").unwrap();
        assert_eq!(members(&v, "judah"), ["frontier", "jerusalem"]);
        // And removed with its Property: nothing is inside any more.
        delete_border(&mut v, "judah").unwrap();
        assert!(members(&v, "judah").is_empty());
    }

    #[test]
    fn a_border_changed_while_closed_is_read_again_on_open() {
        let (dir, mut v) = with_places();
        save_border(&mut v, "judah", &SQUARE).unwrap();
        fs::write(
            dir.path().join("Places/Judah.geojson"),
            r#"{"type":"Polygon","coordinates":[[[44,32],[45,32],[45,33],[44,33],[44,32]]]}"#,
        )
        .unwrap();
        v.scan().unwrap();
        assert_eq!(members(&v, "judah"), ["babylon"]);
    }

    #[test]
    fn a_vanished_place_or_region_leaves_no_containment() {
        let (dir, mut v) = with_places();
        save_border(&mut v, "judah", &SQUARE).unwrap();
        fs::remove_file(dir.path().join("Places/jerusalem.md")).unwrap();
        v.scan().unwrap();
        assert_eq!(members(&v, "judah"), ["frontier"]);
        v.delete("judah").unwrap();
        assert!(members(&v, "judah").is_empty());
    }

    #[test]
    fn border_is_a_built_in_link() {
        assert_eq!(
            crate::properties::PropertySchema::builtin().types.get("border"),
            Some(&crate::properties::PropertyType::Link)
        );
    }
}
