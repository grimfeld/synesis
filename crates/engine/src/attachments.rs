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
    Ok(free_path(root, &base, ext))
}

/// The first of `base.ext`, `base 2.ext`, `base 3.ext`… that no file holds.
fn free_path(root: &Path, base: &str, ext: &str) -> String {
    let mut n = 1;
    loop {
        let name = if n == 1 {
            format!("{base}.{ext}")
        } else {
            format!("{base} {n}.{ext}")
        };
        let rel = format!("{FOLDER}/{name}");
        if !root.join(&rel).exists() {
            return rel;
        }
        n += 1;
    }
}

/// The longest edge a stored Picture keeps (ADR 0018).
///
/// A Cover is a thumbnail; a Picture is read, and a map or a scanned page has
/// small print. 1600 covers the prose column on a high-density screen while
/// keeping a Picture near a megabyte, since every one is carried to every
/// Device and read back as a data URL.
pub const PICTURE_MAX_EDGE: u32 = 1600;

/// A Picture as it appears in text: `![[…]]` naming a picture file, or
/// markdown's `![alt](path)`. Passage detection, Tags and links all step
/// around it, so a Picture named `1 john 3.png` is not a Mention of 1 John 3.
pub const PICTURE_SYNTAX: &str =
    r"!\[\[[^\[\]\n]*\.(?i:png|jpe?g|gif|webp)(?:\|[^\[\]\n]*)?\]\]|!\[[^\]\n]*\]\([^)\n]*\)";

/// Whether a `![[…]]` target names a Picture rather than a document.
///
/// Decided by extension alone: a Picture is not indexed (ADR 0018), so there
/// is nothing to look it up in, and no document ends in `.png`.
pub fn is_picture_target(target: &str) -> bool {
    let target = target.split('|').next().unwrap_or(target).trim();
    is_supported(target)
}

/// A vault-relative path for a new Picture, named after the document that
/// holds it (ADR 0018). A document with no title yet, a Quick capture say,
/// names it after the moment it was dropped instead: `2026-09-26 101512.png`.
///
/// Brackets, `#` and `^` are dropped as well as what a file name cannot hold,
/// because the name is written inside `![[…]]`, where they mean something.
pub fn picture_path(root: &Path, title: &str, ext: &str, now: chrono::NaiveDateTime) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if matches!(c, '[' | ']' | '#' | '^') { ' ' } else { c })
        .collect();
    let base = crate::vault::sanitize_title(&cleaned).to_lowercase();
    let base = if cleaned.trim().is_empty() || base == "untitled" {
        now.format("%Y-%m-%d %H%M%S").to_string()
    } else {
        base
    };
    free_path(root, &base, ext)
}

/// Shrink a picture so its longest edge is at most `max`, or hand back the
/// original bytes when it is already small enough and in a format we serve.
///
/// Re-encodes as PNG or JPEG only: a WebP would need an encoder we do not
/// ship. A GIF is kept whole when `keep_gif` is set, because resizing drops
/// its animation — a Picture wants the animation, a Cover wants the size.
pub fn shrink(bytes: &[u8], ext: &str, max: u32, keep_gif: bool) -> Result<(Vec<u8>, String)> {
    let not_an_image = |e: image::ImageError| Error::Invalid(format!("not an image: {e}"));
    if keep_gif && ext == "gif" {
        // Checked, not trusted: the bytes must really be a GIF.
        return match image::guess_format(bytes) {
            Ok(image::ImageFormat::Gif) => Ok((bytes.to_vec(), "gif".into())),
            _ => Err(Error::Invalid("not an image: not a GIF".into())),
        };
    }
    let img = image::load_from_memory(bytes).map_err(not_an_image)?;
    let keep_jpeg = matches!(ext, "jpg" | "jpeg");
    match target_size(img.width(), img.height(), max) {
        None if keep_jpeg || ext == "png" => Ok((bytes.to_vec(), ext.to_string())),
        size => {
            let img = match size {
                Some((tw, th)) => img.resize(tw, th, image::imageops::FilterType::Lanczos3),
                None => img,
            };
            let mut out = std::io::Cursor::new(Vec::new());
            let (fmt, ext) = if keep_jpeg {
                (image::ImageFormat::Jpeg, "jpg")
            } else {
                (image::ImageFormat::Png, "png")
            };
            // JPEG has no alpha; flatten rather than fail on a transparent source.
            let img = if fmt == image::ImageFormat::Jpeg {
                image::DynamicImage::ImageRgb8(img.to_rgb8())
            } else {
                img
            };
            img.write_to(&mut out, fmt).map_err(not_an_image)?;
            Ok((out.into_inner(), ext.to_string()))
        }
    }
}

/// The vault-relative path of the file a Picture names, if there is one.
///
/// The app writes the full path, but Obsidian writes the shortest one, so
/// `![[athens.png]]` is looked for in `Attachments/` too (ADR 0018). Nothing
/// indexes pictures, so this is a look at the disk, not a query.
pub fn locate_picture(root: &Path, target: &str) -> Option<String> {
    let target = target.split('|').next().unwrap_or(target).trim().replace('\\', "/");
    let name = target.rsplit('/').next().unwrap_or(&target).to_string();
    [target.clone(), format!("{FOLDER}/{name}")]
        .into_iter()
        .find(|rel| safe_relative(root, rel).is_ok_and(|abs| abs.is_file()))
}

/// Copy a Picture into `Attachments/`, shrunk, and return the vault-relative
/// path to write inside `![[…]]` (ADR 0018). `file_name` is only read for its
/// extension; the name comes from `title`.
pub fn store_picture(
    root: &Path,
    title: &str,
    file_name: &str,
    bytes: &[u8],
    now: chrono::NaiveDateTime,
) -> Result<String> {
    if !is_supported(file_name) {
        return Err(Error::Invalid(format!("not a picture we can store: {file_name}")));
    }
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let (bytes, ext) = shrink(bytes, &ext, PICTURE_MAX_EDGE, true)?;
    let rel = picture_path(root, title, &ext, now);
    let abs = root.join(&rel);
    if let Some(dir) = abs.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&abs, &bytes)?;
    Ok(rel)
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

    /// A solid image of the given size, as PNG bytes.
    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([10, 20, 30]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    /// A half-transparent image, to prove JPEG gets a flattened copy.
    fn png_with_alpha(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([10, 20, 30, 128]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    fn gif(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([10, 20, 30, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Gif)
            .unwrap();
        out.into_inner()
    }

    fn size_of(bytes: &[u8]) -> (u32, u32) {
        let img = image::load_from_memory(bytes).unwrap();
        (img.width(), img.height())
    }

    fn noon() -> chrono::NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(2026, 9, 26)
            .unwrap()
            .and_hms_opt(10, 15, 12)
            .unwrap()
    }

    #[test]
    fn a_small_picture_is_stored_exactly_as_it_arrived() {
        // Nothing to gain by re-encoding: the bytes the user picked are kept.
        let bytes = png(100, 80);
        let (out, ext) = shrink(&bytes, "png", MAX_EDGE, false).unwrap();
        assert_eq!(ext, "png");
        assert_eq!(out, bytes);
    }

    #[test]
    fn an_oversize_picture_is_shrunk_to_the_longest_edge() {
        let (out, _) = shrink(&png(1800, 900), "png", MAX_EDGE, false).unwrap();
        // The aspect ratio is kept, so a 2:1 picture stays 2:1.
        assert_eq!(size_of(&out), (MAX_EDGE, MAX_EDGE / 2));
    }

    #[test]
    fn a_jpeg_stays_a_jpeg_and_everything_else_becomes_a_png() {
        // A WebP would need an encoder we do not ship, so the output format
        // is not always the input's.
        let (_, ext) = shrink(&png(1800, 900), "jpg", MAX_EDGE, false).unwrap();
        assert_eq!(ext, "jpg");
        let (_, ext) = shrink(&png(1800, 900), "gif", MAX_EDGE, false).unwrap();
        assert_eq!(ext, "png");
        let (_, ext) = shrink(&png(1800, 900), "webp", MAX_EDGE, false).unwrap();
        assert_eq!(ext, "png");
    }

    #[test]
    fn a_transparent_picture_can_still_be_written_as_a_jpeg() {
        // JPEG has no alpha; flattening rather than failing is the rule.
        let (out, ext) = shrink(&png_with_alpha(1200, 1200), "jpg", MAX_EDGE, false).unwrap();
        assert_eq!(ext, "jpg");
        assert_eq!(size_of(&out).0, MAX_EDGE);
    }

    #[test]
    fn something_that_is_not_a_picture_is_refused() {
        let err = shrink(b"<html>not an image</html>", "png", MAX_EDGE, false).unwrap_err();
        assert!(err.to_string().contains("not an image"), "{err}");
        // Nor does naming it .gif let it through untouched.
        assert!(shrink(b"<html>", "gif", PICTURE_MAX_EDGE, true).is_err());
    }

    #[test]
    fn a_picture_keeps_more_than_a_cover_and_a_gif_keeps_its_animation() {
        let (out, _) = shrink(&png(3200, 1600), "png", PICTURE_MAX_EDGE, true).unwrap();
        assert_eq!(size_of(&out), (1600, 800));
        let bytes = gif(2000, 100);
        let (out, ext) = shrink(&bytes, "gif", PICTURE_MAX_EDGE, true).unwrap();
        assert_eq!((out, ext.as_str()), (bytes, "gif"));
    }

    #[test]
    fn a_picture_is_named_after_the_document_that_holds_it() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let first = store_picture(root, "Paul in Athens", "IMG_2031.PNG", &png(10, 10), noon()).unwrap();
        assert_eq!(first, "Attachments/paul in athens.png");
        let second = store_picture(root, "Paul in Athens", "x.png", &png(10, 10), noon()).unwrap();
        assert_eq!(second, "Attachments/paul in athens 2.png");
        // What means something inside `![[…]]` never reaches the file name.
        assert_eq!(
            picture_path(root, "Acts 17 [draft] #1", "png", noon()),
            "Attachments/acts 17 draft 1.png"
        );
    }

    #[test]
    fn an_untitled_document_names_its_picture_after_the_moment() {
        let dir = tempfile::tempdir().unwrap();
        for title in ["", "  ", "Untitled", "[]"] {
            assert_eq!(
                picture_path(dir.path(), title, "png", noon()),
                "Attachments/2026-09-26 101512.png",
                "{title:?}"
            );
        }
    }

    #[test]
    fn a_file_that_is_not_a_picture_is_refused_before_anything_is_written() {
        let dir = tempfile::tempdir().unwrap();
        assert!(store_picture(dir.path(), "Athens", "notes.pdf", b"%PDF", noon()).is_err());
        assert!(!dir.path().join(FOLDER).exists());
    }

    #[test]
    fn a_picture_target_is_told_apart_from_a_document() {
        assert!(is_picture_target("Attachments/athens.png"));
        assert!(is_picture_target("athens.JPG|300"));
        assert!(!is_picture_target("Paul"));
        assert!(!is_picture_target("Notes/1 John 3.md"));
        assert!(!is_picture_target("diagram.svg"));
    }

    #[test]
    fn the_short_path_obsidian_writes_is_found_in_attachments() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(FOLDER)).unwrap();
        std::fs::write(root.join("Attachments/athens.png"), b"x").unwrap();
        std::fs::write(root.join("map.png"), b"x").unwrap();
        assert_eq!(locate_picture(root, "Attachments/athens.png").as_deref(), Some("Attachments/athens.png"));
        assert_eq!(locate_picture(root, "athens.png|300").as_deref(), Some("Attachments/athens.png"));
        assert_eq!(locate_picture(root, "map.png").as_deref(), Some("map.png"));
        assert_eq!(locate_picture(root, "rome.png"), None);
        assert_eq!(locate_picture(root, "../athens.png"), Some("Attachments/athens.png".into()));
    }
}
