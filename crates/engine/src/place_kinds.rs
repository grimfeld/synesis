//! The Vault's custom Place kinds (PLAN §27.4), in `.bible-study/place-kinds.json`.
//!
//! A Place's `kind:` is free text (ADR 0006), so `kind: oasis` is already a
//! kind; what a custom kind adds is its pin — a label for the legend and one
//! icon from the app's curated set. The five built-in kinds are not stored:
//! they ship with the app, like the built-in Skins.
//!
//! One config file for the whole list, so Pairing carries it whole and the
//! newest write wins (ADR 0016). Deleting a kind never touches a Place: its
//! `kind:` text stays, and it draws the plain pin.

use crate::config;
use crate::vault::HIDDEN_DIR;
use crate::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;

pub const FILE: &str = "place-kinds.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomKind {
    /// The `kind:` text it answers to.
    pub name: String,
    /// What the legend and the picker call it.
    #[serde(default)]
    pub label: String,
    /// A name from the UI's curated icon set. Unknown names draw the plain pin.
    #[serde(default)]
    pub icon: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct File {
    #[serde(default)]
    kinds: Vec<CustomKind>,
}

/// The custom kinds, in the order they were made. A missing, unreadable or
/// deleted file is no custom kinds, not an error: the built-ins still draw.
pub fn list(root: &Path) -> Vec<CustomKind> {
    let Ok(text) = fs::read_to_string(root.join(HIDDEN_DIR).join(FILE)) else {
        return vec![];
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return vec![];
    };
    if config::is_tombstone(&value) {
        return vec![];
    }
    serde_json::from_value::<File>(value)
        .map(|f| f.kinds)
        .unwrap_or_default()
        .into_iter()
        .filter(|k| !k.name.trim().is_empty())
        .collect()
}

/// Replace the whole list. Names are trimmed and a blank one is dropped; the
/// UI resolves duplicates by shadowing, so nothing else is refused here.
pub fn save(root: &Path, kinds: &[CustomKind]) -> Result<()> {
    let kinds: Vec<CustomKind> = kinds
        .iter()
        .filter(|k| !k.name.trim().is_empty())
        .map(|k| CustomKind {
            name: k.name.trim().to_string(),
            label: k.label.trim().to_string(),
            icon: k.icon.trim().to_string(),
        })
        .collect();
    config::write(
        &root.join(HIDDEN_DIR),
        FILE,
        serde_json::to_value(File { kinds })?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(name: &str, icon: &str) -> CustomKind {
        CustomKind {
            name: name.into(),
            label: name.into(),
            icon: icon.into(),
        }
    }

    #[test]
    fn round_trips_in_order_and_syncs_as_config() {
        let d = tempfile::tempdir().unwrap();
        assert!(list(d.path()).is_empty(), "no file is no custom kinds");
        save(
            d.path(),
            &[
                kind("oasis", "palmtree"),
                kind(" camp ", "tent"),
                kind("  ", "x"),
            ],
        )
        .unwrap();
        let got = list(d.path());
        assert_eq!(
            got.iter().map(|k| k.name.as_str()).collect::<Vec<_>>(),
            ["oasis", "camp"]
        );
        assert_eq!(got[1].icon, "tent");
        assert!(config::is_synced(FILE), "Pairing must carry custom kinds");
        let manifest = config::manifest(&d.path().join(HIDDEN_DIR));
        assert!(manifest.iter().any(|e| e.name == FILE));
    }

    #[test]
    fn a_tombstone_or_garbage_is_no_custom_kinds() {
        let d = tempfile::tempdir().unwrap();
        save(d.path(), &[kind("oasis", "palmtree")]).unwrap();
        config::delete(&d.path().join(HIDDEN_DIR), FILE).unwrap();
        assert!(list(d.path()).is_empty());
        fs::write(d.path().join(HIDDEN_DIR).join(FILE), "not json").unwrap();
        assert!(list(d.path()).is_empty());
    }
}
