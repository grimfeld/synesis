//! Where Vaults live, and whether this Device may write there (ADR 0015).
//!
//! On a phone the app chooses the folder from the Vault's name and puts it
//! somewhere the user's file manager can reach. Android only lets an app write
//! outside its private storage with "All files access", so the wizard asks for
//! it on the screen that shows where the Vault will go, and falls back to the
//! private folder — saying so — when it is refused.

use crate::{err, CmdResult};
use serde::Serialize;
use std::path::PathBuf;
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
        return StorageAccess { needed: true, granted: android::is_manager(app) };
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        StorageAccess { needed: false, granted: true }
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
    let base = app.path().document_dir().or_else(|_| app.path().app_data_dir()).map_err(err)?;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let base = app.path().document_dir().or_else(|_| app.path().home_dir()).map_err(err)?;
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
        if entry.file_type()?.is_dir() {
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

    /// Managed state once `init()` has run; absent if the plugin failed to
    /// load, in which case we report no access and fall back.
    pub struct Handle(pub PluginHandle<tauri::Wry>);

    pub fn register<R: Runtime>(api: PluginApi<R, ()>) -> Result<PluginHandle<R>, Box<dyn std::error::Error>> {
        Ok(api.register_android_plugin("tech.grimfeld.synesis", "StoragePlugin")?)
    }

    fn plugin(app: &AppHandle) -> Option<tauri::State<'_, Handle>> {
        app.try_state::<Handle>()
    }

    pub fn is_manager(app: &AppHandle) -> bool {
        plugin(app)
            .and_then(|h| h.0.run_mobile_plugin::<Granted>("isExternalStorageManager", ()).ok())
            .map(|r| r.granted)
            .unwrap_or(false)
    }

    pub fn request(app: &AppHandle) -> CmdResult<()> {
        let h = plugin(app).ok_or("storage plugin unavailable")?;
        h.0.run_mobile_plugin::<()>("requestExternalStorageManager", ()).map_err(err)
    }

    /// `/storage/emulated/0/Documents`, the folder the Files app shows.
    pub fn shared_documents(app: &AppHandle) -> PathBuf {
        plugin(app)
            .and_then(|h| h.0.run_mobile_plugin::<DirPath>("getSharedDocumentsDir", ()).ok())
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
                    Ok(handle) => _app.manage(android::Handle(handle)),
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
        assert!(StorageAccess { needed: false, granted: false }.visible());
        assert!(StorageAccess { needed: false, granted: true }.visible());
    }

    #[test]
    fn android_without_the_grant_falls_back() {
        // The Vault is still made; it just lands where Files cannot browse,
        // which the wizard says on the screen before it happens (ADR 0015).
        assert!(!StorageAccess { needed: true, granted: false }.visible());
        assert!(StorageAccess { needed: true, granted: true }.visible());
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
        assert_eq!(std::fs::read_to_string(to.join("a note.md")).unwrap(), "hello");
        assert!(to.join(".bible-study").join("sync").join("device.json").is_file());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn only_mobile_chooses_the_path_for_the_user() {
        assert_eq!(app_decides_path(), matches!(std::env::consts::OS, "android" | "ios"));
    }
}
