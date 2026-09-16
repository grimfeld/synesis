//! New-document templates per type, and Scripture page generation.

use crate::document::{yaml_str, DocType};
use crate::names;
use crate::scripture::{Lang, Passage, Unit};
use serde_json::{Map, Value};

fn now() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

fn value_to_yaml(v: &Value) -> String {
    match v {
        Value::String(s) => yaml_str(s),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "".into(),
        Value::Array(a) => {
            let items: Vec<String> = a.iter().map(value_to_yaml).collect();
            format!("[{}]", items.join(", "))
        }
        Value::Object(_) => yaml_str(&v.to_string()),
    }
}

/// Frontmatter keys a new document of this type starts with, in order.
pub fn default_fields(doc_type: DocType) -> Vec<(&'static str, Value)> {
    let mut f: Vec<(&str, Value)> = vec![
        ("type", Value::String(doc_type.as_str().into())),
        ("created", Value::String(now())),
    ];
    match doc_type {
        DocType::Note => f.push(("source", Value::String(String::new()))),
        DocType::Clipping => {
            f.push(("source", Value::String(String::new())));
            f.push(("locator", Value::String(String::new())));
        }
        DocType::Composition => {
            f.push(("occasion", Value::String(String::new())));
            f.push(("date", Value::String(String::new())));
        }
        DocType::Source => {
            f.push(("kind", Value::String("article".into())));
            f.push(("url", Value::String(String::new())));
            f.push(("date", Value::String(String::new())));
            f.push(("cover", Value::String(String::new())));
            f.push(("parent", Value::String(String::new())));
        }
        DocType::Place => {
            f.push(("lat", Value::Null));
            f.push(("lon", Value::Null));
            f.push(("modern_name", Value::String(String::new())));
        }
        DocType::Character => f.push(("aliases", Value::Array(vec![]))),
        DocType::Concept => f.push(("aliases", Value::Array(vec![]))),
        DocType::Event => {
            f.push(("start", Value::String(String::new())));
            f.push(("end", Value::String(String::new())));
            f.push(("place", Value::String(String::new())));
            f.push(("characters", Value::Array(vec![])));
        }
        // A Journey is an Event's template with `place` widened to an ordered
        // `places` list: the route is the order of that list (ADR 0010).
        DocType::Journey => {
            f.push(("start", Value::String(String::new())));
            f.push(("end", Value::String(String::new())));
            f.push(("places", Value::Array(vec![])));
            f.push(("characters", Value::Array(vec![])));
        }
        _ => {}
    }
    f
}

/// Build the full text of a new document. `fields` override or extend the defaults.
pub fn new_document(
    id: &str,
    doc_type: DocType,
    fields: &Map<String, Value>,
    body: &str,
) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("id: {}\n", id));
    let mut written = vec!["id".to_string()];
    for (k, default) in default_fields(doc_type) {
        let v = fields.get(k).cloned().unwrap_or(default);
        out.push_str(&format!("{k}: {}\n", value_to_yaml(&v)));
        written.push(k.to_string());
    }
    for (k, v) in fields {
        if !written.contains(k) {
            out.push_str(&format!("{k}: {}\n", value_to_yaml(v)));
        }
    }
    out.push_str("---\n");
    if !body.is_empty() {
        out.push_str(body);
        if !body.ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

/// Vault-relative path for a Scripture page.
pub fn scripture_path(book: u8, chapter: Option<u16>, verse: Option<u16>) -> String {
    let name = names::english_name(book);
    let file = name.to_lowercase();
    match (chapter, verse) {
        (None, _) => format!("Scripture/{name}/{file}.md"),
        (Some(c), None) => format!("Scripture/{name}/{name} {c}/{file} {c}.md"),
        (Some(c), Some(v)) => format!("Scripture/{name}/{name} {c}/{file} {c}.{v}.md"),
    }
}

/// Text of a freshly materialised Scripture page.
pub fn scripture_page(id: &str, book: u8, chapter: Option<u16>, verse: Option<u16>) -> String {
    let doc_type = match (chapter, verse) {
        (None, _) => DocType::Book,
        (Some(_), None) => DocType::Chapter,
        (Some(_), Some(_)) => DocType::Verse,
    };
    let mut aliases: Vec<String> = Vec::new();
    for lang in [Lang::En, Lang::Fr] {
        let n = names::book_name(book, lang);
        let a = match (chapter, verse) {
            (None, _) => n.to_string(),
            (Some(c), None) => format!("{n} {c}"),
            (Some(c), Some(v)) => format!("{n} {c}:{v}"),
        };
        if !aliases.contains(&a) {
            aliases.push(a);
        }
    }
    // The English full name is already the title for Book pages.
    if doc_type == DocType::Book {
        aliases.retain(|a| a != names::english_name(book));
    }
    let mut out = String::from("---\n");
    out.push_str(&format!("id: {id}\n"));
    out.push_str(&format!("type: {}\n", doc_type.as_str()));
    out.push_str(&format!("book: {}\n", yaml_str(names::english_name(book))));
    out.push_str(&format!("book_number: {book}\n"));
    if let Some(c) = chapter {
        out.push_str(&format!("chapter: {c}\n"));
    }
    if let Some(v) = verse {
        out.push_str(&format!("verse: {v}\n"));
    }
    if !aliases.is_empty() {
        out.push_str("aliases:\n");
        for a in aliases {
            out.push_str(&format!("  - {}\n", yaml_str(&a)));
        }
    }
    out.push_str("---\n");
    out
}

/// Which Scripture pages a Passage materialises: the covering unit and its parents.
/// Returns (book, chapter, verse) triples.
pub fn pages_for(p: &Passage) -> Vec<(u8, Option<u16>, Option<u16>)> {
    let mut out = vec![(p.book, None, None)];
    match p.unit() {
        Unit::Book => {}
        Unit::Chapter => out.push((p.book, Some(p.start_chapter), None)),
        Unit::Verse => {
            out.push((p.book, Some(p.start_chapter), None));
            out.push((p.book, Some(p.start_chapter), p.start_verse));
        }
        Unit::Range => {
            if p.start_verse.is_none() && p.end_verse.is_none() {
                for c in p.start_chapter..=p.end_chapter {
                    out.push((p.book, Some(c), None));
                }
            } else {
                for c in p.start_chapter..=p.end_chapter {
                    out.push((p.book, Some(c), None));
                }
                for v in p.verses() {
                    out.push((v.book(), Some(v.chapter()), Some(v.verse())));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripture_paths() {
        assert_eq!(scripture_path(43, None, None), "Scripture/John/john.md");
        assert_eq!(
            scripture_path(43, Some(3), None),
            "Scripture/John/John 3/john 3.md"
        );
        assert_eq!(
            scripture_path(43, Some(3), Some(16)),
            "Scripture/John/John 3/john 3.16.md"
        );
    }

    #[test]
    fn scripture_page_text() {
        let t = scripture_page("X", 43, Some(3), Some(16));
        assert!(t.contains("type: verse"));
        assert!(t.contains("  - \"John 3:16\""));
        assert!(t.contains("  - \"Jean 3:16\""));
        let d = crate::document::parse(&scripture_path(43, Some(3), Some(16)), &t);
        assert_eq!(d.doc_type, DocType::Verse);
        assert_eq!(d.aliases, vec!["John 3:16", "Jean 3:16"]);
    }

    #[test]
    fn pages_for_units() {
        assert_eq!(pages_for(&Passage::chapter(45, 8)).len(), 2);
        assert_eq!(pages_for(&Passage::verse(45, 8, 28)).len(), 3);
        assert_eq!(
            pages_for(&Passage::verses_in(45, 8, 28, 30)).len(),
            1 + 1 + 3
        );
    }

    #[test]
    fn new_doc() {
        let mut f = Map::new();
        f.insert("source".into(), Value::String("[[WT 2024]]".into()));
        let t = new_document("ID1", DocType::Clipping, &f, "Quoted.");
        assert!(t.starts_with("---\nid: ID1\ntype: clipping\ncreated: "));
        assert!(t.contains("source: \"[[WT 2024]]\""));
        assert!(t.ends_with("---\nQuoted.\n"));
    }
}
