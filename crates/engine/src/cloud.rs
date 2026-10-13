//! iCloud placeholders (PLAN §7, amended 2026-10-13).
//!
//! iCloud Drive on iOS — and on a Mac with "Optimise Mac Storage" on — evicts
//! a file it thinks is not needed: `Notes/grace.md` disappears and an opaque
//! `Notes/.grace.md.icloud` takes its place until something asks for the file
//! again. To the engine that looks exactly like a deleted document, and every
//! reaction to a deleted document is wrong for an evicted one:
//!
//! - forgetting it drops a Note the user still has from every view;
//! - writing the merged text back to its path creates a second file beside
//!   the cloud copy, which iCloud resolves into a "grace 2.md" conflict;
//! - giving a new document its name, or a new identity to a Vault whose
//!   `vault.json` is evicted, forks what was one thing into two.
//!
//! So an evicted item is treated as present but unreadable: it stays in the
//! index, nothing is written over it or deleted under it, and the shell asks
//! iCloud to download it (`evicted_under`). The watcher sees the real file
//! arrive and indexes it as any other external edit.
//!
//! The placeholder itself is never indexed, never deleted and never written:
//! it is iCloud's file, not the user's.
use std::path::{Path, PathBuf};

const PREFIX: char = '.';
const SUFFIX: &str = ".icloud";

/// The placeholder iCloud leaves for `path` once it evicts it: `dir/.name.icloud`.
pub fn placeholder_of(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    Some(path.with_file_name(format!("{PREFIX}{name}{SUFFIX}")))
}

/// The item a placeholder stands for: `dir/.name.icloud` -> `dir/name`.
pub fn original_of(placeholder: &Path) -> Option<PathBuf> {
    let name = placeholder.file_name()?.to_str()?;
    let inner = name.strip_prefix(PREFIX)?.strip_suffix(SUFFIX)?;
    if inner.is_empty() {
        return None;
    }
    Some(placeholder.with_file_name(inner))
}

/// Whether this is an iCloud placeholder rather than a file of the Vault's.
pub fn is_placeholder(path: &Path) -> bool {
    original_of(path).is_some()
}

/// The item is not on this Device but iCloud holds it: a placeholder sits
/// where it would be. False when the item itself is here, whatever else is.
pub fn is_evicted(path: &Path) -> bool {
    !path.exists() && placeholder_of(path).is_some_and(|p| p.is_file())
}

/// Whether a path is taken — by the item, or by iCloud's stand-in for it.
/// Used wherever the engine picks a free name: a name an evicted file holds
/// is not free, however empty the folder looks.
pub fn occupied(path: &Path) -> bool {
    path.exists() || is_evicted(path)
}

/// Every evicted item under `root`, hidden folders included (the sync
/// snapshots in `.bible-study/sync/` are evicted like anything else), named by
/// the path it will have once downloaded. That is the path iCloud's download
/// call takes, and the one the engine will see appear.
pub fn evicted_under(root: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| original_of(e.path()))
        // A placeholder beside its own original is a leftover of a download
        // in progress, not an eviction.
        .filter(|p| !p.exists())
        .collect()
}

/// The error for touching an item that is still in iCloud. Phrased for the
/// user: it reaches them through whatever action they tried.
pub fn downloading(path: &Path) -> crate::Error {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    crate::Error::Invalid(format!(
        "“{name}” is still in iCloud and is downloading to this device. Try again once it has arrived."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp() -> PathBuf {
        let p = std::env::temp_dir().join(format!("synesis-cloud-{}", ulid::Ulid::new()));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn names_round_trip() {
        let p = Path::new("Notes/grace.md");
        let ph = placeholder_of(p).unwrap();
        assert_eq!(ph, Path::new("Notes/.grace.md.icloud"));
        assert_eq!(original_of(&ph).unwrap(), p);
        assert!(is_placeholder(&ph));
        assert!(!is_placeholder(p));
        // Hidden files have placeholders too: `.x` -> `..x.icloud`.
        assert_eq!(original_of(Path::new("..x.icloud")).unwrap(), Path::new(".x"));
        // Not every file ending in .icloud is a placeholder.
        assert!(original_of(Path::new("notes.icloud")).is_none());
        assert!(original_of(Path::new("..icloud")).is_none());
    }

    #[test]
    fn evicted_means_placeholder_without_original() {
        let root = tmp();
        let doc = root.join("grace.md");
        assert!(!is_evicted(&doc));
        assert!(!occupied(&doc));
        fs::write(root.join(".grace.md.icloud"), b"bplist").unwrap();
        assert!(is_evicted(&doc));
        assert!(occupied(&doc));
        fs::write(&doc, "back").unwrap();
        assert!(!is_evicted(&doc), "a downloaded file is present, whatever is beside it");
        assert!(occupied(&doc));
    }

    #[test]
    fn finds_evictions_in_hidden_folders() {
        let root = tmp();
        let sync = root.join(".bible-study/sync/DEV");
        fs::create_dir_all(&sync).unwrap();
        fs::create_dir_all(root.join("Notes")).unwrap();
        fs::write(sync.join(".01J.loro.icloud"), b"").unwrap();
        fs::write(root.join("Notes/.grace.md.icloud"), b"").unwrap();
        fs::write(root.join("Notes/kept.md"), "x").unwrap();
        // Downloaded, placeholder not yet cleaned up: not evicted.
        fs::write(root.join("Notes/.kept.md.icloud"), b"").unwrap();
        let mut found = evicted_under(&root);
        found.sort();
        assert_eq!(found, vec![sync.join("01J.loro"), root.join("Notes/grace.md")]);
    }
}
