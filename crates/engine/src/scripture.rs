//! Language-neutral Scripture identity: Books, Chapters, Verses and Passages.

use crate::names;
use crate::versification::{BookInfo, BOOKS};
use serde::{Deserialize, Serialize};

/// UI / display language. Verse identity never depends on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    #[default]
    En,
    Fr,
}

pub fn book(number: u8) -> &'static BookInfo {
    &BOOKS[(number as usize).saturating_sub(1).min(65)]
}

pub fn chapter_count(book_number: u8) -> u16 {
    book(book_number).chapters.len() as u16
}

pub fn verse_count(book_number: u8, chapter: u16) -> Option<u16> {
    book(book_number).chapters.get(chapter.checked_sub(1)? as usize).copied()
}

pub fn is_single_chapter(book_number: u8) -> bool {
    chapter_count(book_number) == 1
}

/// Hebrew-Aramaic Scriptures are books 1..=39; Christian Greek Scriptures 40..=66.
pub fn is_hebrew_aramaic(book_number: u8) -> bool {
    book_number <= 39
}

/// A single Verse, packed as book * 1_000_000 + chapter * 1000 + verse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct VerseId(pub u32);

impl VerseId {
    pub fn new(book: u8, chapter: u16, verse: u16) -> Self {
        VerseId(book as u32 * 1_000_000 + chapter as u32 * 1000 + verse as u32)
    }
    pub fn book(self) -> u8 {
        (self.0 / 1_000_000) as u8
    }
    pub fn chapter(self) -> u16 {
        ((self.0 / 1000) % 1000) as u16
    }
    pub fn verse(self) -> u16 {
        (self.0 % 1000) as u16
    }
    pub fn display(self, lang: Lang) -> String {
        format!("{} {}:{}", names::book_name(self.book(), lang), self.chapter(), self.verse())
    }
}

/// The coarsest unit that covers a Passage. Used for display collapsing and
/// for deciding which Scripture pages to materialise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    Book,
    Chapter,
    Verse,
    Range,
}

/// A contiguous run of Scripture, from one Verse to a whole Book.
/// `start_verse == None` means "from the first verse of start_chapter";
/// `end_verse == None` means "to the last verse of end_chapter".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Passage {
    pub book: u8,
    pub start_chapter: u16,
    pub start_verse: Option<u16>,
    pub end_chapter: u16,
    pub end_verse: Option<u16>,
}

impl Passage {
    pub fn chapter(book: u8, chapter: u16) -> Self {
        Passage { book, start_chapter: chapter, start_verse: None, end_chapter: chapter, end_verse: None }
    }
    pub fn chapters(book: u8, from: u16, to: u16) -> Self {
        Passage { book, start_chapter: from, start_verse: None, end_chapter: to, end_verse: None }
    }
    pub fn verse(book: u8, chapter: u16, verse: u16) -> Self {
        Passage { book, start_chapter: chapter, start_verse: Some(verse), end_chapter: chapter, end_verse: Some(verse) }
    }
    pub fn verses_in(book: u8, chapter: u16, from: u16, to: u16) -> Self {
        Passage { book, start_chapter: chapter, start_verse: Some(from), end_chapter: chapter, end_verse: Some(to) }
    }
    pub fn whole_book(book: u8) -> Self {
        Passage::chapters(book, 1, chapter_count(book))
    }

    pub fn first(&self) -> VerseId {
        VerseId::new(self.book, self.start_chapter, self.start_verse.unwrap_or(1))
    }
    pub fn last(&self) -> VerseId {
        let v = self.end_verse.unwrap_or_else(|| verse_count(self.book, self.end_chapter).unwrap_or(1));
        VerseId::new(self.book, self.end_chapter, v)
    }

    pub fn is_valid(&self) -> bool {
        if self.book == 0 || self.book > 66 {
            return false;
        }
        let chapters = chapter_count(self.book);
        if self.start_chapter == 0 || self.end_chapter == 0 || self.start_chapter > chapters || self.end_chapter > chapters {
            return false;
        }
        if let Some(v) = self.start_verse {
            if v == 0 || v > verse_count(self.book, self.start_chapter).unwrap_or(0) {
                return false;
            }
        }
        if let Some(v) = self.end_verse {
            if v == 0 || v > verse_count(self.book, self.end_chapter).unwrap_or(0) {
                return false;
            }
        }
        self.first() <= self.last()
    }

    pub fn unit(&self) -> Unit {
        if self.start_chapter == 1 && self.start_verse.is_none() && self.end_verse.is_none() && self.end_chapter == chapter_count(self.book) {
            return Unit::Book;
        }
        if self.start_verse.is_none() && self.end_verse.is_none() && self.start_chapter == self.end_chapter {
            return Unit::Chapter;
        }
        if self.start_chapter == self.end_chapter && self.start_verse.is_some() && self.start_verse == self.end_verse {
            return Unit::Verse;
        }
        Unit::Range
    }

    pub fn covers(&self, v: VerseId) -> bool {
        v >= self.first() && v <= self.last()
    }

    /// Every Verse covered by this Passage, in canonical order.
    pub fn verses(&self) -> Vec<VerseId> {
        let mut out = Vec::new();
        for ch in self.start_chapter..=self.end_chapter {
            let n = match verse_count(self.book, ch) {
                Some(n) => n,
                None => continue,
            };
            let from = if ch == self.start_chapter { self.start_verse.unwrap_or(1) } else { 1 };
            let to = if ch == self.end_chapter { self.end_verse.unwrap_or(n) } else { n };
            for v in from..=to.min(n) {
                out.push(VerseId::new(self.book, ch, v));
            }
        }
        out
    }

    /// Canonical display, e.g. "John 3:16-18", "Luke 9:51-10:12", "Romans 8", "Acts 1-2".
    pub fn display(&self, lang: Lang) -> String {
        let name = names::book_name(self.book, lang);
        match (self.start_verse, self.end_verse) {
            (None, None) => {
                if self.unit() == Unit::Book {
                    name.to_string()
                } else if self.start_chapter == self.end_chapter {
                    format!("{name} {}", self.start_chapter)
                } else {
                    format!("{name} {}-{}", self.start_chapter, self.end_chapter)
                }
            }
            _ => {
                let sv = self.start_verse.unwrap_or(1);
                let ev = self.end_verse.unwrap_or_else(|| verse_count(self.book, self.end_chapter).unwrap_or(1));
                if self.start_chapter == self.end_chapter {
                    if sv == ev {
                        format!("{name} {}:{sv}", self.start_chapter)
                    } else {
                        format!("{name} {}:{sv}-{ev}", self.start_chapter)
                    }
                } else {
                    format!("{name} {}:{sv}-{}:{ev}", self.start_chapter, self.end_chapter)
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verse_id_roundtrip() {
        let v = VerseId::new(43, 3, 16);
        assert_eq!((v.book(), v.chapter(), v.verse()), (43, 3, 16));
        assert_eq!(v.display(Lang::En), "John 3:16");
        assert_eq!(v.display(Lang::Fr), "Jean 3:16");
    }

    #[test]
    fn passage_expansion_and_units() {
        let p = Passage::verses_in(43, 3, 16, 18);
        assert_eq!(p.verses().len(), 3);
        assert_eq!(p.unit(), Unit::Range);
        assert_eq!(Passage::chapter(45, 8).verses().len(), 39);
        assert_eq!(Passage::chapter(45, 8).unit(), Unit::Chapter);
        assert_eq!(Passage::verse(45, 8, 28).unit(), Unit::Verse);
        let cross = Passage { book: 42, start_chapter: 9, start_verse: Some(51), end_chapter: 10, end_verse: Some(12) };
        assert!(cross.is_valid());
        assert_eq!(cross.verses().len(), 62 - 51 + 1 + 12);
        assert_eq!(cross.display(Lang::En), "Luke 9:51-10:12");
        assert_eq!(Passage::whole_book(44).unit(), Unit::Book);
    }

    #[test]
    fn validation() {
        assert!(!Passage::chapter(43, 22).is_valid());
        assert!(!Passage::verse(43, 3, 99).is_valid());
        assert!(Passage::verse(19, 119, 176).is_valid());
    }
}
