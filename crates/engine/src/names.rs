//! Book names and abbreviations per language. English and French, including the
//! Watchtower-standard abbreviations used in Jehovah's Witnesses publications.
//! The parser is language-neutral: it accepts every table at once.

use crate::scripture::Lang;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;

/// (english full, english abbreviations, french full, french abbreviations)
/// Numbered books are written with a leading digit; the variant generator
/// expands "1 " into "I ", "1st ", "1er " etc.
static NAMES: [(&str, &[&str], &str, &[&str]); 66] = [
    (
        "Genesis",
        &["Gen", "Ge", "Gn"],
        "Genèse",
        &["Gen", "Gn", "Ge"],
    ),
    ("Exodus", &["Exod", "Exo", "Ex"], "Exode", &["Ex"]),
    (
        "Leviticus",
        &["Lev", "Le", "Lv"],
        "Lévitique",
        &["Lév", "Lev", "Lv", "Le"],
    ),
    (
        "Numbers",
        &["Num", "Nu", "Nb", "Nm"],
        "Nombres",
        &["Nb", "Nomb", "Nu"],
    ),
    (
        "Deuteronomy",
        &["Deut", "Deu", "De", "Dt"],
        "Deutéronome",
        &["Deut", "Dt", "De"],
    ),
    ("Joshua", &["Josh", "Jos"], "Josué", &["Jos"]),
    (
        "Judges",
        &["Judg", "Jdg", "Jg", "Jgs"],
        "Juges",
        &["Jg", "Jug"],
    ),
    ("Ruth", &["Ru", "Rth"], "Ruth", &["Ru", "Rt"]),
    (
        "1 Samuel",
        &["1 Sam", "1 Sa", "1 S", "1Sam", "1Sa", "1S"],
        "1 Samuel",
        &["1 Sam", "1 Sa", "1 S", "1Sam", "1Sa", "1S"],
    ),
    (
        "2 Samuel",
        &["2 Sam", "2 Sa", "2 S", "2Sam", "2Sa", "2S"],
        "2 Samuel",
        &["2 Sam", "2 Sa", "2 S", "2Sam", "2Sa", "2S"],
    ),
    (
        "1 Kings",
        &["1 Kgs", "1 Ki", "1 Kg", "1Kgs", "1Ki", "1K"],
        "1 Rois",
        &["1 R", "1R", "1 Ro", "1Ro"],
    ),
    (
        "2 Kings",
        &["2 Kgs", "2 Ki", "2 Kg", "2Kgs", "2Ki", "2K"],
        "2 Rois",
        &["2 R", "2R", "2 Ro", "2Ro"],
    ),
    (
        "1 Chronicles",
        &["1 Chron", "1 Chr", "1 Ch", "1Chron", "1Chr", "1Ch"],
        "1 Chroniques",
        &["1 Chron", "1 Chr", "1 Ch", "1Chron", "1Chr", "1Ch"],
    ),
    (
        "2 Chronicles",
        &["2 Chron", "2 Chr", "2 Ch", "2Chron", "2Chr", "2Ch"],
        "2 Chroniques",
        &["2 Chron", "2 Chr", "2 Ch", "2Chron", "2Chr", "2Ch"],
    ),
    ("Ezra", &["Ezr"], "Esdras", &["Esd", "Esdr"]),
    ("Nehemiah", &["Neh", "Ne"], "Néhémie", &["Néh", "Neh", "Ne"]),
    ("Esther", &["Esth", "Est", "Es"], "Esther", &["Est", "Esth"]),
    ("Job", &["Jb"], "Job", &["Jb"]),
    (
        "Psalms",
        &["Psalm", "Pss", "Ps", "Psa", "Psm"],
        "Psaumes",
        &["Psaume", "Ps"],
    ),
    (
        "Proverbs",
        &["Prov", "Pro", "Pr", "Prv"],
        "Proverbes",
        &["Prov", "Pr"],
    ),
    (
        "Ecclesiastes",
        &["Eccl", "Ecc", "Ec", "Qoh"],
        "Ecclésiaste",
        &["Eccl", "Ecc", "Ec", "Qo"],
    ),
    (
        "Song of Solomon",
        &[
            "Song of Songs",
            "Song",
            "Canticles",
            "Cant",
            "Ca",
            "SoS",
            "So",
        ],
        "Chant de Salomon",
        &["Cantique des cantiques", "Cantique", "Cant", "Ct", "Ch"],
    ),
    (
        "Isaiah",
        &["Isa", "Is"],
        "Isaïe",
        &["Ésaïe", "Esaïe", "Is", "És", "Es", "Isa"],
    ),
    (
        "Jeremiah",
        &["Jer", "Je", "Jr"],
        "Jérémie",
        &["Jér", "Jer", "Jr"],
    ),
    (
        "Lamentations",
        &["Lam", "La"],
        "Lamentations",
        &["Lam", "Lm", "La"],
    ),
    (
        "Ezekiel",
        &["Ezek", "Eze", "Ez"],
        "Ézéchiel",
        &["Ezéchiel", "Éz", "Ez", "Ézé", "Eze"],
    ),
    (
        "Daniel",
        &["Dan", "Da", "Dn"],
        "Daniel",
        &["Dan", "Dn", "Da"],
    ),
    ("Hosea", &["Hos", "Ho"], "Osée", &["Os"]),
    ("Joel", &["Joe", "Jl"], "Joël", &["Joe", "Jl"]),
    ("Amos", &["Am"], "Amos", &["Am"]),
    ("Obadiah", &["Obad", "Ob"], "Abdias", &["Ab", "Abd"]),
    ("Jonah", &["Jon"], "Jonas", &["Jon"]),
    ("Micah", &["Mic", "Mi"], "Michée", &["Mi", "Mich"]),
    ("Nahum", &["Nah", "Na"], "Nahum", &["Na", "Nah"]),
    ("Habakkuk", &["Hab", "Hb"], "Habacuc", &["Hab", "Ha"]),
    (
        "Zephaniah",
        &["Zeph", "Zep", "Zp"],
        "Sophonie",
        &["Sph", "Sop", "So"],
    ),
    ("Haggai", &["Hag", "Hg"], "Aggée", &["Ag", "Agg"]),
    (
        "Zechariah",
        &["Zech", "Zec", "Zc"],
        "Zacharie",
        &["Za", "Zach", "Zac"],
    ),
    ("Malachi", &["Mal", "Ml"], "Malachie", &["Ml", "Mal"]),
    (
        "Matthew",
        &["Matt", "Mat", "Mt"],
        "Matthieu",
        &["Mat", "Mt"],
    ),
    ("Mark", &["Mrk", "Mk", "Mr"], "Marc", &["Mc", "Mr"]),
    ("Luke", &["Luk", "Lk", "Lu"], "Luc", &["Lc", "Lu"]),
    ("John", &["Joh", "Jn", "Jhn"], "Jean", &["Jn", "Jean"]),
    ("Acts", &["Act", "Ac"], "Actes", &["Ac", "Act"]),
    (
        "Romans",
        &["Rom", "Ro", "Rm"],
        "Romains",
        &["Rom", "Rm", "Ro"],
    ),
    (
        "1 Corinthians",
        &["1 Cor", "1 Co", "1Cor", "1Co"],
        "1 Corinthiens",
        &["1 Cor", "1 Co", "1Cor", "1Co"],
    ),
    (
        "2 Corinthians",
        &["2 Cor", "2 Co", "2Cor", "2Co"],
        "2 Corinthiens",
        &["2 Cor", "2 Co", "2Cor", "2Co"],
    ),
    ("Galatians", &["Gal", "Ga"], "Galates", &["Gal", "Ga"]),
    (
        "Ephesians",
        &["Eph", "Ep"],
        "Éphésiens",
        &["Ephésiens", "Éph", "Eph", "Ép", "Ep"],
    ),
    (
        "Philippians",
        &["Phil", "Php", "Pp"],
        "Philippiens",
        &["Php", "Phil", "Ph"],
    ),
    ("Colossians", &["Col"], "Colossiens", &["Col"]),
    (
        "1 Thessalonians",
        &["1 Thess", "1 Thes", "1 Th", "1Thess", "1Thes", "1Th"],
        "1 Thessaloniciens",
        &["1 Thess", "1 Th", "1Thess", "1Th"],
    ),
    (
        "2 Thessalonians",
        &["2 Thess", "2 Thes", "2 Th", "2Thess", "2Thes", "2Th"],
        "2 Thessaloniciens",
        &["2 Thess", "2 Th", "2Thess", "2Th"],
    ),
    (
        "1 Timothy",
        &["1 Tim", "1 Ti", "1Tim", "1Ti"],
        "1 Timothée",
        &["1 Tim", "1 Tm", "1Tim", "1Tm", "1 Ti", "1Ti"],
    ),
    (
        "2 Timothy",
        &["2 Tim", "2 Ti", "2Tim", "2Ti"],
        "2 Timothée",
        &["2 Tim", "2 Tm", "2Tim", "2Tm", "2 Ti", "2Ti"],
    ),
    ("Titus", &["Tit", "Ti"], "Tite", &["Tt", "Tit"]),
    (
        "Philemon",
        &["Phlm", "Phm", "Pm"],
        "Philémon",
        &["Phm", "Phlm"],
    ),
    (
        "Hebrews",
        &["Heb", "He"],
        "Hébreux",
        &["Héb", "Heb", "Hé", "He"],
    ),
    ("James", &["Jas", "Jm"], "Jacques", &["Jc", "Jac", "Jq"]),
    (
        "1 Peter",
        &["1 Pet", "1 Pe", "1 Pt", "1Pet", "1Pe", "1Pt", "1P"],
        "1 Pierre",
        &["1 Pi", "1 P", "1Pi", "1P"],
    ),
    (
        "2 Peter",
        &["2 Pet", "2 Pe", "2 Pt", "2Pet", "2Pe", "2Pt", "2P"],
        "2 Pierre",
        &["2 Pi", "2 P", "2Pi", "2P"],
    ),
    (
        "1 John",
        &["1 Jn", "1 Jo", "1 Joh", "1Jn", "1Jo", "1Joh"],
        "1 Jean",
        &["1 Jn", "1Jn"],
    ),
    (
        "2 John",
        &["2 Jn", "2 Jo", "2 Joh", "2Jn", "2Jo", "2Joh"],
        "2 Jean",
        &["2 Jn", "2Jn"],
    ),
    (
        "3 John",
        &["3 Jn", "3 Jo", "3 Joh", "3Jn", "3Jo", "3Joh"],
        "3 Jean",
        &["3 Jn", "3Jn"],
    ),
    ("Jude", &["Jud", "Jd"], "Jude", &["Jud", "Jd"]),
    (
        "Revelation",
        &["Rev", "Re", "Rv", "Apocalypse", "Apoc"],
        "Révélation",
        &["Apocalypse", "Apoc", "Ré", "Re", "Rév", "Rev", "Ap"],
    ),
];

pub fn book_name(book: u8, lang: Lang) -> &'static str {
    let entry = &NAMES[(book as usize).saturating_sub(1).min(65)];
    match lang {
        Lang::En => entry.0,
        Lang::Fr => entry.2,
    }
}

/// English name, used for file names on disk.
pub fn english_name(book: u8) -> &'static str {
    book_name(book, Lang::En)
}

/// All display names for a book across languages (used as Obsidian aliases).
pub fn all_full_names(book: u8) -> Vec<&'static str> {
    let e = &NAMES[(book as usize) - 1];
    if e.0 == e.2 {
        vec![e.0]
    } else {
        vec![e.0, e.2]
    }
}

/// Normalise a candidate name for lookup: NFD, strip diacritics, lowercase,
/// drop spaces and trailing dots.
pub fn normalize(s: &str) -> String {
    s.nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .flat_map(|c| c.to_lowercase())
        .filter(|c| !c.is_whitespace() && *c != '.')
        .collect()
}

fn number_prefixes(n: char, lang: Lang) -> Vec<String> {
    let roman = match n {
        '1' => "I",
        '2' => "II",
        _ => "III",
    };
    let mut v = vec![
        format!("{n} "),
        format!("{n}"),
        format!("{roman} "),
        format!("{roman}"),
    ];
    match lang {
        Lang::En => {
            let ord = match n {
                '1' => "1st ",
                '2' => "2nd ",
                _ => "3rd ",
            };
            v.push(ord.to_string());
            v.push(match n {
                '1' => "First ".into(),
                '2' => "Second ".into(),
                _ => "Third ".into(),
            });
        }
        Lang::Fr => {
            v.push(match n {
                '1' => "1er ".into(),
                _ => format!("{n}e "),
            });
            v.push(match n {
                '1' => "1re ".into(),
                _ => format!("{n}ème "),
            });
            v.push(match n {
                '1' => "Premier ".into(),
                '2' => "Deuxième ".into(),
                _ => "Troisième ".into(),
            });
        }
    }
    v
}

fn expand(name: &str, lang: Lang) -> Vec<String> {
    let mut out = Vec::new();
    let first = name.chars().next().unwrap();
    if first.is_ascii_digit() {
        let stem = name[1..].trim_start();
        for p in number_prefixes(first, lang) {
            out.push(format!("{p}{stem}"));
        }
    } else {
        out.push(name.to_string());
    }
    // Unaccented spellings are common when typing fast.
    let extra: Vec<String> = out
        .iter()
        .map(|s| {
            s.nfd()
                .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
                .collect::<String>()
        })
        .filter(|s| !out.contains(s))
        .collect();
    out.extend(extra);
    out
}

/// Every accepted surface form, paired with its book number. Surface forms are
/// not normalised; use [`lookup`] for matching.
pub fn all_variants() -> Vec<(String, u8)> {
    let mut out = Vec::new();
    for (i, (en, en_ab, fr, fr_ab)) in NAMES.iter().enumerate() {
        let n = (i + 1) as u8;
        for v in expand(en, Lang::En) {
            out.push((v, n));
        }
        for a in *en_ab {
            for v in expand(a, Lang::En) {
                out.push((v, n));
            }
        }
        for v in expand(fr, Lang::Fr) {
            out.push((v, n));
        }
        for a in *fr_ab {
            for v in expand(a, Lang::Fr) {
                out.push((v, n));
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

static LOOKUP: Lazy<HashMap<String, u8>> = Lazy::new(|| {
    let mut m = HashMap::new();
    for (v, n) in all_variants() {
        // First writer wins: full names are inserted before abbreviations of the
        // same book, and books are in canonical order. Collisions across books
        // (e.g. French "Es" for Esther vs Isaïe) resolve to the earlier book.
        m.entry(normalize(&v)).or_insert(n);
    }
    m
});

/// Resolve a surface form (any language, any abbreviation) to a book number.
pub fn lookup(name: &str) -> Option<u8> {
    LOOKUP.get(&normalize(name)).copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookups() {
        assert_eq!(lookup("John"), Some(43));
        assert_eq!(lookup("Joh"), Some(43));
        assert_eq!(lookup("Jean"), Some(43));
        assert_eq!(lookup("1 Corinthians"), Some(46));
        assert_eq!(lookup("1Co"), Some(46));
        assert_eq!(lookup("I Corinthiens"), Some(46));
        assert_eq!(lookup("Ro"), Some(45));
        assert_eq!(lookup("Rm"), Some(45));
        assert_eq!(lookup("Re"), Some(66));
        assert_eq!(lookup("Apocalypse"), Some(66));
        assert_eq!(lookup("Genese"), Some(1));
        assert_eq!(lookup("Ps."), Some(19));
        assert_eq!(lookup("Php"), Some(50));
        assert_eq!(lookup("Nope"), None);
    }
}
