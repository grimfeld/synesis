//! Finding names in prose that are not links: the shared heart of Unlinked
//! mentions and Linkables (ADR 0011).
//!
//! Both features ask the same question from opposite ends. A Hub asks "which
//! documents write my name without linking it"; a document being written asks
//! "which names have I written that are not links yet". The matching rule, the
//! exclusions and the text that gets inserted are identical, so they live here
//! once, as pure functions over a `&str`.
//!
//! Nothing in this module touches SQL or the filesystem. The index decides
//! *which* names and *which* documents; this module decides where a name
//! genuinely occurs and what replaces it.

use crate::document::{in_zone, zones};
use aho_corasick::{AhoCorasick, MatchKind};

/// One occurrence of a name in a document's text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occurrence {
    /// Index into the `names` slice the matcher was built from.
    pub name_index: usize,
    /// Byte offset of the match in the text that was searched.
    pub start: usize,
    /// Byte offset one past the match, including a possessive `'s`.
    pub end: usize,
    /// The matched text exactly as it appears, `'s` included.
    pub matched: String,
}

/// A prepared set of names, searched in one pass.
///
/// Built once and reused: the Linkable side runs every Topical Subject and
/// Source name in the Vault against one document, which is thousands of
/// needles and no way to do it needle-by-needle on each keystroke.
pub struct Matcher {
    ac: AhoCorasick,
}

impl Matcher {
    /// Build a matcher over `names`. Matching is case-insensitive in every
    /// alphabet, not just ASCII: a French Vault has a Place called "Éphèse"
    /// and prose that says "éphèse".
    ///
    /// Folding is done by searching a lowercased copy of both the names and
    /// the text, rather than with `ascii_case_insensitive`, which would leave
    /// every accented name matching only its exact spelling.
    ///
    /// `LeftmostLongest` so that a Vault holding both "Antioch" and "Antioch
    /// in Pisidia" matches the longer name where both would fit, rather than
    /// offering the shorter one inside it.
    pub fn new<S: AsRef<str>>(names: &[S]) -> Self {
        let folded: Vec<String> = names.iter().map(|n| fold(n.as_ref())).collect();
        let ac = AhoCorasick::builder()
            .match_kind(MatchKind::LeftmostLongest)
            .build(&folded)
            .expect("name set builds");
        Self { ac }
    }

    /// Every occurrence of any name in `body`, with the exclusions of ADR 0011
    /// already applied.
    ///
    /// `body` is the document's body text, not the whole file: frontmatter is
    /// excluded by never being passed in. Offsets are relative to `body`, so a
    /// caller working in whole-file offsets adds its own `body_offset`.
    pub fn find(&self, body: &str) -> Vec<Occurrence> {
        let mut skip = zones(body);
        skip.extend(heading_spans(body));
        let links = link_spans(body);
        let haystack = fold(body);
        let mut out = Vec::new();
        for m in self.ac.find_iter(&haystack) {
            let (start, mut end) = (m.start(), m.end());
            if !is_word_boundary(body, start, end) {
                continue;
            }
            // A possessive belongs to the match: "Paul's letter" mentions Paul,
            // and the inserted link must cover the apostrophe so the prose is
            // unchanged.
            if let Some(rest) = body.get(end..) {
                for p in ["'s", "\u{2019}s", "'S", "\u{2019}S"] {
                    if rest.starts_with(p) {
                        end += p.len();
                        break;
                    }
                }
            }
            if in_zone(&skip, start, end) || in_zone(&links, start, end) {
                continue;
            }
            out.push(Occurrence {
                name_index: m.pattern().as_usize(),
                start,
                end,
                matched: body[start..end].to_string(),
            });
        }
        out
    }
}

/// Byte ranges covered by ATX heading lines.
///
/// A heading is structure, not prose. Nearly every Note in the vault opens
/// with a heading that repeats its own title, so without this the first row
/// offered on a Hub is "# The brothers at Antioch" — a name the writer put
/// there as a label, not a sentence they forgot to link.
fn heading_spans(body: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut at = 0;
    for line in body.split_inclusive('\n') {
        let t = line.trim_start();
        let hashes = t.len() - t.trim_start_matches('#').len();
        // A space after the hashes is what separates a heading from a `#tag`.
        if (1..=6).contains(&hashes) && t[hashes..].starts_with(' ') {
            out.push((at, at + line.len()));
        }
        at += line.len();
    }
    out
}

/// Lowercase `s` without moving a single byte.
///
/// Offsets found in the folded text are used to slice the original, so the two
/// must stay aligned. Almost every character lowercases to the same byte
/// length; the handful that do not (the dotted capital I, chiefly) are left as
/// they are rather than shifting every offset after them.
fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        let mut it = c.to_lowercase();
        match (it.next(), it.next()) {
            (Some(l), None) if l.len_utf8() == c.len_utf8() => out.push(l),
            _ => out.push(c),
        }
    }
    debug_assert_eq!(out.len(), s.len(), "folding preserves byte offsets");
    out
}

/// Byte ranges covered by a wikilink or a tag, which are already Mentions.
///
/// Deliberately crude: it finds `[[…]]`, `![[…]]` and `#tag` runs without
/// parsing them, because all this needs to know is "hands off". The document
/// parser stays the authority on what a link means.
fn link_spans(body: &str) -> Vec<(usize, usize)> {
    let b = body.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < b.len() {
        if b[i] == b'[' && b[i + 1] == b'[' {
            let start = if i > 0 && b[i - 1] == b'!' { i - 1 } else { i };
            match body[i..].find("]]") {
                Some(rel) => {
                    out.push((start, i + rel + 2));
                    i += rel + 2;
                }
                None => break,
            }
        } else if b[i] == b'#' && (i == 0 || is_boundary_byte(b[i - 1])) {
            let rest = &body[i + 1..];
            let len = rest
                .find(|c: char| !(c.is_alphanumeric() || c == '-' || c == '_' || c == '/'))
                .unwrap_or(rest.len());
            if len > 0 {
                out.push((i, i + 1 + len));
            }
            i += 1 + len;
        } else {
            i += 1;
        }
    }
    // A markdown link's URL is already a SKIP_RE zone, so it needs nothing here.
    out
}

fn is_boundary_byte(b: u8) -> bool {
    !(b as char).is_alphanumeric()
}

/// Every wikilink target and tag name already written in `body`.
///
/// `link_spans` answers "hands off these bytes"; this answers "which documents
/// does this text already link", which is what decides whether a target has
/// been dealt with once and should stop being offered (ADR 0011). The target
/// is returned exactly as written — `Places/Antioch`, `Saul`, `Antioch#Acts` —
/// and resolving it to a document is the index's job, not this module's.
///
/// An embed (`![[…]]`) counts: it names the document just as a link does. A
/// heading or block anchor is trimmed, and an alias (`[[target|shown]]`) is
/// dropped, because only the target side names the document.
pub fn link_targets(body: &str) -> Vec<String> {
    let b = body.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < b.len() {
        if b[i] == b'[' && b[i + 1] == b'[' {
            match body[i..].find("]]") {
                Some(rel) => {
                    let inner = &body[i + 2..i + rel];
                    let t = inner.split('|').next().unwrap_or("");
                    let t = t.split(['#', '^']).next().unwrap_or("").trim();
                    if !t.is_empty() {
                        out.push(t.to_string());
                    }
                    i += rel + 2;
                }
                None => break,
            }
        } else if b[i] == b'#' && (i == 0 || is_boundary_byte(b[i - 1])) {
            let rest = &body[i + 1..];
            let len = rest
                .find(|c: char| !(c.is_alphanumeric() || c == '-' || c == '_' || c == '/'))
                .unwrap_or(rest.len());
            if len > 0 {
                out.push(body[i + 1..i + 1 + len].to_string());
            }
            i += 1 + len;
        } else {
            i += 1;
        }
    }
    out
}

/// Whether `start..end` stands as a whole word.
///
/// Letters and digits on either side disqualify a match, so "Antioch" never
/// fires inside "Antiochus". An apostrophe before the match does too: the
/// "Paul" in "d'Paul" is not a separate word.
fn is_word_boundary(text: &str, start: usize, end: usize) -> bool {
    let before = text[..start].chars().next_back();
    let after = text[end..].chars().next();
    let ok = |c: Option<char>| match c {
        None => true,
        Some(c) => !(c.is_alphanumeric() || c == '_' || c == '\'' || c == '\u{2019}'),
    };
    // A trailing apostrophe is allowed: the possessive is handled by the caller.
    ok(before)
        && match after {
            Some('\'') | Some('\u{2019}') => true,
            other => ok(other),
        }
}

/// The wikilink that replaces `matched` when linking to `title`.
///
/// A bare `[[Title]]` only when the prose already reads exactly as the title;
/// otherwise the matched text is kept as the link's alias so the rendered
/// document does not change by a single character (ADR 0011). `path` is given
/// when the title is ambiguous in the Vault, and is used in place of the title
/// so the link cannot resolve to the wrong document.
pub fn link_text(title: &str, matched: &str, path: Option<&str>) -> String {
    let target = match path {
        Some(p) => p.trim_end_matches(".md"),
        None => title,
    };
    if path.is_none() && matched == title {
        format!("[[{title}]]")
    } else {
        format!("[[{target}|{matched}]]")
    }
}

/// Splice `replacement` over `start..end` of `text`, first checking that
/// `expect` is still exactly what sits there.
///
/// The offsets come from the index, which reflects the last save; Obsidian or
/// a sync may have rewritten the file since. Splicing at a stale offset would
/// silently corrupt prose, so a mismatch refuses rather than guessing
/// (ADR 0011).
pub fn splice(
    text: &str,
    start: usize,
    end: usize,
    expect: &str,
    replacement: &str,
) -> Option<String> {
    if end > text.len() || !text.is_char_boundary(start) || !text.is_char_boundary(end) {
        return None;
    }
    if &text[start..end] != expect {
        return None;
    }
    let mut out = String::with_capacity(text.len() + replacement.len());
    out.push_str(&text[..start]);
    out.push_str(replacement);
    out.push_str(&text[end..]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(names: &[&str], body: &str) -> Vec<String> {
        Matcher::new(names)
            .find(body)
            .into_iter()
            .map(|o| o.matched)
            .collect()
    }

    #[test]
    fn matches_whole_words_only() {
        assert_eq!(found(&["Antioch"], "went to Antioch and"), ["Antioch"]);
        assert!(found(&["Antioch"], "about Antiochus the king").is_empty());
        assert!(found(&["Paul"], "a Pauline letter").is_empty());
    }

    #[test]
    fn matching_is_case_insensitive_and_keeps_the_prose_spelling() {
        assert_eq!(found(&["Antioch"], "antioch was busy"), ["antioch"]);
        assert_eq!(found(&["antioch"], "Antioch was busy"), ["Antioch"]);
    }

    #[test]
    fn case_folding_is_not_ascii_only() {
        assert_eq!(found(&["Éphèse"], "vers éphèse et"), ["éphèse"]);
        assert_eq!(found(&["éphèse"], "vers Éphèse et"), ["Éphèse"]);
    }

    #[test]
    fn a_possessive_is_part_of_the_match() {
        assert_eq!(found(&["Paul"], "Paul's letter"), ["Paul's"]);
        assert_eq!(found(&["Paul"], "Paul\u{2019}s letter"), ["Paul\u{2019}s"]);
    }

    #[test]
    fn existing_links_and_tags_are_not_unlinked() {
        assert!(found(&["Antioch"], "went to [[Antioch]] and").is_empty());
        assert!(found(&["Antioch"], "an ![[Antioch]] embed").is_empty());
        assert!(found(&["Antioch"], "aliased [[Antioch|the city]]").is_empty());
        assert!(found(&["Antioch"], "tagged #Antioch here").is_empty());
    }

    #[test]
    fn a_second_occurrence_outside_a_link_still_matches() {
        assert_eq!(
            found(&["Antioch"], "[[Antioch]] grew, and Antioch sent them"),
            ["Antioch"]
        );
    }

    #[test]
    fn headings_are_structure_not_prose() {
        assert!(found(&["Antioch"], "# The brothers at Antioch\n").is_empty());
        assert!(found(&["Antioch"], "### Antioch\n").is_empty());
        // Only the heading line: the prose under it still counts.
        assert_eq!(
            found(&["Antioch"], "# Antioch\n\nAntioch grew fast.\n"),
            ["Antioch"]
        );
        // `#tag` is not a heading, and is excluded for its own reason.
        assert!(found(&["Antioch"], "#Antioch\n").is_empty());
    }

    #[test]
    fn code_and_urls_are_skipped() {
        assert!(found(&["Antioch"], "`Antioch` in code").is_empty());
        assert!(found(&["Antioch"], "```\nAntioch\n```").is_empty());
        assert!(found(&["Antioch"], "see https://x.test/Antioch here").is_empty());
    }

    #[test]
    fn the_longest_name_wins() {
        assert_eq!(
            found(&["Antioch", "Antioch in Pisidia"], "at Antioch in Pisidia now"),
            ["Antioch in Pisidia"]
        );
    }

    #[test]
    fn multi_word_names_match() {
        assert_eq!(
            found(&["Paul's second missionary journey"], "on Paul's second missionary journey he"),
            ["Paul's second missionary journey"]
        );
    }

    #[test]
    fn link_text_keeps_the_prose_unchanged() {
        assert_eq!(link_text("Antioch", "Antioch", None), "[[Antioch]]");
        assert_eq!(link_text("Paul", "Paul's", None), "[[Paul|Paul's]]");
        assert_eq!(link_text("Antioch", "antioch", None), "[[Antioch|antioch]]");
        assert_eq!(link_text("Barnabas", "Joseph", None), "[[Barnabas|Joseph]]");
    }

    #[test]
    fn an_ambiguous_title_is_linked_by_path() {
        assert_eq!(
            link_text("Antioch", "Antioch", Some("Places/Antioch.md")),
            "[[Places/Antioch|Antioch]]"
        );
    }

    #[test]
    fn splice_refuses_a_stale_offset() {
        let text = "went to Antioch and";
        assert_eq!(
            splice(text, 8, 15, "Antioch", "[[Antioch]]").as_deref(),
            Some("went to [[Antioch]] and")
        );
        // The file changed under us: the same offset now holds other words.
        assert_eq!(splice("we went to Antioch", 8, 15, "Antioch", "[[Antioch]]"), None);
        assert_eq!(splice(text, 8, 999, "Antioch", "[[Antioch]]"), None);
    }
}

