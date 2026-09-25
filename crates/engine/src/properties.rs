//! Property schema (ADR 0006): one type per property name, vault-wide, kept
//! in `.bible-study/properties.json` so it travels with the folder. Built-in
//! names are pre-declared; unknown names are text.

use crate::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const FILE_NAME: &str = "properties.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PropertyType {
    /// Free text.
    Text,
    /// A number (latitude, a count).
    Number,
    /// A Date in the Bible's chronology, written as a reader would say it (ADR 0005).
    Date,
    /// A date in today's calendar, ISO 8601.
    Calendar,
    /// A `[[wikilink]]` to another document.
    Link,
    /// A list of texts or links.
    List,
    /// true / false.
    Checkbox,
}

impl PropertyType {
    pub const ALL: [PropertyType; 7] = [
        PropertyType::Text,
        PropertyType::Number,
        PropertyType::Date,
        PropertyType::Calendar,
        PropertyType::Link,
        PropertyType::List,
        PropertyType::Checkbox,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            PropertyType::Text => "text",
            PropertyType::Number => "number",
            PropertyType::Date => "date",
            PropertyType::Calendar => "calendar",
            PropertyType::Link => "link",
            PropertyType::List => "list",
            PropertyType::Checkbox => "checkbox",
        }
    }

    pub fn parse(s: &str) -> Option<PropertyType> {
        PropertyType::ALL.iter().copied().find(|t| t.as_str() == s)
    }
}

/// Names every vault knows, whether or not the schema file mentions them.
pub const BUILTIN: &[(&str, PropertyType)] = &[
    ("aliases", PropertyType::List),
    ("born", PropertyType::Date),
    ("characters", PropertyType::List),
    // A URL, a vault-relative path, or empty for a Cover the app draws
    // (ADR 0012). Text either way: the path is a reference, not a Link.
    ("cover", PropertyType::Text),
    ("created", PropertyType::Calendar),
    ("date", PropertyType::Calendar),
    ("died", PropertyType::Date),
    ("end", PropertyType::Date),
    ("kind", PropertyType::Text),
    ("lat", PropertyType::Number),
    ("locator", PropertyType::Text),
    ("lon", PropertyType::Number),
    ("modern_name", PropertyType::Text),
    ("occasion", PropertyType::Text),
    ("parent", PropertyType::Link),
    ("place", PropertyType::Link),
    ("places", PropertyType::List),
    ("source", PropertyType::Link),
    ("start", PropertyType::Date),
    ("url", PropertyType::Text),
];

/// Names the app owns; never offered for retyping.
pub const RESERVED: &[&str] = &["id", "type", "title", "tags"];

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct PropertySchema {
    /// Every known name and its type, built-ins included.
    pub types: BTreeMap<String, PropertyType>,
}

impl PropertySchema {
    pub fn builtin() -> PropertySchema {
        PropertySchema {
            types: BUILTIN.iter().map(|(k, t)| (k.to_string(), *t)).collect(),
        }
    }

    fn file(hidden_dir: &Path) -> PathBuf {
        hidden_dir.join(FILE_NAME)
    }

    /// Built-ins overlaid with whatever the schema file declares. A missing or
    /// unreadable file yields the built-ins.
    pub fn load(hidden_dir: &Path) -> PropertySchema {
        let mut schema = PropertySchema::builtin();
        if let Ok(text) = fs::read_to_string(Self::file(hidden_dir)) {
            if let Ok(stored) = serde_json::from_str::<PropertySchema>(&text) {
                for (k, t) in stored.types {
                    if !RESERVED.contains(&k.as_str()) {
                        schema.types.insert(k, t);
                    }
                }
            }
        }
        schema
    }

    /// Write only what differs from the built-ins, so the file stays small and
    /// built-in changes in later versions are picked up.
    pub fn save(&self, hidden_dir: &Path) -> Result<()> {
        let builtin = PropertySchema::builtin();
        let custom: BTreeMap<&String, &PropertyType> = self
            .types
            .iter()
            .filter(|(k, t)| builtin.types.get(*k) != Some(*t))
            .collect();
        // Stamped, so Pairing can tell the newest copy (ADR 0016).
        crate::config::write(hidden_dir, FILE_NAME, serde_json::json!({ "types": custom }))
    }

    pub fn type_of(&self, name: &str) -> PropertyType {
        self.types.get(name).copied().unwrap_or(PropertyType::Text)
    }

    /// Declare or change a name's type. Reserved names are refused.
    pub fn set(&mut self, name: &str, t: PropertyType) -> Result<()> {
        let name = name.trim();
        if name.is_empty() || RESERVED.contains(&name) {
            return Err(crate::Error::Invalid(format!(
                "property name not allowed: {name:?}"
            )));
        }
        self.types.insert(name.to_string(), t);
        Ok(())
    }

    /// Names typed as a Date, for the index and the Timeline.
    pub fn date_names(&self) -> Vec<&str> {
        self.types
            .iter()
            .filter(|(_, t)| **t == PropertyType::Date)
            .map(|(k, _)| k.as_str())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_are_known_and_unknown_is_text() {
        let s = PropertySchema::builtin();
        assert_eq!(s.type_of("lat"), PropertyType::Number);
        assert_eq!(s.type_of("born"), PropertyType::Date);
        assert_eq!(s.type_of("source"), PropertyType::Link);
        assert_eq!(s.type_of("whatever"), PropertyType::Text);
    }

    #[test]
    fn save_writes_only_custom_names_and_load_overlays_them() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = PropertySchema::builtin();
        s.set("anointed", PropertyType::Date).unwrap();
        s.set("modern_name", PropertyType::Text).unwrap(); // same as built-in: not written
        s.save(dir.path()).unwrap();
        let text = fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(text.contains("\"anointed\": \"date\""), "{text}");
        assert!(!text.contains("modern_name"), "{text}");
        let loaded = PropertySchema::load(dir.path());
        assert_eq!(loaded.type_of("anointed"), PropertyType::Date);
        assert_eq!(loaded.type_of("lat"), PropertyType::Number);
        assert!(loaded.date_names().contains(&"anointed"));
    }

    #[test]
    fn reserved_names_and_bad_file_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = PropertySchema::builtin();
        assert!(s.set("type", PropertyType::Number).is_err());
        assert!(s.set("  ", PropertyType::Number).is_err());
        fs::write(dir.path().join(FILE_NAME), "{not json").unwrap();
        assert_eq!(PropertySchema::load(dir.path()), PropertySchema::builtin());
        fs::write(
            dir.path().join(FILE_NAME),
            r#"{"types":{"tags":"number","x":"checkbox"}}"#,
        )
        .unwrap();
        let loaded = PropertySchema::load(dir.path());
        assert_eq!(loaded.type_of("tags"), PropertyType::Text);
        assert_eq!(loaded.type_of("x"), PropertyType::Checkbox);
    }
}
