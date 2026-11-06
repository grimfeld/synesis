//! A Device's id: the name of its sync folder (`sync/<device>/`) and how the
//! pairing roster names it once it is retired.
//!
//! Every id this app makes is a ULID, 26 Crockford base32 characters in upper
//! case (`Sync::open`). A name that arrives from anywhere else — a peer, a
//! folder on disk, the UI — is used as a path component and compared with the
//! ids this Device trusts, so it is only ever handled as a `DeviceId`:
//!
//! - the shape is checked, so `..`, `/tmp/x` or `a/b` never reach `Path::join`
//!   or `remove_dir_all` (#82);
//! - the case is normalised, so `01abc…` and `01ABC…`, which name the same
//!   folder on a case-insensitive disk (APFS, NTFS), are the same id and a
//!   lowercase spelling cannot dodge the "my own folder" or "retired" checks
//!   (#90).

use serde::{Deserialize, Deserializer, Serialize};
use std::fmt;

/// Crockford base32 as ULIDs spell it: no I, L, O or U.
const ALPHABET: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LEN: usize = 26;

/// A Device id in canonical (upper case) form. Construct with
/// [`DeviceId::parse`] or [`DeviceId::generate`]; there is no other way in.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(into = "String")]
pub struct DeviceId(String);

impl DeviceId {
    /// A fresh id for a Device that has none yet.
    pub fn generate() -> DeviceId {
        DeviceId(ulid::Ulid::new().to_string())
    }

    /// `s` as a Device id, upper-cased; `None` unless it is ULID-shaped.
    pub fn parse(s: &str) -> Option<DeviceId> {
        let up = s.to_ascii_uppercase();
        let ok = up.len() == LEN
            && up.chars().all(|c| ALPHABET.contains(c))
            // A ULID's first character carries only 3 bits.
            && up.as_bytes()[0] <= b'7';
        ok.then_some(DeviceId(up))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for DeviceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for DeviceId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl AsRef<std::path::Path> for DeviceId {
    fn as_ref(&self) -> &std::path::Path {
        std::path::Path::new(&self.0)
    }
}

impl From<DeviceId> for String {
    fn from(d: DeviceId) -> String {
        d.0
    }
}

impl TryFrom<String> for DeviceId {
    type Error = String;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        DeviceId::parse(&s).ok_or_else(|| format!("not a device id: {s:?}"))
    }
}

impl<'de> Deserialize<'de> for DeviceId {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        DeviceId::try_from(s).map_err(serde::de::Error::custom)
    }
}

impl PartialEq<str> for DeviceId {
    fn eq(&self, other: &str) -> bool {
        DeviceId::parse(other).is_some_and(|o| o == *self)
    }
}

impl PartialEq<&str> for DeviceId {
    fn eq(&self, other: &&str) -> bool {
        *self == **other
    }
}

/// Deserialize a list of ids, dropping any entry that is not one. For lists
/// read from a file this app wrote (`removed_devices`): one bad entry must not
/// make the whole file unreadable, and a name that is not an id can never be
/// a folder this app trusts or writes anyway.
pub fn lenient_list<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<DeviceId>, D::Error> {
    let raw = Vec::<String>::deserialize(d)?;
    let mut out: Vec<DeviceId> = Vec::new();
    for id in raw.iter().filter_map(|s| DeviceId::parse(s)) {
        if !out.contains(&id) {
            out.push(id);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ulid_is_a_device_id_in_either_case() {
        let id = ulid::Ulid::new().to_string();
        let parsed = DeviceId::parse(&id).unwrap();
        assert_eq!(parsed.as_str(), id);
        let lower = DeviceId::parse(&id.to_lowercase()).unwrap();
        assert_eq!(lower, parsed, "a lowercase spelling is a different id");
        assert_eq!(
            lower.as_str(),
            id,
            "the lowercase spelling was not normalised"
        );
        assert!(parsed == id.to_lowercase().as_str());
    }

    #[test]
    fn anything_else_is_not_a_device_id() {
        for bad in [
            "",
            "..",
            "../x",
            "/tmp/x",
            "a/b",
            "C:\\Users",
            "phone",
            "01SOMEOTHERDEVICE",
            // 26 characters, but outside Crockford base32 or the ULID range.
            "01ARZ3NDEKTSV4RRFFQ69G5FAI",
            "01ARZ3NDEKTSV4RRFFQ69G5FAU",
            "81ARZ3NDEKTSV4RRFFQ69G5FAV",
            "01ARZ3NDEKTSV4RRFFQ69G5FA/",
            "01ARZ3NDEKTSV4RRFFQ69G5FAVX",
        ] {
            assert!(DeviceId::parse(bad).is_none(), "{bad:?}");
        }
        assert!(DeviceId::parse("01ARZ3NDEKTSV4RRFFQ69G5FAV").is_some());
    }

    #[test]
    fn serde_refuses_a_bad_id_and_a_list_drops_it() {
        assert!(serde_json::from_str::<DeviceId>("\"../etc\"").is_err());
        let ok: DeviceId = serde_json::from_str("\"01arz3ndektsv4rrffq69g5fav\"").unwrap();
        assert_eq!(
            serde_json::to_string(&ok).unwrap(),
            "\"01ARZ3NDEKTSV4RRFFQ69G5FAV\""
        );

        #[derive(Deserialize)]
        struct L {
            #[serde(deserialize_with = "lenient_list")]
            ids: Vec<DeviceId>,
        }
        let l: L = serde_json::from_str(
            r#"{"ids":["ghost","01ARZ3NDEKTSV4RRFFQ69G5FAV","01arz3ndektsv4rrffq69g5fav"]}"#,
        )
        .unwrap();
        assert_eq!(l.ids.len(), 1);
    }
}
