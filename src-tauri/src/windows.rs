//! Desktop Windows (spec #35, issue #51). "Open in new Window" asks for a
//! separate app Window on one document; each Window has its own Panes, and
//! an edit made in one reaches the others showing the same document through
//! `relay_edit`. The bookkeeping is `engine::windows`; this sends.

use engine::windows::Windows;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct WindowState(pub Mutex<Windows>);

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// An edit from another Window, as `doc:edited` carries it.
#[derive(Clone, Serialize)]
struct Edited<'a> {
    id: &'a str,
    text: &'a str,
}

/// Open `id` in a new Window. Desktop only.
#[tauri::command]
pub fn open_window(app: AppHandle, state: State<WindowState>, id: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let label = state.0.lock().map_err(err)?.create(&id);
        let built = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("Synesis")
            .inner_size(1100.0, 800.0)
            .min_inner_size(720.0, 480.0)
            .disable_drag_drop_handler()
            .build();
        if let Err(e) = built {
            state.0.lock().map_err(err)?.forget(&label);
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
    Ok(state.0.lock().map_err(err)?.take_start(window.label()))
}

/// The documents this Window's Panes now hold open.
#[tauri::command]
pub fn show_documents(window: tauri::Window, state: State<WindowState>, ids: Vec<String>) -> Result<(), String> {
    state.0.lock().map_err(err)?.show(window.label(), ids);
    Ok(())
}

/// An edit made in this Window: pass it to every other Window showing `id`.
#[tauri::command]
pub fn relay_edit(
    app: AppHandle,
    window: tauri::Window,
    state: State<WindowState>,
    id: String,
    text: String,
) -> Result<(), String> {
    let to = state.0.lock().map_err(err)?.recipients(window.label(), &id);
    for label in to {
        app.emit_to(label.as_str(), "doc:edited", Edited { id: &id, text: &text })
            .map_err(err)?;
    }
    Ok(())
}

/// A Window closed: it shows nothing any more.
pub fn closed(app: &AppHandle, label: &str) {
    if let Some(s) = app.try_state::<WindowState>() {
        if let Ok(mut w) = s.0.lock() {
            w.forget(label);
        }
    }
}
