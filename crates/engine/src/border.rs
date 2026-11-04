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

/// Gather the Polygons of a GeoJSON object: the containers are walked, the
/// geometries read.
fn collect(v: &Value, out: &mut Vec<Polygon>) -> std::result::Result<(), String> {
    let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
    let children: Vec<&Value> = match kind {
        "FeatureCollection" => members(v, "features", "a FeatureCollection without `features`")?,
        "GeometryCollection" => members(v, "geometries", "a GeometryCollection without `geometries`")?,
        "Feature" => v.get("geometry").filter(|g| !g.is_null()).into_iter().collect(),
        _ => return geometry(kind, v, out),
    };
    children.into_iter().try_for_each(|c| collect(c, out))
}

/// The list under `key`, or `missing` as the reason it cannot be read.
fn members<'a>(v: &'a Value, key: &str, missing: &str) -> std::result::Result<Vec<&'a Value>, String> {
    let list = v.get(key).and_then(Value::as_array).ok_or(missing)?;
    Ok(list.iter().collect())
}

/// The Polygons of one geometry of type `kind`.
fn geometry(kind: &str, v: &Value, out: &mut Vec<Polygon>) -> std::result::Result<(), String> {
    match kind {
        "Polygon" => out.push(polygon(v.get("coordinates"))?),
        "MultiPolygon" => {
            for p in members(v, "coordinates", "a MultiPolygon without coordinates")? {
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
    let mut out = positions.iter().map(position).collect::<std::result::Result<Vec<_>, _>>()?;
    // RFC 7946 asks for closed rings; a hand-written file that forgot is
    // still plainly an area, so it is closed here rather than refused.
    if let (Some(&first), Some(&last)) = (out.first(), out.last()) {
        if first != last {
            out.push(first);
        }
    }
    if out.len() < 4 {
        return Err("a ring with fewer than three corners".into());
    }
    Ok(out)
}

/// One GeoJSON position, `[longitude, latitude]`, as `[lat, lon]`.
fn position(p: &Value) -> std::result::Result<LatLon, String> {
    let pair = p.as_array().filter(|a| a.len() >= 2);
    let Some((Some(lon), Some(lat))) = pair.map(|a| (a[0].as_f64(), a[1].as_f64())) else {
        return Err("a position that is not [longitude, latitude]".into());
    };
    if !(-180.0..=180.0).contains(&lon) || !(-90.0..=90.0).contains(&lat) {
        return Err(format!("a position off the globe: [{lon}, {lat}]"));
    }
    Ok([lat, lon])
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
    let mut inside = false;
    for w in ring.windows(2) {
        if on_segment(w[0], w[1], lat, lon) {
            return Where::Edge;
        }
        if crosses(w[0], w[1], lat, lon) {
            inside = !inside;
        }
    }
    if inside { Where::Inside } else { Where::Outside }
}

const EPS: f64 = 1e-9;

/// Whether the point lies on the segment: collinear and within its box.
fn on_segment([y1, x1]: LatLon, [y2, x2]: LatLon, lat: f64, lon: f64) -> bool {
    let cross = (x2 - x1) * (lat - y1) - (y2 - y1) * (lon - x1);
    cross.abs() < EPS && within(lon, x1, x2) && within(lat, y1, y2)
}

fn within(v: f64, a: f64, b: f64) -> bool {
    v >= a.min(b) - EPS && v <= a.max(b) + EPS
}

/// Whether a ray cast from the point towards increasing longitude crosses
/// the segment.
fn crosses([y1, x1]: LatLon, [y2, x2]: LatLon, lat: f64, lon: f64) -> bool {
    (y1 > lat) != (y2 > lat) && lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
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

/// The `border` value naming the file `rel` from the Place at `place_path`:
/// a file beside the Place by its name alone, one elsewhere from the Vault's
/// root, as Obsidian spells a link.
pub fn link_to(place_path: &str, rel: &str) -> String {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let beside = path_for(place_path, name).as_deref() == Some(rel);
    format!("[[{}]]", if beside { name } else { rel })
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
    // A bare `.geojson` is a hidden file, refused with the hidden folders.
    name.ends_with(&format!(".{EXT}"))
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

/// What a Pairing round does with two manifests: the peer's entries newer
/// than this Device's (to take, a file or a deletion) and this Device's newer
/// than the peer's (to give). A name Pairing may not touch is never taken.
pub fn exchange<'a>(
    mine: &'a [BorderEntry],
    theirs: &'a [BorderEntry],
) -> (Vec<&'a BorderEntry>, Vec<&'a BorderEntry>) {
    let newer = |e: &BorderEntry, other: &'a [BorderEntry]| is_newer(e, other.iter().find(|o| o.name == e.name));
    let take = theirs.iter().filter(|e| is_synced(&e.name) && newer(e, mine)).collect();
    let give = mine.iter().filter(|e| newer(e, theirs)).collect();
    (take, give)
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
    /// Files a peer delivered here, which a later round may update or delete
    /// before the Place that names them has arrived.
    #[serde(default)]
    received: std::collections::BTreeSet<String>,
}

impl Register {
    /// Whether Pairing may write over or delete the file `name` here: one a
    /// region names, one deleted here, or one a peer delivered. Any other
    /// `.geojson` file in the Vault is the user's own and never touched.
    fn owns(&self, name: &str) -> bool {
        self.named.contains(name) || self.deleted.contains_key(name) || self.received.contains(name)
    }
}

/// How far ahead of this Device's clock a peer's stamp may run. Anything
/// later is refused: it would win every round from then on, and a time that
/// far out does not fit in a file's modification time everywhere.
const MAX_SKEW_MS: i64 = 24 * 60 * 60 * 1000;

fn plausible(stamp: i64) -> bool {
    (0..=crate::config::now_ms().saturating_add(MAX_SKEW_MS)).contains(&stamp)
}

/// The stamp for a write here: after `previous`, but never past what a peer
/// would accept.
fn next_stamp(previous: i64) -> i64 {
    let now = crate::config::now_ms();
    now.max(previous.saturating_add(1)).min(now.saturating_add(MAX_SKEW_MS))
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
    local_entry_in(root, &register(local), name)
}

fn register(local: &Path) -> Register {
    let _guard = REGISTER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    load(local)
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
    let r = register(local);
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

/// A Border file a peer asked for, served only when a region names it here:
/// the rest of the Vault's `.geojson` files are not Pairing's to hand out.
pub fn offered(root: &Path, local: &Path, name: &str) -> Option<Vec<u8>> {
    register(local).named.contains(name).then(|| read_file(root, name)).flatten()
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
/// the same warning. A stamp far in the future is refused, and so is a file
/// here that is not Pairing's (`Register::owns`). Returns whether it was
/// written.
pub fn accept(root: &Path, local: &Path, name: &str, bytes: &[u8], stamp: i64) -> bool {
    if !is_synced(name) || !plausible(stamp) {
        return false;
    }
    match serde_json::from_slice::<Value>(bytes) {
        Err(_) => return false,
        Ok(v) if v.get("updated").and_then(Value::as_i64).is_some_and(|s| !plausible(s)) => return false,
        Ok(_) => {}
    }
    let p = join(root, name);
    // Never written over while iCloud holds it (see `cloud`).
    if crate::cloud::is_evicted(&p) {
        return false;
    }
    let r = register(local);
    if p.exists() && !r.owns(name) {
        return false;
    }
    let incoming = BorderEntry { name: name.into(), stamp, size: bytes.len() as u64, deleted: false };
    if !is_newer(&incoming, local_entry_in(root, &r, name).as_ref()) {
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
    if let Some(t) = std::time::UNIX_EPOCH.checked_add(std::time::Duration::from_millis(stamp as u64)) {
        let _ = fs::File::options().write(true).open(&p).and_then(|f| f.set_modified(t));
    }
    let _ = update(local, |r| {
        r.deleted.remove(name);
        r.received.insert(name.into());
    });
    true
}

/// A peer deleted `name` at `stamp`: remove the file here unless it was
/// edited later, and keep the tombstone. A file here that is not Pairing's
/// (`Register::owns`) stays. Returns whether anything changed.
pub fn forget(root: &Path, local: &Path, name: &str, stamp: i64) -> bool {
    if !is_synced(name) || !plausible(stamp) {
        return false;
    }
    let p = join(root, name);
    if crate::cloud::is_evicted(&p) {
        return false;
    }
    let r = register(local);
    if p.exists() && !r.owns(name) {
        return false;
    }
    let tomb = BorderEntry { name: name.into(), stamp, size: 0, deleted: true };
    if !is_newer(&tomb, local_entry_in(root, &r, name).as_ref()) {
        return false;
    }
    if p.is_file() && fs::remove_file(&p).is_err() {
        return false;
    }
    update(local, |r| {
        r.deleted.insert(name.into(), stamp);
        r.received.remove(name);
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
        let stamp = next_stamp(previous);
        update(local, |r| {
            r.deleted.insert(rel.into(), stamp);
            r.received.remove(rel);
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
    let text = text(next_stamp(previous))?;
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
    fn slanted_edges_and_corners_level_with_a_point_are_told_apart() {
        // A diamond, corners at lat/lon (0,2) (2,4) (4,2) (2,0): every edge slants.
        let diamond = parse(r#"{"type":"Polygon","coordinates":[[[2,0],[4,2],[2,4],[0,2],[2,0]]]}"#).unwrap();
        let at = |lat: f64, lon: f64| contains(&diamond, lat, lon);
        assert!(at(2.0, 2.0), "the middle");
        // Level with the east and west corners: the ray passes through a corner.
        assert!(at(2.0, 1.0), "inside, level with two corners");
        assert!(!at(2.0, -1.0), "west of it, level with two corners");
        assert!(!at(2.0, 5.0), "east of it, level with two corners");
        // Just either side of a slanted edge, and on it.
        assert!(!at(1.0, 0.9), "just outside the south-west edge");
        assert!(at(1.0, 1.1), "just inside the south-west edge");
        assert!(at(1.0, 1.0), "on the south-west edge");
        assert!(!at(3.0, 3.1), "just outside the north-east edge");
        assert!(at(3.0, 2.9), "just inside the north-east edge");
        assert!(at(3.0, 3.0), "on the north-east edge");
        assert!(at(1.0, 3.0), "on the south-east edge");
        assert!(at(3.0, 1.0), "on the north-west edge");
        assert!(!at(1.0, 3.1), "just outside the south-east edge");
        assert!(at(1.0, 2.9), "just inside the south-east edge");
    }

    #[test]
    fn a_point_in_line_with_an_edge_but_past_its_end_is_outside() {
        let square = parse(SQUARE).unwrap(); // lon 35–36, lat 31–32
        assert!(!contains(&square, 31.0, 37.0), "east along the southern edge");
        assert!(!contains(&square, 33.0, 35.0), "north along the western edge");
    }

    #[test]
    fn a_polygon_with_no_ring_contains_nothing() {
        assert!(!contains(&[vec![]], 0.0, 0.0));
        assert!(!contains(&[], 0.0, 0.0));
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
    fn polygons_are_found_in_every_container_and_labels_are_skipped() {
        let text = r#"{"type":"FeatureCollection","features":[
            {"type":"Feature","properties":{"name":"label"},"geometry":null},
            {"type":"Feature","geometry":{"type":"Point","coordinates":[35.2,31.7]}},
            {"type":"Feature","geometry":{"type":"GeometryCollection","geometries":[
                {"type":"LineString","coordinates":[[0,0],[1,1]]},
                {"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]},
                {"type":"MultiPoint","coordinates":[[0,0]]},
                {"type":"MultiLineString","coordinates":[[[0,0],[1,1]]]}]}}]}"#;
        assert_eq!(parse(text).unwrap(), vec![vec![vec![[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [0.0, 0.0]]]]);
    }

    #[test]
    fn a_malformed_file_says_what_is_wrong() {
        for (bad, why) in [
            ("{nope", "not JSON"),
            (r#"{"coordinates":[]}"#, "no `type`"),
            (r#"{"type":"Circle"}"#, "unknown type `Circle`"),
            (r#"{"type":"FeatureCollection"}"#, "without `features`"),
            (r#"{"type":"GeometryCollection"}"#, "without `geometries`"),
            (r#"{"type":"MultiPolygon"}"#, "MultiPolygon without coordinates"),
            (r#"{"type":"Polygon"}"#, "Polygon without coordinates"),
            (r#"{"type":"Polygon","coordinates":[]}"#, "no ring"),
            (r#"{"type":"Polygon","coordinates":[7]}"#, "not a list of positions"),
            (r#"{"type":"Polygon","coordinates":[[[0,0],[1,0]]]}"#, "fewer than three corners"),
            (r#"{"type":"Polygon","coordinates":[[[0],[1,0],[1,1]]]}"#, "not [longitude, latitude]"),
            (r#"{"type":"Polygon","coordinates":[[["a","b"],[1,0],[1,1]]]}"#, "not [longitude, latitude]"),
            (r#"{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,100]]]}"#, "off the globe"),
            (r#"{"type":"Polygon","coordinates":[[[0,0],[181,0],[1,1]]]}"#, "off the globe"),
            (r#"{"type":"Polygon","coordinates":[[[0,0],[-181,0],[1,1]]]}"#, "off the globe"),
            (r#"{"type":"Polygon","coordinates":[[[0,0],[1,-91],[1,1]]]}"#, "off the globe"),
            (r#"{"type":"Point","coordinates":[0,0]}"#, "no Polygon or MultiPolygon"),
        ] {
            let e = parse(bad).unwrap_err();
            assert!(e.contains(why), "{bad}: {e}");
        }
    }

    #[test]
    fn positions_on_the_edge_of_the_globe_are_on_it() {
        let text = r#"{"type":"Polygon","coordinates":[[[-180,-90],[180,-90],[180,90],[-180,-90]]]}"#;
        assert_eq!(parse(text).unwrap()[0][0][1], [-90.0, 180.0]);
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
    fn a_drawn_corner_must_be_on_the_globe() {
        for bad in [[f64::NAN, 1.0], [1.0, f64::NAN], [-90.5, 1.0], [1.0, 180.5], [1.0, -181.0], [f64::INFINITY, 1.0]] {
            assert!(drawn(&[[1.0, 1.0], [2.0, 2.0], bad], 0).is_err(), "{bad:?}");
        }
        // The poles and the antimeridian are on it.
        assert!(drawn(&[[90.0, 180.0], [-90.0, -180.0], [0.0, 0.0]], 0).is_ok());
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
    fn a_link_spells_a_file_beside_the_place_by_name_and_any_other_from_the_root() {
        assert_eq!(link_to("Places/Judah.md", "Places/Judah.geojson"), "[[Judah.geojson]]");
        assert_eq!(link_to("Places/Judah.md", "Maps/Judah.geojson"), "[[Maps/Judah.geojson]]");
        assert_eq!(link_to("Judah.md", "Judah.geojson"), "[[Judah.geojson]]");
        assert_eq!(link_to("Places/Judah.md", "Judah.geojson"), "[[Judah.geojson]]");
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
        assert!(is_synced("J.geojson"));
        assert!(!is_synced("Places/Ju?dah.geojson"));
        assert!(!is_synced("Places/Ju\ndah.geojson"));
        assert!(!is_synced("Places\\Judah.geojson"));
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

    fn e(name: &str, stamp: i64, size: u64, deleted: bool) -> BorderEntry {
        BorderEntry { name: name.into(), stamp, size, deleted }
    }

    #[test]
    fn a_round_takes_what_is_newer_there_and_gives_what_is_newer_here() {
        let mine = [
            e("Places/A.geojson", 5, 10, false),
            e("Places/B.geojson", 9, 10, false),
            e("Places/C.geojson", 3, 0, true),
            e("Places/Mine.geojson", 1, 10, false),
        ];
        let theirs = [
            e("Places/A.geojson", 7, 10, false),
            e("Places/B.geojson", 2, 10, false),
            e("Places/C.geojson", 3, 10, false),
            e("Places/Theirs.geojson", 4, 0, true),
            e("../Escape.geojson", 99, 10, false),
            e("Places/note.md", 99, 10, false),
        ];
        let (take, give) = exchange(&mine, &theirs);
        let names = |v: Vec<&BorderEntry>| v.into_iter().map(|e| e.name.clone()).collect::<Vec<_>>();
        // A is newer there; C's file beats a tombstone of the same stamp;
        // a tombstone for a file never seen here still travels.
        assert_eq!(names(take), ["Places/A.geojson", "Places/C.geojson", "Places/Theirs.geojson"]);
        assert_eq!(names(give), ["Places/B.geojson", "Places/Mine.geojson"]);
    }

    #[test]
    fn identical_manifests_exchange_nothing() {
        let both = [e("Places/A.geojson", 5, 10, false), e("Places/B.geojson", 6, 0, true)];
        let (take, give) = exchange(&both, &both);
        assert!(take.is_empty() && give.is_empty());
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
    fn a_peer_cannot_touch_a_geojson_file_no_region_names() {
        let (_a, root, local) = device();
        fs::create_dir_all(root.join("Maps")).unwrap();
        let roads = "Maps/roads.geojson";
        fs::write(root.join(roads), SQUARE).unwrap();
        let now = crate::config::now_ms() + 1000;
        assert!(!accept(&root, &local, roads, b"{}", now), "an unnamed file was overwritten");
        assert_eq!(fs::read_to_string(root.join(roads)).unwrap(), SQUARE);
        assert!(!forget(&root, &local, roads, now), "an unnamed file was deleted");
        assert!(root.join(roads).exists());
        assert_eq!(offered(&root, &local, roads), None, "an unnamed file was served");
        // A named Border is served, and a Border a peer delivered can be
        // updated again before its Place arrives and names it.
        set_named(&local, [roads.to_string()]).unwrap();
        assert!(offered(&root, &local, roads).is_some());
        let rel = "Places/Judah.geojson";
        assert!(accept(&root, &local, rel, SQUARE.as_bytes(), now));
        assert!(accept(&root, &local, rel, b"{\"type\":\"Polygon\"}", now + 1));
        assert!(forget(&root, &local, rel, now + 2));
        assert!(!root.join(rel).exists());
    }

    #[test]
    fn a_stamp_far_in_the_future_is_refused() {
        let (_a, root, local) = device();
        let rel = "Places/Judah.geojson";
        assert!(!accept(&root, &local, rel, SQUARE.as_bytes(), i64::MAX));
        assert!(!root.join(rel).exists());
        let pinned = format!(r#"{{"type":"Polygon","updated":{},"coordinates":[]}}"#, i64::MAX);
        assert!(!accept(&root, &local, rel, pinned.as_bytes(), crate::config::now_ms()));
        assert!(!root.join(rel).exists());
        assert!(!forget(&root, &local, rel, i64::MAX));
        assert!(!held(&root, &local, rel), "a far-future tombstone was kept");
        // A file another tool stamped that way can still be edited here.
        fs::create_dir_all(root.join("Places")).unwrap();
        fs::write(root.join(rel), &pinned).unwrap();
        write(&root, rel, &[[31.0, 35.0], [31.0, 36.0], [32.0, 36.0]]).unwrap();
        remove(&root, &local, rel).unwrap();
    }

    fn held(root: &Path, local: &Path, rel: &str) -> bool {
        local_entry(root, local, rel).is_some()
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
