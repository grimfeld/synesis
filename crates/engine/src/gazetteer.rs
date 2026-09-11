//! Bundled gazetteer of Bible places (PLAN §14.6): name, coordinates and
//! modern name for every identifiable place in Scripture, derived from the
//! OpenBible.info geocoding data (CC BY 4.0, see data/GAZETTEER-NOTICE.txt).
//! Works offline; the user picks a hit and the Place gets its coordinates.

use crate::names::normalize;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

const DATA: &str = include_str!("../data/gazetteer.tsv");

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GazetteerHit {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub modern_name: String,
    /// Verses mentioning the place: a proxy for how likely the user means it.
    pub verses: u32,
}

struct Entry {
    hit: GazetteerHit,
    norm: String,
}

static ENTRIES: Lazy<Vec<Entry>> = Lazy::new(|| {
    DATA.lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .filter_map(|l| {
            let mut f = l.split('\t');
            let name = f.next()?.to_string();
            let lat = f.next()?.parse().ok()?;
            let lon = f.next()?.parse().ok()?;
            let modern_name = f.next()?.to_string();
            let verses = f.next()?.parse().ok()?;
            Some(Entry {
                norm: normalize(&name),
                hit: GazetteerHit {
                    name,
                    lat,
                    lon,
                    modern_name,
                    verses,
                },
            })
        })
        .collect()
});

pub fn len() -> usize {
    ENTRIES.len()
}

/// Places whose name starts with `query` (accent- and case-insensitive),
/// then those containing it; exact name first, then by verse count.
pub fn search(query: &str, limit: usize) -> Vec<GazetteerHit> {
    let q = normalize(query);
    if q.is_empty() {
        return vec![];
    }
    let mut scored: Vec<(u8, &Entry)> = ENTRIES
        .iter()
        .filter_map(|e| {
            if e.norm == q {
                Some((0, e))
            } else if e.norm.starts_with(&q) {
                Some((1, e))
            } else if e.norm.contains(&q) {
                Some((2, e))
            } else {
                None
            }
        })
        .collect();
    scored.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then(b.1.hit.verses.cmp(&a.1.hit.verses))
            .then(a.1.hit.name.cmp(&b.1.hit.name))
    });
    scored
        .into_iter()
        .take(limit)
        .map(|(_, e)| e.hit.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_data_loads() {
        assert!(len() > 1200, "{}", len());
    }

    #[test]
    fn prefix_search_ranks_exact_then_by_verses() {
        let hits = search("Eph", 5);
        assert_eq!(hits[0].name, "Ephesus");
        assert!((hits[0].lat - 37.9391).abs() < 0.01);
        assert!((hits[0].lon - 27.3407).abs() < 0.01);
        assert_eq!(hits[0].modern_name, "Ephesus");
        let b = search("bethlehem", 5);
        assert!(b[0].name.starts_with("Bethlehem"), "{:?}", b[0]);
        assert!(b[0].verses >= b[1].verses);
        // Exact match wins over longer names sharing the prefix.
        let j = search("Jerusalem", 3);
        assert_eq!(j[0].name, "Jerusalem");
    }

    #[test]
    fn accents_and_empty() {
        assert!(search("", 5).is_empty());
        assert_eq!(search("éphesus", 1)[0].name, "Ephesus");
        assert!(search("zzzzqqq", 5).is_empty());
    }
}
