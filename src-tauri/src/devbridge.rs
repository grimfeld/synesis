//! Debug-only HTTP bridge: lets the React app run in an ordinary browser
//! (`vite` on :1420) against the live engine, for UI work and automated
//! smoke tests. POST /invoke/<command> with a JSON body of arguments.
//! Compiled only in debug builds; binds to localhost only.

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

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = if status == 200 {
        "OK"
    } else if status == 204 {
        "No Content"
    } else {
        "Error"
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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
    if method == "OPTIONS" {
        respond(&mut stream, 204, "");
        return;
    }
    let cmd = path.strip_prefix("/invoke/").unwrap_or("").to_string();
    let body = &buf[head_end..(head_end + content_length).min(buf.len())];
    let args: Value = serde_json::from_slice(body).unwrap_or(json!({}));
    match dispatch(&app, &cmd, args) {
        Ok(v) => respond(&mut stream, 200, &v.to_string()),
        Err(e) => respond(&mut stream, 500, &json!({ "error": e }).to_string()),
    }
}

fn arg<T: serde::de::DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("bad argument {key}: {e}"))
}

fn ok<T: Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

fn dispatch(app: &AppHandle, cmd: &str, a: Value) -> Result<Value, String> {
    let state = app.state::<AppState>();
    match cmd {
        "get_settings" => ok(get_settings(state)?),
        "set_language" => ok(set_language(state, arg(&a, "lang")?)?),
        "set_graph_level" => ok(set_graph_level(state, arg(&a, "level")?)?),
        "set_sync_method" => ok(set_sync_method(state, arg(&a, "method")?)?),
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
        "sync_status" => ok(sync_status(state)?),
        "sync_locations" => ok(sync_locations(app.clone(), state)?),
        "open_vault" => ok(open_vault(app.clone(), state, arg(&a, "path")?)?),
        "close_vault" => ok(close_vault(state)?),
        "vault_info" => ok(vault_info(state)?),
        "rescan" => ok(rescan(state)?),
        "list_documents" => ok(list_documents(state, arg(&a, "docType")?)?),
        "get_document" => ok(get_document(state, arg(&a, "id")?)?),
        "save_document" => ok(save_document(state, arg(&a, "id")?, arg(&a, "text")?)?),
        "create_document" => ok(create_document(
            state,
            arg(&a, "docType")?,
            arg(&a, "title")?,
            arg(&a, "fields")?,
            arg(&a, "body")?,
        )?),
        "rename_document" => ok(rename_document(state, arg(&a, "id")?, arg(&a, "title")?)?),
        "delete_document" => ok(delete_document(state, arg(&a, "id")?)?),
        "resolve_link" => ok(resolve_link(state, arg(&a, "target")?)?),
        "resolve_many" => ok(resolve_many(state, arg(&a, "targets")?)?),
        "names" => ok(names(state)?),
        "backlinks" => ok(backlinks(state, arg(&a, "id")?)?),
        "verse_mentions" => ok(verse_mentions(
            state,
            arg(&a, "book")?,
            arg(&a, "chapter")?,
            arg(&a, "verse")?,
        )?),
        "scripture_page" => ok(scripture_page(
            state,
            arg(&a, "book")?,
            arg(&a, "chapter")?,
            arg(&a, "verse")?,
        )?),
        "ensure_scripture_page" => ok(ensure_scripture_page(
            state,
            arg(&a, "book")?,
            arg(&a, "chapter")?,
            arg(&a, "verse")?,
        )?),
        "coverage" => ok(coverage(state)?),
        "verse_coverage" => ok(verse_coverage(
            state,
            arg(&a, "book")?,
            arg(&a, "chapter")?,
        )?),
        "graph" => ok(graph(state, arg(&a, "level")?)?),
        "search" => ok(search(state, arg(&a, "query")?, arg(&a, "limit")?)?),
        "suggest" => ok(suggest(state, arg(&a, "prefix")?, arg(&a, "limit")?)?),
        "tags" => ok(tags(state)?),
        "tagged_documents" => ok(tagged_documents(state, arg(&a, "tag")?)?),
        "places" => ok(places(state)?),
        "property_schema" => ok(property_schema(state)?),
        "set_property_type" => ok(set_property_type(
            state,
            arg(&a, "name")?,
            arg(&a, "propType")?,
        )?),
        "dates_of" => ok(dates_of(state, arg(&a, "id")?)?),
        "timeline" => ok(timeline(state)?),
        "events_naming" => ok(events_naming(state, arg(&a, "id")?)?),
        "event_links" => ok(event_links(state)?),
        "gazetteer" => ok(gazetteer(arg(&a, "query")?, arg(&a, "limit")?)),
        "versions" => ok(versions(state, arg(&a, "id")?)?),
        "save_version" => ok(save_version(state, arg(&a, "id")?, arg(&a, "label")?)?),
        "delete_version" => ok(delete_version(state, arg(&a, "id")?, arg(&a, "key")?)?),
        "text_at" => ok(text_at(state, arg(&a, "id")?, arg(&a, "frontier")?)?),
        "history" => ok(history(state, arg(&a, "id")?)?),
        "candidates" => ok(candidates(state, arg(&a, "id")?)?),
        "source_trail" => ok(source_trail(state, arg(&a, "id")?)?),
        "source_children" => ok(source_children(state, arg(&a, "id")?)?),
        "unresolved_links" => ok(unresolved_links(state)?),
        "find_source_by_url" => ok(find_source_by_url(state, arg(&a, "url")?)?),
        "detect_passages" => ok(detect_passages(state, arg(&a, "text")?)?),
        "books" => ok(books(state)?),
        "fetch_url_metadata" => ok(tauri::async_runtime::block_on(fetch_url_metadata(arg(
            &a, "url",
        )?))?),
        "hidden_dir" => ok(hidden_dir()),
        "ui_log" => {
            ui_log(arg(&a, "level")?, arg(&a, "message")?);
            ok(())
        }
        other => Err(format!("unknown command {other}")),
    }
}
