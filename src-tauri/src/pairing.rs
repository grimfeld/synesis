//! Pairing (ADR 0008): runs the engine's peer-to-peer node for the open vault,
//! forwards its events to the UI as `pairing:event`, and keeps the desktop
//! app alive in the tray so a closed window still syncs.
use crate::{err, AppState, CmdResult};
use engine::p2p::{Event, Invite, Member, Node, NodeId, Status};
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

fn parse_node(hex_id: &str) -> CmdResult<NodeId> {
    let bytes = hex::decode(hex_id).map_err(err)?;
    <[u8; 32]>::try_from(bytes).map_err(|_| "bad node id".to_string())
}

/// Start the node for the open vault (no-op when already running).
pub async fn ensure_started(app: &AppHandle, state: &AppState) -> CmdResult<Arc<Node>> {
    if let Some(n) = state.p2p.lock().map_err(err)?.clone() {
        return Ok(n);
    }
    // Every document needs a snapshot before another Device can receive it.
    state.with_vault_mut(|v| v.publish_missing())?;
    let (root, device_id) = state.with_vault(|v| Ok((v.root().to_path_buf(), v.device_id().unwrap_or("device").to_string())))?;
    let data_dir = app.path().app_data_dir().map_err(err)?;
    let local_dir = engine::vault::local_dir_for(&data_dir, &root);
    let (name, platform) = engine::sync::this_device();
    let me = Member { node: [0; 32], device_id, name, platform };
    let relay = state.settings.lock().map_err(err)?.relay_url.clone();
    let (tx, mut rx) = mpsc::channel::<Event>(256);
    let forward = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            // Snapshots that just arrived: merge and materialise them now rather
            // than waiting for the file watcher (which mobile may not deliver).
            if let Event::Synced { .. } = ev {
                let state = forward.state::<AppState>();
                if let Ok(changed) = state.with_vault_mut(|v| v.apply_remote()) {
                    if !changed.is_empty() {
                        let _ = forward.emit("vault:changed", crate::watch::ChangedPayload { changed, removed: vec![] });
                    }
                }
            }
            let _ = forward.emit("pairing:event", &ev);
        }
    });
    let node = Node::start(&root, &data_dir.join("device"), &local_dir, me, relay, tx).await.map_err(err)?;
    *state.p2p.lock().map_err(err)? = Some(node.clone());
    Ok(node)
}

/// After a vault opens: start the node when this Device is already paired for it.
pub fn autostart(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let paired = (|| -> CmdResult<bool> {
            let root = state.with_vault(|v| Ok(v.root().to_path_buf()))?;
            let data_dir = app.path().app_data_dir().map_err(err)?;
            let local = engine::vault::local_dir_for(&data_dir, &root);
            Ok(local.join("pairing.json").exists())
        })()
        .unwrap_or(false);
        if paired {
            let _ = ensure_started(&app, &state).await;
        }
    });
}

pub async fn stop(state: &AppState) {
    let node = state.p2p.lock().ok().and_then(|mut g| g.take());
    if let Some(n) = node {
        n.shutdown().await;
    }
}

/// After a document was written: make sure it has a snapshot, then push.
pub fn after_write(state: &AppState) {
    let _ = state.with_vault_mut(|v| v.publish_missing());
    notify(state);
}

#[tauri::command]
pub async fn pairing_sync_now(state: tauri::State<'_, AppState>) -> CmdResult<Option<Status>> {
    let _ = state.with_vault_mut(|v| v.publish_missing());
    let n = state.p2p.lock().map_err(err)?.clone();
    Ok(n.map(|n| {
        n.notify_changed();
        n.status()
    }))
}

/// Something local changed: push it to connected peers now.
pub fn notify(state: &AppState) {
    if let Ok(g) = state.p2p.lock() {
        if let Some(n) = g.as_ref() {
            n.notify_changed();
        }
    }
}

// ------------------------------------------------------------------ commands

#[derive(Serialize)]
pub struct InvitePayload {
    pub code: String,
}

#[tauri::command]
pub async fn pairing_status(state: tauri::State<'_, AppState>) -> CmdResult<Option<Status>> {
    Ok(state.p2p.lock().map_err(err)?.as_ref().map(|n| n.status()))
}

#[tauri::command]
pub async fn pairing_invite(app: AppHandle, state: tauri::State<'_, AppState>) -> CmdResult<InvitePayload> {
    let node = ensure_started(&app, &state).await?;
    Ok(InvitePayload { code: node.invite().encode() })
}

#[tauri::command]
pub async fn pairing_revoke_invite(app: AppHandle, state: tauri::State<'_, AppState>) -> CmdResult<InvitePayload> {
    let node = ensure_started(&app, &state).await?;
    node.revoke_invite();
    Ok(InvitePayload { code: node.invite().encode() })
}

/// Join a vault from an Invite: create the vault folder at `path`, open it, and ask to join.
#[tauri::command]
pub async fn pairing_join(app: AppHandle, state: tauri::State<'_, AppState>, code: String, path: String) -> CmdResult<Status> {
    let invite = Invite::decode(&code).ok_or("not a pairing code")?;
    stop(&state).await;
    crate::do_open_vault(app.clone(), &state, Some(path))?;
    let node = ensure_started(&app, &state).await?;
    node.join(invite);
    Ok(node.status())
}

#[tauri::command]
pub async fn pairing_approve(state: tauri::State<'_, AppState>, node: String, allow: bool) -> CmdResult<bool> {
    let id = parse_node(&node)?;
    let n = state.p2p.lock().map_err(err)?.clone().ok_or("pairing not running")?;
    Ok(n.approve(&id, allow))
}

#[tauri::command]
pub async fn pairing_remove(state: tauri::State<'_, AppState>, node: String) -> CmdResult<()> {
    let id = parse_node(&node)?;
    let n = state.p2p.lock().map_err(err)?.clone().ok_or("pairing not running")?;
    n.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn pairing_stop(state: tauri::State<'_, AppState>) -> CmdResult<()> {
    stop(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn set_relay(app: AppHandle, state: tauri::State<'_, AppState>, url: Option<String>) -> CmdResult<()> {
    let url = url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
    state.settings.lock().map_err(err)?.relay_url = url;
    state.save_settings()?;
    // Restart with the new relay when running.
    let running = state.p2p.lock().map_err(err)?.is_some();
    if running {
        stop(&state).await;
        ensure_started(&app, &state).await?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_background_sync(state: tauri::State<'_, AppState>, enabled: bool) -> CmdResult<()> {
    state.settings.lock().map_err(err)?.background_sync = enabled;
    state.save_settings()
}

// ---------------------------------------------------------------------- tray

/// Desktop: closing the window hides it while pairing runs; the tray icon brings it back.
#[cfg(desktop)]
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    let open = MenuItem::with_id(app, "open", "Open Synesis", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main").menu(&menu).tooltip("Synesis").on_menu_event(|app, e| match e.id().as_ref() {
        "open" => show_main(app),
        "quit" => {
            let state = app.state::<AppState>();
            state.quitting.store(true, std::sync::atomic::Ordering::SeqCst);
            app.exit(0);
        }
        _ => {}
    });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(desktop)]
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// True when the window should hide instead of closing.
#[cfg(desktop)]
pub fn keep_in_background(state: &AppState) -> bool {
    if state.quitting.load(std::sync::atomic::Ordering::SeqCst) {
        return false;
    }
    let bg = state.settings.lock().map(|s| s.background_sync).unwrap_or(true);
    let running = state.p2p.lock().map(|g| g.is_some()).unwrap_or(false);
    bg && running
}
