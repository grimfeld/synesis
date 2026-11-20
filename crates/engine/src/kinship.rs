//! Kinship (CONTEXT.md; ADR 0024): the family ties between Characters, read
//! from three built-in Properties on a Character — `father` and `mother`
//! (one link each) and `spouses` (a list of links).
//!
//! Each tie is stored once, on the side that names it. This module only reads
//! them: it turns the links into edges, as written, and reports what cannot be
//! one (a target that is not a Character, two values where one is allowed, a
//! Character who is their own ancestor). The other direction — a parent's
//! children, siblings, a spouse named only by the other side — is derived by
//! the UI (`src/lib/kinship.ts`), which the Hub and the Family tree share.
//! Nothing here writes a file: bad data is reported, never corrected.
use crate::document::DocType;
use crate::index::DocSummary;
use crate::Result;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

/// The three Property names that carry Kinship, in the order a Character's
/// edges are given.
pub const KINSHIP_PROPERTIES: [&str; 3] = ["father", "mother", "spouses"];

/// What the Character that names a tie says the other one is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Relation {
    Father,
    Mother,
    Spouse,
}

impl Relation {
    fn of(property: &str) -> Option<Relation> {
        match property {
            "father" => Some(Relation::Father),
            "mother" => Some(Relation::Mother),
            "spouses" => Some(Relation::Spouse),
            _ => None,
        }
    }
}

/// One tie as written: `character` names `kin` as its `relation` ("Jacob's
/// father is Isaac"). Both ends are Characters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KinshipEdge {
    pub character: DocSummary,
    pub relation: Relation,
    pub kin: DocSummary,
}

/// Kinship data that cannot be read as a tie, reported on `character`'s Hub.
/// The tie it concerns is left out of the edges; the file is untouched.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum KinshipWarning {
    /// `property` names `target`, which is a document but not a Character.
    NotACharacter {
        character: DocSummary,
        property: String,
        target: DocSummary,
    },
    /// `father` or `mother` holds more than one link: neither is used.
    TwoValues {
        character: DocSummary,
        property: String,
        targets: Vec<String>,
    },
    /// `character` is their own ancestor: `path` runs from them through
    /// parents back to them. The parent ties on the cycle are left out.
    Cycle {
        character: DocSummary,
        path: Vec<DocSummary>,
    },
}

/// Every Kinship edge in the Vault, and every warning.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Kinship {
    pub edges: Vec<KinshipEdge>,
    pub warnings: Vec<KinshipWarning>,
}

/// One Kinship link as the index holds it: the Character whose front matter
/// carries it, the Property, and the link's target as written.
pub struct NamedKin {
    pub character: DocSummary,
    pub property: String,
    pub target: String,
}

/// Read the edges and warnings from every Kinship link, given in Character
/// order and, within one, in the order written. `resolve` answers what a link
/// target names; one that names nothing ties no one, silently — following the
/// link creates the page, and it joins Kinship once its type is Character.
pub fn read(
    links: Vec<NamedKin>,
    mut resolve: impl FnMut(&str) -> Result<Option<DocSummary>>,
) -> Result<Kinship> {
    // Group by Character, keeping the order given.
    let mut order: Vec<DocSummary> = Vec::new();
    let mut by_character: HashMap<String, Vec<(String, String)>> = HashMap::new();
    for l in links {
        if Relation::of(&l.property).is_none() || l.character.doc_type != DocType::Character {
            continue;
        }
        let entry = by_character.entry(l.character.id.clone()).or_default();
        if entry.is_empty() {
            order.push(l.character.clone());
        }
        entry.push((l.property, l.target));
    }

    let mut out = Kinship::default();
    for character in &order {
        let named = &by_character[&character.id];
        for property in KINSHIP_PROPERTIES {
            let relation = Relation::of(property).expect("a Kinship Property");
            let targets: Vec<&String> = named
                .iter()
                .filter(|(p, _)| p == property)
                .map(|(_, t)| t)
                .collect();
            let mut kin = Vec::new();
            for target in &targets {
                let Some(d) = resolve(target)? else { continue };
                if d.doc_type != DocType::Character {
                    out.warnings.push(KinshipWarning::NotACharacter {
                        character: character.clone(),
                        property: property.to_string(),
                        target: d,
                    });
                } else {
                    kin.push(d);
                }
            }
            if relation != Relation::Spouse && targets.len() > 1 {
                out.warnings.push(KinshipWarning::TwoValues {
                    character: character.clone(),
                    property: property.to_string(),
                    targets: targets.iter().map(|t| t.to_string()).collect(),
                });
                continue;
            }
            let mut seen = HashSet::new();
            for k in kin {
                // Marrying oneself is no tie; being one's own parent is a
                // cycle, reported below.
                if relation == Relation::Spouse && k.id == character.id {
                    continue;
                }
                if seen.insert(k.id.clone()) {
                    out.edges.push(KinshipEdge {
                        character: character.clone(),
                        relation,
                        kin: k,
                    });
                }
            }
        }
    }
    drop_cycles(&mut out);
    Ok(out)
}

/// Report every Character who is their own ancestor, and leave out the parent
/// ties that lie on a cycle, so whatever walks the tree always ends.
fn drop_cycles(k: &mut Kinship) {
    let mut parents: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut summary: HashMap<&str, &DocSummary> = HashMap::new();
    for e in &k.edges {
        summary.insert(&e.character.id, &e.character);
        summary.insert(&e.kin.id, &e.kin);
        if e.relation != Relation::Spouse {
            parents.entry(&e.character.id).or_default().push(&e.kin.id);
        }
    }
    // Every ancestor of each Character that has a parent.
    let ancestors = |from: &str| -> HashSet<&str> {
        let mut seen = HashSet::new();
        let mut queue: VecDeque<&str> = parents.get(from).into_iter().flatten().copied().collect();
        while let Some(p) = queue.pop_front() {
            if seen.insert(p) {
                queue.extend(parents.get(p).into_iter().flatten().copied());
            }
        }
        seen
    };
    let mut warnings = Vec::new();
    let mut on_cycle: HashSet<(String, String)> = HashSet::new();
    let mut reported: HashSet<&str> = HashSet::new();
    for e in &k.edges {
        if e.relation == Relation::Spouse {
            continue;
        }
        let (c, p) = (e.character.id.as_str(), e.kin.id.as_str());
        if c == p || ancestors(p).contains(c) {
            on_cycle.insert((c.to_string(), p.to_string()));
            if reported.insert(c) {
                let path = cycle_path(c, &parents)
                    .into_iter()
                    .map(|id| summary[id].clone())
                    .collect();
                warnings.push(KinshipWarning::Cycle {
                    character: e.character.clone(),
                    path,
                });
            }
        }
    }
    k.edges.retain(|e| {
        e.relation == Relation::Spouse
            || !on_cycle.contains(&(e.character.id.clone(), e.kin.id.clone()))
    });
    k.warnings.extend(warnings);
}

/// The shortest way from `start` through parents back to `start`, both ends
/// included. Called only for a Character known to be on a cycle.
fn cycle_path<'a>(start: &'a str, parents: &HashMap<&'a str, Vec<&'a str>>) -> Vec<&'a str> {
    let mut came_from: HashMap<&str, &str> = HashMap::new();
    let mut queue = VecDeque::from([start]);
    while let Some(u) = queue.pop_front() {
        for &p in parents.get(u).into_iter().flatten() {
            if p == start {
                let mut path = vec![start, u];
                let mut at = u;
                while at != start {
                    at = came_from[at];
                    path.push(at);
                }
                // Built from the end back: `start, u, …, start`, reversed.
                path.reverse();
                return path;
            }
            if !came_from.contains_key(p) {
                came_from.insert(p, u);
                queue.push_back(p);
            }
        }
    }
    vec![start, start]
}
