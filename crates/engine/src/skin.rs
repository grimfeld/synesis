//! Skins (PLAN §22, ADR 0017): named looks for the app, kept in the Vault at
//! `.bible-study/skins/<name>.json`, with the one the Vault wears named in
//! `.bible-study/appearance.json`. Both are config files, so Pairing carries
//! them (ADR 0016).
//!
//! The engine stores and validates the shape; what a seed or an override
//! means is the UI's business (`src/lib/skin.ts`). Keys it does not know are
//! kept, so a Skin written by a newer version survives an edit by an older one.

use crate::config;
use crate::vault::HIDDEN_DIR;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

pub const DIR: &str = "skins";
pub const APPEARANCE: &str = "appearance.json";
/// The Skin file format this engine writes.
pub const VERSION: u32 = 1;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Seeds {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Typography {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prose_font: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_font: Option<String>,
    /// Unitless, as CSS `line-height`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    /// Width of the writing column, in CSS px at 100% Text scale (720 by default).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_width: Option<f64>,
    /// Prose size relative to the default (1 = unchanged). The Device's Text
    /// scale multiplies it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prose_size: Option<f64>,
}

/// One side of a Skin. Everything is optional: what is missing falls back.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinSide {
    #[serde(default)]
    pub seeds: Seeds,
    /// Multiplier on the chroma of document-type, route and decoration colours.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_chroma: Option<f64>,
    /// Stable token name (`surface.card`, `type.place`) -> CSS colour.
    #[serde(default)]
    pub overrides: BTreeMap<String, String>,
    #[serde(default)]
    pub typography: Typography,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skin {
    /// A ULID; empty on a Skin not yet saved in this Vault.
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub light: SkinSide,
    #[serde(default)]
    pub dark: SkinSide,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn default_version() -> u32 {
    VERSION
}

/// What the Vault wears.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    /// The active Skin's id: one in the Vault, or a built-in's (`builtin:…`).
    /// None = the default built-in.
    #[serde(default)]
    pub skin: Option<String>,
}

/// Keys that belong to the config file, not the Skin: never exported, never
/// taken from an imported file.
const FILE_KEYS: &[&str] = &["updated", "deleted"];

fn hidden(root: &Path) -> std::path::PathBuf {
    root.join(HIDDEN_DIR)
}

/// Every live Skin in the Vault with the file it lives in, by name.
fn stored(root: &Path) -> Vec<(String, Skin)> {
    let mut out = Vec::new();
    let Ok(files) = fs::read_dir(hidden(root).join(DIR)) else { return out };
    for f in files.flatten() {
        let file = f.file_name().to_string_lossy().to_string();
        if !config::is_synced(&format!("{DIR}/{file}")) {
            continue;
        }
        let Ok(text) = fs::read_to_string(f.path()) else { continue };
        let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
        if config::is_tombstone(&value) {
            continue;
        }
        if let Ok(skin) = serde_json::from_value::<Skin>(value) {
            if !skin.id.is_empty() {
                out.push((file, skin));
            }
        }
    }
    out.sort_by(|a, b| a.1.name.to_lowercase().cmp(&b.1.name.to_lowercase()));
    out
}

pub fn list(root: &Path) -> Vec<Skin> {
    stored(root).into_iter().map(|(_, s)| strip(s)).collect()
}

fn strip(mut skin: Skin) -> Skin {
    for k in FILE_KEYS {
        skin.extra.remove(*k);
    }
    skin
}

/// A file name for a new Skin, from its name, not taken by a live Skin.
fn file_for(root: &Path, name: &str) -> String {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let slug = if slug.is_empty() { "skin".to_string() } else { slug };
    let taken: Vec<String> = stored(root).into_iter().map(|(f, _)| f).collect();
    let mut n = 1;
    loop {
        let file = if n == 1 { format!("{slug}.json") } else { format!("{slug}-{n}.json") };
        if !taken.contains(&file) {
            return file;
        }
        n += 1;
    }
}

/// Create or update a Skin. A Skin without an id gets one; an existing id
/// keeps its file, whatever it is now called.
pub fn save(root: &Path, skin: Skin) -> Result<Skin> {
    let mut skin = strip(skin);
    skin.name = skin.name.trim().to_string();
    if skin.name.is_empty() {
        return Err(Error::Invalid("a Skin needs a name".into()));
    }
    skin.version = VERSION;
    let existing = if skin.id.is_empty() {
        skin.id = ulid::Ulid::new().to_string();
        None
    } else {
        stored(root).into_iter().find(|(_, s)| s.id == skin.id).map(|(f, _)| f)
    };
    let file = existing.unwrap_or_else(|| file_for(root, &skin.name));
    config::write(&hidden(root), &format!("{DIR}/{file}"), serde_json::to_value(&skin)?)?;
    Ok(skin)
}

/// Delete a Skin, leaving a tombstone so a Paired Device's copy does not
/// bring it back. Unknown ids are a no-op.
pub fn delete(root: &Path, id: &str) -> Result<()> {
    if let Some((file, _)) = stored(root).into_iter().find(|(_, s)| s.id == id) {
        config::delete(&hidden(root), &format!("{DIR}/{file}"))?;
    }
    Ok(())
}

/// Parse a Skin file from outside the Vault, for import. Its id is kept, so
/// the caller can tell a Skin already here from a new one.
pub fn read_file(path: &Path) -> Result<Skin> {
    let text = fs::read_to_string(path)?;
    let skin: Skin = serde_json::from_str(&text)
        .map_err(|e| Error::Invalid(format!("not a Skin file: {e}")))?;
    if skin.name.trim().is_empty() {
        return Err(Error::Invalid("not a Skin file: it has no name".into()));
    }
    Ok(strip(skin))
}

/// Write a Skin to a file outside the Vault, for sharing.
pub fn write_file(skin: &Skin, path: &Path) -> Result<()> {
    let skin = strip(skin.clone());
    fs::write(path, serde_json::to_string_pretty(&skin)? + "\n")?;
    Ok(())
}

pub fn appearance(root: &Path) -> Appearance {
    fs::read_to_string(hidden(root).join(APPEARANCE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn set_appearance(root: &Path, appearance: &Appearance) -> Result<()> {
    config::write(&hidden(root), APPEARANCE, serde_json::to_value(appearance)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn named(name: &str) -> Skin {
        Skin { name: name.into(), ..Default::default() }
    }

    #[test]
    fn save_assigns_an_id_and_a_file_and_keeps_both_on_rename() {
        let d = tempfile::tempdir().unwrap();
        let mut s = save(d.path(), named("Night reading")).unwrap();
        assert_eq!(s.id.len(), 26);
        assert!(d.path().join(".bible-study/skins/night-reading.json").exists());
        s.name = "Late".into();
        s.dark.seeds.background = Some("#101010".into());
        save(d.path(), s.clone()).unwrap();
        let all = list(d.path());
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Late");
        assert_eq!(all[0].dark.seeds.background.as_deref(), Some("#101010"));
        assert!(d.path().join(".bible-study/skins/night-reading.json").exists(), "a rename moved the file");
    }

    #[test]
    fn same_name_gets_its_own_file() {
        let d = tempfile::tempdir().unwrap();
        save(d.path(), named("Sepia")).unwrap();
        save(d.path(), named("Sepia")).unwrap();
        assert!(d.path().join(".bible-study/skins/sepia-2.json").exists());
        assert_eq!(list(d.path()).len(), 2);
    }

    #[test]
    fn delete_leaves_a_tombstone_that_list_skips() {
        let d = tempfile::tempdir().unwrap();
        let s = save(d.path(), named("Gone")).unwrap();
        delete(d.path(), &s.id).unwrap();
        assert!(list(d.path()).is_empty());
        let text = fs::read_to_string(d.path().join(".bible-study/skins/gone.json")).unwrap();
        assert!(text.contains("\"deleted\": true"), "{text}");
    }

    #[test]
    fn unknown_keys_survive_and_file_keys_do_not_leak() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("shared.json");
        fs::write(
            &path,
            r##"{"id":"01ABC","name":"Shared","updated":5,"future":1,"light":{"seeds":{"accent":"#f00"},"glow":true}}"##,
        )
        .unwrap();
        let s = read_file(&path).unwrap();
        assert_eq!(s.id, "01ABC");
        assert!(!s.extra.contains_key("updated"));
        assert_eq!(s.extra.get("future"), Some(&Value::from(1)));
        assert_eq!(s.light.extra.get("glow"), Some(&Value::from(true)));
        let saved = save(d.path(), s).unwrap();
        let out = d.path().join("out.json");
        write_file(&saved, &out).unwrap();
        let text = fs::read_to_string(out).unwrap();
        assert!(text.contains("\"future\"") && text.contains("\"glow\""), "{text}");
        assert!(!text.contains("updated"), "{text}");
    }

    #[test]
    fn files_that_are_not_skins_are_refused() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("x.json");
        fs::write(&path, r#"{"types":{}}"#).unwrap();
        assert!(read_file(&path).is_err());
        fs::write(&path, r#"{"name":"  "}"#).unwrap();
        assert!(read_file(&path).is_err());
    }

    #[test]
    fn appearance_roundtrips_and_defaults() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(appearance(d.path()).skin, None);
        set_appearance(d.path(), &Appearance { skin: Some("builtin:sepia".into()) }).unwrap();
        assert_eq!(appearance(d.path()).skin.as_deref(), Some("builtin:sepia"));
    }
}
