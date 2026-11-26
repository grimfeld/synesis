//! Where Vaults live, and whether this Device may write there (ADR 0015).
//!
//! On a phone the app chooses the folder from the Vault's name and puts it
//! somewhere the user's file manager can reach. Android only lets an app write
//! outside its private storage with "All files access", so the wizard asks for
//! it on the screen that shows where the Vault will go, and falls back to the
//! private folder — saying so — when it is refused.

use crate::{err, CmdResult};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Whether this Device needs a permission to write Vaults where the user can
/// see them, and whether it has one. Off Android nothing is needed: iOS shares
/// the app's own Documents container through Info.plist, and desktop writes
/// wherever the user points the picker.
#[derive(Serialize, Clone, Copy)]
pub struct StorageAccess {
    pub needed: bool,
    pub granted: bool,
}

impl StorageAccess {
    /// Vaults go to the visible folder only when nothing stands in the way.
    pub fn visible(self) -> bool {
        !self.needed || self.granted
    }
}

/// Does this Device choose the Vault folder itself? True on mobile, where
/// there is no folder picker and no path the user could usefully type.
pub fn app_decides_path() -> bool {
    matches!(std::env::consts::OS, "android" | "ios")
}

pub fn access(app: &AppHandle) -> StorageAccess {
    #[cfg(target_os = "android")]
    {
        return StorageAccess {
            needed: true,
            granted: android::is_manager(app),
        };
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        StorageAccess {
            needed: false,
            granted: true,
        }
    }
}

/// The folder new Vaults go in. On Android that is the shared `Documents`
/// when we may write there, and the app's private storage when we may not; on
/// iOS it is the app's Documents container, which Info.plist shares with the
/// Files app; on desktop it is the user's own Documents folder.
pub fn vaults_parent(app: &AppHandle) -> CmdResult<PathBuf> {
    #[cfg(target_os = "android")]
    let base = if access(app).visible() {
        android::shared_documents(app)
    } else {
        app.path().document_dir().map_err(err)?
    };
    #[cfg(target_os = "ios")]
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(err)?;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(err)?;
    Ok(base.join("Synesis"))
}

/// Where a Vault called `name` would go, without disturbing anything already
/// there (ADR 0014's sibling path).
pub fn vault_path(app: &AppHandle, name: &str) -> CmdResult<PathBuf> {
    let parent = vaults_parent(app)?;
    std::fs::create_dir_all(&parent).map_err(err)?;
    Ok(engine::meta::free_path(&parent, name))
}

/// Whether this Device may write Vaults where the user can find them.
#[tauri::command]
pub fn storage_access(app: AppHandle) -> CmdResult<StorageAccess> {
    Ok(access(&app))
}

/// Send the user to the system page that grants all-files access. The grant
/// happens outside the app, so the UI re-checks `storage_access` on focus.
#[tauri::command]
pub fn request_storage_access(app: AppHandle) -> CmdResult<()> {
    #[cfg(target_os = "android")]
    {
        return android::request(&app);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Copy a folder and everything under it. Used by the move, which copies
/// before it deletes so a phone that sleeps mid-way leaves the Vault intact.
pub fn copy_tree(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        let kind = entry.file_type()?;
        // A link is not copied: copying would bring its target into the
        // Vault, wherever on the disk that is (#86).
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            copy_tree(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), &dest)?;
        }
    }
    Ok(())
}

/// Whether a Vault sits somewhere its owner cannot browse, and so is worth
/// offering to move (ADR 0015). Only Android hides a folder this way.
pub fn is_hidden_path(app: &AppHandle, path: &str) -> bool {
    if std::env::consts::OS != "android" || !access(app).visible() {
        return false;
    }
    path.contains("/Android/data/")
}

/// The folder iOS gives this app (`…/Containers/Data/Application/<UUID>`),
/// whose Documents holds the Vaults made on this Device. `None` elsewhere.
pub fn app_container(app: &AppHandle) -> Option<PathBuf> {
    if std::env::consts::OS != "ios" {
        return None;
    }
    app.path()
        .document_dir()
        .ok()
        .and_then(|d| d.parent().map(PathBuf::from))
}

/// `stored`, moved into `container` when it points inside an earlier iOS app
/// container. iOS gives the app a new `<UUID>` folder on every update and
/// moves its files there, so a path saved before the update names a folder
/// that is gone, and opening it fails with an OS error.
pub fn rebase_on_container(stored: &str, container: &Path) -> Option<PathBuf> {
    let parts: Vec<&str> = stored.split('/').collect();
    let at = parts.windows(4).position(|w| {
        w[0] == "Containers" && w[1] == "Data" && w[2] == "Application" && is_uuid(w[3])
    })?;
    let rest = &parts[at + 4..];
    let rebased = rest
        .iter()
        .filter(|p| !p.is_empty())
        .fold(container.to_path_buf(), |acc, p| acc.join(p));
    (rebased != Path::new(stored)).then_some(rebased)
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36
        && s.chars().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// After an iOS update: point every saved Vault path at the app's new
/// container, and move each Vault's per-Device state (index, pairing) with
/// it, since that state is filed under a hash of the path
/// (`engine::vault::local_dir_for`). A path is changed only when it is gone
/// and its rebased twin is there. Returns whether anything changed.
pub fn follow_moved_container(
    settings: &mut crate::Settings,
    container: &Path,
    data_dir: &Path,
) -> bool {
    let mut moved: Vec<(String, String)> = Vec::new();
    let mut follow = |p: &mut String| {
        if Path::new(p.as_str()).exists() {
            return;
        }
        let Some(new) = rebase_on_container(p, container) else {
            return;
        };
        if !new.exists() {
            return;
        }
        let new = new.to_string_lossy().to_string();
        if !moved.iter().any(|(old, _)| old == p) {
            moved.push((p.clone(), new.clone()));
        }
        *p = new;
    };
    if let Some(p) = settings.vault_path.as_mut() {
        follow(p);
    }
    settings.recent.iter_mut().for_each(&mut follow);
    settings.vaults.iter_mut().for_each(|v| follow(&mut v.path));
    for (old, new) in &moved {
        let from = engine::vault::local_dir_for(data_dir, Path::new(old));
        let to = engine::vault::local_dir_for(data_dir, Path::new(new));
        if from.is_dir() && !to.exists() {
            let _ = std::fs::rename(&from, &to);
        }
    }
    !moved.is_empty()
}

/// Calls into the Kotlin side that `scripts/android-post-init.mjs` injects
/// into the generated project (`src-tauri/gen/` is regenerated and gitignored,
/// so the plugin cannot live there as a checked-in source file).
#[cfg(target_os = "android")]
mod android {
    use super::*;
    use serde::Deserialize;
    use tauri::plugin::{PluginApi, PluginHandle};
    use tauri::Runtime;

    #[derive(Deserialize)]
    struct Granted {
        granted: bool,
    }

    #[derive(Deserialize)]
    struct DirPath {
        path: String,
    }

    /// Managed state once the plugin has loaded; absent if it failed to, in
    /// which case we report no access and fall back. Generic over the runtime
    /// so the state's type matches the plugin the builder produced.
    pub struct Handle<R: Runtime>(pub PluginHandle<R>);

    pub fn register<R: Runtime>(
        api: PluginApi<R, ()>,
    ) -> Result<PluginHandle<R>, Box<dyn std::error::Error>> {
        Ok(api.register_android_plugin("tech.grimfeld.synesis", "StoragePlugin")?)
    }

    /// `AppHandle` in this crate is `AppHandle<Wry>`, so the lookup is concrete.
    fn plugin(app: &AppHandle) -> Option<tauri::State<'_, Handle<tauri::Wry>>> {
        app.try_state::<Handle<tauri::Wry>>()
    }

    pub fn is_manager(app: &AppHandle) -> bool {
        plugin(app)
            .and_then(|h| {
                h.0.run_mobile_plugin::<Granted>("isExternalStorageManager", ())
                    .ok()
            })
            .map(|r| r.granted)
            .unwrap_or(false)
    }

    pub fn request(app: &AppHandle) -> CmdResult<()> {
        let h = plugin(app).ok_or("storage plugin unavailable")?;
        h.0.run_mobile_plugin::<()>("requestExternalStorageManager", ())
            .map_err(err)
    }

    /// `/storage/emulated/0/Documents`, the folder the Files app shows.
    pub fn shared_documents(app: &AppHandle) -> PathBuf {
        plugin(app)
            .and_then(|h| {
                h.0.run_mobile_plugin::<DirPath>("getSharedDocumentsDir", ())
                    .ok()
            })
            .map(|r| PathBuf::from(r.path))
            .unwrap_or_else(|| PathBuf::from("/storage/emulated/0/Documents"))
    }
}

/// The Tauri plugin that carries the Android side. A no-op elsewhere, so
/// `run()` registers it unconditionally and the commands have one shape.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("synesis-storage")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                match android::register(_api) {
                    // `manage` answers whether the value was new; nothing here
                    // has anything to say about that.
                    Ok(handle) => {
                        _app.manage(android::Handle(handle));
                    }
                    // Without the plugin we cannot reach the shared folder;
                    // `access()` then reports not-granted and Vaults fall back
                    // to private storage rather than failing to be created.
                    Err(e) => eprintln!("storage plugin unavailable: {e}"),
                }
            }
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_stands_in_the_way_when_no_permission_is_needed() {
        // Desktop and iOS: the folder is reachable without asking.
        assert!(StorageAccess {
            needed: false,
            granted: false
        }
        .visible());
        assert!(StorageAccess {
            needed: false,
            granted: true
        }
        .visible());
    }

    #[test]
    fn android_without_the_grant_falls_back() {
        // The Vault is still made; it just lands where Files cannot browse,
        // which the wizard says on the screen before it happens (ADR 0015).
        assert!(!StorageAccess {
            needed: true,
            granted: false
        }
        .visible());
        assert!(StorageAccess {
            needed: true,
            granted: true
        }
        .visible());
    }

    #[test]
    fn a_copied_tree_keeps_everything_under_it() {
        // The move copies before it deletes, so a phone that sleeps half way
        // through still has the Vault where it was.
        let root = std::env::temp_dir().join(format!("synesis-copy-{}", std::process::id()));
        let from = root.join("from");
        let nested = from.join(".bible-study").join("sync");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(from.join("a note.md"), "hello").unwrap();
        std::fs::write(nested.join("device.json"), "{}").unwrap();
        let to = root.join("to");
        copy_tree(&from, &to).unwrap();
        assert_eq!(
            std::fs::read_to_string(to.join("a note.md")).unwrap(),
            "hello"
        );
        assert!(to
            .join(".bible-study")
            .join("sync")
            .join("device.json")
            .is_file());
        std::fs::remove_dir_all(&root).ok();
    }

    const OLD: &str =
        "/private/var/mobile/Containers/Data/Application/0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9";

    #[test]
    fn a_path_in_an_earlier_ios_container_moves_to_the_current_one() {
        let now = Path::new(
            "/var/mobile/Containers/Data/Application/FFFFFFFF-0000-1111-2222-333333333333",
        );
        assert_eq!(
            rebase_on_container(&format!("{OLD}/Documents/Synesis/main"), now),
            Some(now.join("Documents").join("Synesis").join("main"))
        );
        // iCloud and desktop paths are not inside an app container.
        let icloud = "/private/var/mobile/Library/Mobile Documents/iCloud~tech~grimfeld~synesis/Documents/main";
        assert_eq!(rebase_on_container(icloud, now), None);
        assert_eq!(
            rebase_on_container("/Users/me/Documents/Synesis/main", now),
            None
        );
        // Not a UUID: left alone.
        assert_eq!(
            rebase_on_container("/x/Containers/Data/Application/main/Documents", now),
            None
        );
    }

    #[test]
    fn an_update_keeps_the_vaults_and_their_pairing() {
        let tmp = std::env::temp_dir().join(format!("synesis-ios-{}", std::process::id()));
        let container =
            tmp.join("Containers/Data/Application/FFFFFFFF-0000-1111-2222-333333333333");
        let vault = container.join("Documents/Synesis/main");
        std::fs::create_dir_all(&vault).unwrap();
        let data_dir = container.join("Library/Application Support/app");
        let old = format!("{OLD}/Documents/Synesis/main");
        // The state the old build filed under the old path's hash.
        let old_local = engine::vault::local_dir_for(&data_dir, Path::new(&old));
        std::fs::create_dir_all(&old_local).unwrap();
        std::fs::write(old_local.join("pairing.json"), "{}").unwrap();

        let mut s: crate::Settings = serde_json::from_str("{}").unwrap();
        s.vault_path = Some(old.clone());
        s.recent = vec![old.clone(), "/elsewhere/gone".into()];
        s.vaults = vec![crate::KnownVault {
            id: "v".into(),
            name: "main".into(),
            path: old.clone(),
        }];
        assert!(follow_moved_container(&mut s, &container, &data_dir));
        let new = vault.to_string_lossy().to_string();
        assert_eq!(s.vault_path.as_deref(), Some(new.as_str()));
        assert_eq!(s.recent, vec![new.clone(), "/elsewhere/gone".into()]);
        assert_eq!(s.vaults[0].path, new);
        assert!(engine::vault::local_dir_for(&data_dir, &vault)
            .join("pairing.json")
            .is_file());
        // Run again: nothing left to follow.
        assert!(!follow_moved_container(&mut s, &container, &data_dir));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn only_mobile_chooses_the_path_for_the_user() {
        assert_eq!(
            app_decides_path(),
            matches!(std::env::consts::OS, "android" | "ios")
        );
    }
}
