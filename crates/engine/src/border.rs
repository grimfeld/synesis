//! A region Place's Border (ADR 0023): a `.geojson` file kept beside the
//! Place and named in its `border` link Property.
//!
//! The Border is plain GeoJSON (RFC 7946) so any GIS tool, and Obsidian's
//! file explorer, sees an ordinary file. The engine reads Polygons and
//! MultiPolygons, wherever they sit (a bare geometry, a Feature, a
//! FeatureCollection or a GeometryCollection), and writes a FeatureCollection
//! of one Polygon Feature when the Border is drawn on the Map.
//!
//! The file carries an `updated` stamp as a top-level foreign member (RFC 7946
//! §6.1), which Pairing compares to decide which copy is newer: a Border is
//! edited in place, so unlike a picture (ADR 0020) the same name can hold
//! different bytes over time, and the newest write wins, as config files do
//! (ADR 0016). The file's modification time counts too (`stamp_of_file`), so
//! an edit made in another tool, which keeps the old member, is newer.

use crate::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// The file extension a Border is stored under.
pub const EXT: &str = "geojson";

/// The Property naming a region's Border file.
pub const PROPERTY: &str = "border";

/// The Place kind that has a Border (ADR 0023).
pub const REGION: &str = "region";

/// Whether a Place's `kind` value names a region, ignoring case and accents
/// as the Map does (a hand-typed `Region` or `Région` is still one).
pub fn is_region(kind: Option<&Value>) -> bool {
    kind.and_then(Value::as_str).is_some_and(|k| crate::names::normalize(k) == REGION)
}

/// Why a `border` value is not read as a Border: it names something other
/// than a `.geojson` file inside the Vault.
pub fn not_a_border(target: &str) -> String {
    format!("`border` names {target}, which is not a .{EXT} file in the Vault")
}

/// One position as Leaflet takes it: latitude first.
pub type LatLon = [f64; 2];

/// A polygon: its outer ring, then any holes. Rings are closed (the last
/// position repeats the first), positions are `[lat, lon]`.
pub type Polygon = Vec<Vec<LatLon>>;

/// What became of reading one Place's Border file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BorderStatus {
    Ok,
    /// `border` names a file the Vault does not hold.
    Missing,
    /// The file is there but is not GeoJSON with an area in it.
    Malformed,
    /// iCloud holds the file and has not downloaded it yet (see `cloud`).
    Downloading,
}

/// A region's Border as the Map draws it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Border {
    /// The Place's id.
    pub doc: String,
    /// The file, vault-relative.
    pub path: String,
    pub status: BorderStatus,
    /// Why the file could not be read, for the warning on the Place.
    pub error: Option<String>,
    /// Every piece of the area: one for a Polygon, several for a MultiPolygon.
    pub polygons: Vec<Polygon>,
}

/// Read every Polygon out of GeoJSON text. An error says what is wrong in a
/// sentence the Place's page can show.
pub fn parse(text: &str) -> std::result::Result<Vec<Polygon>, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("not JSON: {e}"))?;
    let mut out = Vec::new();
    collect(&v, &mut out)?;
    if out.is_empty() {
        return Err("no Polygon or MultiPolygon in the file".into());
    }
    Ok(out)
}

fn collect(v: &Value, out: &mut Vec<Polygon>) -> std::result::Result<(), String> {
    let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
    match kind {
        "FeatureCollection" => {
            let features = v
                .get("features")
                .and_then(Value::as_array)
                .ok_or("a FeatureCollection without `features`")?;
            for f in features {
                collect(f, out)?;
            }
        }
        "Feature" => {
            if let Some(g) = v.get("geometry").filter(|g| !g.is_null()) {
                collect(g, out)?;
            }
        }
        "GeometryCollection" => {
            let gs = v
                .get("geometries")
                .and_then(Value::as_array)
                .ok_or("a GeometryCollection without `geometries`")?;
            for g in gs {
                collect(g, out)?;
            }
        }
        "Polygon" => out.push(polygon(v.get("coordinates"))?),
        "MultiPolygon" => {
            let polys = v
                .get("coordinates")
                .and_then(Value::as_array)
                .ok_or("a MultiPolygon without coordinates")?;
            for p in polys {
                out.push(polygon(Some(p))?);
            }
        }
        // Points and lines say nothing about an area; they are not an error,
        // a published map often labels its regions with them.
        "Point" | "MultiPoint" | "LineString" | "MultiLineString" => {}
        "" => return Err("not GeoJSON: no `type`".into()),
        other => return Err(format!("not GeoJSON: unknown type `{other}`")),
    }
    Ok(())
}

fn polygon(coords: Option<&Value>) -> std::result::Result<Polygon, String> {
    let rings = coords
        .and_then(Value::as_array)
        .ok_or("a Polygon without coordinates")?;
    if rings.is_empty() {
        return Err("a Polygon with no ring".into());
    }
    rings.iter().map(ring).collect()
}

fn ring(v: &Value) -> std::result::Result<Vec<LatLon>, String> {
    let positions = v.as_array().ok_or("a ring that is not a list of positions")?;
    let mut out = Vec::with_capacity(positions.len());
    for p in positions {
        let pair = p.as_array().filter(|a| a.len() >= 2);
        let (lon, lat) = match pair.map(|a| (a[0].as_f64(), a[1].as_f64())) {
            Some((Some(lon), Some(lat))) => (lon, lat),
            _ => return Err("a position that is not [longitude, latitude]".into()),
        };
        if !(-180.0..=180.0).contains(&lon) || !(-90.0..=90.0).contains(&lat) {
            return Err(format!("a position off the globe: [{lon}, {lat}]"));
        }
        out.push([lat, lon]);
    }
    // RFC 7946 asks for closed rings; a hand-written file that forgot is
    // still plainly an area, so it is closed here rather than refused.
    if out.first() != out.last() {
        if let Some(&first) = out.first() {
            out.push(first);
        }
    }
    if out.len() < 4 {
        return Err("a ring with fewer than three corners".into());
    }
    Ok(out)
}

/// Whether a point lies within a Border: inside any of its pieces and not in
/// one of that piece's holes. A point on a line counts as inside, so a city
/// drawn on the frontier belongs to the region (and to its neighbour too).
/// Planar, in degrees: a Border is a few hundred kilometres across, where the
/// difference from a great-circle test is far below how well it was drawn.
pub fn contains(polygons: &[Polygon], lat: f64, lon: f64) -> bool {
    polygons.iter().any(|rings| {
        let Some((outer, holes)) = rings.split_first() else { return false };
        match in_ring(outer, lat, lon) {
            Where::Outside => false,
            Where::Edge => true,
            Where::Inside => holes.iter().all(|h| in_ring(h, lat, lon) != Where::Inside),
        }
    })
}

#[derive(PartialEq)]
enum Where {
    Inside,
    Outside,
    Edge,
}

/// Ray casting on a closed ring of `[lat, lon]` positions, with the edge
/// told apart from both sides.
fn in_ring(ring: &[LatLon], lat: f64, lon: f64) -> Where {
    const EPS: f64 = 1e-9;
    let mut inside = false;
    for w in ring.windows(2) {
        let ([y1, x1], [y2, x2]) = (w[0], w[1]);
        // On this segment: collinear and within its box.
        let cross = (x2 - x1) * (lat - y1) - (y2 - y1) * (lon - x1);
        if cross.abs() < EPS
            && lon >= x1.min(x2) - EPS
            && lon <= x1.max(x2) + EPS
            && lat >= y1.min(y2) - EPS
            && lat <= y1.max(y2) + EPS
        {
            return Where::Edge;
        }
        if (y1 > lat) != (y2 > lat) && lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1) {
            inside = !inside;
        }
    }
    if inside { Where::Inside } else { Where::Outside }
}

/// The GeoJSON for a Border drawn on the Map: one Polygon from its corners,
/// in the order they were placed. `updated` is the stamp Pairing compares.
pub fn drawn(corners: &[LatLon], updated: i64) -> Result<String> {
    let mut ring: Vec<LatLon> = corners.to_vec();
    if ring.first() == ring.last() {
        ring.pop();
    }
    ring.dedup();
    if ring.len() < 3 {
        return Err(crate::Error::Invalid("a Border needs at least three corners".into()));
    }
    for [lat, lon] in &ring {
        if !lat.is_finite() || !lon.is_finite() || lat.abs() > 90.0 || lon.abs() > 180.0 {
            return Err(crate::Error::Invalid(format!("a corner off the globe: {lat}, {lon}")));
        }
    }
    let first = ring[0];
    ring.push(first);
    let coords: Vec<[f64; 2]> = ring.iter().map(|[lat, lon]| [*lon, *lat]).collect();
    let v = json!({
        "type": "FeatureCollection",
        "updated": updated,
        "features": [{
            "type": "Feature",
            "properties": {},
            "geometry": { "type": "Polygon", "coordinates": [coords] }
        }]
    });
    Ok(serde_json::to_string_pretty(&v)? + "\n")
}

/// The file name inside a `border` value: `[[Judah.geojson]]` → `Judah.geojson`.
pub fn link_target(value: &Value) -> Option<String> {
    let s = value.as_str()?.trim();
    let inner = s
        .strip_prefix("[[")
        .and_then(|r| r.strip_suffix("]]"))
        .unwrap_or(s);
    // `[[file|alias]]`: the alias is display text.
    let target = inner.split('|').next().unwrap_or("").trim();
    (!target.is_empty()).then(|| target.to_string())
}

/// Where a Place's Border file lives, vault-relative. A bare file name sits
/// beside the Place (ADR 0023); a name with a folder is from the vault root,
/// as Obsidian reads it.
pub fn path_for(place_path: &str, target: &str) -> Option<String> {
    let target = target.replace('\\', "/");
    if target.split('/').any(|p| p == ".." || p.is_empty()) || target.starts_with('/') {
        return None;
    }
    if target.contains('/') {
        return Some(target);
    }
    Some(match place_path.rsplit_once('/') {
        Some((dir, _)) => format!("{dir}/{target}"),
        None => target,
    })
}

/// A file name beside `place_path` for a new Border, after the Place's title,
/// that no other file holds.
pub fn free_name(root: &Path, place_path: &str, title: &str) -> String {
    let base = crate::vault::sanitize_title(title);
    let mut n = 1;
    loop {
        let name = if n == 1 { format!("{base}.{EXT}") } else { format!("{base} {n}.{EXT}") };
        let rel = path_for(place_path, &name).unwrap_or_else(|| name.clone());
        if !crate::cloud::occupied(&root.join(&rel)) {
            return name;
        }
        n += 1;
    }
}

/// Read one Border file into what the Map draws.
pub fn read(root: &Path, doc: &str, rel: &str) -> Border {
    let abs = root.join(rel);
    let (status, error, polygons) = if crate::cloud::is_evicted(&abs) {
        (BorderStatus::Downloading, None, vec![])
    } else {
        match fs::read_to_string(&abs) {
            Err(_) => (BorderStatus::Missing, Some(format!("{rel} is not in the Vault")), vec![]),
            Ok(text) => match parse(&text) {
                Ok(p) => (BorderStatus::Ok, None, p),
                Err(e) => (BorderStatus::Malformed, Some(e), vec![]),
            },
        }
    };
    Border { doc: doc.into(), path: rel.into(), status, error, polygons }
}

// ---- Pairing (ADR 0023: carried whole, newest write wins) -------------------
//
// Only the files some region's `border` names travel, never every `.geojson`
// in the Vault: a GIS file the user keeps for another purpose stays on its
// Device. The engine keeps, per Device, a small register beside the index
// (`borders.json` in the Vault's local folder): the files named, which the
// Vault writes as it indexes, and a tombstone for each Border deleted here or
// on a peer, so a Device still holding the old file cannot push it back.

/// Whether a vault-relative name is a Border file Pairing may read or write:
/// a `.geojson` file outside every hidden folder, with no step outside the
/// Vault.
pub fn is_synced(name: &str) -> bool {
    let parts: Vec<&str> = name.split('/').collect();
    name.len() > EXT.len() + 1
        && name.ends_with(&format!(".{EXT}"))
        && !name.contains('\\')
        && parts.iter().all(|p| {
            !p.is_empty()
                && !p.starts_with('.')
                && !p.contains(':')
                && !p.ends_with([' ', '.'])
                && !p.chars().any(|c| c.is_control() || "<>\"|?*".contains(c))
        })
}

fn join(root: &Path, name: &str) -> PathBuf {
    name.split('/').fold(root.to_path_buf(), |p, part| p.join(part))
}

/// One Border as Pairing advertises it: a file, or the tombstone of one
/// deleted at `stamp`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BorderEntry {
    pub name: String,
    pub stamp: i64,
    pub size: u64,
    pub deleted: bool,
}

/// Whether a peer's entry should replace what is here. The later stamp wins;
/// at the same stamp a file beats a tombstone (never lose a drawing on a
/// tie), then the larger file wins, as for config files.
pub fn is_newer(theirs: &BorderEntry, mine: Option<&BorderEntry>) -> bool {
    let Some(m) = mine else { return true };
    if theirs.stamp != m.stamp {
        return theirs.stamp > m.stamp;
    }
    match (theirs.deleted, m.deleted) {
        (false, true) => true,
        (true, _) => false,
        (false, false) => theirs.size > m.size,
    }
}

/// When a Border file was last changed: the later of its `updated` member and
/// its modification time. The member outranks a peer's clock running fast;
/// the time catches an edit made in another tool, which keeps the old member.
pub fn stamp_of_file(p: &Path, bytes: &[u8]) -> i64 {
    crate::config::stamp_of(bytes).unwrap_or(0).max(crate::config::mtime_ms(p))
}

const REGISTER: &str = "borders.json";

/// The per-Device register: what is named, and what was deleted when.
#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
struct Register {
    #[serde(default)]
    named: std::collections::BTreeSet<String>,
    #[serde(default)]
    deleted: std::collections::BTreeMap<String, i64>,
}

/// The Vault and the Pairing node both write the register, from different
/// threads of one process.
static REGISTER_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn load(local: &Path) -> Register {
    fs::read(local.join(REGISTER))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save(local: &Path, r: &Register) -> Result<()> {
    fs::create_dir_all(local)?;
    let tmp = local.join(format!("{REGISTER}.part"));
    fs::write(&tmp, serde_json::to_vec(r)?)?;
    fs::rename(&tmp, local.join(REGISTER))?;
    Ok(())
}

fn update(local: &Path, f: impl FnOnce(&mut Register)) -> Result<()> {
    let _guard = REGISTER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut r = load(local);
    let before = serde_json::to_vec(&r)?;
    f(&mut r);
    if serde_json::to_vec(&r)? != before {
        save(local, &r)?;
    }
    Ok(())
}

/// Record which Border files the Vault's regions name. Only these travel.
pub fn set_named(local: &Path, names: impl IntoIterator<Item = String>) -> Result<()> {
    let names: std::collections::BTreeSet<String> = names.into_iter().filter(|n| is_synced(n)).collect();
    update(local, |r| r.named = names)
}

/// What this Device holds for `name`: the file, or its tombstone, whichever
/// is newer. Named or not: it answers "is the peer's copy newer than mine?".
fn local_entry(root: &Path, local: &Path, name: &str) -> Option<BorderEntry> {
    let r = {
        let _guard = REGISTER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        load(local)
    };
    local_entry_in(root, &r, name)
}

fn local_entry_in(root: &Path, r: &Register, name: &str) -> Option<BorderEntry> {
    let p = join(root, name);
    let file = fs::read(&p).ok().map(|bytes| BorderEntry {
        name: name.into(),
        stamp: stamp_of_file(&p, &bytes),
        size: bytes.len() as u64,
        deleted: false,
    });
    let tomb = r
        .deleted
        .get(name)
        .map(|&stamp| BorderEntry { name: name.into(), stamp, size: 0, deleted: true });
    match (file, tomb) {
        (Some(f), Some(t)) => Some(if is_newer(&t, Some(&f)) { t } else { f }),
        (f, t) => f.or(t),
    }
}

/// Every Border this Device advertises: each named file it holds, and each
/// tombstone that no later file has replaced.
pub fn manifest(root: &Path, local: &Path) -> Vec<BorderEntry> {
    let r = {
        let _guard = REGISTER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        load(local)
    };
    let mut names: std::collections::BTreeSet<&String> = r.named.iter().collect();
    names.extend(r.deleted.keys());
    names
        .into_iter()
        .filter(|n| is_synced(n) && !crate::cloud::is_evicted(&join(root, n)))
        .filter_map(|n| {
            let e = local_entry_in(root, &r, n)?;
            // A file that is here but no longer named is not offered.
            (e.deleted || r.named.contains(n)).then_some(e)
        })
        .collect()
}

pub fn read_file(root: &Path, name: &str) -> Option<Vec<u8>> {
    if !is_synced(name) {
        return None;
    }
    fs::read(join(root, name)).ok()
}

/// Take a Border file from a peer, which stamped it `stamp`, when that is
/// newer than the file or tombstone here. Bytes that are not JSON are
/// refused; a malformed Border that is JSON travels, so every Device shows
/// the same warning. Returns whether it was written.
pub fn accept(root: &Path, local: &Path, name: &str, bytes: &[u8], stamp: i64) -> bool {
    if !is_synced(name) || serde_json::from_slice::<Value>(bytes).is_err() {
        return false;
    }
    let p = join(root, name);
    // Never written over while iCloud holds it (see `cloud`).
    if crate::cloud::is_evicted(&p) {
        return false;
    }
    let incoming = BorderEntry { name: name.into(), stamp, size: bytes.len() as u64, deleted: false };
    if !is_newer(&incoming, local_entry(root, local, name).as_ref()) {
        return false;
    }
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp = p.with_extension(format!("{EXT}.part"));
    if fs::write(&tmp, bytes).is_err() || fs::rename(&tmp, &p).is_err() {
        return false;
    }
    // The file's stamp here is the peer's, so the two agree and neither
    // pushes it back.
    let t = std::time::UNIX_EPOCH + std::time::Duration::from_millis(stamp.max(0) as u64);
    let _ = fs::File::options().write(true).open(&p).and_then(|f| f.set_modified(t));
    let _ = revive(local, name);
    true
}

/// A peer deleted `name` at `stamp`: remove the file here unless it was
/// edited later, and keep the tombstone. Returns whether anything changed.
pub fn forget(root: &Path, local: &Path, name: &str, stamp: i64) -> bool {
    if !is_synced(name) {
        return false;
    }
    let p = join(root, name);
    if crate::cloud::is_evicted(&p) {
        return false;
    }
    let tomb = BorderEntry { name: name.into(), stamp, size: 0, deleted: true };
    if !is_newer(&tomb, local_entry(root, local, name).as_ref()) {
        return false;
    }
    if p.is_file() && fs::remove_file(&p).is_err() {
        return false;
    }
    update(local, |r| {
        r.deleted.insert(name.into(), stamp);
    })
    .is_ok()
}

/// Delete a Border file here and leave its tombstone, stamped later than the
/// file it removes so every peer holding that copy drops it.
pub fn remove(root: &Path, local: &Path, rel: &str) -> Result<()> {
    let p = join(root, rel);
    if crate::cloud::is_evicted(&p) {
        return Err(crate::cloud::downloading(&p));
    }
    let previous = fs::read(&p).ok().map(|b| stamp_of_file(&p, &b)).unwrap_or(0);
    if p.is_file() {
        fs::remove_file(&p)?;
    }
    if is_synced(rel) {
        let stamp = crate::config::now_ms().max(previous + 1);
        update(local, |r| {
            r.deleted.insert(rel.into(), stamp);
        })?;
    }
    Ok(())
}

/// A Border written here again after it was deleted: its tombstone goes.
pub fn revive(local: &Path, rel: &str) -> Result<()> {
    update(local, |r| {
        r.deleted.remove(rel);
    })
}

/// Write a Border file, stamped newer than whatever is on disk so a local edit
/// outranks a peer's clock that runs fast.
pub fn write(root: &Path, rel: &str, corners: &[LatLon]) -> Result<()> {
    put(root, rel, |updated| drawn(corners, updated))
}

/// Copy a GeoJSON file picked from disk in as a Border: refused, with the
/// reason, unless it holds an area; otherwise kept whole (every piece, every
/// member it carries) with the `updated` stamp Pairing compares added.
pub fn import(root: &Path, rel: &str, text: &str) -> Result<()> {
    parse(text).map_err(crate::Error::Invalid)?;
    let mut v: Value = serde_json::from_str(text)?;
    put(root, rel, |updated| {
        v["updated"] = json!(updated);
        Ok(serde_json::to_string_pretty(&v)? + "\n")
    })
}

/// Write a Border file atomically, stamped newer than whatever is on disk so
/// a local edit outranks a peer's clock that runs fast.
fn put(root: &Path, rel: &str, text: impl FnOnce(i64) -> Result<String>) -> Result<()> {
    let p = join(root, rel);
    if crate::cloud::is_evicted(&p) {
        return Err(crate::cloud::downloading(&p));
    }
    let previous = fs::read(&p).ok().map(|b| stamp_of_file(&p, &b)).unwrap_or(0);
    let text = text(crate::config::now_ms().max(previous + 1))?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = p.with_extension(format!("{EXT}.part"));
    fs::write(&tmp, text)?;
    fs::rename(&tmp, &p)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SQUARE: &str = r#"{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},
        "geometry":{"type":"Polygon","coordinates":[[[35,31],[36,31],[36,32],[35,32],[35,31]]]}}]}"#;

    #[test]
    fn a_point_is_inside_outside_or_on_the_edge_of_a_border() {
        let square = parse(SQUARE).unwrap(); // lon 35–36, lat 31–32
        assert!(contains(&square, 31.5, 35.5), "the middle");
        assert!(!contains(&square, 30.9, 35.5), "south of it");
        assert!(!contains(&square, 31.5, 36.1), "east of it");
        // On the line is inside: a city drawn on the border belongs to it.
        assert!(contains(&square, 31.0, 35.5), "on the southern edge");
        assert!(contains(&square, 31.5, 36.0), "on the eastern edge");
        assert!(contains(&square, 32.0, 36.0), "on a corner");
    }

    #[test]
    fn a_point_in_any_piece_of_a_multipolygon_is_inside_but_not_in_a_hole() {
        let text = r#"{"type":"MultiPolygon","coordinates":[
            [[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]],
            [[[10,10],[11,10],[11,11],[10,11],[10,10]]]]}"#;
        let p = parse(text).unwrap();
        assert!(contains(&p, 0.5, 0.5), "the first piece, outside its hole");
        assert!(!contains(&p, 2.0, 2.0), "inside the hole");
        assert!(contains(&p, 1.0, 2.0), "on the hole's edge still borders the land");
        assert!(contains(&p, 10.5, 10.5), "the second piece");
        assert!(!contains(&p, 7.0, 7.0), "between the pieces");
        assert!(!contains(&[], 0.5, 0.5), "no Border contains nothing");
    }

    #[test]
    fn a_feature_collection_polygon_is_read_lat_first() {
        let p = parse(SQUARE).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0][0][0], [31.0, 35.0]);
        assert_eq!(p[0][0].len(), 5);
    }

    #[test]
    fn a_multipolygon_keeps_every_piece() {
        let text = r#"{"type":"MultiPolygon","coordinates":[
            [[[0,0],[1,0],[1,1],[0,0]]],
            [[[5,5],[6,5],[6,6],[5,5]]]]}"#;
        assert_eq!(parse(text).unwrap().len(), 2);
    }

    #[test]
    fn an_unclosed_ring_is_closed() {
        let text = r#"{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1]]]}"#;
        let p = parse(text).unwrap();
        assert_eq!(p[0][0].first(), p[0][0].last());
    }

    #[test]
    fn malformed_files_are_refused_with_a_reason() {
        for bad in [
            "{nope",
            r#"{"coordinates":[]}"#,
            r#"{"type":"Polygon","coordinates":[[[0,0],[1,0]]]}"#,
            r#"{"type":"Polygon","coordinates":[[["a","b"],[1,0],[1,1]]]}"#,
            r#"{"type":"Point","coordinates":[0,0]}"#,
            r#"{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,100]]]}"#,
        ] {
            let e = parse(bad).unwrap_err();
            assert!(!e.is_empty(), "{bad}");
        }
    }

    #[test]
    fn a_drawn_border_reads_back_as_its_corners() {
        let corners = [[31.0, 35.0], [31.0, 36.0], [32.0, 36.0]];
        let text = drawn(&corners, 7).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["updated"], 7);
        let p = parse(&text).unwrap();
        assert_eq!(p[0][0], vec![[31.0, 35.0], [31.0, 36.0], [32.0, 36.0], [31.0, 35.0]]);
    }

    #[test]
    fn fewer_than_three_corners_is_not_a_border() {
        assert!(drawn(&[[1.0, 1.0], [2.0, 2.0]], 0).is_err());
        assert!(drawn(&[[1.0, 1.0], [2.0, 2.0], [1.0, 1.0]], 0).is_err());
        assert!(drawn(&[[1.0, 1.0], [2.0, 2.0], [95.0, 1.0]], 0).is_err());
    }

    #[test]
    fn a_link_names_a_file_beside_the_place() {
        assert_eq!(link_target(&json!("[[Judah.geojson]]")).as_deref(), Some("Judah.geojson"));
        assert_eq!(link_target(&json!("[[Judah.geojson|outline]]")).as_deref(), Some("Judah.geojson"));
        assert_eq!(link_target(&json!("")), None);
        assert_eq!(path_for("Places/Judah.md", "Judah.geojson").as_deref(), Some("Places/Judah.geojson"));
        assert_eq!(path_for("Judah.md", "Judah.geojson").as_deref(), Some("Judah.geojson"));
        assert_eq!(path_for("Places/Judah.md", "Maps/J.geojson").as_deref(), Some("Maps/J.geojson"));
        assert_eq!(path_for("Places/Judah.md", "../x.geojson"), None);
    }

    #[test]
    fn only_geojson_outside_hidden_folders_syncs() {
        assert!(is_synced("Places/Judah.geojson"));
        assert!(is_synced("Judah.geojson"));
        assert!(!is_synced(".bible-study/x.geojson"));
        assert!(!is_synced("Places/../x.geojson"));
        assert!(!is_synced("/etc/x.geojson"));
        assert!(!is_synced("Places/Judah.md"));
        assert!(!is_synced("c:/x.geojson"));
        assert!(!is_synced(".geojson"));
    }

    /// A Device: its Vault folder and its per-Device local folder.
    fn device() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("vault");
        let local = d.path().join("local");
        fs::create_dir_all(&root).unwrap();
        (d, root, local)
    }

    fn entry(root: &Path, local: &Path, name: &str) -> BorderEntry {
        manifest(root, local).into_iter().find(|e| e.name == name).unwrap()
    }

    fn set_mtime(p: &Path, ms: i64) {
        let t = std::time::UNIX_EPOCH + std::time::Duration::from_millis(ms as u64);
        fs::File::options().write(true).open(p).unwrap().set_modified(t).unwrap();
    }

    #[test]
    fn pairing_carries_the_newest_border_whole() {
        let (_a, ra, la) = device();
        let (_b, rb, lb) = device();
        let rel = "Places/Judah.geojson";
        write(&ra, rel, &[[31.0, 35.0], [31.0, 36.0], [32.0, 36.0]]).unwrap();
        set_named(&la, [rel.to_string()]).unwrap();
        let m = manifest(&ra, &la);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].name, rel);
        let first = read_file(&ra, rel).unwrap();
        assert!(accept(&rb, &lb, rel, &first, m[0].stamp), "a missing Border was not taken");
        assert_eq!(fs::read(rb.join(rel)).unwrap(), first);
        // B now holds the same copy, at the same stamp: neither is newer.
        set_named(&lb, [rel.to_string()]).unwrap();
        assert_eq!(entry(&rb, &lb, rel).stamp, m[0].stamp);
        assert!(!accept(&rb, &lb, rel, &first, m[0].stamp));
        // An edit on B is newer and wins on A; A's older copy loses on B.
        std::thread::sleep(std::time::Duration::from_millis(5));
        write(&rb, rel, &[[30.0, 35.0], [31.0, 36.0], [32.0, 36.0]]).unwrap();
        let edited = read_file(&rb, rel).unwrap();
        let eb = entry(&rb, &lb, rel);
        assert!(accept(&ra, &la, rel, &edited, eb.stamp));
        assert!(!accept(&rb, &lb, rel, &first, m[0].stamp), "an older Border replaced a newer one");
        assert_eq!(fs::read(ra.join(rel)).unwrap(), edited);
        // Junk and unsafe names are refused.
        assert!(!accept(&ra, &la, rel, b"{nope", i64::MAX));
        assert!(!accept(&ra, &la, "../x.geojson", &edited, i64::MAX));
        assert!(!accept(&ra, &la, "Notes/grace.md", b"{}", i64::MAX));
    }

    #[test]
    fn only_the_files_a_region_names_are_advertised() {
        let (_a, root, local) = device();
        fs::create_dir_all(root.join(".bible-study")).unwrap();
        fs::create_dir_all(root.join("Maps")).unwrap();
        fs::write(root.join(".bible-study/x.geojson"), SQUARE).unwrap();
        fs::write(root.join("Maps/roads.geojson"), SQUARE).unwrap();
        fs::write(root.join("Maps/judah.geojson"), SQUARE).unwrap();
        fs::write(root.join("Note.md"), "x").unwrap();
        assert!(manifest(&root, &local).is_empty(), "nothing is named yet");
        set_named(
            &local,
            ["Maps/judah.geojson".to_string(), ".bible-study/x.geojson".into(), "Note.md".into()],
        )
        .unwrap();
        let names: Vec<String> = manifest(&root, &local).into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["Maps/judah.geojson"]);
    }

    #[test]
    fn a_deleted_border_is_not_brought_back_by_an_older_copy() {
        let (_a, ra, la) = device();
        let (_b, rb, lb) = device();
        let rel = "Places/Judah.geojson";
        write(&ra, rel, &[[31.0, 35.0], [31.0, 36.0], [32.0, 36.0]]).unwrap();
        set_named(&la, [rel.to_string()]).unwrap();
        let old = entry(&ra, &la, rel);
        let bytes = read_file(&ra, rel).unwrap();
        assert!(accept(&rb, &lb, rel, &bytes, old.stamp));
        // Deleted on A: the manifest carries a tombstone, later than the file.
        remove(&ra, &la, rel).unwrap();
        set_named(&la, Vec::<String>::new()).unwrap();
        assert!(!ra.join(rel).exists());
        let tomb = entry(&ra, &la, rel);
        assert!(tomb.deleted && tomb.stamp > old.stamp, "{tomb:?}");
        // B's older copy does not come back to A…
        assert!(is_newer(&tomb, Some(&old)));
        assert!(!is_newer(&old, Some(&tomb)));
        assert!(!accept(&ra, &la, rel, &bytes, old.stamp), "a deleted Border came back");
        assert!(!ra.join(rel).exists());
        // …and B drops it when told.
        assert!(forget(&rb, &lb, rel, tomb.stamp));
        assert!(!rb.join(rel).exists());
        // A Border drawn again after the deletion is newer than the tombstone.
        std::thread::sleep(std::time::Duration::from_millis(5));
        write(&rb, rel, &[[30.0, 35.0], [31.0, 36.0], [32.0, 36.0]]).unwrap();
        revive(&lb, rel).unwrap();
        set_named(&lb, [rel.to_string()]).unwrap();
        let again = entry(&rb, &lb, rel);
        assert!(!again.deleted && again.stamp > tomb.stamp);
        assert!(accept(&ra, &la, rel, &read_file(&rb, rel).unwrap(), again.stamp));
        assert!(ra.join(rel).exists());
    }

    #[test]
    fn a_tombstone_older_than_an_edit_leaves_the_edit() {
        let (_b, rb, lb) = device();
        let rel = "Places/Judah.geojson";
        write(&rb, rel, &[[31.0, 35.0], [31.0, 36.0], [32.0, 36.0]]).unwrap();
        set_named(&lb, [rel.to_string()]).unwrap();
        let mine = entry(&rb, &lb, rel);
        assert!(!forget(&rb, &lb, rel, mine.stamp - 1));
        assert!(rb.join(rel).exists(), "a newer edit was deleted");
        assert!(!entry(&rb, &lb, rel).deleted);
    }

    #[test]
    fn an_outside_edit_counts_by_its_modification_time() {
        let (_a, ra, la) = device();
        let (_b, rb, lb) = device();
        let rel = "Places/Judah.geojson";
        write(&ra, rel, &[[31.0, 35.0], [31.0, 36.0], [32.0, 36.0], [32.0, 35.0]]).unwrap();
        set_named(&la, [rel.to_string()]).unwrap();
        let shared = entry(&ra, &la, rel);
        let bytes = read_file(&ra, rel).unwrap();
        assert!(accept(&rb, &lb, rel, &bytes, shared.stamp));
        // Another tool shrinks A's copy and keeps the old `updated` member.
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        let shrunk = format!(
            r#"{{"type":"Polygon","updated":{},"coordinates":[[[35,31],[36,31],[36,32],[35,31]]]}}"#,
            v["updated"]
        );
        assert!(shrunk.len() < bytes.len());
        fs::write(ra.join(rel), &shrunk).unwrap();
        set_mtime(&ra.join(rel), shared.stamp + 60_000);
        let edited = entry(&ra, &la, rel);
        assert!(edited.stamp > shared.stamp, "{edited:?}");
        // B's older copy does not overwrite it…
        assert!(!accept(&ra, &la, rel, &bytes, shared.stamp));
        assert_eq!(fs::read_to_string(ra.join(rel)).unwrap(), shrunk);
        // …and B takes the edit.
        assert!(accept(&rb, &lb, rel, shrunk.as_bytes(), edited.stamp));
        assert_eq!(fs::read_to_string(rb.join(rel)).unwrap(), shrunk);
    }

    #[test]
    fn reading_reports_missing_malformed_and_evicted_files() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("Places")).unwrap();
        assert_eq!(read(d.path(), "x", "Places/A.geojson").status, BorderStatus::Missing);
        fs::write(d.path().join("Places/B.geojson"), "{nope").unwrap();
        let b = read(d.path(), "x", "Places/B.geojson");
        assert_eq!(b.status, BorderStatus::Malformed);
        assert!(b.error.is_some());
        fs::write(d.path().join("Places/.C.geojson.icloud"), "").unwrap();
        assert_eq!(read(d.path(), "x", "Places/C.geojson").status, BorderStatus::Downloading);
        // iCloud is asked for it like any other evicted file of the Vault.
        assert!(crate::cloud::evicted_under(d.path()).contains(&d.path().join("Places/C.geojson")));
        fs::write(d.path().join("Places/D.geojson"), SQUARE).unwrap();
        let ok = read(d.path(), "x", "Places/D.geojson");
        assert_eq!(ok.status, BorderStatus::Ok);
        assert_eq!(ok.polygons.len(), 1);
    }
}
