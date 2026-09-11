//! Synesis engine: versification, Passage parsing, document parsing,
//! the SQLite index and the Vault itself. Everything that is not UI lives here
//! (see docs/adr/0004-rust-engine-react-ui.md).

pub mod dates;
pub mod document;
pub mod gazetteer;
pub mod index;
pub mod names;
pub mod parser;
pub mod properties;
pub mod scripture;
pub mod sync;
pub mod templates;
pub mod vault;
pub mod versification;

pub use scripture::{Lang, Passage, Unit, VerseId};
pub use vault::Vault;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("yaml: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid: {0}")]
    Invalid(String),
}

pub type Result<T> = std::result::Result<T, Error>;
