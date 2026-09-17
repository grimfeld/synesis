//! What a Vault is, as opposed to where it happens to sit (ADR 0014).
//!
//! A Vault used to be identified by nothing but its folder, so two Vaults that
//! landed on one path became one Vault and nothing could notice. That is not
//! hypothetical: a phone joined a second Vault into the folder that already
//! held the demo one, the CRDT merged both sets as it is designed to, and the
//! merge synced back to the desktop.
//!
//! So a Vault carries a ULID and a name in `.bible-study/vault.json`, written
//! once and never changed. An Invite names the Vault id it is for, and joining
//! refuses a folder that already holds a different one.
//!
//! `.bible-study/` is hidden from Obsidian, so the vault is still a plain
//! folder of markdown (ADR 0003).
use crate::vault::HIDDEN_DIR;
use crate::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// The file that says which Vault this folder is.
const FILE: &str = "vault.json";

/// A Vault's own identity: what it is, and what to call it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultMeta {
    /// Written once when the Vault comes into being; never changed.
    pub id: String,
    /// Shown wherever a Vault is named. Travels with the Vault, so the same
    /// Vault reads the same on every Device however each one filed it.
    pub name: String,
}

impl VaultMeta {
    fn path(root: &Path) -> std::path::PathBuf {
        root.join(HIDDEN_DIR).join(FILE)
    }

    /// What this folder says it is, or `None` if it has never said.
    pub fn read(root: &Path) -> Option<VaultMeta> {
        let text = fs::read_to_string(Self::path(root)).ok()?;
        serde_json::from_str(&text).ok()
    }

    pub fn write(&self, root: &Path) -> Result<()> {
        let dir = root.join(HIDDEN_DIR);
        fs::create_dir_all(&dir)?;
        fs::write(Self::path(root), serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    /// The identity this folder already has, or a new one written in passing.
    ///
    /// A Vault that predates ids is adopted rather than refused: it is a Vault
    /// the user has been using, and the name of its folder is the best thing
    /// to call it. Two Devices adopting separate copies of one pre-existing
    /// Vault will invent different ids, and the first join between them says
    /// so — which is the right answer for two folders that have diverged.
    pub fn adopt(root: &Path) -> Result<VaultMeta> {
        if let Some(m) = Self::read(root) {
            return Ok(m);
        }
        let name = root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| "Vault".to_string());
        let meta = VaultMeta {
            id: ulid::Ulid::new().to_string(),
            name,
        };
        meta.write(root)?;
        Ok(meta)
    }
}

/// Why a folder cannot be joined.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum JoinCheck {
    /// Nothing here yet, or a folder that holds no Vault: adopt the invited id.
    Free,
    /// The Vault being joined is the one already here: a re-pair or a
    /// reinstall, which is ordinary.
    Same,
    /// Another Vault lives here. Joining would merge them, permanently, and
    /// that is never what anyone meant.
    Occupied { name: String, id: String },
}

/// Whether `root` can receive the Vault `invited_id`.
///
/// The check ADR 0014 exists for. A folder with documents but no `vault.json`
/// counts as occupied: it is someone's Vault from before ids, and merging into
/// it would lose exactly what this is meant to protect.
pub fn check_join(root: &Path, invited_id: &str) -> JoinCheck {
    if let Some(m) = VaultMeta::read(root) {
        return if m.id == invited_id {
            JoinCheck::Same
        } else {
            JoinCheck::Occupied {
                name: m.name,
                id: m.id,
            }
        };
    }
    if holds_documents(root) {
        return JoinCheck::Occupied {
            name: root
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Vault".into()),
            id: String::new(),
        };
    }
    JoinCheck::Free
}

/// Whether the folder already holds markdown, at any depth.
///
/// Stops at the first one: the question is "is anything here", not how much.
fn holds_documents(root: &Path) -> bool {
    walkdir::WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| e.file_name() != std::ffi::OsStr::new(HIDDEN_DIR))
        .filter_map(|e| e.ok())
        .any(|e| e.path().extension().is_some_and(|x| x == "md"))
}

/// A folder name for a Vault called `name`, free within `parent`.
///
/// The mobile join used to propose one fixed folder for every Vault, which is
/// how two of them came to share one. Naming it after the Vault means the
/// suggestion is right by default, and the suffix keeps it right when two
/// Vaults share a name.
pub fn free_path(parent: &Path, name: &str) -> std::path::PathBuf {
    let stem = crate::vault::sanitize_title(name);
    let first = parent.join(&stem);
    if !first.exists() {
        return first;
    }
    for n in 2..1000 {
        let p = parent.join(format!("{stem} {n}"));
        if !p.exists() {
            return p;
        }
    }
    first
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("synesis-meta-{}", ulid::Ulid::new()));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn a_vault_keeps_the_identity_it_was_given() {
        let root = tmp();
        let first = VaultMeta::adopt(&root).unwrap();
        let again = VaultMeta::adopt(&root).unwrap();
        assert_eq!(first, again, "adopting twice must not mint a new id");
    }

    #[test]
    fn a_vault_from_before_ids_is_named_after_its_folder() {
        let root = tmp().join("main");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a note.md"), "hello").unwrap();
        let m = VaultMeta::adopt(&root).unwrap();
        assert_eq!(m.name, "main");
        assert!(!m.id.is_empty());
    }

    #[test]
    fn an_empty_folder_is_free_to_join() {
        let root = tmp();
        assert_eq!(check_join(&root, "01ABC"), JoinCheck::Free);
    }

    #[test]
    fn rejoining_the_same_vault_is_allowed() {
        let root = tmp();
        let m = VaultMeta::adopt(&root).unwrap();
        assert_eq!(check_join(&root, &m.id), JoinCheck::Same);
    }

    #[test]
    fn a_folder_holding_another_vault_is_refused() {
        // The bug this exists for: joining `main` into the folder that already
        // held the demo Vault merged the two.
        let root = tmp();
        let demo = VaultMeta {
            id: "01DEMO".into(),
            name: "demo".into(),
        };
        demo.write(&root).unwrap();
        match check_join(&root, "01MAIN") {
            JoinCheck::Occupied { name, id } => {
                assert_eq!(name, "demo");
                assert_eq!(id, "01DEMO");
            }
            other => panic!("expected the folder to be refused, got {other:?}"),
        }
    }

    #[test]
    fn a_folder_with_documents_but_no_id_is_refused_too() {
        // Someone's Vault from before ids. Merging into it is the thing that
        // must not happen, whether or not it can name itself.
        let root = tmp();
        fs::create_dir_all(root.join("Notes")).unwrap();
        fs::write(root.join("Notes").join("mine.md"), "my work").unwrap();
        assert!(matches!(
            check_join(&root, "01MAIN"),
            JoinCheck::Occupied { .. }
        ));
    }

    #[test]
    fn a_suggested_folder_steps_aside_for_one_that_exists() {
        let parent = tmp();
        assert_eq!(free_path(&parent, "main"), parent.join("main"));
        fs::create_dir_all(parent.join("main")).unwrap();
        assert_eq!(free_path(&parent, "main"), parent.join("main 2"));
    }
}
