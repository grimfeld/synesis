//! Pictures kept in the vault: copied into `Attachments/`, downscaled on the
//! way in, and read back as bytes (ADR 0012).
//!
//! Attachments are referenced, never indexed. The vault scanner reads `.md`
//! only, so nothing here becomes a row in `documents` — an image has no title,
//! body, links or type, and indexing one would put it in the sidebar, in
//! search and in the graph to no purpose. The only thing that knows an
//! attachment exists is the `cover` property naming it.
//!
//! Everything is copied in rather than linked to. A vault pointing at
//! `C:\Users\…\Downloads\cover.jpg` breaks the moment it syncs to another
//! Device, and breaks in Obsidian; copying is what keeps the vault whole.
use crate::{Error, Result};
use std::path::{Path, PathBuf};

/// Where pictures live, relative to the vault root.
pub const FOLDER: &str = "Attachments";

/// The longest edge a stored picture keeps.
///
/// Covers are read back as data URLs, which are base64 and so a third larger
/// again than the bytes; a shelf of full-resolution scans would be megabytes
/// of string handed to the webview. A Cover is a thumbnail — this is the size
/// it is actually drawn at, near enough.
pub const MAX_EDGE: u32 = 600;

/// Extensions accepted on the way in, and the media type each is served as.
///
/// A closed list, because the value ends up in a `data:` URL: anything whose
/// type we cannot name cannot be displayed, and guessing is how an HTML file
/// ends up served as an image.
const TYPES: &[(&str, &str)] = &[
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("png", "image/png"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
];

/// The media type for a stored picture, by extension.
pub fn media_type(path: &str) -> Option<&'static str> {
    let ext = Path::new(path)
        .extension()?
        .to_str()?
        .to_ascii_lowercase();
    TYPES.iter().find(|(e, _)| *e == ext).map(|(_, m)| *m)
}

/// Whether this file is one we are prepared to store and serve.
pub fn is_supported(path: &str) -> bool {
    media_type(path).is_some()
}

/// A vault-relative path inside `Attachments/` that no file holds yet.
///
/// Named after the Source it covers, so the folder stays legible to someone
/// browsing the vault in Obsidian rather than being a heap of hashes.
///
/// An empty title is an error rather than an "untitled" fallback. The name is
/// the only thing tying a picture back to the Source that uses it — nothing
/// indexes attachments (ADR 0012) — so `untitled.jpg`, and then `untitled
/// 2.jpg`, is a folder nobody can read. A caller with no title yet must wait
/// until it has one.
pub fn unique_path(root: &Path, title: &str, ext: &str) -> Result<String> {
    let base = crate::vault::sanitize_title(title).to_lowercase();
    if title.trim().is_empty() || base == "untitled" {
        return Err(Error::Invalid(
            "a Cover needs the Source's title to be named after".into(),
        ));
    }
    let mut n = 1;
    loop {
        let name = if n == 1 {
            format!("{base}.{ext}")
        } else {
            format!("{base} {n}.{ext}")
        };
        let rel = format!("{FOLDER}/{name}");
        if !root.join(&rel).exists() {
            return Ok(rel);
        }
        n += 1;
    }
}

/// Guard a vault-relative path read from a `cover` property.
///
/// The value comes out of a file the user (or a sync peer) may have written by
/// hand, and it is handed straight to the filesystem, so `../../secrets` must
/// not resolve. Only a plain relative path inside the vault is accepted.
pub fn safe_relative(root: &Path, rel: &str) -> Result<PathBuf> {
    let rel = rel.replace('\\', "/");
    if rel.is_empty()
        || rel.starts_with('/')
        || rel.contains("..")
        || Path::new(&rel).is_absolute()
        || rel.chars().nth(1) == Some(':')
    {
        return Err(Error::Invalid(format!("not a vault path: {rel}")));
    }
    if !is_supported(&rel) {
        return Err(Error::Invalid(format!("not an image: {rel}")));
    }
    Ok(root.join(rel))
}

/// Shrink so the longest edge is at most `MAX_EDGE`, keeping the aspect ratio.
/// Returns `None` when the picture is already small enough to store as it is.
pub fn target_size(w: u32, h: u32, max: u32) -> Option<(u32, u32)> {
    let longest = w.max(h);
    if longest <= max || longest == 0 {
        return None;
    }
    let scale = max as f64 / longest as f64;
    Some((
        ((w as f64 * scale).round() as u32).max(1),
        ((h as f64 * scale).round() as u32).max(1),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_types_are_named_not_guessed() {
        assert_eq!(media_type("Attachments/a.jpg"), Some("image/jpeg"));
        assert_eq!(media_type("Attachments/a.JPEG"), Some("image/jpeg"));
        assert_eq!(media_type("Attachments/a.png"), Some("image/png"));
        assert_eq!(media_type("Attachments/a.webp"), Some("image/webp"));
        // Not an image, and so never served as one.
        assert_eq!(media_type("Attachments/a.svg"), None);
        assert_eq!(media_type("Attachments/a.html"), None);
        assert_eq!(media_type("Attachments/a"), None);
    }

    #[test]
    fn a_cover_path_cannot_climb_out_of_the_vault() {
        let root = Path::new("/vault");
        // The value is hand-editable and arrives from sync, so it is checked
        // rather than trusted.
        assert!(safe_relative(root, "../secrets.png").is_err());
        assert!(safe_relative(root, "Attachments/../../x.png").is_err());
        assert!(safe_relative(root, "/etc/passwd.png").is_err());
        assert!(safe_relative(root, "C:/Windows/a.png").is_err());
        assert!(safe_relative(root, "").is_err());
        // Nor can it name something that is not an image.
        assert!(safe_relative(root, "Notes/secret.md").is_err());
        assert!(safe_relative(root, "Attachments/ok.png").is_ok());
    }

    #[test]
    fn a_windows_separator_is_still_a_vault_path() {
        let root = Path::new("/vault");
        assert!(safe_relative(root, "Attachments\\cover.png").is_ok());
        assert!(safe_relative(root, "..\\secrets.png").is_err());
    }

    #[test]
    fn only_pictures_past_the_cap_are_shrunk() {
        assert_eq!(target_size(400, 300, 600), None, "already small enough");
        assert_eq!(target_size(600, 600, 600), None, "exactly the cap");
        assert_eq!(target_size(1200, 900, 600), Some((600, 450)));
        assert_eq!(target_size(900, 1800, 600), Some((300, 600)));
        // A very thin picture keeps at least one pixel rather than collapsing.
        assert_eq!(target_size(10_000, 3, 600), Some((600, 1)));
    }

    #[test]
    fn attachments_are_named_after_the_source_they_cover() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(FOLDER)).unwrap();
        let first = unique_path(root, "Insight on the Scriptures", "jpg").unwrap();
        assert_eq!(first, "Attachments/insight on the scriptures.jpg");
        // A second picture for the same title does not overwrite the first.
        std::fs::write(root.join(&first), b"x").unwrap();
        let second = unique_path(root, "Insight on the Scriptures", "jpg").unwrap();
        assert_eq!(second, "Attachments/insight on the scriptures 2.jpg");
    }

    #[test]
    fn a_cover_is_refused_until_the_source_has_a_title() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(FOLDER)).unwrap();
        // The file name is the only thing tying a picture back to its Source,
        // so "untitled.jpg" — and then "untitled 2.jpg" — is not a fallback,
        // it is a folder nobody can read. The caller waits for the title.
        assert!(unique_path(dir.path(), "", "png").is_err());
        assert!(unique_path(dir.path(), "   ", "png").is_err());
        // A title that sanitises away to nothing is the same case.
        assert!(unique_path(dir.path(), "///", "png").is_err());
    }
}
