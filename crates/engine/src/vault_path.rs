//! Paths inside a Vault.
//!
//! Every vault-relative path the engine is handed comes from somewhere it does
//! not control: the UI, a file's frontmatter, another Device's snapshot. A
//! [`VaultPath`] is one that has been checked to name something under the
//! Vault's folder, and [`VaultPath::under`] is the one way to turn it into a
//! filesystem path, so a path that leaves the Vault cannot be expressed:
//!
//! - by its shape: no absolute path, no `..` or `.`, no empty segment, no
//!   backslash, no drive or stream `:`, no control character;
//! - by what is on disk: a symbolic link is followed only when what it points
//!   at is inside the Vault's folder too (#86). A Vault shared through git or a
//!   cloud folder could otherwise carry a link to a private file elsewhere, and
//!   the app would read it into a Note and sync it to every Device.

use crate::{Error, Result};
use std::fmt;
use std::path::{Path, PathBuf};

/// A checked vault-relative path, `/`-separated.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct VaultPath(String);

impl VaultPath {
    /// Check `rel`'s shape. Hidden folders such as `.bible-study` are allowed:
    /// whether a path names a document is [`crate::vault::is_document_path`]'s
    /// question, not this one's.
    pub fn parse(rel: &str) -> Result<VaultPath> {
        let ok = !rel.is_empty()
            && !rel.contains('\\')
            && !rel.contains(':')
            && !rel.chars().any(char::is_control)
            && rel
                .split('/')
                .all(|seg| !seg.is_empty() && seg != "." && seg != "..");
        if ok {
            Ok(VaultPath(rel.to_string()))
        } else {
            Err(Error::Invalid(format!(
                "not a path inside the Vault: {rel}"
            )))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The filesystem path under `root`. Refused when a symbolic link on the
    /// way leads out of `root`.
    pub fn under(&self, root: &Path) -> Result<PathBuf> {
        let abs = self
            .0
            .split('/')
            .fold(root.to_path_buf(), |p, seg| p.join(seg));
        if confined(root, &abs) {
            Ok(abs)
        } else {
            Err(Error::Invalid(format!(
                "{} leads outside the Vault",
                self.0
            )))
        }
    }
}

impl fmt::Display for VaultPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Whether `abs`, a path under `root`, stays inside `root` once symbolic links
/// are followed. A path that does not exist yet is judged by the nearest folder
/// above it that does, since that is where a write would land.
pub fn confined(root: &Path, abs: &Path) -> bool {
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    let mut at = abs;
    loop {
        // `symlink_metadata` sees a dangling link, which `canonicalize` cannot
        // resolve: such a link would be written through, so it is refused.
        if at.symlink_metadata().is_ok() {
            return at.canonicalize().is_ok_and(|real| real.starts_with(&root));
        }
        match at.parent() {
            Some(parent) => at = parent,
            None => return false,
        }
    }
}

/// Whether the file at `abs` is itself a symbolic link. The Vault's walk does
/// not follow links (a linked Note would be the same file twice), so neither
/// does anything that looks at one file.
pub fn is_link(abs: &Path) -> bool {
    abs.symlink_metadata()
        .is_ok_and(|m| m.file_type().is_symlink())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_that_leaves_the_vault_cannot_be_parsed() {
        for bad in [
            "",
            "/etc/passwd",
            "../x.md",
            "Notes/../../x.md",
            "Notes/./a.md",
            "Notes//a.md",
            "Notes/",
            "C:/Windows/a.md",
            "Notes\\a.md",
            "a.md:stream",
            "a\0.md",
        ] {
            assert!(VaultPath::parse(bad).is_err(), "{bad:?} parsed");
        }
        for good in [
            "a.md",
            "Notes/a b.md",
            ".bible-study/x.json",
            "Notes/..a.md",
        ] {
            assert!(VaultPath::parse(good).is_ok(), "{good:?} refused");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_followed_only_inside_the_vault() {
        let vault = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = vault.path();
        std::fs::create_dir_all(root.join("Notes")).unwrap();
        std::fs::write(root.join("Notes/real.md"), "x").unwrap();
        std::fs::write(outside.path().join("id_rsa"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("id_rsa"), root.join("Notes/key.md"))
            .unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("Elsewhere")).unwrap();
        std::os::unix::fs::symlink(root.join("Notes/real.md"), root.join("Notes/alias.md"))
            .unwrap();
        std::os::unix::fs::symlink(root.join("Notes"), root.join("Linked")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("gone"), root.join("Notes/dangling.md"))
            .unwrap();

        let under = |rel: &str| VaultPath::parse(rel).unwrap().under(root);
        assert!(under("Notes/key.md").is_err());
        assert!(
            under("Elsewhere/new.md").is_err(),
            "a write through a linked folder"
        );
        assert!(under("Notes/dangling.md").is_err());
        assert!(under("Notes/alias.md").is_ok());
        assert!(under("Linked/real.md").is_ok());
        assert!(under("Notes/new.md").is_ok());
        assert!(under("New folder/new.md").is_ok());
        assert!(is_link(&root.join("Notes/alias.md")));
        assert!(!is_link(&root.join("Notes/real.md")));
    }
}
