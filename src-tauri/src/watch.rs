//! Folder watcher: external edits (Obsidian, a text editor, the sync folder)
//! are re-indexed and announced to the UI as `vault:changed`.

use crate::AppState;
use engine::vault::HIDDEN_DIR;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub struct Watcher {
    _debouncer: Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
}

#[derive(Serialize, Clone)]
pub struct ChangedPayload {
    pub changed: Vec<engine::index::DocSummary>,
    pub removed: Vec<String>,
}

impl Watcher {
    pub fn start(app: AppHandle, root: PathBuf) -> Result<Watcher, String> {
        let root_for_events = root.clone();
        let mut debouncer = new_debouncer(Duration::from_millis(400), move |res: DebounceEventResult| {
            let events = match res {
                Ok(e) => e,
                Err(_) => return,
            };
            let state = app.state::<AppState>();
            let mut changed = Vec::new();
            let mut removed = Vec::new();
            let mut guard = match state.vault.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            let vault = match guard.as_mut() {
                Some(v) => v,
                None => return,
            };
            let mut seen = std::collections::HashSet::new();
            let mut sync_touched = false;
            for ev in events {
                let p = ev.path;
                let rel = match p.strip_prefix(&root_for_events) {
                    Ok(r) => r.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };
                if rel.starts_with(&format!("{HIDDEN_DIR}/sync/")) {
                    sync_touched = true;
                    continue;
                }
                if p.extension().map_or(true, |x| x != "md") {
                    continue;
                }
                if rel.starts_with(HIDDEN_DIR) || rel.split('/').any(|seg| seg.starts_with('.')) || !seen.insert(rel.clone()) {
                    continue;
                }
                if p.is_file() {
                    if let Ok(Some(d)) = vault.index_file(&rel) {
                        changed.push(d);
                    }
                } else {
                    let _ = vault.forget(&rel);
                    removed.push(rel);
                }
            }
            if sync_touched {
                if let Ok(docs) = vault.apply_remote() {
                    changed.extend(docs);
                }
            }
            drop(guard);
            if !changed.is_empty() || !removed.is_empty() {
                let _ = app.emit("vault:changed", ChangedPayload { changed, removed });
            }
        })
        .map_err(|e| e.to_string())?;
        debouncer.watcher().watch(&root, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
        Ok(Watcher { _debouncer: debouncer })
    }
}
