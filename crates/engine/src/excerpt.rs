//! The Board excerpt: the static snippet a Board ref shows on its card.
//!
//! Not an Embed. A Board never renders its material live (PLAN §17.12) — a
//! renderer per node will not survive a forty-node Board, and body text is
//! unreadable at the zoom where a Board is useful. So a card shows a short
//! plain-text snapshot, taken here and refreshed when the document changes.
//!
//! One rule serves every document type: the first meaningful block of body
//! text, minus anything that merely repeats the title. That happens to produce
//! what PLAN §17.12 asks for a Clipping (its quote) and a Note (its first
//! line) without special-casing either, so a new document type gets a sensible
//! excerpt the day it is added rather than the day someone remembers to add a
//! branch for it.

/// How much text crosses the bridge per card.
///
/// The card line-clamps to three lines, but the clamp is a CSS effect on
/// whatever string it is handed: without a cap here a forty-node Board would
/// ship whole documents to paint a hundred visible characters. No ellipsis is
/// appended — `line-clamp` draws its own when it clips, and two would read as
/// a mistake.
const MAX_CHARS: usize = 200;

/// The body text a Board card shows for a document, and whether the node's
/// `subpath` could be found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Excerpt {
    pub text: String,
    /// True when the node named a `subpath` that no longer exists. The card
    /// falls back to the document's opening text and says so: never silently
    /// show different text than the user pinned (PLAN §17.13).
    pub subpath_missing: bool,
}

/// The excerpt for `body`, optionally starting from `subpath`.
///
/// `title` is the document's own title, dropped when the body opens by
/// repeating it as a heading — every Note in the vault does, and the card
/// already shows the title in bold above.
pub fn excerpt(body: &str, title: &str, subpath: Option<&str>) -> Excerpt {
    let (section, subpath_missing) = match subpath {
        Some(s) => match section_for(body, s) {
            Some(found) => (found, false),
            // Unresolvable: fall back to the whole body so the card is not
            // blank, and let the caller flag it.
            None => (body, true),
        },
        None => (body, false),
    };
    Excerpt {
        text: first_block(section, title),
        subpath_missing,
    }
}

/// The slice of `body` a `#Heading` or `#^block-id` names, Obsidian's
/// semantics (ADR 0003): a heading owns everything until the next heading of
/// equal or higher level; a block id owns the single block carrying it.
fn section_for<'a>(body: &'a str, subpath: &str) -> Option<&'a str> {
    let want = subpath.trim_start_matches('#');
    if want.is_empty() {
        return None;
    }
    if let Some(id) = want.strip_prefix('^') {
        return block_for(body, id);
    }
    let mut start = None;
    let mut depth = 0usize;
    for (offset, line) in line_offsets(body) {
        let (level, text) = match heading(line) {
            Some(h) => h,
            None => continue,
        };
        match start {
            None => {
                if text.eq_ignore_ascii_case(want) {
                    start = Some(offset + line.len());
                    depth = level;
                }
            }
            // The section ends at the next heading that is not nested under it.
            Some(from) => {
                if level <= depth {
                    return Some(&body[from..offset]);
                }
            }
        }
    }
    start.map(|from| &body[from..])
}

/// The block carrying a trailing `^id`. Blocks are separated by blank lines,
/// and the id sits at the end of the block's last line.
fn block_for<'a>(body: &'a str, id: &str) -> Option<&'a str> {
    for block in split_blocks(body) {
        let marker = block.trim_end().rsplit_once(" ^");
        if let Some((before, found)) = marker {
            if found.trim() == id {
                return Some(before);
            }
        }
    }
    None
}

/// `(level, text)` when the line is an ATX heading.
fn heading(line: &str) -> Option<(usize, &str)> {
    let t = line.trim();
    if !t.starts_with('#') {
        return None;
    }
    let level = t.chars().take_while(|&c| c == '#').count();
    // `#tag` is a Tag, not a heading: a heading needs a space after its hashes.
    let rest = t[level..].strip_prefix(' ')?;
    (1..=6).contains(&level).then(|| (level, rest.trim()))
}

/// Byte offset and text of every line, newline excluded from the text but
/// counted in the offsets so slices line up with the original.
fn line_offsets(body: &str) -> impl Iterator<Item = (usize, &str)> {
    let mut at = 0usize;
    body.split_inclusive('\n').map(move |raw| {
        let offset = at;
        at += raw.len();
        (offset, raw)
    })
}

/// Blocks, in order: runs of adjacent non-blank lines.
///
/// Splitting on a blank *line* rather than on a literal "\n\n", because a
/// vault written on Windows or round-tripped through another client separates
/// its blocks with "\r\n\r\n" and would otherwise arrive as one giant block —
/// taking the title heading and the whole body with it.
fn split_blocks(body: &str) -> impl Iterator<Item = &str> {
    let mut blocks = Vec::new();
    let mut start: Option<usize> = None;
    let mut end = 0usize;
    for (offset, raw) in line_offsets(body) {
        if raw.trim().is_empty() {
            if let Some(from) = start.take() {
                blocks.push(body[from..end].trim());
            }
        } else {
            start.get_or_insert(offset);
            end = offset + raw.trim_end().len();
        }
    }
    if let Some(from) = start {
        blocks.push(body[from..end].trim());
    }
    blocks.into_iter().filter(|b| !b.is_empty())
}

/// The first block of `section` that says something the card is not already
/// showing, flattened to plain text and capped.
fn first_block(section: &str, title: &str) -> String {
    for block in split_blocks(section) {
        // A heading that repeats the title is the vault's house style; the
        // card shows the title already, so it would waste the best line.
        if let Some((_, text)) = heading(block) {
            if text.eq_ignore_ascii_case(title.trim()) {
                continue;
            }
        }
        let flat = flatten(block);
        if !flat.is_empty() {
            return truncate(&flat);
        }
    }
    String::new()
}

/// Markdown to plain text: the words survive, the syntax does not.
///
/// The card is 12px text with no renderer, so `[[Jesus]]` would show its
/// brackets as noise and `**bold**` its asterisks. Deliberately shallow —
/// this is a snippet, not a document view.
fn flatten(block: &str) -> String {
    let mut out = String::with_capacity(block.len());
    for (i, line) in block.lines().enumerate() {
        let mut l = line.trim();
        // Quote markers, list bullets and the leading hashes of a heading are
        // structure rather than content.
        l = l.trim_start_matches('>').trim_start();
        for bullet in ["- ", "* ", "+ "] {
            if let Some(rest) = l.strip_prefix(bullet) {
                l = rest;
                break;
            }
        }
        if let Some((_, text)) = heading(l) {
            l = text;
        }
        if l.is_empty() {
            continue;
        }
        if i > 0 && !out.is_empty() {
            out.push(' ');
        }
        out.push_str(l);
    }
    inline(&out).trim().to_string()
}

/// Inline markup, removed in one pass: `[[link|alias]]`, `[text](url)`,
/// `**bold**`, `*em*`, `` `code` ``, `==highlight==`.
fn inline(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let b: Vec<char> = s.chars().collect();
    let mut i = 0usize;
    while i < b.len() {
        // [[target|alias]] and [[target#section]] show what a reader would see.
        if b[i] == '[' && i + 1 < b.len() && b[i + 1] == '[' {
            if let Some(end) = find(&b, i + 2, "]]") {
                let inner: String = b[i + 2..end].iter().collect();
                let shown = inner
                    .rsplit_once('|')
                    .map(|(_, a)| a.to_string())
                    .unwrap_or_else(|| {
                        inner.split_once('#').map_or(inner.clone(), |(t, sec)| {
                            if t.is_empty() { sec.to_string() } else { t.to_string() }
                        })
                    });
                out.push_str(shown.trim());
                i = end + 2;
                continue;
            }
        }
        // [text](url) keeps the text.
        if b[i] == '[' {
            if let Some(close) = find(&b, i + 1, "]") {
                if close + 1 < b.len() && b[close + 1] == '(' {
                    if let Some(paren) = find(&b, close + 2, ")") {
                        out.extend(&b[i + 1..close]);
                        i = paren + 1;
                        continue;
                    }
                }
            }
        }
        // Emphasis and code markers carry no meaning without a renderer.
        if matches!(b[i], '*' | '_' | '`' | '=' | '~') {
            i += 1;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    // Collapse the whitespace the removals leave behind.
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn find(b: &[char], from: usize, pat: &str) -> Option<usize> {
    let p: Vec<char> = pat.chars().collect();
    (from..b.len().saturating_sub(p.len() - 1)).find(|&i| b[i..i + p.len()] == p[..])
}

/// Cap at [`MAX_CHARS`], on a word boundary so the card never ends mid-word.
fn truncate(s: &str) -> String {
    if s.chars().count() <= MAX_CHARS {
        return s.to_string();
    }
    let cut: String = s.chars().take(MAX_CHARS).collect();
    match cut.rsplit_once(' ') {
        // Only honour the boundary if it keeps most of the budget; a single
        // very long word would otherwise collapse the excerpt to nothing.
        Some((head, _)) if head.chars().count() > MAX_CHARS / 2 => head.trim_end().to_string(),
        _ => cut.trim_end().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(body: &str, title: &str) -> String {
        excerpt(body, title, None).text
    }

    #[test]
    fn clipping_shows_its_quote_not_its_title() {
        // PLAN §17.12: a Clipping shows its quote rather than its made-up title.
        let body = "> Endurance is not merely putting up with a trial; it is remaining steadfast. (Compare Heb 12:2.)";
        assert_eq!(
            text(body, "Endurance is steadfastness"),
            "Endurance is not merely putting up with a trial; it is remaining steadfast. (Compare Heb 12:2.)"
        );
    }

    #[test]
    fn note_skips_the_heading_that_repeats_its_title() {
        // Every Note in the vault opens with `# <title>`, and the card already
        // shows the title in bold.
        let body = "# Endurance in trials\n\nJas 1:2-4 says to consider it all joy.";
        assert_eq!(
            text(body, "Endurance in trials"),
            "Jas 1:2-4 says to consider it all joy."
        );
    }

    #[test]
    fn a_heading_that_is_not_the_title_is_kept() {
        let body = "# Something else\n\nThe body.";
        assert_eq!(text(body, "Endurance in trials"), "Something else");
    }

    #[test]
    fn wikilinks_show_what_a_reader_would_see() {
        assert_eq!(text("Written by [[Paul]] in prison.", "t"), "Written by Paul in prison.");
        assert_eq!(text("See [[Notes/joy|joy]] for more.", "t"), "See joy for more.");
        assert_eq!(text("See [[joy#Section]].", "t"), "See joy.");
    }

    #[test]
    fn emphasis_and_code_markers_are_dropped() {
        assert_eq!(text("**Bold** and *em* and `code`.", "t"), "Bold and em and code.");
        assert_eq!(text("==Highlighted== text.", "t"), "Highlighted text.");
    }

    #[test]
    fn markdown_links_keep_their_text() {
        assert_eq!(text("Read [the article](https://x.test/a).", "t"), "Read the article.");
    }

    #[test]
    fn list_bullets_are_structure_not_content() {
        assert_eq!(text("- First point\n- Second point", "t"), "First point Second point");
    }

    #[test]
    fn an_empty_body_yields_an_empty_excerpt() {
        assert_eq!(text("", "t"), "");
        assert_eq!(text("\n\n   \n", "t"), "");
        // A body that is nothing but the title heading has nothing to add.
        assert_eq!(text("# Only the title\n", "Only the title"), "");
    }

    #[test]
    fn long_text_is_capped_on_a_word_boundary() {
        let body = "word ".repeat(100);
        let got = text(&body, "t");
        assert!(got.chars().count() <= MAX_CHARS, "over budget: {}", got.chars().count());
        assert!(!got.ends_with(' '));
        // Cut between words, never through one.
        assert!(got.ends_with("word"), "cut mid-word: {got:?}");
        // No ellipsis: the card's line-clamp draws its own.
        assert!(!got.contains('…'));
    }

    #[test]
    fn a_single_enormous_word_still_yields_something() {
        let got = text(&"x".repeat(500), "t");
        assert_eq!(got.chars().count(), MAX_CHARS);
    }

    #[test]
    fn a_heading_subpath_selects_its_own_section() {
        let body = "# Title\n\nOpening line.\n\n## Cross-references\n\nRo 5:3-5 links tribulation.\n\n## To do\n\nSomething else.";
        let got = excerpt(body, "Title", Some("#Cross-references"));
        assert_eq!(got.text, "Ro 5:3-5 links tribulation.");
        assert!(!got.subpath_missing);
    }

    #[test]
    fn a_section_ends_at_the_next_heading_of_equal_or_higher_level() {
        let body = "## A\n\nAlpha.\n\n### A.1\n\nNested.\n\n## B\n\nBeta.";
        // The nested heading does not end the section, so A still starts at Alpha.
        assert_eq!(excerpt(body, "t", Some("#A")).text, "Alpha.");
        assert_eq!(excerpt(body, "t", Some("#B")).text, "Beta.");
    }

    #[test]
    fn a_block_id_subpath_selects_its_block() {
        let body = "First block.\n\nThe quoted line. ^quote1\n\nAnother block.";
        let got = excerpt(body, "t", Some("#^quote1"));
        assert_eq!(got.text, "The quoted line.");
        assert!(!got.subpath_missing);
    }

    #[test]
    fn an_unresolvable_subpath_is_flagged_and_falls_back() {
        // PLAN §17.13: never silently show something other than what was pinned.
        let body = "# Title\n\nOpening line.";
        let got = excerpt(body, "Title", Some("#Gone"));
        assert!(got.subpath_missing);
        assert_eq!(got.text, "Opening line.");

        let got = excerpt(body, "Title", Some("#^missing"));
        assert!(got.subpath_missing);
        assert_eq!(got.text, "Opening line.");
    }

    #[test]
    fn a_heading_subpath_matches_regardless_of_case() {
        let body = "## Cross-references\n\nThe text.";
        assert_eq!(excerpt(body, "t", Some("#cross-references")).text, "The text.");
    }

    #[test]
    fn a_tag_is_not_a_heading() {
        // `#endurance` has no space, so it is a Tag and stays in the text.
        assert_eq!(text("#endurance is the theme.", "t"), "#endurance is the theme.");
    }

    #[test]
    fn crlf_bodies_behave_the_same() {
        let body = "# Title\r\n\r\nOpening line.";
        assert_eq!(text(body, "Title"), "Opening line.");
    }
}
