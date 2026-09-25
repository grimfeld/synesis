//! The browser test build: the engine behind one `invoke(command, args)`
//! export, answering the same commands as the Tauri shell so the React app
//! runs unchanged in a plain browser (`src/lib/webengine.ts`).
//!
//! The page gives this module an in-memory filesystem holding the demo vault
//! at `VAULT` and a scratch `/data` for the index. Nothing persists past a
//! reload. Pairing, native dialogs and the network have no counterpart here;
//! those commands answer with an error or an empty value.

use engine::api;
use engine::scripture::Lang;
use engine::Vault;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::path::Path;

/// Where the page mounts the demo vault; its last component names the Vault.
pub const VAULT: &str = "/Demo vault";
const DATA: &str = "/data";

struct State {
    vault: Option<Vault>,
    /// The shell's `Settings`, kept as JSON: the UI reads it whole and the
    /// web build has nowhere to save it.
    settings: Map<String, Value>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State {
        vault: None,
        settings: default_settings(),
    });
}

fn default_settings() -> Map<String, Value> {
    let v = json!({
        "vault_path": VAULT,
        "lang": "en",
        "recent": [VAULT],
        "vaults": [],
        "graph_level": null,
        "sync_method": "none",
        "relay_url": null,
        "background_sync": false,
        "timeline_hidden_types": [],
        "timeline_in_view": true,
        "map_books": [],
        "map_mentioned_only": false,
        "appearance_mode": "system",
        "text_scale": 1.0,
    });
    match v {
        Value::Object(m) => m,
        _ => unreachable!(),
    }
}

type Res = Result<Value, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("bad argument {key}: {e}"))
}

fn ok<T: Serialize>(v: T) -> Res {
    serde_json::to_value(v).map_err(err)
}

fn unavailable(cmd: &str) -> Res {
    Err(format!("{cmd} is not available in the web test build"))
}

impl State {
    fn vault(&self) -> Result<&Vault, String> {
        self.vault.as_ref().ok_or_else(|| "no vault open".into())
    }
    fn vault_mut(&mut self) -> Result<&mut Vault, String> {
        self.vault.as_mut().ok_or_else(|| "no vault open".into())
    }
    fn lang(&self) -> Lang {
        self.settings
            .get("lang")
            .cloned()
            .and_then(|l| serde_json::from_value(l).ok())
            .unwrap_or_default()
    }
    fn set(&mut self, key: &str, value: Value) {
        self.settings.insert(key.into(), value);
    }

    fn open(&mut self, path: Option<String>) -> Res {
        let path = path.unwrap_or_else(|| VAULT.into());
        self.vault = None;
        api::prepare_vault_folder(Path::new(&path)).map_err(err)?;
        let vault = Vault::open(&path, Path::new(DATA), self.lang()).map_err(err)?;
        let info = vault.info().map_err(err)?;
        self.vault = Some(vault);
        self.set("vault_path", json!(path));
        self.set(
            "vaults",
            json!([{ "id": info.meta.id, "name": info.meta.name, "path": path }]),
        );
        ok(info)
    }

    fn dispatch(&mut self, cmd: &str, a: Value) -> Res {
        match cmd {
            "get_settings" => ok(&self.settings),
            "set_language" => {
                let lang: Lang = arg(&a, "lang")?;
                self.set("lang", ok(lang)?);
                if let Some(v) = self.vault.as_mut() {
                    v.set_lang(lang);
                }
                ok(())
            }
            "set_device_appearance" => {
                self.set("appearance_mode", arg(&a, "mode")?);
                let scale: f64 = arg(&a, "textScale")?;
                self.set("text_scale", json!(scale.clamp(0.75, 2.0)));
                ok(())
            }
            "set_graph_level" => {
                self.set("graph_level", a.get("level").cloned().unwrap_or(Value::Null));
                ok(())
            }
            "set_timeline_filters" => {
                self.set("timeline_hidden_types", arg(&a, "hiddenTypes")?);
                self.set("timeline_in_view", arg(&a, "inView")?);
                ok(())
            }
            "set_map_filters" => {
                self.set("map_books", arg(&a, "books")?);
                self.set("map_mentioned_only", arg(&a, "mentionedOnly")?);
                ok(())
            }
            "set_sync_method" => {
                self.set("sync_method", a.get("method").cloned().unwrap_or(Value::Null));
                ok(())
            }
            "set_background_sync" => ok(()),
            "pairing_status" => ok(Value::Null),
            "sync_status" => ok(self.vault()?.devices()),
            "sync_locations" => ok(json!({
                "platform": "web",
                "home": "/",
                "can_pick_folder": false,
                "app_decides_path": true,
                "storage": { "needed": false, "granted": true },
                "locations": [],
                "found": [],
            })),
            "storage_access" | "request_storage_access" => {
                ok(json!({ "needed": false, "granted": true }))
            }
            "hidden_vaults" => ok(Vec::<String>::new()),
            "suggest_vault_path" => {
                let name: String = arg(&a, "name")?;
                ok(format!("/{}", name.trim()))
            }
            "open_vault" => self.open(arg(&a, "path")?),
            "close_vault" => {
                self.vault = None;
                self.set("vault_path", Value::Null);
                ok(())
            }
            "forget_vault" => {
                self.set("vaults", json!([]));
                ok(Vec::<Value>::new())
            }
            "rename_vault" => {
                let name: String = arg(&a, "name")?;
                let v = self.vault_mut()?;
                v.set_name(&name).map_err(err)?;
                let info = v.info().map_err(err)?;
                self.set(
                    "vaults",
                    json!([{ "id": info.meta.id, "name": info.meta.name, "path": VAULT }]),
                );
                ok(info)
            }
            "forget_device" => {
                let device: String = arg(&a, "device")?;
                let v = self.vault_mut()?;
                v.forget_device(&device).map_err(err)?;
                ok(v.devices())
            }
            "vault_info" => ok(self.vault()?.info().map_err(err)?),
            "rescan" => ok(self.vault_mut()?.scan().map_err(err)?),
            "query" => ok(self.vault()?.query(arg(&a, "query")?).map_err(err)?),
            "get_document" => {
                let v = self.vault()?;
                let view = v.read(&arg::<String>(&a, "id")?).map_err(err)?;
                ok(api::payload(v, view))
            }
            "save_document" => {
                let (id, text): (String, String) = (arg(&a, "id")?, arg(&a, "text")?);
                let v = self.vault_mut()?;
                let view = v.write(&id, &text).map_err(err)?;
                ok(api::payload(v, view))
            }
            "create_document" => {
                let fields: Option<Map<String, Value>> = arg(&a, "fields")?;
                let body: Option<String> = arg(&a, "body")?;
                let (doc_type, title): (engine::document::DocType, String) =
                    (arg(&a, "docType")?, arg(&a, "title")?);
                let v = self.vault_mut()?;
                let view = v
                    .create(
                        doc_type,
                        &title,
                        &fields.unwrap_or_default(),
                        body.as_deref().unwrap_or(""),
                    )
                    .map_err(err)?;
                ok(api::payload(v, view))
            }
            "rename_document" => {
                let (id, title): (String, String) = (arg(&a, "id")?, arg(&a, "title")?);
                let v = self.vault_mut()?;
                let view = v.rename(&id, &title).map_err(err)?;
                ok(api::payload(v, view))
            }
            "delete_document" => {
                ok(self.vault_mut()?.delete(&arg::<String>(&a, "id")?).map_err(err)?)
            }
            "resolve_link" => {
                ok(self.vault()?.resolve(&arg::<String>(&a, "target")?).map_err(err)?)
            }
            "resolve_many" => {
                let targets: Vec<String> = arg(&a, "targets")?;
                let v = self.vault()?;
                let out: engine::Result<Vec<_>> = targets.iter().map(|t| v.resolve(t)).collect();
                ok(out.map_err(err)?)
            }
            "names" => ok(api::names(self.vault()?).map_err(err)?),
            "linkables" => {
                let (id, text): (String, String) = (arg(&a, "id")?, arg(&a, "text")?);
                ok(api::linkables(self.vault()?, &id, &text).map_err(err)?)
            }
            "link_mentions" => {
                let target: String = arg(&a, "targetId")?;
                let mentions: Vec<api::MentionRef> = arg(&a, "mentions")?;
                ok(api::link_mentions(self.vault_mut()?, &target, &mentions))
            }
            "undo_link_mentions" => {
                let texts: Vec<(String, String)> = arg(&a, "texts")?;
                ok(self.vault_mut()?.restore_texts(&texts).map_err(err)?)
            }
            "ensure_scripture_page" => {
                let v = self.vault_mut()?;
                ok(api::ensure_scripture_page(
                    v,
                    arg(&a, "book")?,
                    arg(&a, "chapter")?,
                    arg(&a, "verse")?,
                )
                .map_err(err)?)
            }
            "property_schema" => ok(self.vault()?.property_schema()),
            "set_property_type" => {
                let (name, t): (String, engine::properties::PropertyType) =
                    (arg(&a, "name")?, arg(&a, "propType")?);
                ok(self.vault_mut()?.set_property_type(&name, t).map_err(err)?)
            }
            "skins" => ok(engine::skin::list(self.vault()?.root())),
            "save_skin" => {
                let skin: engine::skin::Skin = arg(&a, "skin")?;
                ok(engine::skin::save(self.vault()?.root(), skin).map_err(err)?)
            }
            "delete_skin" => {
                let id: String = arg(&a, "id")?;
                ok(engine::skin::delete(self.vault()?.root(), &id).map_err(err)?)
            }
            "appearance" => ok(engine::skin::appearance(self.vault()?.root())),
            "set_appearance" => {
                let ap: engine::skin::Appearance = arg(&a, "appearance")?;
                ok(engine::skin::set_appearance(self.vault()?.root(), &ap).map_err(err)?)
            }
            "gazetteer" => {
                let (q, limit): (String, Option<usize>) = (arg(&a, "query")?, arg(&a, "limit")?);
                ok(engine::gazetteer::search(&q, limit.unwrap_or(8)))
            }
            "versions" => ok(self.vault_mut()?.versions(&arg::<String>(&a, "id")?).map_err(err)?),
            "save_version" => {
                let (id, label): (String, String) = (arg(&a, "id")?, arg(&a, "label")?);
                ok(self.vault_mut()?.save_version(&id, &label).map_err(err)?)
            }
            "delete_version" => {
                let (id, key): (String, String) = (arg(&a, "id")?, arg(&a, "key")?);
                ok(self.vault_mut()?.delete_version(&id, &key).map_err(err)?)
            }
            "text_at" => {
                let (id, f): (String, String) = (arg(&a, "id")?, arg(&a, "frontier")?);
                ok(self.vault_mut()?.text_at(&id, &f).map_err(err)?)
            }
            "history" => ok(self.vault_mut()?.history(&arg::<String>(&a, "id")?).map_err(err)?),
            "get_board" => ok(self.vault_mut()?.read_board(&arg::<String>(&a, "id")?).map_err(err)?),
            "save_board" => {
                let (id, board): (String, engine::canvas::Canvas) =
                    (arg(&a, "id")?, arg(&a, "board")?);
                ok(self.vault_mut()?.write_board(&id, &board).map_err(err)?)
            }
            "board_at" => {
                let (id, f): (String, String) = (arg(&a, "id")?, arg(&a, "frontier")?);
                ok(self.vault_mut()?.board_at(&id, &f).map_err(err)?)
            }
            "read_attachment" => {
                use base64::Engine as _;
                let path: String = arg(&a, "path")?;
                let media = engine::attachments::media_type(&path)
                    .ok_or_else(|| format!("not an image: {path}"))?;
                let abs = engine::attachments::safe_relative(self.vault()?.root(), &path)
                    .map_err(err)?;
                let bytes = std::fs::read(abs).map_err(err)?;
                let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
                ok(format!("data:{media};base64,{b64}"))
            }
            "find_source_by_url" => {
                ok(self.vault()?.find_by_url(&arg::<String>(&a, "url")?).map_err(err)?)
            }
            "detect_passages" => {
                ok(api::detect_passages(&arg::<String>(&a, "text")?, self.lang()))
            }
            "books" => ok(api::books(self.lang())),
            "hidden_dir" => ok(engine::vault::HIDDEN_DIR),
            "ui_log" => ok(()),
            other => unavailable(other),
        }
    }
}

/// Run one command. `args` is the JSON object the UI passed to `invoke`.
pub fn invoke(cmd: &str, args: &str) -> Result<String, String> {
    let args: Value = serde_json::from_str(args).unwrap_or(json!({}));
    STATE
        .with(|s| s.borrow_mut().dispatch(cmd, args))
        .map(|v| v.to_string())
}

// ---- the ABI `webengine.ts` calls ---------------------------------------------
//
// Strings cross as (pointer, length) pairs in this module's memory. The page
// allocates the command and its arguments with `web_alloc`; `web_invoke`
// answers with a pointer to a buffer laid out as [status u8][len u32 LE][json],
// status 0 for success and 1 for an error, which the page frees with
// `web_free`.

fn layout(len: usize) -> std::alloc::Layout {
    // Never zero-sized: `alloc` must not be asked for nothing.
    std::alloc::Layout::array::<u8>(len.max(1)).expect("buffer too large")
}

#[no_mangle]
pub extern "C" fn web_alloc(len: usize) -> *mut u8 {
    unsafe { std::alloc::alloc(layout(len)) }
}

/// # Safety
/// `ptr` and `len` must come from `web_alloc`, or from `web_invoke` with
/// `len` the 5 header bytes plus the JSON length.
#[no_mangle]
pub unsafe extern "C" fn web_free(ptr: *mut u8, len: usize) {
    std::alloc::dealloc(ptr, layout(len));
}

/// # Safety
/// Both pairs must point at UTF-8 written into buffers from `web_alloc`.
#[no_mangle]
pub unsafe extern "C" fn web_invoke(
    cmd_ptr: *const u8,
    cmd_len: usize,
    args_ptr: *const u8,
    args_len: usize,
) -> *mut u8 {
    let text = |p, n| String::from_utf8_lossy(std::slice::from_raw_parts(p, n)).into_owned();
    let (cmd, args) = (text(cmd_ptr, cmd_len), text(args_ptr, args_len));
    let (status, body) = match invoke(&cmd, &args) {
        Ok(json) => (0u8, json),
        Err(e) => (1u8, Value::String(e).to_string()),
    };
    let len = 5 + body.len();
    let ptr = web_alloc(len);
    let out = std::slice::from_raw_parts_mut(ptr, len);
    out[0] = status;
    out[1..5].copy_from_slice(&(body.len() as u32).to_le_bytes());
    out[5..].copy_from_slice(body.as_bytes());
    ptr
}
