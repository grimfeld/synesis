//! Scripture reference detection (ADR 0002). Finds Passages in free text.
//!
//! Rules (docs/PLAN.md §5):
//! - a reference needs a book name followed by a chapter number ("Ro 8:38", "Acts 20");
//!   bare book names are never detected;
//! - the book name must start with an uppercase letter or a digit ("Job 3" yes, "my job 3" no);
//! - contextual "v. 17" / "verses 3, 4" resolve against the last explicit
//!   reference in the same paragraph and are flagged `inferred`;
//! - nothing is detected inside code spans, fenced code blocks or URLs;
//! - every Passage is validated against the versification; invalid chapters or
//!   verses are dropped rather than clamped.
//!
//! Offsets are byte offsets into the input.

use crate::names;
use crate::scripture::{is_single_chapter, Passage};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Detected {
    pub start: usize,
    pub end: usize,
    pub passages: Vec<Passage>,
    pub inferred: bool,
}

static BOOK_ALT: Lazy<String> = Lazy::new(|| {
    let mut variants: Vec<String> = names::all_variants()
        .into_iter()
        .map(|(v, _)| regex::escape(&v).replace(' ', r"\s?"))
        .collect();
    variants.sort_by(|a, b| b.len().cmp(&a.len()).then(a.cmp(b)));
    variants.dedup();
    variants.join("|")
});

static BOOK_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)(?:^|[^\p{{L}}\p{{N}}])(?P<book>{})\.?[ \t]*(?P<num>\d{{1,3}})",
        *BOOK_ALT
    ))
    .expect("book regex")
});

/// Anchored form: does a book reference start exactly here?
static BOOK_AT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"\A(?i)(?:{})\.?[ \t]*\d", *BOOK_ALT)).expect("book-at regex")
});

static CONTEXT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[^\p{L}\p{N}])(?P<kw>versets|verset|verses|verse|vv|vs|v)\.?[ \t]*(?P<num>\d{1,3})").expect("context regex")
});

static SKIP_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)```.*?(?:```|\z)|`[^`\n]*`|https?://[^\s)>\]]+").expect("skip regex")
});

fn is_dash(c: char) -> bool {
    matches!(c, '-' | '–' | '—')
}

struct Cursor<'a> {
    s: &'a str,
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn peek(&self) -> Option<char> {
        self.s[self.pos..].chars().next()
    }
    fn peek_at(&self, offset: usize) -> Option<char> {
        self.s[self.pos..].chars().nth(offset)
    }
    fn skip_spaces(&mut self) {
        while let Some(c) = self.peek() {
            if c == ' ' || c == '\t' {
                self.pos += c.len_utf8();
            } else {
                break;
            }
        }
    }
    fn eat(&mut self, pred: impl Fn(char) -> bool) -> bool {
        match self.peek() {
            Some(c) if pred(c) => {
                self.pos += c.len_utf8();
                true
            }
            _ => false,
        }
    }
    /// Reads a 1-3 digit number at the current position without skipping spaces.
    fn number(&mut self) -> Option<u16> {
        let rest = &self.s[self.pos..];
        let len = rest.chars().take_while(|c| c.is_ascii_digit()).count();
        if len == 0 || len > 3 {
            return None;
        }
        let n: u16 = rest[..len].parse().ok()?;
        self.pos += len;
        Some(n)
    }
    /// True when a book reference starts at byte `at`, e.g. the "2" of
    /// "..., 2 Corinthians 5:17" that would otherwise read as a verse number.
    fn book_starts_at(&self, at: usize) -> bool {
        BOOK_AT_RE.is_match(&self.s[at..])
    }
}

/// Parses "v(-v | -c:v)?" items separated by ',' or ';' starting at the
/// cursor (the cursor is just before the first verse number). Returns the
/// passages found and advances the cursor to the end of the last valid item.
fn parse_verse_list(cur: &mut Cursor, book: u8, mut chapter: u16) -> Vec<Passage> {
    let mut out = Vec::new();
    loop {
        let item_start = cur.pos;
        let v = match cur.number() {
            Some(v) => v,
            None => {
                cur.pos = item_start;
                break;
            }
        };
        if !out.is_empty() && cur.book_starts_at(item_start) {
            cur.pos = item_start;
            break;
        }
        // "c:v" inside a list moves to another chapter.
        let mut sv = v;
        let mut probe = Cursor {
            s: cur.s,
            pos: cur.pos,
        };
        if probe.eat(|c| c == ':') {
            if let Some(v2) = probe.number() {
                chapter = v;
                sv = v2;
                cur.pos = probe.pos;
            }
        }
        let mut passage = Passage::verse(book, chapter, sv);
        // range?
        let mut probe = Cursor {
            s: cur.s,
            pos: cur.pos,
        };
        probe.skip_spaces();
        if probe.eat(is_dash) {
            probe.skip_spaces();
            if let Some(n) = probe.number() {
                let mut probe2 = Cursor {
                    s: cur.s,
                    pos: probe.pos,
                };
                if probe2.eat(|c| c == ':') {
                    if let Some(ev) = probe2.number() {
                        passage = Passage {
                            book,
                            start_chapter: chapter,
                            start_verse: Some(sv),
                            end_chapter: n,
                            end_verse: Some(ev),
                        };
                        probe.pos = probe2.pos;
                        chapter = n;
                    }
                } else {
                    passage = Passage::verses_in(book, chapter, sv, n);
                }
                if passage.is_valid() {
                    cur.pos = probe.pos;
                }
            }
        }
        if !passage.is_valid() {
            cur.pos = item_start;
            break;
        }
        out.push(passage);
        // separator?
        let mut probe = Cursor {
            s: cur.s,
            pos: cur.pos,
        };
        let sep_pos = probe.pos;
        if probe.eat(|c| c == ',' || c == ';') {
            probe.skip_spaces();
            if probe.peek().map_or(false, |c| c.is_ascii_digit()) {
                cur.pos = probe.pos;
                continue;
            }
        }
        cur.pos = sep_pos;
        break;
    }
    out
}

/// Parses everything after a book name. `cur` sits at the first digit.
fn parse_tail(cur: &mut Cursor, book: u8) -> Vec<Passage> {
    let start = cur.pos;
    let n = match cur.number() {
        Some(n) => n,
        None => return vec![],
    };
    let single = is_single_chapter(book);
    let next = cur.peek();
    let comma_then_digit =
        next == Some(',') && cur.peek_at(1).map_or(false, |c| c.is_ascii_digit());
    if next == Some(':') || comma_then_digit {
        cur.pos += 1;
        // "John 3:99" or a dangling "John 3:" yield nothing: invalid
        // references are dropped, never clamped.
        return parse_verse_list(cur, book, n);
    }
    if single {
        // "Jude 4" means verse 4; "Jude 4-6" a range.
        cur.pos = start;
        let list = parse_verse_list(cur, book, 1);
        return list;
    }
    // Chapter, or chapter range "Acts 1-2" / "Acts 1-2:5".
    let mut probe = Cursor {
        s: cur.s,
        pos: cur.pos,
    };
    probe.skip_spaces();
    if probe.eat(is_dash) {
        probe.skip_spaces();
        let range_num_start = probe.pos;
        if let Some(m) = probe.number() {
            let mut p = Passage::chapters(book, n, m);
            let mut probe2 = Cursor {
                s: cur.s,
                pos: probe.pos,
            };
            if probe2.eat(|c| c == ':') {
                if let Some(ev) = probe2.number() {
                    p.end_verse = Some(ev);
                    probe.pos = probe2.pos;
                }
            }
            if p.is_valid() && !probe.book_starts_at(range_num_start) {
                cur.pos = probe.pos;
                return vec![p];
            }
        }
    }
    let p = Passage::chapter(book, n);
    if p.is_valid() {
        vec![p]
    } else {
        vec![]
    }
}

fn skip_zones(text: &str) -> Vec<(usize, usize)> {
    SKIP_RE
        .find_iter(text)
        .map(|m| (m.start(), m.end()))
        .collect()
}

fn in_zone(zones: &[(usize, usize)], start: usize, end: usize) -> bool {
    zones.iter().any(|&(a, b)| start < b && end > a)
}

/// Byte offsets at which a new paragraph begins (after a blank line).
fn paragraph_breaks(text: &str) -> Vec<usize> {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n[ \t]*\n").unwrap());
    RE.find_iter(text).map(|m| m.end()).collect()
}

fn paragraph_of(breaks: &[usize], pos: usize) -> usize {
    breaks.partition_point(|&b| b <= pos)
}

/// Detect every Scripture reference in `text`.
pub fn detect(text: &str) -> Vec<Detected> {
    let zones = skip_zones(text);
    let mut out: Vec<Detected> = Vec::new();

    for caps in BOOK_RE.captures_iter(text) {
        let book_m = caps.name("book").unwrap();
        let num_m = caps.name("num").unwrap();
        // Uppercase-or-digit rule.
        let first = book_m.as_str().chars().next().unwrap();
        if !(first.is_uppercase() || first.is_ascii_digit()) {
            continue;
        }
        let book = match names::lookup(book_m.as_str()) {
            Some(b) => b,
            None => continue,
        };
        let mut cur = Cursor {
            s: text,
            pos: num_m.start(),
        };
        let passages = parse_tail(&mut cur, book);
        if passages.is_empty() {
            continue;
        }
        let (start, end) = (book_m.start(), cur.pos);
        if in_zone(&zones, start, end) {
            continue;
        }
        if out.last().map_or(false, |d| d.end > start) {
            continue;
        }
        out.push(Detected {
            start,
            end,
            passages,
            inferred: false,
        });
    }

    let breaks = paragraph_breaks(text);
    let explicit = out.clone();
    let mut inferred = Vec::new();
    for caps in CONTEXT_RE.captures_iter(text) {
        let kw = caps.name("kw").unwrap();
        let num = caps.name("num").unwrap();
        let start = kw.start();
        if in_zone(&zones, start, num.end())
            || explicit
                .iter()
                .any(|d| d.start < num.end() && d.end > start)
        {
            continue;
        }
        let para = paragraph_of(&breaks, start);
        let ctx = explicit
            .iter()
            .filter(|d| d.end <= start && paragraph_of(&breaks, d.start) == para)
            .last();
        let ctx = match ctx {
            Some(c) => c,
            None => continue,
        };
        let last = match ctx.passages.last() {
            Some(p) => p,
            None => continue,
        };
        let mut cur = Cursor {
            s: text,
            pos: num.start(),
        };
        let passages = parse_verse_list(&mut cur, last.book, last.end_chapter);
        if passages.is_empty() {
            continue;
        }
        inferred.push(Detected {
            start,
            end: cur.pos,
            passages,
            inferred: true,
        });
    }
    out.extend(inferred);
    out.sort_by_key(|d| d.start);
    out
}

/// Convert byte offsets to UTF-16 code unit offsets (what the editor uses).
pub fn byte_to_utf16(text: &str, byte: usize) -> usize {
    text[..byte.min(text.len())].encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scripture::Lang;

    fn refs(text: &str) -> Vec<String> {
        detect(text)
            .into_iter()
            .flat_map(|d| d.passages.into_iter().map(|p| p.display(Lang::En)))
            .collect()
    }

    #[test]
    fn basic_forms() {
        assert_eq!(refs("See John 3:16 today"), vec!["John 3:16"]);
        assert_eq!(
            refs("Ro 8:38, 39 is great"),
            vec!["Romans 8:38", "Romans 8:39"]
        );
        assert_eq!(refs("Read Acts 20 fully"), vec!["Acts 20"]);
        assert_eq!(refs("Ps 23:1-3."), vec!["Psalms 23:1-3"]);
        assert_eq!(refs("Rev. 21:4"), vec!["Revelation 21:4"]);
        assert_eq!(refs("1 Corinthians 13:4-8a"), vec!["1 Corinthians 13:4-8"]);
        assert_eq!(
            refs("(2 Timothy 3:16, 17)"),
            vec!["2 Timothy 3:16", "2 Timothy 3:17"]
        );
    }

    #[test]
    fn watchtower_and_french() {
        assert_eq!(
            refs("Joh 3:16; Mr 1:1; Lu 2:1; Php 4:6; Re 21:3"),
            vec![
                "John 3:16",
                "Mark 1:1",
                "Luke 2:1",
                "Philippians 4:6",
                "Revelation 21:3"
            ]
        );
        assert_eq!(
            refs("Jean 3:16 et Jn 3,16 et Éph 4:5"),
            vec!["John 3:16", "John 3:16", "Ephesians 4:5"]
        );
        assert_eq!(refs("1 Corinthiens 13:4"), vec!["1 Corinthians 13:4"]);
        assert_eq!(
            refs("Genèse 1:1 puis Genese 1:2"),
            vec!["Genesis 1:1", "Genesis 1:2"]
        );
    }

    #[test]
    fn ranges_and_lists() {
        assert_eq!(refs("Luke 9:51-10:12"), vec!["Luke 9:51-10:12"]);
        assert_eq!(refs("Luke 9:51–10:12"), vec!["Luke 9:51-10:12"]);
        assert_eq!(
            refs("Romans 8:1-4, 12"),
            vec!["Romans 8:1-4", "Romans 8:12"]
        );
        assert_eq!(refs("Gen 1:1; 2:4"), vec!["Genesis 1:1", "Genesis 2:4"]);
        assert_eq!(refs("Acts 1-2"), vec!["Acts 1-2"]);
        assert_eq!(
            refs("Matthew 24:3, 7-14"),
            vec!["Matthew 24:3", "Matthew 24:7-14"]
        );
    }

    #[test]
    fn single_chapter_books() {
        assert_eq!(refs("Jude 4"), vec!["Jude 1:4"]);
        assert_eq!(refs("Jude 4-6"), vec!["Jude 1:4-6"]);
        assert_eq!(refs("Philemon 1:10"), vec!["Philemon 1:10"]);
        assert_eq!(refs("2 John 9"), vec!["2 John 1:9"]);
    }

    #[test]
    fn no_false_positives() {
        assert!(refs("my job 3 years ago").is_empty());
        assert!(refs("I am 5 today").is_empty());
        assert!(refs("met at 3:16 pm").is_empty());
        assert!(refs("In Acts, Paul said").is_empty());
        assert!(refs("John 3:99").is_empty());
        assert!(refs("John 22").is_empty());
        assert!(refs("`John 3:16` in code").is_empty());
        assert!(refs("https://example.com/John 3:16").is_empty());
        assert!(refs("```\nJohn 3:16\n```").is_empty());
    }

    #[test]
    fn list_does_not_swallow_next_book() {
        assert_eq!(
            refs("John 3:16, 2 Corinthians 5:17"),
            vec!["John 3:16", "2 Corinthians 5:17"]
        );
        assert_eq!(
            refs("Ro 8:38, 39 And then"),
            vec!["Romans 8:38", "Romans 8:39"]
        );
    }

    #[test]
    fn contextual_verses() {
        let d = detect("Read Romans 8:28 carefully. Then v. 29 and verses 31, 32 too.");
        let names: Vec<_> = d
            .iter()
            .flat_map(|x| x.passages.iter().map(|p| p.display(Lang::En)))
            .collect();
        assert_eq!(
            names,
            vec!["Romans 8:28", "Romans 8:29", "Romans 8:31", "Romans 8:32"]
        );
        assert!(d[1].inferred && d[2].inferred && !d[0].inferred);
        // New paragraph: no context.
        assert_eq!(refs("Romans 8:28.\n\nv. 29 alone"), vec!["Romans 8:28"]);
        // No prior reference: nothing.
        assert!(refs("v. 29 alone").is_empty());
        // French keyword.
        assert_eq!(
            refs("Jean 3:16, puis verset 17"),
            vec!["John 3:16", "John 3:17"]
        );
    }

    #[test]
    fn spans_are_exact() {
        let text = "See John 3:16-18 now";
        let d = detect(text);
        assert_eq!(&text[d[0].start..d[0].end], "John 3:16-18");
        let text = "Voir Éph 4:5.";
        let d = detect(text);
        assert_eq!(&text[d[0].start..d[0].end], "Éph 4:5");
        assert_eq!(byte_to_utf16(text, d[0].start), 5);
    }

    #[test]
    fn inside_wikilink_still_detected() {
        assert_eq!(refs("[[John 3:16]]"), vec!["John 3:16"]);
    }
}
