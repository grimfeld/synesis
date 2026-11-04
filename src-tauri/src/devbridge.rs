//! Debug-only HTTP bridge: lets the React app run in an ordinary browser
//! (`vite` on :1420) against the live engine, for UI work and automated
//! smoke tests. POST /invoke/<command> with a JSON body of arguments.
//! Compiled only in debug builds; binds to localhost only.
//!
//! Binding to localhost does not keep other websites out: any page open in
//! the developer's browser can send requests to 127.0.0.1, and the dev build
//! shares the installed app's settings and open Vault. So every request is
//! checked first (`admit`): the `Host` must be this bridge (which defeats DNS
//! rebinding, where a hostile name resolves to 127.0.0.1), a browser's
//! `Origin` must be the Vite dev server, and a POST must say
//! `Content-Type: application/json`, which no cross-site form can send and
//! which makes a browser ask first (a preflight that only the dev server's
//! origin passes). Node scripts (Cypress's `cy.request`, ui-smoke,
//! site-screenshots) send no `Origin` and are let through: a local process
//! can read the Vault's files directly anyway.

use crate::*;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use tauri::Manager;

pub const PORT: u16 = 4321;

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[devbridge] not started: {e}");
                return;
            }
        };
        eprintln!("[devbridge] listening on http://127.0.0.1:{PORT}/invoke/<command>");
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || handle(stream, app));
        }
    });
}

/// The origins of the Vite dev server (`devUrl` in tauri.conf.json), the
/// only web pages allowed to call the bridge.
const ALLOWED_ORIGINS: [&str; 2] = ["http://localhost:1420", "http://127.0.0.1:1420"];

/// What `admit` decided about a request.
#[derive(Debug, PartialEq)]
enum Admission {
    /// Answer it; `origin` is echoed in `Access-Control-Allow-Origin` (none
    /// for a request with no `Origin`, which is not a browser's).
    Allow { origin: Option<String> },
    /// Refuse it with 403 and this reason.
    Deny(&'static str),
}

/// The value of header `name` in a request head, if present.
fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().skip(1).find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.trim().eq_ignore_ascii_case(name).then(|| v.trim())
    })
}

/// Whether a request may reach the engine (see the module comment).
fn admit(method: &str, head: &str) -> Admission {
    let host_ok = header(head, "host")
        .map(|h| {
            h.eq_ignore_ascii_case(&format!("127.0.0.1:{PORT}")) || h.eq_ignore_ascii_case(&format!("localhost:{PORT}"))
        })
        .unwrap_or(false);
    if !host_ok {
        return Admission::Deny("unexpected Host");
    }
    let origin = match header(head, "origin") {
        None => None,
        Some(o) if ALLOWED_ORIGINS.contains(&o) => Some(o.to_string()),
        Some(_) => return Admission::Deny("origin not allowed"),
    };
    match method {
        "OPTIONS" => Admission::Allow { origin },
        "POST" => {
            let json = header(head, "content-type")
                .map(|c| c.split(';').next().unwrap_or("").trim().eq_ignore_ascii_case("application/json"))
                .unwrap_or(false);
            if json {
                Admission::Allow { origin }
            } else {
                Admission::Deny("Content-Type must be application/json")
            }
        }
        _ => Admission::Deny("only POST"),
    }
}

fn respond(stream: &mut TcpStream, status: u16, origin: Option<&str>, body: &str) {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        403 => "Forbidden",
        _ => "Error",
    };
    let cors = match origin {
        Some(o) => format!(
            "Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\n"
        ),
        None => String::new(),
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\n{cors}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
}

fn handle(mut stream: TcpStream, app: AppHandle) {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 8192];
    let (head_end, mut content_length) = loop {
        let n = match stream.read(&mut tmp) {
            Ok(0) | Err(_) => return,
            Ok(n) => n,
        };
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&buf[..pos]).to_string();
            let len = head
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                })
                .unwrap_or(0);
            break (pos + 4, len);
        }
    };
    while buf.len() < head_end + content_length {
        let n = match stream.read(&mut tmp) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        buf.extend_from_slice(&tmp[..n]);
        content_length = content_length.min(buf.len() - head_end).max(content_length);
    }
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let first = head.lines().next().unwrap_or_default().to_string();
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    let origin = match admit(method, &head) {
        Admission::Allow { origin } => origin,
        Admission::Deny(why) => {
            eprintln!("[devbridge] refused {method} {path}: {why}");
            respond(&mut stream, 403, None, &json!({ "error": why }).to_string());
            return;
        }
    };
    let origin = origin.as_deref();
    if method == "OPTIONS" {
        respond(&mut stream, 204, origin, "");
        return;
    }
    let cmd = path.strip_prefix("/invoke/").unwrap_or("").to_string();
    let body = &buf[head_end..(head_end + content_length).min(buf.len())];
    let args: Value = serde_json::from_slice(body).unwrap_or(json!({}));
    match dispatch(&app, &cmd, args) {
        Ok(v) => respond(&mut stream, 200, origin, &v.to_string()),
        Err(e) => respond(&mut stream, 500, origin, &json!({ "error": e }).to_string()),
    }
}

fn arg<T: serde::de::DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("bad argument {key}: {e}"))
}

fn ok<T: Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

fn no_window(cmd: &str) -> Result<Value, String> {
    Err(format!("{cmd} needs a Tauri window"))
}

fn dispatch(app: &AppHandle, cmd: &str, a: Value) -> Result<Value, String> {
    let state = app.state::<AppState>();
    match cmd {
        "get_settings" => ok(get_settings(state)?),
        "set_language" => ok(set_language(state, arg(&a, "lang")?)?),
        "set_device_appearance" => ok(set_device_appearance(state, arg(&a, "mode")?, arg(&a, "textScale")?)?),
        "set_graph_level" => ok(set_graph_level(state, arg(&a, "level")?)?),
        "set_timeline_filters" => ok(set_timeline_filters(state, arg(&a, "hiddenTypes")?, arg(&a, "inView")?)?),
        "set_map_filters" => ok(set_map_filters(state, arg(&a, "books")?, arg(&a, "mentionedOnly")?, arg(&a, "colorBy")?)?),
        "set_sync_method" => ok(set_sync_method(state, arg(&a, "method")?)?),
        "leave_vault" => ok(leave_vault(app.clone(), state, arg(&a, "id")?, arg(&a, "deleteDocuments")?)?),
        "forget_device" => ok(forget_device(state, arg(&a, "device")?)?),
        "pairing_status" => ok(tauri::async_runtime::block_on(crate::pairing::pairing_status(state))?),
        "pairing_invite" => ok(tauri::async_runtime::block_on(crate::pairing::pairing_invite(app.clone(), state))?),
        "pairing_revoke_invite" => ok(tauri::async_runtime::block_on(crate::pairing::pairing_revoke_invite(app.clone(), state))?),
        "pairing_join" => ok(tauri::async_runtime::block_on(crate::pairing::pairing_join(app.clone(), state, arg(&a, "code")?, arg(&a, "path")?))?),
        "pairing_approve" => ok(tauri::async_runtime::block_on(crate::pairing::pairing_approve(state, arg(&a, "node")?, arg(&a, "allow")?))?),
        "pairing_remove" => ok(tauri::async_runtime::block_on(crate::pairing::pairing_remove(state, arg(&a, "node")?))?),
        "pairing_stop" => ok(tauri::async_runtime::block_on(crate::pairing::pairing_stop(state))?),
        "pairing_sync_now" => ok(tauri::async_runtime::block_on(crate::pairing::pairing_sync_now(state))?),
        "set_relay" => ok(tauri::async_runtime::block_on(crate::pairing::set_relay(app.clone(), state, arg(&a, "url")?))?),
        "set_background_sync" => ok(crate::pairing::set_background_sync(state, arg(&a, "enabled")?)?),
        "set_check_updates" => ok(set_check_updates(state, arg(&a, "enabled")?)?),
        // Phone system bars: nothing to colour behind a desktop browser.
        "set_system_bars" => ok(()),
        "sync_status" => ok(sync_status(state)?),
        "sync_locations" => ok(sync_locations(app.clone(), state)?),
        "storage_access" => ok(crate::storage::storage_access(app.clone())?),
        "request_storage_access" => ok(crate::storage::request_storage_access(app.clone())?),
        "open_vault" => ok(open_vault(app.clone(), state, arg(&a, "path")?)?),
        "close_vault" => ok(close_vault(app.clone(), state)?),
        "forget_vault" => ok(forget_vault(state, arg(&a, "id")?)?),
        "move_vault" => ok(move_vault(app.clone(), state, arg(&a, "id")?)?),
        "hidden_vaults" => ok(hidden_vaults(app.clone(), state)?),
        "rename_vault" => ok(rename_vault(state, arg(&a, "name")?)?),
        "suggest_vault_path" => ok(suggest_vault_path(app.clone(), arg(&a, "name")?, arg(&a, "method")?)?),
        "inspect_invite" => ok(inspect_invite(arg(&a, "code")?, arg(&a, "path")?)?),
        "vault_info" => ok(vault_info(state)?),
        "rescan" => ok(rescan(state)?),
        // One arm for every read the index answers: a new question is a
        // `Query` variant, not another line here that someone forgets.
        "query" => ok(query(state, arg(&a, "query")?)?),
        "get_document" => ok(get_document(state, arg(&a, "id")?)?),
        "save_document" => ok(save_document(state, app.state::<crate::windows::WindowState>(), arg(&a, "id")?, arg(&a, "text")?)?),
        "create_document" => ok(create_document(
            state,
            arg(&a, "docType")?,
            arg(&a, "title")?,
            arg(&a, "fields")?,
            arg(&a, "body")?,
        )?),
        "rename_document" => ok(rename_document(state, arg(&a, "id")?, arg(&a, "title")?)?),
        "duplicate_composition" => ok(duplicate_composition(state, arg(&a, "id")?, arg(&a, "title")?)?),
        "delete_document" => ok(delete_document(state, arg(&a, "id")?)?),
        "resolve_link" => ok(resolve_link(state, arg(&a, "target")?)?),
        "resolve_many" => ok(resolve_many(state, arg(&a, "targets")?)?),
        "names" => ok(names(state)?),
        "linkables" => ok(linkables(state, arg(&a, "id")?, arg(&a, "text")?)?),
        "link_mentions" => ok(link_mentions(
            state,
            arg(&a, "targetId")?,
            arg(&a, "mentions")?,
        )?),
        "undo_link_mentions" => ok(undo_link_mentions(state, arg(&a, "texts")?)?),
        "fill_kinds" => ok(fill_kinds(state, arg(&a, "fills")?)?),
        "save_border" => ok(save_border(state, arg(&a, "id")?, arg(&a, "corners")?)?),
        "import_border" => ok(import_border(
            state,
            arg(&a, "id")?,
            arg(&a, "fileName")?,
            arg(&a, "text")?,
        )?),
        "delete_border" => ok(delete_border(state, arg(&a, "id")?)?),
        "ensure_scripture_page" => ok(ensure_scripture_page(
            state,
            arg(&a, "book")?,
            arg(&a, "chapter")?,
            arg(&a, "verse")?,
        )?),
        "property_schema" => ok(property_schema(state)?),
        "set_property_type" => ok(set_property_type(
            state,
            arg(&a, "name")?,
            arg(&a, "propType")?,
        )?),
        "skins" => ok(skins(state)?),
        "save_skin" => ok(save_skin(state, arg(&a, "skin")?)?),
        "delete_skin" => ok(delete_skin(state, arg(&a, "id")?)?),
        "read_skin_file" => ok(read_skin_file(arg(&a, "path")?)?),
        "export_skin" => ok(export_skin(arg(&a, "skin")?, arg(&a, "path")?)?),
        "appearance" => ok(appearance(state)?),
        "set_appearance" => ok(set_appearance(state, arg(&a, "appearance")?)?),
        "place_kinds" => ok(place_kinds(state)?),
        "set_place_kinds" => ok(set_place_kinds(state, arg(&a, "kinds")?)?),
        "gazetteer" => ok(gazetteer(arg(&a, "query")?, arg(&a, "limit")?)),
        "versions" => ok(versions(state, arg(&a, "id")?)?),
        "save_version" => ok(save_version(state, arg(&a, "id")?, arg(&a, "label")?)?),
        "delete_version" => ok(delete_version(state, arg(&a, "id")?, arg(&a, "key")?)?),
        "text_at" => ok(text_at(state, arg(&a, "id")?, arg(&a, "frontier")?)?),
        "history" => ok(history(state, arg(&a, "id")?)?),
        "get_board" => ok(get_board(state, arg(&a, "id")?)?),
        "save_board" => ok(save_board(state, arg(&a, "id")?, arg(&a, "board")?)?),
        "export_board" => ok(export_board(arg(&a, "path")?, arg(&a, "data")?, arg(&a, "base64")?)?),
        "board_at" => ok(board_at(state, arg(&a, "id")?, arg(&a, "frontier")?)?),
        // `sourceId` is optional: absent means every Clipping in the vault.
        "attach_image" => ok(attach_image(state, arg(&a, "title")?, arg(&a, "path")?)?),
        "read_attachment" => ok(read_attachment(state, arg(&a, "path")?)?),
        "attach_picture" => ok(attach_picture(state, arg(&a, "title")?, arg(&a, "name")?, arg(&a, "data")?)?),
        "read_picture" => ok(read_picture(state, arg(&a, "target")?)?),
        "save_remote_cover" => ok(tauri::async_runtime::block_on(save_remote_cover(
            app.clone(),
            arg(&a, "title")?,
            arg(&a, "url")?,
        ))?),
        "find_source_by_url" => ok(find_source_by_url(state, arg(&a, "url")?)?),
        "detect_passages" => ok(detect_passages(state, arg(&a, "text")?)?),
        "read_date" => ok(read_date(arg(&a, "text")?)),
        "books" => ok(books(state)?),
        "fetch_url_metadata" => ok(tauri::async_runtime::block_on(fetch_url_metadata(arg(
            &a, "url",
        )?))?),
        "skin_gallery" => ok(tauri::async_runtime::block_on(skin_gallery())?),
        "gallery_skin" => ok(tauri::async_runtime::block_on(gallery_skin(arg(&a, "file")?))?),
        "hidden_dir" => ok(hidden_dir()),
        "ui_log" => {
            ui_log(arg(&a, "level")?, arg(&a, "message")?);
            ok(())
        }
        // Windows (src-tauri/src/windows.rs) are Tauri windows: a page in a
        // plain browser is none. They answer an error, as they did (with
        // "unknown command") before they had arms here.
        "open_window" => no_window(cmd),
        "window_start" => no_window(cmd),
        "doc_join" => no_window(cmd),
        "doc_sync" => no_window(cmd),
        "doc_leave" => no_window(cmd),
        "close_other_windows" => no_window(cmd),
        "window_flushed" => no_window(cmd),
        "flush_all_windows" => no_window(cmd),
        other => Err(format!("unknown command {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::{admit, Admission};

    fn head(lines: &[&str]) -> String {
        let mut h = String::from("POST /invoke/get_settings HTTP/1.1");
        for l in lines {
            h.push_str("\r\n");
            h.push_str(l);
        }
        h
    }

    fn allowed(origin: Option<&str>) -> Admission {
        Admission::Allow { origin: origin.map(str::to_string) }
    }

    #[test]
    fn the_dev_server_and_node_scripts_are_let_in() {
        let page = head(&["Host: 127.0.0.1:4321", "Origin: http://localhost:1420", "Content-Type: application/json"]);
        assert_eq!(admit("POST", &page), allowed(Some("http://localhost:1420")));
        let page = head(&[
            "host: localhost:4321",
            "origin: http://127.0.0.1:1420",
            "content-type: application/json; charset=utf-8",
        ]);
        assert_eq!(admit("POST", &page), allowed(Some("http://127.0.0.1:1420")));
        let node = head(&["Host: 127.0.0.1:4321", "Content-Type: application/json"]);
        assert_eq!(admit("POST", &node), allowed(None));
        let preflight = head(&["Host: 127.0.0.1:4321", "Origin: http://localhost:1420"]);
        assert_eq!(admit("OPTIONS", &preflight), allowed(Some("http://localhost:1420")));
    }

    /// #60: any website open in the browser could drive the engine.
    #[test]
    fn another_website_is_refused() {
        for origin in ["https://evil.example", "http://localhost:1421", "null", "http://localhost:1420.evil.example"] {
            let origin_line = format!("Origin: {origin}");
            let h = head(&["Host: 127.0.0.1:4321", &origin_line, "Content-Type: application/json"]);
            assert!(matches!(admit("POST", &h), Admission::Deny(_)), "{origin}");
            assert!(matches!(admit("OPTIONS", &h), Admission::Deny(_)), "{origin} preflight");
        }
    }

    /// DNS rebinding: a hostile name resolving to 127.0.0.1 makes the page
    /// same-origin with the bridge, but its Host header still names it.
    #[test]
    fn a_rebound_host_is_refused() {
        let h = head(&["Host: evil.example:4321", "Content-Type: application/json"]);
        assert!(matches!(admit("POST", &h), Admission::Deny(_)));
        let h = head(&["Content-Type: application/json"]);
        assert!(matches!(admit("POST", &h), Admission::Deny(_)));
    }

    /// A cross-site form can POST text/plain without a preflight.
    #[test]
    fn a_post_that_is_not_json_is_refused() {
        let h = head(&["Host: 127.0.0.1:4321", "Content-Type: text/plain"]);
        assert!(matches!(admit("POST", &h), Admission::Deny(_)));
        let h = head(&["Host: 127.0.0.1:4321"]);
        assert!(matches!(admit("POST", &h), Admission::Deny(_)));
        let h = head(&["Host: 127.0.0.1:4321", "Content-Type: application/json"]);
        assert!(matches!(admit("GET", &h), Admission::Deny(_)));
    }
    /// A Tauri command exists in three places: its `fn`, `generate_handler!`
    /// and this bridge's hand-written dispatch. The bridge is the one that gets
    /// forgotten, and then every spec that reaches the command fails with
    /// "unknown command" for reasons that have nothing to do with the view.
    #[test]
    fn every_command_has_a_bridge_arm() {
        let lib = include_str!("lib.rs");
        let bridge = include_str!("devbridge.rs");
        let start = lib.find("generate_handler![").expect("handler list") + "generate_handler![".len();
        let end = start + lib[start..].find(']').expect("end of handler list");
        let missing: Vec<&str> = lib[start..end]
            .split(',')
            .map(|c| c.trim())
            .filter(|c| !c.is_empty() && !c.starts_with('#'))
            .map(|c| c.rsplit("::").next().unwrap())
            .filter(|c| !bridge.contains(&format!("\"{c}\" =>")))
            .collect();
        assert!(missing.is_empty(), "no devbridge arm for {missing:?}");
    }
}
