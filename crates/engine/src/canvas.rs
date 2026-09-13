//! Boards on disk: the JSON Canvas 1.0 format (<https://jsoncanvas.org/spec/1.0/>).
//!
//! A Board is the spatial arrangement of material for one Composition, stored
//! beside it as `<composition>.canvas` so Obsidian opens it as a canvas of its
//! own (ADR 0009). This module is the format only: parse, serialise, and the
//! node/edge model. Merging Boards across Devices lives in `sync.rs`.
//!
//! Two rules shape the types here.
//!
//! Unknown fields are preserved. The spec says nothing about keys it does not
//! define, and Obsidian round-trips them, so a field this app parses and drops
//! is destroyed the moment the user touches the Board in Synesis. Every node
//! and edge therefore keeps its `extra` map of everything we did not claim.
//!
//! Nodes are addressed by id, never by position in the array. The array order
//! carries z-index ("nodes are placed in the array in ascending order by
//! z-index"), which is why `Canvas` keeps the order it read rather than a map.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{Error, Result};

/// A node's kind. The spec defines these four and no others.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    /// The writer's own bubble. Plain text with markdown syntax.
    Text,
    /// A document from the Vault, optionally a heading or block within it.
    File,
    /// An external URL. Synesis does not create these (a URL is a Source),
    /// but Obsidian can, so they are parsed and preserved.
    Link,
    /// A labelled box. JSON Canvas has no parent field: membership in a group
    /// is geometric only, never stored.
    Group,
}

impl NodeKind {
    fn as_str(self) -> &'static str {
        match self {
            NodeKind::Text => "text",
            NodeKind::File => "file",
            NodeKind::Link => "link",
            NodeKind::Group => "group",
        }
    }
}

/// One node on a Board.
///
/// `x`, `y`, `width` and `height` are pixels and integers per the spec; the
/// origin is unspecified, and negative coordinates are normal.
///
/// The serde shape is the on-disk shape: a node is stored in the CRDT as the
/// JSON the spec defines, with `extra` flattened back into it, so the map and
/// the file never drift.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: NodeKind,
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
    /// Hex (`#FF0000`) or one of the preset numbers as a string (`"1"`..`"6"`).
    /// The spec leaves the presets' actual colours to the application.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// `text` nodes: the bubble's markdown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// `file` nodes: the vault-relative path to the document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// `file` nodes: a heading or block within the file. Always starts with `#`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subpath: Option<String>,
    /// `link` nodes: the URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// `group` nodes: the label drawn on the box.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Every key we did not claim, kept so a round-trip destroys nothing.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Node {
    /// A node with the required fields set and nothing else.
    pub fn new(id: impl Into<String>, kind: NodeKind, x: i64, y: i64, width: i64, height: i64) -> Node {
        Node {
            id: id.into(),
            kind,
            x,
            y,
            width,
            height,
            color: None,
            text: None,
            file: None,
            subpath: None,
            url: None,
            label: None,
            extra: Map::new(),
        }
    }

    /// The document this node points at, if it points at one.
    ///
    /// This is what becomes a Board ref in the index: the path only, never the
    /// `subpath`, because a Board ref names a document and not a section of it.
    pub fn target(&self) -> Option<&str> {
        match self.kind {
            NodeKind::File => self.file.as_deref(),
            _ => None,
        }
    }
}

/// One edge between two nodes. Endpoints are node ids; the spec has no
/// free-floating endpoints and no waypoints.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    pub id: String,
    #[serde(rename = "fromNode")]
    pub from_node: String,
    #[serde(rename = "fromSide", default, skip_serializing_if = "Option::is_none")]
    pub from_side: Option<Side>,
    #[serde(rename = "fromEnd", default, skip_serializing_if = "Option::is_none")]
    pub from_end: Option<End>,
    #[serde(rename = "toNode")]
    pub to_node: String,
    #[serde(rename = "toSide", default, skip_serializing_if = "Option::is_none")]
    pub to_side: Option<Side>,
    #[serde(rename = "toEnd", default, skip_serializing_if = "Option::is_none")]
    pub to_end: Option<End>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Edge {
    pub fn new(id: impl Into<String>, from_node: impl Into<String>, to_node: impl Into<String>) -> Edge {
        Edge {
            id: id.into(),
            from_node: from_node.into(),
            from_side: None,
            from_end: None,
            to_node: to_node.into(),
            to_side: None,
            to_end: None,
            color: None,
            label: None,
            extra: Map::new(),
        }
    }
}

/// Which side of a node an edge attaches to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Top,
    Right,
    Bottom,
    Left,
}

impl Side {
    fn as_str(self) -> &'static str {
        match self {
            Side::Top => "top",
            Side::Right => "right",
            Side::Bottom => "bottom",
            Side::Left => "left",
        }
    }

    fn parse(s: &str) -> Option<Side> {
        match s {
            "top" => Some(Side::Top),
            "right" => Some(Side::Right),
            "bottom" => Some(Side::Bottom),
            "left" => Some(Side::Left),
            _ => None,
        }
    }
}

/// Whether an edge draws an arrowhead at an end. The spec's defaults are
/// `none` at the start and `arrow` at the end, so `None` here means "absent
/// from the file", which is not the same as `Some(End::None)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum End {
    None,
    Arrow,
}

impl End {
    fn as_str(self) -> &'static str {
        match self {
            End::None => "none",
            End::Arrow => "arrow",
        }
    }

    fn parse(s: &str) -> Option<End> {
        match s {
            "none" => Some(End::None),
            "arrow" => Some(End::Arrow),
            _ => None,
        }
    }
}

/// A whole Board. Both top-level keys are optional in the spec, so an empty
/// canvas is a legal one.
///
/// The serde shape is the on-disk shape, so what crosses the IPC boundary to
/// the UI is the same JSON the vault holds. `parse` is still the reader for
/// files, because it is forgiving about what the spec leaves loose (floats for
/// coordinates, optionals of the wrong type) in ways a derive cannot be.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Canvas {
    #[serde(default)]
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub edges: Vec<Edge>,
    /// Root-level keys the spec does not define, kept for the same reason as
    /// `Node::extra`.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Canvas {
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty() && self.edges.is_empty()
    }

    pub fn node(&self, id: &str) -> Option<&Node> {
        self.nodes.iter().find(|n| n.id == id)
    }

    /// Every document referenced by a `file` node, in node order, deduplicated.
    ///
    /// These are the Board refs: recorded apart from prose links so that
    /// placing material on a Board does not mark it used (PLAN §16.6).
    pub fn targets(&self) -> Vec<&str> {
        let mut out: Vec<&str> = Vec::new();
        for n in &self.nodes {
            if let Some(t) = n.target() {
                if !out.contains(&t) {
                    out.push(t);
                }
            }
        }
        out
    }

    /// Rewrite every `file` node pointing at `from` to point at `to`.
    /// Returns whether anything changed. This is what keeps Boards intact when
    /// a document is renamed (PLAN §16.13).
    pub fn rewrite_path(&mut self, from: &str, to: &str) -> bool {
        let mut changed = false;
        for n in &mut self.nodes {
            if n.kind == NodeKind::File && n.file.as_deref() == Some(from) {
                n.file = Some(to.to_string());
                changed = true;
            }
        }
        changed
    }

    pub fn parse(text: &str) -> Result<Canvas> {
        let v: Value = serde_json::from_str(text)?;
        let mut root = match v {
            Value::Object(m) => m,
            _ => return Err(Error::Invalid("canvas: top level is not an object".into())),
        };
        let nodes = match root.remove("nodes") {
            Some(Value::Array(a)) => a.into_iter().map(parse_node).collect::<Result<Vec<_>>>()?,
            // A present-but-wrong `nodes` is a corrupt file, not an empty Board.
            Some(Value::Null) | None => Vec::new(),
            Some(_) => return Err(Error::Invalid("canvas: nodes is not an array".into())),
        };
        let edges = match root.remove("edges") {
            Some(Value::Array(a)) => a.into_iter().map(parse_edge).collect::<Result<Vec<_>>>()?,
            Some(Value::Null) | None => Vec::new(),
            Some(_) => return Err(Error::Invalid("canvas: edges is not an array".into())),
        };
        Ok(Canvas { nodes, edges, extra: root })
    }

    pub fn to_json(&self) -> String {
        let mut root = Map::new();
        root.insert(
            "nodes".into(),
            Value::Array(self.nodes.iter().map(node_json).collect()),
        );
        root.insert(
            "edges".into(),
            Value::Array(self.edges.iter().map(edge_json).collect()),
        );
        for (k, v) in &self.extra {
            root.insert(k.clone(), v.clone());
        }
        // Obsidian writes canvases pretty-printed; matching it keeps diffs and
        // external edits readable.
        let mut s = serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_else(|_| "{}".into());
        s.push('\n');
        s
    }
}

fn want_str(m: &mut Map<String, Value>, key: &str) -> Result<String> {
    match m.remove(key) {
        Some(Value::String(s)) => Ok(s),
        _ => Err(Error::Invalid(format!("canvas: missing {key}"))),
    }
}

fn take_str(m: &mut Map<String, Value>, key: &str) -> Option<String> {
    match m.remove(key) {
        Some(Value::String(s)) => Some(s),
        // A wrong-typed optional is put back, not dropped: preserving what we
        // cannot read beats destroying it.
        Some(other) => {
            m.insert(key.into(), other);
            None
        }
        None => None,
    }
}

/// Coordinates are integers in the spec, but a float here is recoverable and a
/// missing one is not, so round rather than reject.
fn want_int(m: &mut Map<String, Value>, key: &str) -> Result<i64> {
    match m.remove(key) {
        Some(Value::Number(n)) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f.round() as i64))
            .ok_or_else(|| Error::Invalid(format!("canvas: {key} is not a number"))),
        _ => Err(Error::Invalid(format!("canvas: missing {key}"))),
    }
}

fn parse_node(v: Value) -> Result<Node> {
    let mut m = match v {
        Value::Object(m) => m,
        _ => return Err(Error::Invalid("canvas: node is not an object".into())),
    };
    let id = want_str(&mut m, "id")?;
    let kind = match want_str(&mut m, "type")?.as_str() {
        "text" => NodeKind::Text,
        "file" => NodeKind::File,
        "link" => NodeKind::Link,
        "group" => NodeKind::Group,
        other => return Err(Error::Invalid(format!("canvas: unknown node type {other}"))),
    };
    let x = want_int(&mut m, "x")?;
    let y = want_int(&mut m, "y")?;
    let width = want_int(&mut m, "width")?;
    let height = want_int(&mut m, "height")?;
    Ok(Node {
        id,
        kind,
        x,
        y,
        width,
        height,
        color: take_str(&mut m, "color"),
        text: take_str(&mut m, "text"),
        file: take_str(&mut m, "file"),
        subpath: take_str(&mut m, "subpath"),
        url: take_str(&mut m, "url"),
        label: take_str(&mut m, "label"),
        extra: m,
    })
}

fn parse_edge(v: Value) -> Result<Edge> {
    let mut m = match v {
        Value::Object(m) => m,
        _ => return Err(Error::Invalid("canvas: edge is not an object".into())),
    };
    let id = want_str(&mut m, "id")?;
    let from_node = want_str(&mut m, "fromNode")?;
    let to_node = want_str(&mut m, "toNode")?;
    // An unreadable side or end is dropped rather than preserved: both are
    // closed vocabularies, so a value outside them cannot be round-tripped
    // meaningfully. Everything open-ended is kept in `extra`.
    let from_side = take_str(&mut m, "fromSide").and_then(|s| Side::parse(&s));
    let to_side = take_str(&mut m, "toSide").and_then(|s| Side::parse(&s));
    let from_end = take_str(&mut m, "fromEnd").and_then(|s| End::parse(&s));
    let to_end = take_str(&mut m, "toEnd").and_then(|s| End::parse(&s));
    Ok(Edge {
        id,
        from_node,
        from_side,
        from_end,
        to_node,
        to_side,
        to_end,
        color: take_str(&mut m, "color"),
        label: take_str(&mut m, "label"),
        extra: m,
    })
}

fn node_json(n: &Node) -> Value {
    let mut m = Map::new();
    m.insert("id".into(), Value::String(n.id.clone()));
    m.insert("type".into(), Value::String(n.kind.as_str().into()));
    m.insert("x".into(), Value::Number(n.x.into()));
    m.insert("y".into(), Value::Number(n.y.into()));
    m.insert("width".into(), Value::Number(n.width.into()));
    m.insert("height".into(), Value::Number(n.height.into()));
    for (k, v) in [
        ("color", &n.color),
        ("text", &n.text),
        ("file", &n.file),
        ("subpath", &n.subpath),
        ("url", &n.url),
        ("label", &n.label),
    ] {
        if let Some(s) = v {
            m.insert(k.into(), Value::String(s.clone()));
        }
    }
    for (k, v) in &n.extra {
        m.insert(k.clone(), v.clone());
    }
    Value::Object(m)
}

fn edge_json(e: &Edge) -> Value {
    let mut m = Map::new();
    m.insert("id".into(), Value::String(e.id.clone()));
    m.insert("fromNode".into(), Value::String(e.from_node.clone()));
    if let Some(s) = e.from_side {
        m.insert("fromSide".into(), Value::String(s.as_str().into()));
    }
    if let Some(s) = e.from_end {
        m.insert("fromEnd".into(), Value::String(s.as_str().into()));
    }
    m.insert("toNode".into(), Value::String(e.to_node.clone()));
    if let Some(s) = e.to_side {
        m.insert("toSide".into(), Value::String(s.as_str().into()));
    }
    if let Some(s) = e.to_end {
        m.insert("toEnd".into(), Value::String(s.as_str().into()));
    }
    if let Some(s) = &e.color {
        m.insert("color".into(), Value::String(s.clone()));
    }
    if let Some(s) = &e.label {
        m.insert("label".into(), Value::String(s.clone()));
    }
    for (k, v) in &e.extra {
        m.insert(k.clone(), v.clone());
    }
    Value::Object(m)
}

/// The Board file that belongs to a Composition at `path`: the same path with
/// `.canvas` in place of `.md`. A Board has no identity of its own; the pairing
/// is what makes it one Composition's Board (ADR 0009).
pub fn board_path(composition_path: &str) -> String {
    match composition_path.strip_suffix(".md") {
        Some(stem) => format!("{stem}.canvas"),
        None => format!("{composition_path}.canvas"),
    }
}

/// The Composition a Board file belongs to, the inverse of [`board_path`].
pub fn composition_path(board_path: &str) -> Option<String> {
    board_path.strip_suffix(".canvas").map(|s| format!("{s}.md"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // The sample from the JSON Canvas repo, trimmed: one of each node type
    // plus an edge, so the shape of a real file is what gets tested.
    const SAMPLE: &str = r##"{
      "nodes": [
        {"id":"a","type":"text","text":"Endurance is learned","x":-300,"y":-460,"width":260,"height":80},
        {"id":"b","type":"file","file":"Clippings/A.md","subpath":"#Quote","x":40,"y":-460,"width":300,"height":120},
        {"id":"c","type":"group","label":"Point 1","x":-340,"y":-500,"width":720,"height":220},
        {"id":"d","type":"link","url":"https://example.org","x":40,"y":-200,"width":300,"height":120}
      ],
      "edges": [
        {"id":"e1","fromNode":"a","fromSide":"right","toNode":"b","toSide":"left","label":"because","color":"3"}
      ]
    }"##;

    #[test]
    fn parses_every_node_type_and_its_fields() {
        let c = Canvas::parse(SAMPLE).unwrap();
        assert_eq!(c.nodes.len(), 4);
        assert_eq!(c.edges.len(), 1);

        let a = c.node("a").unwrap();
        assert_eq!(a.kind, NodeKind::Text);
        assert_eq!(a.text.as_deref(), Some("Endurance is learned"));
        // Negative coordinates are normal: the spec fixes no origin.
        assert_eq!((a.x, a.y, a.width, a.height), (-300, -460, 260, 80));

        let b = c.node("b").unwrap();
        assert_eq!(b.kind, NodeKind::File);
        assert_eq!(b.file.as_deref(), Some("Clippings/A.md"));
        assert_eq!(b.subpath.as_deref(), Some("#Quote"));

        assert_eq!(c.node("c").unwrap().label.as_deref(), Some("Point 1"));
        assert_eq!(c.node("d").unwrap().url.as_deref(), Some("https://example.org"));

        let e = &c.edges[0];
        assert_eq!((e.from_node.as_str(), e.to_node.as_str()), ("a", "b"));
        assert_eq!(e.from_side, Some(Side::Right));
        assert_eq!(e.to_side, Some(Side::Left));
        assert_eq!(e.label.as_deref(), Some("because"));
        assert_eq!(e.color.as_deref(), Some("3"));
    }

    #[test]
    fn round_trip_is_stable() {
        let c = Canvas::parse(SAMPLE).unwrap();
        let again = Canvas::parse(&c.to_json()).unwrap();
        assert_eq!(c, again);
    }

    // The hard requirement: anything we do not understand survives a round
    // trip, because Obsidian and its plugins write keys this app never will.
    #[test]
    fn unknown_fields_survive_a_round_trip() {
        let src = r#"{
          "nodes": [{"id":"a","type":"text","text":"hi","x":0,"y":0,"width":10,"height":10,
                     "styleAttributes":{"shape":"diamond"},"zoomToFit":true}],
          "edges": [{"id":"e1","fromNode":"a","toNode":"a","thickness":4}],
          "metadata": {"frontmatter": {"tags": ["talk"]}}
        }"#;
        let c = Canvas::parse(src).unwrap();
        assert_eq!(c.nodes[0].extra["styleAttributes"]["shape"], "diamond");
        assert_eq!(c.nodes[0].extra["zoomToFit"], true);
        assert_eq!(c.edges[0].extra["thickness"], 4);
        assert_eq!(c.extra["metadata"]["frontmatter"]["tags"][0], "talk");

        let out = Canvas::parse(&c.to_json()).unwrap();
        assert_eq!(out, c);
        // And they are really in the text, not just in the struct.
        let json = c.to_json();
        assert!(json.contains("\"shape\": \"diamond\""));
        assert!(json.contains("\"thickness\": 4"));
        assert!(json.contains("\"frontmatter\""));
    }

    #[test]
    fn an_optional_field_of_the_wrong_type_is_kept_not_dropped() {
        let src = r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"color":7}]}"#;
        let c = Canvas::parse(src).unwrap();
        assert_eq!(c.nodes[0].color, None);
        assert_eq!(c.nodes[0].extra["color"], 7);
        assert!(c.to_json().contains("\"color\": 7"));
    }

    #[test]
    fn both_top_level_keys_are_optional() {
        let c = Canvas::parse("{}").unwrap();
        assert!(c.is_empty());
        // An empty Board still serialises to a file Obsidian will open.
        let out = Canvas::parse(&c.to_json()).unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn node_order_is_kept_because_it_is_the_z_index() {
        let c = Canvas::parse(SAMPLE).unwrap();
        let ids: Vec<&str> = c.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b", "c", "d"]);
        let again = Canvas::parse(&c.to_json()).unwrap();
        let ids: Vec<&str> = again.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b", "c", "d"]);
    }

    #[test]
    fn a_missing_required_field_is_an_error() {
        let no_id = r#"{"nodes":[{"type":"text","x":0,"y":0,"width":1,"height":1}]}"#;
        assert!(Canvas::parse(no_id).is_err());
        let no_height = r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":1}]}"#;
        assert!(Canvas::parse(no_height).is_err());
        let bad_type = r#"{"nodes":[{"id":"a","type":"sticky","x":0,"y":0,"width":1,"height":1}]}"#;
        assert!(Canvas::parse(bad_type).is_err());
        assert!(Canvas::parse("not json").is_err());
        assert!(Canvas::parse("[]").is_err());
    }

    #[test]
    fn float_coordinates_are_rounded_rather_than_rejected() {
        let src = r#"{"nodes":[{"id":"a","type":"text","x":0.4,"y":-10.6,"width":10.0,"height":10}]}"#;
        let c = Canvas::parse(src).unwrap();
        assert_eq!((c.nodes[0].x, c.nodes[0].y, c.nodes[0].width), (0, -11, 10));
    }

    // Board refs: what the index records, apart from prose links.
    #[test]
    fn targets_are_file_nodes_only_deduplicated_in_order() {
        let src = r##"{"nodes":[
            {"id":"a","type":"file","file":"Notes/B.md","x":0,"y":0,"width":1,"height":1},
            {"id":"b","type":"text","text":"[[Notes/C]]","x":0,"y":0,"width":1,"height":1},
            {"id":"c","type":"file","file":"Notes/A.md","subpath":"#x","x":0,"y":0,"width":1,"height":1},
            {"id":"d","type":"file","file":"Notes/B.md","x":0,"y":0,"width":1,"height":1},
            {"id":"e","type":"link","url":"https://example.org","x":0,"y":0,"width":1,"height":1}
        ]}"##;
        let c = Canvas::parse(src).unwrap();
        // A wikilink typed into a text node is an ordinary Mention, not a
        // Board ref, so it is absent here (PLAN §16.11).
        assert_eq!(c.targets(), vec!["Notes/B.md", "Notes/A.md"]);
    }

    #[test]
    fn rewrite_path_follows_a_renamed_document() {
        let src = r##"{"nodes":[
            {"id":"a","type":"file","file":"Notes/old.md","subpath":"#x","x":0,"y":0,"width":1,"height":1},
            {"id":"b","type":"file","file":"Notes/other.md","x":0,"y":0,"width":1,"height":1}
        ]}"##;
        let mut c = Canvas::parse(src).unwrap();
        assert!(c.rewrite_path("Notes/old.md", "Notes/new.md"));
        assert_eq!(c.node("a").unwrap().file.as_deref(), Some("Notes/new.md"));
        // The subpath is untouched: a rename moves the file, not its headings.
        assert_eq!(c.node("a").unwrap().subpath.as_deref(), Some("#x"));
        assert_eq!(c.node("b").unwrap().file.as_deref(), Some("Notes/other.md"));
        assert!(!c.rewrite_path("Notes/absent.md", "Notes/x.md"));
    }

    #[test]
    fn a_board_is_paired_to_its_composition_by_path() {
        assert_eq!(
            board_path("Compositions/talk on endurance.md"),
            "Compositions/talk on endurance.canvas"
        );
        assert_eq!(
            composition_path("Compositions/talk on endurance.canvas").as_deref(),
            Some("Compositions/talk on endurance.md")
        );
        assert_eq!(composition_path("Notes/a.md"), None);
    }
}
