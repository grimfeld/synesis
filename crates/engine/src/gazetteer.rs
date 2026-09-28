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
    /// One of the built-in Place kinds (PLAN §27.3), or `None` where
    /// OpenBible's classification has no clear kind (a campsite, a valley).
    pub kind: Option<String>,
}

struct Entry {
    hit: GazetteerHit,
    norm: String,
    /// The name without its disambiguating number ("Antioch 1" is "antioch"),
    /// which is the title a Place made from it carries.
    base: String,
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
            // Slug and score, then the kind (`scripts/gazetteer-kinds.mjs`).
            let kind = f.nth(2).map(str::trim).filter(|k| !k.is_empty()).map(String::from);
            let base = normalize(name.trim_end_matches(|c: char| c.is_ascii_digit()).trim_end());
            Some(Entry {
                base,
                norm: normalize(&name),
                hit: GazetteerHit {
                    name,
                    lat,
                    lon,
                    modern_name,
                    verses,
                    kind,
                },
            })
        })
        .collect()
});

/// The kind the gazetteer gives a Place of this title (PLAN §27.13), or None
/// when it cannot say which entry is meant.
///
/// Several entries share a name ("Antioch 1" on the Orontes, "Antioch 2" in
/// Pisidia). With coordinates, the entry nearest the Place wins, if it lies
/// within half a degree: further than that, the Place is somewhere the
/// gazetteer does not know. Without them, the entries must all agree.
pub fn kind_for(title: &str, at: Option<(f64, f64)>) -> Option<String> {
    let key = normalize(title);
    if key.is_empty() {
        return None;
    }
    let hits: Vec<&GazetteerHit> = ENTRIES
        .iter()
        .filter(|e| e.base == key)
        .map(|e| &e.hit)
        .collect();
    if hits.is_empty() {
        return None;
    }
    match at {
        Some((lat, lon)) => {
            let d = |h: &GazetteerHit| (h.lat - lat).hypot(h.lon - lon);
            let near = hits.iter().min_by(|a, b| d(a).total_cmp(&d(b)))?;
            (d(near) <= 0.5).then(|| near.kind.clone()).flatten()
        }
        None => {
            let first = hits[0].kind.as_ref()?;
            hits.iter()
                .all(|h| h.kind.as_ref() == Some(first))
                .then(|| first.clone())
        }
    }
}

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
    fn hits_carry_their_kind() {
        let kind = |q: &str| search(q, 1)[0].kind.clone();
        assert_eq!(kind("Jerusalem").as_deref(), Some("settlement"));
        assert_eq!(kind("Mount Sinai").as_deref(), Some("mountain"));
        assert_eq!(kind("Sea of Galilee").as_deref(), Some("water"));
        assert_eq!(kind("Egypt").as_deref(), Some("region"));
        assert_eq!(kind("Gethsemane").as_deref(), Some("site"));
        // A valley is not one of the five: blank, so it draws the plain pin.
        assert_eq!(kind("Jordan Valley"), None);
        let kinds = ["settlement", "mountain", "water", "region", "site"];
        assert!(ENTRIES.iter().filter_map(|e| e.hit.kind.as_deref()).all(|k| kinds.contains(&k)));
        let with = ENTRIES.iter().filter(|e| e.hit.kind.is_some()).count();
        assert!(with * 10 > len() * 9, "{with} of {} have a kind", len());
    }

    #[test]
    fn kind_for_a_title_picks_the_entry_nearest_the_place() {
        assert_eq!(kind_for("Mount Sinai", None).as_deref(), Some("mountain"));
        assert_eq!(kind_for("jerusalem", Some((31.78, 35.23))).as_deref(), Some("settlement"));
        // Tabor names a mountain and, near Bethel, a site: coordinates decide.
        assert_eq!(kind_for("Tabor", Some((32.68, 35.33))).as_deref(), Some("mountain"));
        assert_eq!(kind_for("Tabor", Some((31.92, 35.24))).as_deref(), Some("site"));
        // Without coordinates, entries that disagree give no answer.
        assert_eq!(kind_for("Tabor", None), None);
        // Far from every entry of that name: not this gazetteer's place.
        assert_eq!(kind_for("Jerusalem", Some((51.5, -0.1))), None);
        assert_eq!(kind_for("Atlantis", None), None);
        assert_eq!(kind_for("", None), None);
    }

    #[test]
    fn accents_and_empty() {
        assert!(search("", 5).is_empty());
        assert_eq!(search("éphesus", 1)[0].name, "Ephesus");
        assert!(search("zzzzqqq", 5).is_empty());
    }
}
