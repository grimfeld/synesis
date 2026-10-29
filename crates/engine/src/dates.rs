//! Dates in the Bible's chronology (ADR 0005): written as a reader would say
//! them ("c. 1513 BCE", "14 Nisan 33 CE", "52 CE", "1513 av. n. è.") and
//! parsed into an astronomical year plus precision. The text is never
//! rewritten; a value that does not parse simply is not a Date.
//!
//! Astronomical years: 1 CE = 1, 1 BCE = 0, 2 BCE = -1. An era marker is
//! required, so bare numbers never become Dates.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Precision {
    Year,
    Month,
    Day,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BibleDate {
    /// Astronomical year: 1 BCE is 0, 2 BCE is -1.
    pub year: i32,
    /// 1–12 in the civil calendar; Hebrew months map to their usual civil month.
    pub month: Option<u8>,
    pub day: Option<u8>,
    pub approx: bool,
}

impl BibleDate {
    pub fn precision(&self) -> Precision {
        match (self.month, self.day) {
            (Some(_), Some(_)) => Precision::Day,
            (Some(_), None) => Precision::Month,
            _ => Precision::Year,
        }
    }

    /// Position on a continuous year axis, for sorting and the Timeline.
    pub fn sort_key(&self) -> f64 {
        let m = self.month.map(|m| (m as f64 - 1.0) / 12.0).unwrap_or(0.0);
        let d = self.day.map(|d| (d as f64 - 1.0) / 365.0).unwrap_or(0.0);
        self.year as f64 + m + d
    }

    /// The year as people say it: (1513, true) for 1513 BCE, (33, false) for 33 CE.
    pub fn era_year(&self) -> (i32, bool) {
        if self.year <= 0 {
            (1 - self.year, true)
        } else {
            (self.year, false)
        }
    }

    /// Parse a Date written in English or French. `None` when the text is not a Date.
    pub fn parse(text: &str) -> Option<BibleDate> {
        Self::parse_parts(text).ok().map(|p| p.date)
    }

    /// Read a Date for display: its parts, or why the text is not a Date.
    ///
    /// The live preview under a Date field shows this, formatted in the app
    /// language from the parts, never from the user's text, which stays as
    /// typed (ADR 0005).
    pub fn read(text: &str) -> Result<DateReading, DateError> {
        let Parsed {
            date,
            month_name,
            era,
        } = Self::parse_parts(text)?;
        let (era_year, bce) = date.era_year();
        Ok(DateReading {
            era_year,
            bce,
            era,
            month: date.month,
            month_name,
            day: date.day,
            approx: date.approx,
            precision: date.precision(),
        })
    }

    /// The Date and what the text said about it beyond the Date itself, or the
    /// most helpful reason it is not one.
    fn parse_parts(text: &str) -> Result<Parsed, DateError> {
        let text = without_notes(text);
        let cleaned = clean(&text);
        let tokens: Vec<&str> = cleaned.split_whitespace().collect();
        let read = match era_suffix(&tokens) {
            Some((bce, era, n)) => {
                read_tokens(&tokens[..tokens.len() - n], bce).map(|(date, month_name)| Parsed {
                    date,
                    month_name,
                    era,
                })
            }
            None => Err(no_era(&tokens)),
        };
        // Whatever else is wrong, two years in one value is the thing to say:
        // the fix is two Properties, not a better spelling.
        read.map_err(|e| {
            if looks_like_span(&text) {
                DateError::SpanInOneValue
            } else {
                e
            }
        })
    }
}

struct Parsed {
    date: BibleDate,
    /// The Hebrew month's one name, when the text named one.
    month_name: Option<&'static str>,
    era: EraStyle,
}

/// The Date in what comes before the era marker: an optional "c.", an
/// optional day and month in either order, then the year.
fn read_tokens(
    tokens: &[&str],
    bce: bool,
) -> Result<(BibleDate, Option<&'static str>), DateError> {
    use DateError::{UnknownMonth, Unreadable};
    let mut tokens = tokens.to_vec();
    let mut approx = false;
    if let Some(first) = tokens.first() {
        if APPROX.contains(first) {
            approx = true;
            tokens.remove(0);
        } else if let Some(rest) = first.strip_prefix('~') {
            approx = true;
            tokens[0] = rest;
            if rest.is_empty() {
                tokens.remove(0);
            }
        }
    }
    // The year is the last token: digits only.
    let year_tok = tokens.pop().ok_or(Unreadable)?;
    let n: i32 = year_tok
        .parse()
        .ok()
        .filter(|n| *n > 0 && *n < 100_000)
        .ok_or(Unreadable)?;
    let year = if bce { 1 - n } else { n };
    // A word where the month goes that names no month.
    let month = |m: &str| month_of(m).ok_or(if is_word(m) { UnknownMonth } else { Unreadable });
    let ((month, name), day) = match tokens.as_slice() {
        [] => ((None, None), None),
        [m] => (month(m)?, None),
        [a, b] => {
            if let Some(m) = month_of(a) {
                (m, Some(day_number(b).ok_or(Unreadable)?))
            } else {
                let m = month(b)?;
                (m, Some(day_number(a).ok_or(Unreadable)?))
            }
        }
        words => {
            return Err(if words.iter().any(|w| is_word(w) && month_of(w).is_none()) {
                UnknownMonth
            } else {
                Unreadable
            })
        }
    };
    let date = BibleDate {
        year,
        month,
        day,
        approx,
    };
    Ok((date, name))
}

/// Why a text with no era marker at its end is not a Date.
fn no_era(tokens: &[&str]) -> DateError {
    if !tokens.iter().any(|t| t.chars().any(|c| c.is_ascii_digit())) {
        return DateError::Unreadable;
    }
    // An era that is there but not at the end ("see 33 CE talk") is a
    // different mistake from no era at all.
    if (1..tokens.len()).any(|i| era_suffix(&tokens[..=i]).is_some()) {
        return DateError::Unreadable;
    }
    // A misspelt month is the first thing to fix: adding an era would not
    // make "14 Nisn 33" a Date.
    match read_tokens(tokens, false) {
        Err(DateError::UnknownMonth) => DateError::UnknownMonth,
        _ => DateError::NoEra,
    }
}

/// A word that could stand where a month goes: letters only, and not "c.".
fn is_word(t: &str) -> bool {
    t.chars().all(char::is_alphabetic) && !APPROX.contains(&t)
}

/// A Date as the app read it, for the live preview under a Date field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DateReading {
    /// The year as people say it, with `bce` for its era: 1513 and true for 1513 BCE.
    pub era_year: i32,
    pub bce: bool,
    /// Which pair of era markers the text used, so the preview answers in it.
    pub era: EraStyle,
    /// Civil month, 1–12.
    pub month: Option<u8>,
    /// The Hebrew month the text named ("nisan", "tishri"…), under one name
    /// whatever spelling was typed; `None` for a civil month.
    pub month_name: Option<&'static str>,
    pub day: Option<u8>,
    pub approx: bool,
    pub precision: Precision,
}

/// The pair of era markers a Date was written with. The preview echoes the
/// user's own family in the app language: "1513 BC" reads back as "1513 BC"
/// (or "1513 av. J.-C."), not "1513 BCE".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EraStyle {
    /// BCE/CE, av. n. è./de n. è.
    Common,
    /// BC/AD, av. J.-C./ap. J.-C.
    Christian,
}

/// Why a text is not a Date, so the preview can say how to fix it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DateError {
    /// No BCE/CE marker: a bare number is never a Date.
    NoEra,
    /// A word where a month goes that names no month.
    UnknownMonth,
    /// Two years in one value, joined by a dash or "to"/"à": a Span is two
    /// Dates, each in its own Property.
    SpanInOneValue,
    /// Anything else.
    Unreadable,
}

/// The text without its notes in brackets: "c. 1513 BCE (Ex 12-13)" is
/// "c. 1513 BCE" with a reference beside it.
fn without_notes(text: &str) -> std::borrow::Cow<'_, str> {
    use std::sync::LazyLock;
    static NOTE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"\([^()]*\)").unwrap());
    NOTE.replace_all(text, " ")
}

/// Lowercased, with the separators a Date may use turned to spaces.
fn clean(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| {
            if c == '.' || c == ',' || c == '-' || c == '–' || c == '/' {
                ' '
            } else {
                c
            }
        })
        .collect()
}

/// Two numbers joined by a dash or by "to"/"à", as in "1513–1473 BCE". An ISO
/// calendar date ("2026-08-02") is three numbers, not a Span.
fn looks_like_span(text: &str) -> bool {
    use std::sync::LazyLock;
    static SPAN: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"(?i)\d[^\d]*?(?:[-–—]|\bto\b|\bà\b)[^\d]*?\d").unwrap()
    });
    static ISO: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^\s*\d+-\d+-\d+\s*$").unwrap());
    SPAN.is_match(text) && !ISO.is_match(text)
}

const APPROX: &[&str] = &[
    "c", "ca", "circa", "v", "vers", "env", "environ", "about", "abt", "approx",
];

/// Era phrases as token sequences (dots, commas and dashes already turned to
/// spaces): the words, whether they mean BCE, and the family they belong to.
const ERAS: &[(&[&str], bool, EraStyle)] = {
    use EraStyle::{Christian as X, Common as C};
    &[
        (&["bce"], true, C),
        (&["b", "c", "e"], true, C),
        (&["bc"], true, X),
        (&["b", "c"], true, X),
        (&["ce"], false, C),
        (&["c", "e"], false, C),
        (&["ad"], false, X),
        (&["a", "d"], false, X),
        (&["av", "j", "c"], true, X),
        (&["av", "jc"], true, X),
        (&["av", "n", "è"], true, C),
        (&["av", "n", "e"], true, C),
        (&["avant", "notre", "ère"], true, C),
        (&["avant", "notre", "ere"], true, C),
        (&["avant", "jésus", "christ"], true, X),
        (&["avant", "jesus", "christ"], true, X),
        (&["ap", "j", "c"], false, X),
        (&["apr", "j", "c"], false, X),
        (&["ap", "jc"], false, X),
        (&["apr", "jc"], false, X),
        (&["de", "n", "è"], false, C),
        (&["de", "n", "e"], false, C),
        (&["de", "notre", "ère"], false, C),
        (&["de", "notre", "ere"], false, C),
        (&["après", "jésus", "christ"], false, X),
        (&["apres", "jesus", "christ"], false, X),
    ]
};

/// The era marker ending `tokens`, the longest that fits: whether it means
/// BCE, its family, and how many tokens it takes.
fn era_suffix(tokens: &[&str]) -> Option<(bool, EraStyle, usize)> {
    let mut best: Option<(bool, EraStyle, usize)> = None;
    for (phrase, bce, style) in ERAS {
        let n = phrase.len();
        if tokens.len() > n
            && tokens[tokens.len() - n..] == **phrase
            && best.map_or(true, |(_, _, b)| n > b)
        {
            best = Some((*bce, *style, n));
        }
    }
    best
}

fn day_number(s: &str) -> Option<u8> {
    let s = s
        .trim_end_matches(|c| c == 'e' || c == 'r')
        .trim_end_matches("st")
        .trim_end_matches("nd")
        .trim_end_matches("th");
    s.parse().ok().filter(|d| (1..=31).contains(d))
}

/// Civil month for an English, French or Hebrew month name (or abbreviation),
/// with the Hebrew month's one name when it is one.
fn month_of(s: &str) -> Option<(Option<u8>, Option<&'static str>)> {
    if let Some((m, name)) = hebrew_month(s) {
        return Some((Some(m), Some(name)));
    }
    civil_month(s).map(|m| (Some(m), None))
}

/// A Hebrew month, at the civil month it usually begins in, under one name
/// whatever spelling was typed.
fn hebrew_month(s: &str) -> Option<(u8, &'static str)> {
    Some(match s {
        "nisan" | "nissan" | "abib" => (4, "nisan"),
        "iyyar" | "iyar" | "ziv" => (5, "iyyar"),
        "sivan" | "siwan" => (6, "sivan"),
        "tammuz" | "tamouz" => (7, "tammuz"),
        "ab" | "av" => (8, "ab"),
        "elul" | "eloul" => (9, "elul"),
        "tishri" | "tishrei" | "ethanim" | "tisri" => (10, "tishri"),
        "heshvan" | "cheshvan" | "marheshvan" | "bul" => (11, "heshvan"),
        "chislev" | "kislev" | "kislew" => (12, "chislev"),
        "tebeth" | "tevet" | "tébeth" => (1, "tebeth"),
        "shebat" | "shevat" | "schebat" => (2, "shebat"),
        "adar" | "veadar" | "adar ii" => (3, "adar"),
        _ => return None,
    })
}

fn civil_month(s: &str) -> Option<u8> {
    Some(match s {
        "january" | "jan" | "janvier" | "janv" => 1,
        "february" | "feb" | "février" | "fevrier" | "févr" | "fevr" => 2,
        "march" | "mar" | "mars" => 3,
        "april" | "apr" | "avril" | "avr" => 4,
        "may" | "mai" => 5,
        "june" | "jun" | "juin" => 6,
        "july" | "jul" | "juillet" | "juil" => 7,
        "august" | "aug" | "août" | "aout" => 8,
        "september" | "sep" | "sept" | "septembre" => 9,
        "october" | "oct" | "octobre" => 10,
        "november" | "nov" | "novembre" => 11,
        "december" | "dec" | "décembre" | "decembre" | "déc" => 12,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> Option<BibleDate> {
        BibleDate::parse(s)
    }

    #[test]
    fn years_with_eras() {
        assert_eq!(
            p("1513 BCE"),
            Some(BibleDate {
                year: -1512,
                month: None,
                day: None,
                approx: false
            })
        );
        assert_eq!(p("33 CE").unwrap().year, 33);
        assert_eq!(p("1 BCE").unwrap().year, 0);
        assert_eq!(p("1 CE").unwrap().year, 1);
        assert_eq!(p("607 B.C.E.").unwrap().year, -606);
        assert_eq!(p("70 A.D.").unwrap().year, 70);
        assert_eq!(p("70 AD").unwrap().year, 70);
        assert_eq!(p("4026 BC").unwrap().year, -4025);
        assert_eq!(p("52 C.E.").unwrap().year, 52);
    }

    #[test]
    fn french_eras() {
        assert_eq!(p("1513 av. n. è.").unwrap().year, -1512);
        assert_eq!(p("1513 av. J.-C.").unwrap().year, -1512);
        assert_eq!(p("33 de n. è.").unwrap().year, 33);
        assert_eq!(p("33 ap. J.-C.").unwrap().year, 33);
        assert_eq!(p("33 apr. J.-C.").unwrap().year, 33);
        assert_eq!(p("607 avant notre ère").unwrap().year, -606);
    }

    #[test]
    fn approximate() {
        let d = p("c. 1513 BCE").unwrap();
        assert!(d.approx);
        assert_eq!(d.year, -1512);
        assert!(p("ca. 1513 BCE").unwrap().approx);
        assert!(p("circa 1513 BCE").unwrap().approx);
        assert!(p("~1513 BCE").unwrap().approx);
        assert!(p("~ 1513 BCE").unwrap().approx);
        assert!(p("v. 1513 av. n. è.").unwrap().approx);
        assert!(p("vers 1513 av. n. è.").unwrap().approx);
        assert!(!p("1513 BCE").unwrap().approx);
    }

    #[test]
    fn months_and_days() {
        let d = p("14 Nisan 33 CE").unwrap();
        assert_eq!((d.year, d.month, d.day), (33, Some(4), Some(14)));
        assert_eq!(d.precision(), Precision::Day);
        let d = p("Nisan 14, 33 CE").unwrap();
        assert_eq!((d.month, d.day), (Some(4), Some(14)));
        let d = p("Nisan 33 CE").unwrap();
        assert_eq!((d.month, d.day), (Some(4), None));
        assert_eq!(d.precision(), Precision::Month);
        let d = p("October 29 CE").unwrap();
        assert_eq!(d.month, Some(10));
        let d = p("14 nisan 33 de n. è.").unwrap();
        assert_eq!(d.day, Some(14));
        let d = p("1er avril 33 de n. è.").unwrap();
        assert_eq!((d.day, d.month), (Some(1), Some(4)));
        assert_eq!(p("1513 BCE").unwrap().precision(), Precision::Year);
    }

    #[test]
    fn not_dates() {
        assert_eq!(p("33"), None);
        assert_eq!(p("Selçuk, Türkiye"), None);
        assert_eq!(p("see 33 CE talk"), None);
        assert_eq!(p("BCE"), None);
        assert_eq!(p(""), None);
        assert_eq!(p("2026-08-02"), None);
        assert_eq!(p("Nisan 33"), None);
        assert_eq!(p("99 Nisan 33 CE"), None);
        assert_eq!(p("[[Ephesus]]"), None);
    }

    #[test]
    fn ordering_and_display() {
        let flood = p("2370 BCE").unwrap();
        let exodus = p("1513 BCE").unwrap();
        let passover = p("14 Nisan 33 CE").unwrap();
        let spring = p("Nisan 33 CE").unwrap();
        assert!(flood.sort_key() < exodus.sort_key());
        assert!(exodus.sort_key() < spring.sort_key());
        assert!(spring.sort_key() < passover.sort_key());
        assert_eq!(flood.era_year(), (2370, true));
        assert_eq!(passover.era_year(), (33, false));
        assert_eq!(p("1 BCE").unwrap().era_year(), (1, true));
    }

    fn read(s: &str) -> Result<DateReading, DateError> {
        BibleDate::read(s)
    }

    #[test]
    fn reading_one_value_per_precision() {
        let r = read("c. 1513 BCE").unwrap();
        assert_eq!(
            (r.era_year, r.bce, r.approx, r.precision),
            (1513, true, true, Precision::Year)
        );
        assert_eq!((r.month, r.day, r.month_name), (None, None, None));

        let r = read("Nisan 33 CE").unwrap();
        assert_eq!(
            (r.era_year, r.bce, r.month, r.day, r.precision),
            (33, false, Some(4), None, Precision::Month)
        );
        assert_eq!(r.month_name, Some("nisan"));

        let r = read("14 Nisan 33 CE").unwrap();
        assert_eq!(
            (r.month, r.day, r.month_name, r.precision),
            (Some(4), Some(14), Some("nisan"), Precision::Day)
        );
        // A civil month has no Hebrew name; Abib is Nisan by another name.
        assert_eq!(read("1er avril 33 de n. è.").unwrap().month_name, None);
        assert_eq!(read("Abib 1513 BCE").unwrap().month_name, Some("nisan"));
    }

    #[test]
    fn reading_says_why_a_value_is_not_a_date() {
        use DateError::*;
        assert_eq!(read("1513"), Err(NoEra));
        assert_eq!(read("14 Nisan 33"), Err(NoEra));
        // A word in the month slot that names no month is the first thing to
        // fix, era or not.
        assert_eq!(read("14 Nisn 33"), Err(UnknownMonth));
        assert_eq!(read("Frimaire 33"), Err(UnknownMonth));
        assert_eq!(read("2026-08-02"), Err(NoEra));
        assert_eq!(read("14 Nisn 33 CE"), Err(UnknownMonth));
        assert_eq!(read("Frimaire 33 CE"), Err(UnknownMonth));
        assert_eq!(read("1513–1473 BCE"), Err(SpanInOneValue));
        assert_eq!(read("1513-1473 BCE"), Err(SpanInOneValue));
        assert_eq!(read("c. 1513 BCE – c. 1473 BCE"), Err(SpanInOneValue));
        assert_eq!(read("29 to 33 CE"), Err(SpanInOneValue));
        assert_eq!(read("1513 à 1473 av. n. è."), Err(SpanInOneValue));
        assert_eq!(read("1513–1473"), Err(SpanInOneValue));
        assert_eq!(read(""), Err(Unreadable));
        assert_eq!(read("Selçuk, Türkiye"), Err(Unreadable));
        assert_eq!(read("see 33 CE talk"), Err(Unreadable));
        assert_eq!(read("99 Nisan 33 CE"), Err(Unreadable));
        assert_eq!(read("BCE"), Err(Unreadable));
    }

    #[test]
    fn reading_serialises_for_the_ui() {
        let ok = serde_json::to_value(read("14 Nisan 33 CE").unwrap()).unwrap();
        assert_eq!(ok["precision"], "day");
        assert_eq!(ok["month_name"], "nisan");
        assert_eq!(ok["era"], "common");
        assert!(ok.get("year").is_none());
        assert_eq!(serde_json::to_value(DateError::SpanInOneValue).unwrap(), "span_in_one_value");
    }

    #[test]
    fn a_note_in_brackets_is_not_part_of_the_date() {
        // The dash in "12-13" is a Passage's, not a Span's: the Date before it
        // reads, so nothing claims the value holds two.
        let r = read("c. 1513 BCE (Ex 12-13)").unwrap();
        assert_eq!((r.era_year, r.bce, r.approx), (1513, true, true));
        assert_eq!(p("33 CE (traditional)").unwrap().year, 33);
        assert_eq!(p("(see Acts 2) 33 CE").unwrap().year, 33);
        assert_eq!(read("1513 (Ex 12-13)"), Err(DateError::NoEra));
    }

    #[test]
    fn reading_keeps_the_era_family_typed() {
        use EraStyle::*;
        for (text, style) in [
            ("1513 BCE", Common),
            ("33 C.E.", Common),
            ("1513 av. n. è.", Common),
            ("33 de notre ère", Common),
            ("1513 BC", Christian),
            ("70 A.D.", Christian),
            ("1513 av. J.-C.", Christian),
            ("33 apr. J.-C.", Christian),
            ("607 avant Jésus-Christ", Christian),
        ] {
            assert_eq!(read(text).unwrap().era, style, "{text}");
        }
    }
}
