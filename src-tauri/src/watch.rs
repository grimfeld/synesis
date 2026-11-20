//! Folder watcher: external edits (Obsidian, a text editor, the sync folder)
//! are re-indexed and announced to the UI as `vault:changed`. Markdown files
//! are documents; a `.canvas` beside a Composition is its Board (ADR 0009).

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
    /// Compositions whose Board was edited outside the app (PLAN §17.14). A
    /// Board is not a document, so it is not in `changed`: naming the
    /// Composition there would read as an edit to its text.
    pub boards: Vec<String>,
    /// Folders inside `Notes/` or `Compositions/` that appeared, were
    /// renamed or went away outside the app (PLAN §31), so the sidebar's
    /// Folder tree asks again even when no document changed (an empty one).
    pub folders: Vec<String>,
}

/// Whether `rel` names a Folder: a path with no extension under a type that
/// has Folders. A Folder whose name has a dot in it is still caught by the
/// `is_dir` check of an existing one; a deleted one is caught here.
fn is_folder_event(rel: &str, p: &std::path::Path) -> bool {
    let under = rel.starts_with("Notes/") || rel.starts_with("Compositions/");
    under && (p.is_dir() || (!p.exists() && p.extension().is_none()))
}

impl Watcher {
    pub fn start(app: AppHandle, root: PathBuf) -> Result<Watcher, String> {
        let root_for_events = root.clone();
        let mut debouncer = new_debouncer(
            Duration::from_millis(400),
            move |res: DebounceEventResult| {
                let events = match res {
                    Ok(e) => e,
                    Err(_) => return,
                };
                let state = app.state::<AppState>();
                let mut changed = Vec::new();
                let mut removed = Vec::new();
                let mut boards = Vec::new();
                let mut folders = Vec::new();
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
                    // iCloud evicted something, or is bringing it back: ask
                    // for it. The real file's own event follows on arrival.
                    if engine::cloud::is_placeholder(&p) {
                        if p.is_file() {
                            if let Some(orig) = engine::cloud::original_of(&p) {
                                crate::icloud::download(&[orig]);
                            }
                        }
                        continue;
                    }
                    if rel.starts_with(&format!("{HIDDEN_DIR}/sync/")) {
                        sync_touched = true;
                        continue;
                    }
                    // A Folder made, renamed or removed in Finder or Obsidian:
                    // its own event is often all there is, so the documents
                    // under it are found again, each keeping its id.
                    if is_folder_event(&rel, &p) {
                        if rel.split('/').any(|seg| seg.starts_with('.'))
                            || engine::vault_path::is_link(&p)
                            || !seen.insert(rel.clone())
                        {
                            continue;
                        }
                        if let Ok((c, r)) = vault.folder_changed(&rel) {
                            changed.extend(c);
                            removed.extend(r);
                        }
                        folders.push(rel);
                        continue;
                    }
                    let ext = p.extension().and_then(|x| x.to_str()).unwrap_or_default();
                    // A region's Border edited, arrived or removed (ADR 0023):
                    // the Places inside it are recomputed, and the regions
                    // whose containment changed are announced.
                    if ext == engine::border::EXT {
                        if engine::border::is_synced(&rel) && seen.insert(rel.clone()) {
                            if let Ok(regions) = vault.border_file_changed() {
                                changed.extend(regions);
                            }
                        }
                        continue;
                    }
                    if ext != "md" && ext != "canvas" {
                        continue;
                    }
                    if rel.starts_with(HIDDEN_DIR)
                        || rel.split('/').any(|seg| seg.starts_with('.'))
                        || !seen.insert(rel.clone())
                    {
                        continue;
                    }
                    // A Board edited in Obsidian (ADR 0009): folded in node by
                    // node, and announced only when it really changed, so this
                    // app's own Board saves do not echo back. A deleted canvas
                    // is left to the CRDT, which still holds the Board.
                    if ext == "canvas" {
                        if p.is_file() {
                            if let Ok(Some(comp)) = vault.fold_board_file(&rel) {
                                boards.push(comp.id);
                            }
                        }
                        continue;
                    }
                    // `is_file` follows a link; the engine refuses one, and
                    // leaving it out here keeps it from looking vanished.
                    if engine::vault_path::is_link(&p) {
                        continue;
                    }
                    if p.is_file() {
                        if let Ok(Some(d)) = vault.index_file(&rel) {
                            changed.push(d);
                        }
                    } else if vault.vanished(&rel).unwrap_or(false) {
                        // Only a file that is really gone; an evicted one
                        // stays listed (engine::cloud).
                        removed.push(rel);
                    }
                }
                if sync_touched {
                    if let Ok(docs) = vault.apply_remote() {
                        changed.extend(docs);
                    }
                }
                drop(guard);
                if !changed.is_empty()
                    || !removed.is_empty()
                    || !boards.is_empty()
                    || !folders.is_empty()
                {
                    let _ = app.emit(
                        "vault:changed",
                        ChangedPayload {
                            changed,
                            removed,
                            boards,
                            folders,
                        },
                    );
                }
            },
        )
        .map_err(|e| e.to_string())?;
        debouncer
            .watcher()
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
        Ok(Watcher {
            _debouncer: debouncer,
        })
    }
}
