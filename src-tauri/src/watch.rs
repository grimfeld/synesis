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

/// What a path under `Notes/` or `Compositions/` is to the Folder tree.
#[derive(Debug, PartialEq, Eq)]
enum FolderEvent {
    /// Not a Folder: a document, a Board, or this app's own temporary file.
    No,
    /// A Folder that exists, or a gone path with no extension: a Folder for sure.
    Folder,
    /// A gone path with an extension that is no document's (`Acts 2.1`): a
    /// Folder only if documents were indexed under it.
    Maybe,
}

/// Classify a watcher event's path, from its name and whether it is there.
/// The engine writes every file through a `<name>.md.tmp-<ulid>` it renames
/// away (`write_atomic`), so a gone path holding `.tmp-` is never a Folder:
/// otherwise every save would be announced as one.
fn folder_event(rel: &str, is_dir: bool, exists: bool) -> FolderEvent {
    let under = rel.starts_with("Notes/") || rel.starts_with("Compositions/");
    let name = rel.rsplit('/').next().unwrap_or_default();
    if !under || name.starts_with('.') || name.contains(".tmp-") {
        return FolderEvent::No;
    }
    if is_dir {
        return FolderEvent::Folder;
    }
    if exists {
        return FolderEvent::No;
    }
    match std::path::Path::new(name)
        .extension()
        .and_then(|x| x.to_str())
    {
        None => FolderEvent::Folder,
        Some(ext) if ext == "md" || ext == "canvas" || ext == engine::border::EXT => {
            FolderEvent::No
        }
        Some(_) => FolderEvent::Maybe,
    }
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
                    let kind = folder_event(&rel, p.is_dir(), p.exists());
                    if kind != FolderEvent::No {
                        if rel.split('/').any(|seg| seg.starts_with('.'))
                            || engine::vault_path::is_link(&p)
                            || !seen.insert(rel.clone())
                        {
                            continue;
                        }
                        let mut forgot = false;
                        if let Ok((c, r)) = vault.folder_changed(&rel) {
                            forgot = !r.is_empty();
                            changed.extend(c);
                            removed.extend(r);
                        }
                        if kind == FolderEvent::Folder || forgot {
                            folders.push(rel);
                        }
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

#[cfg(test)]
mod tests {
    use super::{folder_event, FolderEvent};

    #[test]
    fn a_save_is_not_a_folder_event() {
        // `write_atomic`'s temporary file, gone by the time the event lands.
        assert_eq!(
            folder_event("Notes/week 2.md.tmp-01JABC", false, false),
            FolderEvent::No
        );
        assert_eq!(
            folder_event("Notes/week 2.md", false, false),
            FolderEvent::No
        );
        assert_eq!(
            folder_event("Notes/week 2.md", false, true),
            FolderEvent::No
        );
        assert_eq!(
            folder_event("Compositions/talk.canvas", false, false),
            FolderEvent::No
        );
    }

    #[test]
    fn folders_made_or_gone_are_folder_events() {
        assert_eq!(
            folder_event("Notes/Sermons", true, true),
            FolderEvent::Folder
        );
        assert_eq!(
            folder_event("Notes/Sermons", false, false),
            FolderEvent::Folder
        );
        assert_eq!(
            folder_event("Notes/Acts 2.1", true, true),
            FolderEvent::Folder
        );
        assert_eq!(
            folder_event("Notes/Acts 2.1", false, false),
            FolderEvent::Maybe
        );
    }

    #[test]
    fn only_notes_and_compositions_have_folders() {
        assert_eq!(folder_event("Sources/Books", true, true), FolderEvent::No);
        assert_eq!(folder_event("Notes/.hidden", true, true), FolderEvent::No);
        assert_eq!(folder_event("Notes", true, true), FolderEvent::No);
    }
}
