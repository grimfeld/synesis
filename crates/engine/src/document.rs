//! Parsing one markdown file: frontmatter, type, aliases, wikilinks, tags and
//! Scripture references. Obsidian conventions throughout (ADR 0003).

use crate::parser::{self, Detected};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DocType {
    #[default]
    Note,
    Clipping,
    Composition,
    Source,
    Book,
    Chapter,
    Verse,
    Place,
    Character,
    Concept,
    Event,
    Other,
}

impl DocType {
    pub const ALL: [DocType; 11] = [
        DocType::Note,
        DocType::Clipping,
        DocType::Composition,
        DocType::Source,
        DocType::Book,
        DocType::Chapter,
        DocType::Verse,
        DocType::Place,
        DocType::Character,
        DocType::Concept,
        DocType::Event,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            DocType::Note => "note",
            DocType::Clipping => "clipping",
            DocType::Composition => "composition",
            DocType::Source => "source",
            DocType::Book => "book",
            DocType::Chapter => "chapter",
            DocType::Verse => "verse",
            DocType::Place => "place",
            DocType::Character => "character",
            DocType::Concept => "concept",
            DocType::Event => "event",
            DocType::Other => "other",
        }
    }

    pub fn parse(s: &str) -> Option<DocType> {
        Some(match s.trim().to_ascii_lowercase().as_str() {
            "note" => DocType::Note,
            "clipping" => DocType::Clipping,
            "composition" => DocType::Composition,
            "source" => DocType::Source,
            "book" => DocType::Book,
            "chapter" => DocType::Chapter,
            "verse" => DocType::Verse,
            "place" => DocType::Place,
            "character" => DocType::Character,
            "concept" => DocType::Concept,
            "event" => DocType::Event,
            _ => return None,
        })
    }

    /// Default folder for new documents of this type (plan §4).
    pub fn default_folder(self) -> &'static str {
        match self {
            DocType::Note => "Notes",
            DocType::Clipping => "Clippings",
            DocType::Composition => "Compositions",
            DocType::Source => "Sources",
            DocType::Book | DocType::Chapter | DocType::Verse => "Scripture",
            DocType::Place => "Places",
            DocType::Character => "Characters",
            DocType::Concept => "Concepts",
            DocType::Event => "Events",
            DocType::Other => "",
        }
    }

    fn from_folder(folder: &str) -> Option<DocType> {
        Some(match folder {
            "Notes" => DocType::Note,
            "Clippings" => DocType::Clipping,
            "Compositions" => DocType::Composition,
            "Sources" => DocType::Source,
            "Places" => DocType::Place,
            "Characters" => DocType::Character,
            "Concepts" => DocType::Concept,
            "Events" => DocType::Event,
            _ => return None,
        })
    }

    pub fn is_scripture(self) -> bool {
        matches!(self, DocType::Book | DocType::Chapter | DocType::Verse)
    }

    pub fn is_subject(self) -> bool {
        self.is_scripture()
            || matches!(
                self,
                DocType::Place | DocType::Character | DocType::Concept | DocType::Event
            )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Link {
    /// Raw target as written, e.g. "Paul", "Notes/Foo", "John 3:16".
    pub target: String,
    pub alias: Option<String>,
    pub embed: bool,
    pub start: usize,
    pub end: usize,
    /// Frontmatter key this link was found under, if any (e.g. "source", "parent").
    pub property: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagRef {
    pub name: String,
    pub start: usize,
    pub end: usize,
    pub in_frontmatter: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedDoc {
    pub id: Option<String>,
    pub doc_type: DocType,
    pub title: String,
    pub aliases: Vec<String>,
    pub frontmatter: Map<String, Value>,
    /// Byte offset where the body starts (after the frontmatter block).
    pub body_offset: usize,
    pub links: Vec<Link>,
    pub tags: Vec<TagRef>,
    pub references: Vec<Detected>,
}

static WIKILINK_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(!?)\[\[([^\[\]\|#]+?)(?:#[^\[\]\|]*)?(?:\|([^\[\]]*))?\]\]").unwrap()
});
static TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:^|[^\p{L}\p{N}_/#&])#([\p{L}\p{N}_/\-]+)").unwrap());
static SKIP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)```.*?(?:```|\z)|`[^`\n]*`|https?://[^\s)>\]]+").unwrap());
static FM_KEY_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^([A-Za-z0-9_\-]+)\s*:").unwrap());

/// Split a file into its YAML frontmatter (raw) and the byte offset of the body.
pub fn split_frontmatter(text: &str) -> (Option<&str>, usize) {
    let t = text.strip_prefix('\u{feff}').unwrap_or(text);
    let bom = text.len() - t.len();
    if !(t.starts_with("---\n") || t.starts_with("---\r\n")) {
        return (None, 0);
    }
    let first_nl = t.find('\n').unwrap();
    let rest = &t[first_nl + 1..];
    // The closing fence is a line that is exactly "---" (or "...").
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" || trimmed == "..." {
            let yaml_end = first_nl + 1 + offset;
            let body_start = yaml_end + line.len();
            return (Some(&t[first_nl + 1..yaml_end]), bom + body_start);
        }
        offset += line.len();
    }
    (None, 0)
}

fn yaml_to_json(v: serde_yaml::Value) -> Value {
    match v {
        serde_yaml::Value::Null => Value::Null,
        serde_yaml::Value::Bool(b) => Value::Bool(b),
        serde_yaml::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::from(i)
            } else if let Some(f) = n.as_f64() {
                Value::from(f)
            } else {
                Value::Null
            }
        }
        serde_yaml::Value::String(s) => Value::String(s),
        serde_yaml::Value::Sequence(seq) => {
            Value::Array(seq.into_iter().map(yaml_to_json).collect())
        }
        serde_yaml::Value::Mapping(m) => Value::Object(
            m.into_iter()
                .map(|(k, v)| {
                    let key = match k {
                        serde_yaml::Value::String(s) => s,
                        other => serde_yaml::to_string(&other)
                            .unwrap_or_default()
                            .trim()
                            .to_string(),
                    };
                    (key, yaml_to_json(v))
                })
                .collect(),
        ),
        serde_yaml::Value::Tagged(t) => yaml_to_json(t.value),
    }
}

pub fn parse_frontmatter(yaml: &str) -> Map<String, Value> {
    match serde_yaml::from_str::<serde_yaml::Value>(yaml) {
        Ok(v) => match yaml_to_json(v) {
            Value::Object(m) => m,
            _ => Map::new(),
        },
        Err(_) => Map::new(),
    }
}

fn string_list(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::String(s)) => vec![s.trim().to_string()],
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|x| match x {
                Value::String(s) => Some(s.trim().to_string()),
                Value::Number(n) => Some(n.to_string()),
                _ => None,
            })
            .collect(),
        _ => vec![],
    }
}

/// Title from a vault-relative path: the file stem.
pub fn title_from_path(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").unwrap_or(name).to_string()
}

/// A title as shown in the app: the first letter capitalised, the rest as written.
/// File names are lowercase; this recovers a presentable title from a stem.
pub fn display_title(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut done = false;
    for c in s.chars() {
        if !done && c.is_alphabetic() {
            out.extend(c.to_uppercase());
            done = true;
        } else {
            out.push(c);
        }
    }
    out
}

/// Set (or remove, with `None`) one scalar property in the frontmatter. Every
/// other line and the body stay byte-for-byte untouched.
pub fn set_frontmatter_field(text: &str, key: &str, value: Option<&str>) -> String {
    let (yaml, body_offset) = split_frontmatter(text);
    let Some(yaml) = yaml else {
        return match value {
            Some(v) => with_frontmatter_fields(text, &[(key, &yaml_str(v))]),
            None => text.to_string(),
        };
    };
    let re = Regex::new(&format!(r"^{}\s*:", regex::escape(key))).unwrap();
    let rendered = value.map(|v| format!("{key}: {}", yaml_str(v)));
    let mut lines: Vec<&str> = yaml.lines().collect();
    let idx = lines.iter().position(|l| re.is_match(l));
    // Continuation lines (block lists, nested maps) belong to the key above them.
    let end_of = |i: usize, lines: &[&str]| {
        let mut e = i + 1;
        while e < lines.len() && (lines[e].starts_with(' ') || lines[e].starts_with("- ")) {
            e += 1;
        }
        e
    };
    match (idx, &rendered) {
        (Some(i), Some(r)) => {
            let e = end_of(i, &lines);
            lines.splice(i..e, [r.as_str()]);
        }
        (Some(i), None) => {
            let e = end_of(i, &lines);
            lines.drain(i..e);
        }
        (None, Some(r)) => lines.push(r.as_str()),
        (None, None) => return text.to_string(),
    }
    let bom = if text.starts_with('\u{feff}') {
        "\u{feff}"
    } else {
        ""
    };
    let nl = if yaml.contains("\r\n") { "\r\n" } else { "\n" };
    format!(
        "{bom}---{nl}{}{nl}---{nl}{}",
        lines.join(nl),
        &text[body_offset..]
    )
}

fn zones(text: &str) -> Vec<(usize, usize)> {
    SKIP_RE
        .find_iter(text)
        .map(|m| (m.start(), m.end()))
        .collect()
}

fn in_zone(zones: &[(usize, usize)], start: usize, end: usize) -> bool {
    zones.iter().any(|&(a, b)| start < b && end > a)
}

/// Parse one document. `path` is vault-relative with forward slashes.
pub fn parse(path: &str, text: &str) -> ParsedDoc {
    let (yaml, body_offset) = split_frontmatter(text);
    let frontmatter = yaml.map(parse_frontmatter).unwrap_or_default();
    // Display title: an explicit `title` property, else the (lowercase) file stem capitalised.
    let title = frontmatter
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| display_title(&title_from_path(path)));
    let id = frontmatter.get("id").and_then(|v| match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    });
    let folder = path
        .split('/')
        .next()
        .filter(|_| path.contains('/'))
        .unwrap_or("");
    let doc_type = frontmatter
        .get("type")
        .and_then(Value::as_str)
        .and_then(DocType::parse)
        .or_else(|| DocType::from_folder(folder))
        .unwrap_or(DocType::Note);
    let mut aliases = string_list(frontmatter.get("aliases"));
    aliases.extend(string_list(frontmatter.get("alias")));

    let mut links = Vec::new();
    let mut tags = Vec::new();

    // Links and tags declared in frontmatter properties.
    if let Some(yaml) = yaml {
        let yaml_start = text.len() - text.trim_start_matches('\u{feff}').len() + 4; // after "---\n"
                                                                                     // Map each byte of yaml to the property key it belongs to.
        let mut keys: Vec<(usize, String)> = FM_KEY_RE
            .captures_iter(yaml)
            .map(|c| (c.get(1).unwrap().start(), c[1].to_string()))
            .collect();
        keys.sort();
        let key_at = |pos: usize| {
            keys.iter()
                .rev()
                .find(|(s, _)| *s <= pos)
                .map(|(_, k)| k.clone())
        };
        for caps in WIKILINK_RE.captures_iter(yaml) {
            let m = caps.get(0).unwrap();
            links.push(Link {
                target: caps[2].trim().to_string(),
                alias: caps.get(3).map(|a| a.as_str().trim().to_string()),
                embed: false,
                start: yaml_start + m.start(),
                end: yaml_start + m.end(),
                property: key_at(m.start()),
            });
        }
        for t in string_list(frontmatter.get("tags"))
            .into_iter()
            .chain(string_list(frontmatter.get("tag")))
        {
            let name = t.trim_start_matches('#').to_string();
            if !name.is_empty() {
                tags.push(TagRef {
                    name,
                    start: 0,
                    end: 0,
                    in_frontmatter: true,
                });
            }
        }
    }

    let body = &text[body_offset..];
    let z = zones(body);
    for caps in WIKILINK_RE.captures_iter(body) {
        let m = caps.get(0).unwrap();
        if in_zone(&z, m.start(), m.end()) {
            continue;
        }
        links.push(Link {
            target: caps[2].trim().to_string(),
            alias: caps.get(3).map(|a| a.as_str().trim().to_string()),
            embed: &caps[1] == "!",
            start: body_offset + m.start(),
            end: body_offset + m.end(),
            property: None,
        });
    }
    for caps in TAG_RE.captures_iter(body) {
        let m = caps.get(1).unwrap();
        let name = m.as_str().trim_end_matches(['/', '-']);
        // Obsidian: a tag needs at least one non-numeric character.
        if name.is_empty()
            || name.chars().all(|c| c.is_ascii_digit())
            || in_zone(&z, m.start(), m.end())
        {
            continue;
        }
        tags.push(TagRef {
            name: name.to_string(),
            start: body_offset + m.start() - 1,
            end: body_offset + m.start() + name.len(),
            in_frontmatter: false,
        });
    }

    let mut references = parser::detect(body);
    for r in &mut references {
        r.start += body_offset;
        r.end += body_offset;
    }

    ParsedDoc {
        id,
        doc_type,
        title,
        aliases,
        frontmatter,
        body_offset,
        links,
        tags,
        references,
    }
}

/// Return `text` with `key: value` lines inserted into the frontmatter for every
/// key that is missing, creating a frontmatter block if needed. Existing lines
/// and the body are left byte-for-byte untouched.
pub fn with_frontmatter_fields(text: &str, fields: &[(&str, &str)]) -> String {
    let (yaml, body_offset) = split_frontmatter(text);
    match yaml {
        Some(yaml) => {
            let existing = parse_frontmatter(yaml);
            let missing: Vec<String> = fields
                .iter()
                .filter(|(k, _)| !existing.contains_key(*k))
                .map(|(k, v)| format!("{k}: {v}\n"))
                .collect();
            if missing.is_empty() {
                return text.to_string();
            }
            let head_len = text.find('\n').map(|i| i + 1).unwrap_or(0);
            let mut out = String::with_capacity(text.len() + 64);
            out.push_str(&text[..head_len]);
            for m in missing {
                out.push_str(&m);
            }
            out.push_str(&text[head_len..]);
            let _ = body_offset;
            out
        }
        None => {
            let mut out = String::from("---\n");
            for (k, v) in fields {
                out.push_str(&format!("{k}: {v}\n"));
            }
            out.push_str("---\n");
            out.push_str(text);
            out
        }
    }
}

/// Quote a string for a YAML scalar when needed.
pub fn yaml_str(s: &str) -> String {
    let needs = s.is_empty()
        || s.contains(|c: char| {
            matches!(
                c,
                ':' | '#'
                    | '['
                    | ']'
                    | '{'
                    | '}'
                    | ','
                    | '&'
                    | '*'
                    | '!'
                    | '|'
                    | '>'
                    | '\''
                    | '"'
                    | '%'
                    | '@'
                    | '`'
            )
        })
        || s.starts_with(|c: char| c == '-' || c == '?' || c.is_whitespace())
        || s.ends_with(char::is_whitespace)
        || matches!(
            s.to_ascii_lowercase().as_str(),
            "true" | "false" | "null" | "yes" | "no" | "~"
        )
        || s.parse::<f64>().is_ok();
    if needs {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_and_body() {
        let text = "---\nid: abc\ntype: clipping\nsource: \"[[The Watchtower 2024-03]]\"\ntags: [faith, hope]\naliases:\n  - Alt\n---\nBody with [[Paul]] and #endurance and John 3:16.\n";
        let d = parse("Clippings/Foo.md", text);
        assert_eq!(d.id.as_deref(), Some("abc"));
        assert_eq!(d.doc_type, DocType::Clipping);
        assert_eq!(d.title, "Foo");
        assert_eq!(d.aliases, vec!["Alt"]);
        assert_eq!(d.links.len(), 2);
        assert_eq!(d.links[0].target, "The Watchtower 2024-03");
        assert_eq!(d.links[0].property.as_deref(), Some("source"));
        assert_eq!(d.links[1].target, "Paul");
        assert_eq!(&text[d.links[1].start..d.links[1].end], "[[Paul]]");
        let names: Vec<_> = d.tags.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["faith", "hope", "endurance"]);
        assert_eq!(&text[d.tags[2].start..d.tags[2].end], "#endurance");
        assert_eq!(d.references.len(), 1);
        assert_eq!(
            &text[d.references[0].start..d.references[0].end],
            "John 3:16"
        );
    }

    #[test]
    fn display_titles_and_title_property() {
        assert_eq!(display_title("paul of tarsus"), "Paul of tarsus");
        assert_eq!(display_title("1 samuel 2"), "1 Samuel 2");
        assert_eq!(display_title("2026-09-10 17.07"), "2026-09-10 17.07");
        assert_eq!(display_title("éclair"), "Éclair");
        let text = "---
id: X
type: note
---
body
";
        let with = set_frontmatter_field(text, "title", Some("Paul of Tarsus"));
        assert_eq!(
            with,
            "---
id: X
type: note
title: Paul of Tarsus
---
body
"
        );
        assert_eq!(
            parse("Characters/paul of tarsus.md", &with).title,
            "Paul of Tarsus"
        );
        assert_eq!(
            parse("Characters/paul of tarsus.md", text).title,
            "Paul of tarsus"
        );
        let replaced = set_frontmatter_field(&with, "title", Some("Other: one"));
        assert!(replaced.contains(
            "title: \"Other: one\"
"
        ));
        assert_eq!(set_frontmatter_field(&with, "title", None), text);
        assert_eq!(
            set_frontmatter_field(
                "no frontmatter
",
                "title",
                Some("T")
            ),
            "---
title: T
---
no frontmatter
"
        );
    }

    #[test]
    fn type_from_folder_and_default() {
        assert_eq!(parse("Sources/X.md", "hello").doc_type, DocType::Source);
        assert_eq!(parse("Random/X.md", "hello").doc_type, DocType::Note);
        assert_eq!(parse("X.md", "hello").doc_type, DocType::Note);
        assert_eq!(
            parse("Notes/X.md", "---\ntype: concept\n---\n").doc_type,
            DocType::Concept
        );
    }

    #[test]
    fn tags_rules() {
        let d = parse(
            "N.md",
            "# Heading\nA #tag/sub and #123 and x#no and `#code` and #fin.",
        );
        let names: Vec<_> = d.tags.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["tag/sub", "fin"]);
    }

    #[test]
    fn embeds_and_aliases() {
        let d = parse(
            "N.md",
            "![[Clip one]] and [[Paul|the apostle]] and [[Notes/Deep#Heading|x]]",
        );
        assert!(d.links[0].embed);
        assert_eq!(d.links[1].alias.as_deref(), Some("the apostle"));
        assert_eq!(d.links[2].target, "Notes/Deep");
    }

    #[test]
    fn add_fields() {
        let t = with_frontmatter_fields(
            "---\ntype: note\n---\nbody",
            &[("id", "X"), ("type", "note")],
        );
        assert_eq!(t, "---\nid: X\ntype: note\n---\nbody");
        let t = with_frontmatter_fields("body only", &[("id", "X")]);
        assert_eq!(t, "---\nid: X\n---\nbody only");
        let t = with_frontmatter_fields("---\nid: Y\n---\nb", &[("id", "X")]);
        assert_eq!(t, "---\nid: Y\n---\nb");
    }

    #[test]
    fn yaml_quoting() {
        assert_eq!(yaml_str("Paul"), "Paul");
        assert_eq!(yaml_str("[[Paul]]"), "\"[[Paul]]\"");
        assert_eq!(yaml_str("John 3:16"), "\"John 3:16\"");
        assert_eq!(yaml_str("2024"), "\"2024\"");
    }
}
