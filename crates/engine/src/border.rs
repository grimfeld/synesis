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
//! (ADR 0016).

use crate::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// The file extension a Border is stored under.
pub const EXT: &str = "geojson";

/// The Property naming a region's Border file.
pub const PROPERTY: &str = "border";

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

/// Every Border file in the Vault, as Pairing advertises it.
pub fn manifest(root: &Path) -> Vec<crate::config::ConfigEntry> {
    walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        // Hidden folders hold the engine's own state, never a Border.
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let rel = e.path().strip_prefix(root).ok()?.to_string_lossy().replace('\\', "/");
            if !is_synced(&rel) {
                return None;
            }
            let bytes = fs::read(e.path()).ok()?;
            Some(crate::config::ConfigEntry {
                stamp: crate::config::stamp_at(e.path(), &bytes),
                size: bytes.len() as u64,
                name: rel,
            })
        })
        .collect()
}

pub fn read_file(root: &Path, name: &str) -> Option<Vec<u8>> {
    if !is_synced(name) {
        return None;
    }
    fs::read(join(root, name)).ok()
}

/// Take a Border file from a peer when it is newer than what is here. Bytes
/// that are not JSON are refused; a malformed Border that is JSON travels, so
/// every Device shows the same warning. Returns whether it was written.
pub fn accept(root: &Path, name: &str, bytes: &[u8]) -> bool {
    if !is_synced(name) || serde_json::from_slice::<Value>(bytes).is_err() {
        return false;
    }
    let p = join(root, name);
    crate::config::accept_at(&p, bytes)
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
    let previous = fs::read(&p).ok().map(|b| crate::config::stamp_at(&p, &b)).unwrap_or(0);
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

    #[test]
    fn pairing_carries_the_newest_border_whole() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let rel = "Places/Judah.geojson";
        write(a.path(), rel, &[[31.0, 35.0], [31.0, 36.0], [32.0, 36.0]]).unwrap();
        let m = manifest(a.path());
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].name, rel);
        let first = read_file(a.path(), rel).unwrap();
        assert!(accept(b.path(), rel, &first), "a missing Border was not taken");
        assert_eq!(fs::read(b.path().join(rel)).unwrap(), first);
        // An edit on B is newer and wins on A; A's older copy loses on B.
        std::thread::sleep(std::time::Duration::from_millis(5));
        write(b.path(), rel, &[[30.0, 35.0], [31.0, 36.0], [32.0, 36.0]]).unwrap();
        let edited = read_file(b.path(), rel).unwrap();
        assert!(accept(a.path(), rel, &edited));
        assert!(!accept(b.path(), rel, &first), "an older Border replaced a newer one");
        assert_eq!(fs::read(a.path().join(rel)).unwrap(), edited);
        // Junk and unsafe names are refused.
        assert!(!accept(a.path(), rel, b"{nope"));
        assert!(!accept(a.path(), "../x.geojson", &edited));
    }

    #[test]
    fn hidden_folders_are_not_advertised() {
        let a = tempfile::tempdir().unwrap();
        fs::create_dir_all(a.path().join(".bible-study")).unwrap();
        fs::write(a.path().join(".bible-study/x.geojson"), SQUARE).unwrap();
        fs::write(a.path().join("Note.md"), "x").unwrap();
        assert!(manifest(a.path()).is_empty());
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
