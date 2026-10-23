//! iCloud Drive on Apple devices (PLAN §7 and §14, amended 2026-10-13).
//!
//! An iPhone app cannot read the user's iCloud Drive at large; it gets one
//! folder of its own, the ubiquity container `iCloud.tech.grimfeld.synesis`.
//! Info.ios.plist publishes that container's `Documents` folder to iCloud
//! Drive under the name "Synesis", so a Vault the phone creates there is the
//! folder a Mac sees as iCloud Drive › Synesis
//! (`~/Library/Mobile Documents/iCloud~tech~grimfeld~synesis/Documents`), and
//! that Windows sees under `iCloudDrive\iCloud~tech~grimfeld~synesis`.
//!
//! iCloud evicts files it thinks are not needed and leaves `.name.icloud`
//! placeholders (`engine::cloud`). The engine keeps an evicted document as it
//! was and refuses to write over it; this module asks iCloud to bring every
//! evicted item back, and rescans when something arrives — the watcher does
//! not see every download on iOS.
use crate::AppState;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// The ubiquity container, as registered in the Apple Developer portal and
/// named in the iOS entitlements (`src-tauri/ios/Synesis_iOS.entitlements`).
/// Changing it strands every Vault already in the old one (ADR 0022).
#[allow(dead_code)] // read on iOS only
pub const CONTAINER_ID: &str = "iCloud.tech.grimfeld.synesis";

/// The same container as a folder name: what iCloud Drive calls it on disk,
/// on a Mac under `~/Library/Mobile Documents` and on Windows under `iCloudDrive`.
pub const CONTAINER_DIR: &str = "iCloud~tech~grimfeld~synesis";

/// Where this Device keeps the container's Documents folder, when iCloud
/// Drive is on and the container is there. `None` means iCloud is not
/// available to this app: signed out, iCloud Drive off, or Synesis not
/// allowed to use it.
pub fn container(home: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "ios")]
    {
        let _ = home;
        return apple::container_documents();
    }
    #[cfg(target_os = "macos")]
    {
        // A Mac build signed with the iCloud entitlement (and its
        // provisioning profile) can ask for the container, which creates it;
        // one without gets nothing back and uses the folder only once an
        // iPhone has made it.
        if let Some(d) = apple::container_documents() {
            return Some(d);
        }
        let d = home.join("Library/Mobile Documents").join(CONTAINER_DIR).join("Documents");
        return d.is_dir().then_some(d);
    }
    #[cfg(target_os = "windows")]
    {
        // iCloud for Windows shows each app's container as a folder of
        // iCloud Drive; the `Documents` level is usually folded away.
        let c = home.join("iCloudDrive").join(CONTAINER_DIR);
        let docs = c.join("Documents");
        return if docs.is_dir() { Some(docs) } else { c.is_dir().then_some(c) };
    }
    #[allow(unreachable_code)]
    {
        let _ = home;
        None
    }
}

/// Ask iCloud to download each item. A no-op off Apple platforms, where
/// iCloud for Windows downloads on open and leaves no placeholder.
pub fn download(paths: &[PathBuf]) {
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    apple::download(paths);
    #[cfg(not(any(target_os = "ios", target_os = "macos")))]
    let _ = paths;
}

/// Before opening a Vault: ask for everything evicted under it, and wait a
/// while for its identity file, which the engine will not invent a second of
/// (ADR 0014). Gives up quietly; `Vault::open` then says what is missing.
pub fn prepare(root: &Path) {
    if !cfg!(any(target_os = "ios", target_os = "macos")) {
        return;
    }
    let evicted = engine::cloud::evicted_under(root);
    if evicted.is_empty() {
        return;
    }
    download(&evicted);
    let meta = root.join(engine::vault::HIDDEN_DIR).join("vault.json");
    for _ in 0..40 {
        if !engine::cloud::is_evicted(&meta) {
            return;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// While a Vault is open on an Apple device: keep asking iCloud for whatever
/// it has evicted, and rescan once something has come back. Every 15 seconds
/// is often enough to catch up a phone that was offline and cheap when
/// nothing is evicted (one walk of the folder).
pub fn start(app: AppHandle) {
    if !cfg!(any(target_os = "ios", target_os = "macos")) {
        return;
    }
    std::thread::spawn(move || {
        let mut waiting: Vec<PathBuf> = Vec::new();
        loop {
            std::thread::sleep(Duration::from_secs(15));
            let state = app.state::<AppState>();
            let Some(root) = state.vault.lock().ok().and_then(|g| g.as_ref().map(|v| v.root().to_path_buf())) else {
                waiting.clear();
                continue;
            };
            // Walk outside the lock: the folder may be large.
            let evicted = engine::cloud::evicted_under(&root);
            let arrived = waiting.iter().any(|p| p.starts_with(&root) && !evicted.contains(p));
            if !evicted.is_empty() {
                download(&evicted);
            }
            waiting = evicted;
            if arrived {
                rescan(&app, &root);
            }
        }
    });
}

/// Index what arrived and merge any snapshots that came with it, announcing
/// it the way the watcher does.
fn rescan(app: &AppHandle, root: &Path) {
    let state = app.state::<AppState>();
    let Ok(mut guard) = state.vault.lock() else { return };
    let Some(vault) = guard.as_mut() else { return };
    if vault.root() != root {
        return;
    }
    let mut changed = vault.scan().unwrap_or_default();
    if let Ok(docs) = vault.apply_remote() {
        changed.extend(docs);
    }
    drop(guard);
    if !changed.is_empty() {
        let _ = app.emit("vault:changed", crate::watch::ChangedPayload { changed, removed: vec![], boards: vec![] });
    }
}

#[cfg(any(target_os = "ios", target_os = "macos"))]
mod apple {
    use super::*;
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    /// `URLForUbiquityContainerIdentifier` may block while iCloud sets the
    /// container up, and Apple asks that it never run on the main thread —
    /// which is where Tauri runs a synchronous command. So it runs on its own
    /// thread, and the caller waits a bounded time for the answer. A found
    /// container is remembered; "not available" is asked again next time,
    /// since the user may have signed in meanwhile.
    pub fn container_documents() -> Option<PathBuf> {
        use std::sync::Mutex;
        static FOUND: Mutex<Option<PathBuf>> = Mutex::new(None);
        if let Some(p) = FOUND.lock().ok().and_then(|g| g.clone()) {
            return Some(p);
        }
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let found = objc2::rc::autoreleasepool(|_| {
                let fm = NSFileManager::defaultManager();
                let id = NSString::from_str(CONTAINER_ID);
                fm.URLForUbiquityContainerIdentifier(Some(&id)).and_then(|u| u.to_file_path())
            });
            let _ = tx.send(found);
        });
        let root = rx.recv_timeout(Duration::from_secs(4)).ok().flatten()?;
        let docs = root.join("Documents");
        std::fs::create_dir_all(&docs).ok()?;
        if let Ok(mut g) = FOUND.lock() {
            *g = Some(docs.clone());
        }
        Some(docs)
    }

    /// `startDownloadingUbiquitousItemAtURL` takes the item's own URL, not
    /// the placeholder's, and returns at once; the file appears when it is
    /// done. Errors (not in iCloud, offline) are left for the next round.
    pub fn download(paths: &[PathBuf]) {
        let paths = paths.to_vec();
        std::thread::spawn(move || {
            objc2::rc::autoreleasepool(|_| {
                let fm = NSFileManager::defaultManager();
                for p in &paths {
                    if let Some(url) = NSURL::from_file_path(p) {
                        let _ = fm.startDownloadingUbiquitousItemAtURL_error(&url);
                    }
                }
            });
        });
    }
}
