//! Desktop Windows (spec #35, issue #51). "Open in new Window" asks for a
//! separate app Window on one document; each Window has its own Panes. The
//! Windows showing one document keep its text the same through a session in
//! `engine::windows`, which orders their changes; this sends the events.
//!
//! No typing may be lost to a Window going away: a secondary Window saves as
//! it closes (in the UI); before the Vault changes, the other Windows save
//! and close (`close_other_windows`); before the app quits, every Window
//! saves (`flush_all_then`).

use crate::err;
use engine::windows::{Exit, ExitGate, Joined, SyncReply, SyncRequest, Windows, MAIN};
use serde::Serialize;
use std::collections::BTreeSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct WindowState {
    windows: Mutex<Windows>,
    /// The Windows asked to save before the app quits that have not answered yet.
    flushing: Mutex<BTreeSet<String>>,
    /// The app quits once, after the Windows saved.
    exit: Mutex<ExitGate>,
}

/// How long the app waits for its Windows to save before it goes on anyway.
const FLUSH_WAIT: Duration = Duration::from_secs(4);

#[derive(Clone, Serialize)]
struct Poke<'a> {
    id: &'a str,
}

/// Open `id` in a new Window. Desktop only.
#[tauri::command]
pub fn open_window(app: AppHandle, state: State<WindowState>, id: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let label = state.windows.lock().map_err(err)?.create(&id);
        let built = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("Synesis")
            .inner_size(1100.0, 800.0)
            .min_inner_size(720.0, 480.0)
            .disable_drag_drop_handler()
            .build();
        if let Err(e) = built {
            state.windows.lock().map_err(err)?.forget(&label);
            return Err(err(e));
        }
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, state, id);
        Err("Windows are desktop only".into())
    }
}

/// The document this Window was opened on, if it is a new Window just opening.
#[tauri::command]
pub fn window_start(window: tauri::Window, state: State<WindowState>) -> Result<Option<String>, String> {
    Ok(state.windows.lock().map_err(err)?.take_start(window.label()))
}

/// This Window shows `id`, which it read as `text`.
#[tauri::command]
pub fn doc_join(
    window: tauri::Window,
    state: State<WindowState>,
    id: String,
    client: u64,
    text: String,
) -> Result<Joined, String> {
    Ok(state.windows.lock().map_err(err)?.join(window.label(), client, &id, &text))
}

/// This Window no longer shows `id`.
#[tauri::command]
pub fn doc_leave(window: tauri::Window, state: State<WindowState>, id: String, client: u64) -> Result<(), String> {
    state.windows.lock().map_err(err)?.leave(window.label(), client, &id);
    Ok(())
}

/// A change made in this Window, or the file as it read it, or just "what did I miss".
#[tauri::command]
pub fn doc_sync(
    app: AppHandle,
    window: tauri::Window,
    state: State<WindowState>,
    req: SyncRequest,
) -> Result<SyncReply, String> {
    let id = req.id.clone();
    let (reply, to) = {
        let mut w = state.windows.lock().map_err(err)?;
        let (reply, changed) = w.sync(window.label(), req)?;
        (reply, if changed { w.others(window.label(), &id) } else { Vec::new() })
    };
    for label in to {
        let _ = app.emit_to(label.as_str(), "doc:poke", Poke { id: &id });
    }
    Ok(reply)
}

/// A Window saved `id` as `text`: the watcher's echo of it is no edit from outside.
pub fn saved(state: &WindowState, id: &str, text: &str) {
    if let Ok(mut w) = state.windows.lock() {
        w.saved(id, text);
    }
}

/// The Vault changed (opened, closed, left): every session ends.
pub fn vault_changed(app: &AppHandle) {
    if let Some(s) = app.try_state::<WindowState>() {
        if let Ok(mut w) = s.windows.lock() {
            w.vault_changed();
        }
    }
}

/// A Window closed: it shows nothing any more.
pub fn closed(app: &AppHandle, label: &str) {
    if let Some(s) = app.try_state::<WindowState>() {
        if let Ok(mut w) = s.windows.lock() {
            w.forget(label);
        }
        if let Ok(mut f) = s.flushing.lock() {
            f.remove(label);
        }
    }
}

/// Before the main Window changes the Vault: every other Window saves what
/// is pending and closes (`windows:close`, in the UI). One that does not
/// within a few seconds is closed anyway.
#[tauri::command]
pub async fn close_other_windows(app: AppHandle) -> Result<(), String> {
    let others = || -> Vec<String> {
        app.webview_windows().into_keys().filter(|l| l != MAIN).collect()
    };
    for label in others() {
        let _ = app.emit_to(label.as_str(), "windows:close", ());
    }
    let start = Instant::now();
    while !others().is_empty() && start.elapsed() < FLUSH_WAIT {
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    for label in others() {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.destroy();
        }
    }
    Ok(())
}

/// A Window has saved what was pending, as `flush_all_then` asked.
#[tauri::command]
pub fn window_flushed(window: tauri::Window, state: State<WindowState>) -> Result<(), String> {
    state.flushing.lock().map_err(err)?.remove(window.label());
    Ok(())
}

/// Ask every Window to save what is pending (`windows:flush`).
fn ask_to_flush(app: &AppHandle) {
    let labels: BTreeSet<String> = app.webview_windows().into_keys().collect();
    if let Some(s) = app.try_state::<WindowState>() {
        if let Ok(mut f) = s.flushing.lock() {
            *f = labels.clone();
        }
    }
    for label in &labels {
        let _ = app.emit_to(label.as_str(), "windows:flush", ());
    }
}

/// Whether a Window asked by `ask_to_flush` has not answered yet.
fn still_flushing(app: &AppHandle) -> bool {
    app.try_state::<WindowState>()
        .and_then(|s| s.flushing.lock().ok().map(|f| !f.is_empty()))
        .unwrap_or(false)
}

/// Have every Window save what is pending, wait for them (a few seconds at
/// most), then run `then`: before the app quits. The exit `then` makes is let
/// through (`exit_requested`).
pub fn flush_all_then(app: &AppHandle, then: impl FnOnce(&AppHandle) + Send + 'static) {
    ask_to_flush(app);
    let app = app.clone();
    std::thread::spawn(move || {
        let start = Instant::now();
        while still_flushing(&app) && start.elapsed() < FLUSH_WAIT {
            std::thread::sleep(Duration::from_millis(30));
        }
        if let Some(s) = app.try_state::<WindowState>() {
            if let Ok(mut g) = s.exit.lock() {
                g.saved();
            }
        }
        then(&app);
    });
}

/// The app was asked to quit (Cmd+Q, the app menu, `app.exit`): the first
/// request is held while every Window saves, then the app quits with `code`.
pub fn exit_requested(app: &AppHandle, code: Option<i32>, prevent: impl FnOnce()) {
    let decision = app
        .try_state::<WindowState>()
        .and_then(|s| s.exit.lock().ok().map(|mut g| g.request()))
        .unwrap_or(Exit::Allow);
    match decision {
        Exit::Allow => {}
        Exit::Wait => prevent(),
        Exit::Flush => {
            prevent();
            flush_all_then(app, move |app| app.exit(code.unwrap_or(0)));
        }
    }
}

/// Every Window saves what is pending (a few seconds at most): before an
/// update is installed, since the installer may close the app itself.
#[tauri::command]
pub async fn flush_all_windows(app: AppHandle) -> Result<(), String> {
    ask_to_flush(&app);
    let start = Instant::now();
    while still_flushing(&app) && start.elapsed() < FLUSH_WAIT {
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    Ok(())
}
