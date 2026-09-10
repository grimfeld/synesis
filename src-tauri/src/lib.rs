//! Tauri shell: exposes the engine through a small, document-shaped command set
//! (ADR 0004), keeps the vault open in app state, watches the folder for
//! external edits and forwards changes to the UI as events.

use engine::document::DocType;
use engine::index::{Backlink, Candidate, CoverageCell, DocSummary, Graph, GraphLevel, SearchHit, TrailEntry, UnresolvedLink};
use engine::scripture::{Lang, Passage};
use engine::vault::{DocumentView, VaultInfo, HIDDEN_DIR};
use engine::{parser, Vault};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

mod watch;
#[cfg(debug_assertions)]
mod devbridge;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub vault_path: Option<String>,
    #[serde(default)]
    pub lang: Lang,
    #[serde(default)]
    pub recent: Vec<String>,
    #[serde(default)]
    pub graph_level: Option<GraphLevel>,
}

pub struct AppState {
    vault: Mutex<Option<Vault>>,
    settings: Mutex<Settings>,
    settings_path: PathBuf,
    watcher: Mutex<Option<watch::Watcher>>,
}

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

impl AppState {
    fn with_vault<T>(&self, f: impl FnOnce(&Vault) -> engine::Result<T>) -> CmdResult<T> {
        let guard = self.vault.lock().map_err(err)?;
        let v = guard.as_ref().ok_or("no vault open")?;
        f(v).map_err(err)
    }
    fn with_vault_mut<T>(&self, f: impl FnOnce(&mut Vault) -> engine::Result<T>) -> CmdResult<T> {
        let mut guard = self.vault.lock().map_err(err)?;
        let v = guard.as_mut().ok_or("no vault open")?;
        f(v).map_err(err)
    }
    fn save_settings(&self) -> CmdResult<()> {
        let s = self.settings.lock().map_err(err)?;
        if let Some(p) = self.settings_path.parent() {
            std::fs::create_dir_all(p).map_err(err)?;
        }
        std::fs::write(&self.settings_path, serde_json::to_string_pretty(&*s).map_err(err)?).map_err(err)
    }
}

// ---- UTF-16 views for the editor ------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct PassageInfo {
    pub display: String,
    pub book: u8,
    pub start_chapter: u16,
    pub start_verse: Option<u16>,
    pub end_chapter: u16,
    pub end_verse: Option<u16>,
    pub unit: engine::Unit,
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedRange {
    pub from: usize,
    pub to: usize,
    pub passages: Vec<PassageInfo>,
    pub inferred: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkRange {
    pub from: usize,
    pub to: usize,
    pub target: String,
    pub alias: Option<String>,
    pub embed: bool,
    pub property: Option<String>,
    pub resolved: Option<DocSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagRange {
    pub from: usize,
    pub to: usize,
    pub name: String,
    pub in_frontmatter: bool,
    pub resolved: Option<DocSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocumentPayload {
    pub summary: DocSummary,
    pub text: String,
    pub frontmatter: Map<String, Value>,
    pub body_offset: usize,
    pub links: Vec<LinkRange>,
    pub tags: Vec<TagRange>,
    pub references: Vec<DetectedRange>,
}

fn passage_info(p: &Passage, lang: Lang) -> PassageInfo {
    PassageInfo {
        display: p.display(lang),
        book: p.book,
        start_chapter: p.start_chapter,
        start_verse: p.start_verse,
        end_chapter: p.end_chapter,
        end_verse: p.end_verse,
        unit: p.unit(),
    }
}

fn to_payload(v: &Vault, view: DocumentView) -> DocumentPayload {
    let text = &view.text;
    let u16 = |b: usize| parser::byte_to_utf16(text, b);
    let lang = v.lang();
    DocumentPayload {
        links: view
            .links
            .iter()
            .map(|l| LinkRange {
                from: u16(l.start),
                to: u16(l.end),
                target: l.target.clone(),
                alias: l.alias.clone(),
                embed: l.embed,
                property: l.property.clone(),
                resolved: v.resolve(&l.target).ok().flatten(),
            })
            .collect(),
        tags: view
            .tags
            .iter()
            .map(|t| TagRange { from: u16(t.start), to: u16(t.end), name: t.name.clone(), in_frontmatter: t.in_frontmatter, resolved: v.resolve(&t.name).ok().flatten() })
            .collect(),
        references: view
            .references
            .iter()
            .map(|d| DetectedRange { from: u16(d.start), to: u16(d.end), passages: d.passages.iter().map(|p| passage_info(p, lang)).collect(), inferred: d.inferred })
            .collect(),
        body_offset: u16(view.body_offset),
        summary: view.summary,
        text: view.text,
        frontmatter: view.frontmatter,
    }
}

// ---- commands ---------------------------------------------------------------

#[tauri::command]
fn get_settings(state: State<AppState>) -> CmdResult<Settings> {
    Ok(state.settings.lock().map_err(err)?.clone())
}

#[tauri::command]
fn set_language(state: State<AppState>, lang: Lang) -> CmdResult<()> {
    state.settings.lock().map_err(err)?.lang = lang;
    if let Some(v) = state.vault.lock().map_err(err)?.as_mut() {
        v.set_lang(lang);
    }
    state.save_settings()
}

#[tauri::command]
fn set_graph_level(state: State<AppState>, level: GraphLevel) -> CmdResult<()> {
    state.settings.lock().map_err(err)?.graph_level = Some(level);
    state.save_settings()
}

#[tauri::command]
fn open_vault(app: AppHandle, state: State<AppState>, path: Option<String>) -> CmdResult<VaultInfo> {
    let lang = state.settings.lock().map_err(err)?.lang;
    let path = match path.or_else(|| state.settings.lock().ok().and_then(|s| s.vault_path.clone())) {
        Some(p) => p,
        None => return Err("no vault path".into()),
    };
    let root = PathBuf::from(&path);
    // Stop watching the previous vault before touching files.
    *state.watcher.lock().map_err(err)? = None;
    std::fs::create_dir_all(&root).map_err(err)?;
    for folder in ["Notes", "Clippings", "Compositions", "Sources", "Scripture", "Places", "Characters", "Concepts"] {
        std::fs::create_dir_all(root.join(folder)).map_err(err)?;
    }
    let data_dir = app.path().app_data_dir().map_err(err)?;
    let vault = Vault::open(&root, &data_dir, lang).map_err(err)?;
    let info = vault.info().map_err(err)?;
    *state.vault.lock().map_err(err)? = Some(vault);
    {
        let mut s = state.settings.lock().map_err(err)?;
        s.vault_path = Some(path.clone());
        s.recent.retain(|p| p != &path);
        s.recent.insert(0, path.clone());
        s.recent.truncate(8);
    }
    state.save_settings()?;
    *state.watcher.lock().map_err(err)? = watch::Watcher::start(app.clone(), root).ok();
    app.emit("vault:opened", &info).ok();
    Ok(info)
}

#[tauri::command]
fn close_vault(state: State<AppState>) -> CmdResult<()> {
    *state.watcher.lock().map_err(err)? = None;
    *state.vault.lock().map_err(err)? = None;
    state.settings.lock().map_err(err)?.vault_path = None;
    state.save_settings()
}

#[tauri::command]
fn vault_info(state: State<AppState>) -> CmdResult<VaultInfo> {
    state.with_vault(|v| v.info())
}

#[tauri::command]
fn rescan(state: State<AppState>) -> CmdResult<Vec<DocSummary>> {
    state.with_vault_mut(|v| v.scan())
}

#[tauri::command]
fn list_documents(state: State<AppState>, doc_type: Option<DocType>) -> CmdResult<Vec<DocSummary>> {
    state.with_vault(|v| v.list(doc_type))
}

#[tauri::command]
fn get_document(state: State<AppState>, id: String) -> CmdResult<DocumentPayload> {
    state.with_vault(|v| Ok(to_payload(v, v.read(&id)?)))
}

#[tauri::command]
fn save_document(state: State<AppState>, id: String, text: String) -> CmdResult<DocumentPayload> {
    state.with_vault_mut(|v| {
        let view = v.write(&id, &text)?;
        Ok(to_payload(v, view))
    })
}

#[tauri::command]
fn create_document(state: State<AppState>, doc_type: DocType, title: String, fields: Option<Map<String, Value>>, body: Option<String>) -> CmdResult<DocumentPayload> {
    state.with_vault_mut(|v| {
        let view = v.create(doc_type, &title, &fields.unwrap_or_default(), body.as_deref().unwrap_or(""))?;
        Ok(to_payload(v, view))
    })
}

#[tauri::command]
fn rename_document(state: State<AppState>, id: String, title: String) -> CmdResult<DocumentPayload> {
    state.with_vault_mut(|v| {
        let view = v.rename(&id, &title)?;
        Ok(to_payload(v, view))
    })
}

#[tauri::command]
fn delete_document(state: State<AppState>, id: String) -> CmdResult<()> {
    state.with_vault_mut(|v| v.delete(&id))
}

#[tauri::command]
fn resolve_link(state: State<AppState>, target: String) -> CmdResult<Option<DocSummary>> {
    state.with_vault(|v| v.resolve(&target))
}

#[derive(Serialize)]
pub struct NameEntry {
    pub name: String,
    pub id: String,
    #[serde(rename = "type")]
    pub doc_type: DocType,
    pub alias: bool,
}

/// Every title and alias in the vault, for client-side link resolution and autocomplete.
#[tauri::command]
fn names(state: State<AppState>) -> CmdResult<Vec<NameEntry>> {
    state.with_vault(|v| {
        let mut out = Vec::new();
        for d in v.list(None)? {
            out.push(NameEntry { name: d.title.clone(), id: d.id.clone(), doc_type: d.doc_type, alias: false });
            for a in v.aliases_of(&d.id)? {
                out.push(NameEntry { name: a, id: d.id.clone(), doc_type: d.doc_type, alias: true });
            }
        }
        Ok(out)
    })
}

#[tauri::command]
fn resolve_many(state: State<AppState>, targets: Vec<String>) -> CmdResult<Vec<Option<DocSummary>>> {
    state.with_vault(|v| targets.iter().map(|t| v.resolve(t)).collect())
}

#[tauri::command]
fn backlinks(state: State<AppState>, id: String) -> CmdResult<Vec<Backlink>> {
    state.with_vault(|v| v.backlinks(&id))
}

#[tauri::command]
fn verse_mentions(state: State<AppState>, book: u8, chapter: Option<u16>, verse: Option<u16>) -> CmdResult<Vec<Backlink>> {
    state.with_vault(|v| v.verse_mentions(book, chapter, verse))
}

#[tauri::command]
fn scripture_page(state: State<AppState>, book: u8, chapter: Option<u16>, verse: Option<u16>) -> CmdResult<Option<DocSummary>> {
    state.with_vault(|v| v.scripture_doc(book, chapter, verse))
}

/// Materialise (and return) the page for a Scripture unit, e.g. when the user
/// clicks a detected Passage that has not been written on yet.
#[tauri::command]
fn ensure_scripture_page(state: State<AppState>, book: u8, chapter: Option<u16>, verse: Option<u16>) -> CmdResult<DocSummary> {
    state.with_vault_mut(|v| {
        let p = match (chapter, verse) {
            (None, _) => Passage::whole_book(book),
            (Some(c), None) => Passage::chapter(book, c),
            (Some(c), Some(vs)) => Passage::verse(book, c, vs),
        };
        v.materialise(&[p])?;
        v.scripture_doc(book, chapter, verse)?.ok_or_else(|| engine::Error::NotFound("scripture page".into()))
    })
}

#[tauri::command]
fn coverage(state: State<AppState>) -> CmdResult<Vec<CoverageCell>> {
    state.with_vault(|v| v.coverage())
}

#[tauri::command]
fn graph(state: State<AppState>, level: GraphLevel) -> CmdResult<Graph> {
    state.with_vault(|v| v.graph(level))
}

#[tauri::command]
fn search(state: State<AppState>, query: String, limit: Option<usize>) -> CmdResult<Vec<SearchHit>> {
    state.with_vault(|v| v.search(&query, limit.unwrap_or(30)))
}

#[tauri::command]
fn suggest(state: State<AppState>, prefix: String, limit: Option<usize>) -> CmdResult<Vec<DocSummary>> {
    state.with_vault(|v| v.suggest(&prefix, limit.unwrap_or(12)))
}

#[derive(Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: u32,
}

#[tauri::command]
fn tags(state: State<AppState>) -> CmdResult<Vec<TagCount>> {
    state.with_vault(|v| Ok(v.tags()?.into_iter().map(|(tag, count)| TagCount { tag, count }).collect()))
}

#[tauri::command]
fn places(state: State<AppState>) -> CmdResult<Vec<DocSummary>> {
    state.with_vault(|v| v.places())
}

#[tauri::command]
fn candidates(state: State<AppState>, id: String) -> CmdResult<Vec<Candidate>> {
    state.with_vault(|v| v.candidates(&id))
}

#[tauri::command]
fn source_trail(state: State<AppState>, id: String) -> CmdResult<Vec<TrailEntry>> {
    state.with_vault(|v| v.source_trail(&id))
}

#[tauri::command]
fn source_children(state: State<AppState>, id: String) -> CmdResult<Vec<DocSummary>> {
    state.with_vault(|v| v.source_children(&id))
}

#[tauri::command]
fn unresolved_links(state: State<AppState>) -> CmdResult<Vec<UnresolvedLink>> {
    state.with_vault(|v| v.unresolved())
}

#[tauri::command]
fn find_source_by_url(state: State<AppState>, url: String) -> CmdResult<Option<DocSummary>> {
    state.with_vault(|v| v.find_by_url(&url))
}

/// Live detection for the editor: runs on the text as typed.
#[tauri::command]
fn detect_passages(state: State<AppState>, text: String) -> CmdResult<Vec<DetectedRange>> {
    let lang = state.settings.lock().map_err(err)?.lang;
    Ok(parser::detect(&text)
        .into_iter()
        .map(|d| DetectedRange {
            from: parser::byte_to_utf16(&text, d.start),
            to: parser::byte_to_utf16(&text, d.end),
            passages: d.passages.iter().map(|p| passage_info(p, lang)).collect(),
            inferred: d.inferred,
        })
        .collect())
}

#[derive(Serialize)]
pub struct BookMeta {
    pub number: u8,
    pub name: String,
    pub english: String,
    pub chapters: Vec<u16>,
    pub hebrew_aramaic: bool,
}

#[tauri::command]
fn books(state: State<AppState>) -> CmdResult<Vec<BookMeta>> {
    let lang = state.settings.lock().map_err(err)?.lang;
    Ok(engine::versification::BOOKS
        .iter()
        .map(|b| BookMeta {
            number: b.number,
            name: engine::names::book_name(b.number, lang).to_string(),
            english: b.english.to_string(),
            chapters: b.chapters.to_vec(),
            hebrew_aramaic: engine::scripture::is_hebrew_aramaic(b.number),
        })
        .collect())
}

#[derive(Serialize, Default)]
pub struct UrlMeta {
    pub url: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub site: Option<String>,
    pub date: Option<String>,
    pub description: Option<String>,
}

fn meta_content(html: &str, key: &str) -> Option<String> {
    // <meta property="og:title" content="..."> in either attribute order.
    let re1 = regex::Regex::new(&format!(r#"(?is)<meta[^>]+(?:property|name)\s*=\s*["']{}["'][^>]*content\s*=\s*["']([^"']*)["']"#, regex::escape(key))).ok()?;
    let re2 = regex::Regex::new(&format!(r#"(?is)<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*(?:property|name)\s*=\s*["']{}["']"#, regex::escape(key))).ok()?;
    re1.captures(html).or_else(|| re2.captures(html)).map(|c| html_unescape(c[1].trim()))
}

fn html_unescape(s: &str) -> String {
    s.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ")
}

#[tauri::command]
async fn fetch_url_metadata(url: String) -> CmdResult<UrlMeta> {
    let client = reqwest::Client::builder()
        .user_agent("Synesis/0.1 (+https://github.com/grimfeld/synesis)")
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(err)?;
    let html = client.get(&url).send().await.map_err(err)?.text().await.map_err(err)?;
    let title_tag = regex::Regex::new(r"(?is)<title[^>]*>(.*?)</title>").ok().and_then(|re| re.captures(&html).map(|c| html_unescape(c[1].trim())));
    let title = meta_content(&html, "og:title").or(title_tag);
    let author = meta_content(&html, "author").or_else(|| meta_content(&html, "article:author"));
    let site = meta_content(&html, "og:site_name").or_else(|| url.split('/').nth(2).map(|h| h.trim_start_matches("www.").to_string()));
    let date = meta_content(&html, "article:published_time")
        .or_else(|| meta_content(&html, "datePublished"))
        .or_else(|| meta_content(&html, "date"))
        .map(|d| d.chars().take(10).collect());
    let description = meta_content(&html, "og:description").or_else(|| meta_content(&html, "description"));
    Ok(UrlMeta { url, title, author, site, date, description })
}

/// Webview errors, forwarded to the terminal in development.
#[tauri::command]
fn ui_log(level: String, message: String) {
    eprintln!("[ui:{level}] {message}");
}

#[tauri::command]
fn hidden_dir() -> String {
    HIDDEN_DIR.into()
}

fn settings_path(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from(".")).join("settings.json")
}

fn load_settings(p: &Path) -> Settings {
    std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init());
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = app.emit("quick-capture", ());
                }
            })
            .build(),
    );
    builder
        .setup(|app| {
            let sp = settings_path(app.handle());
            let settings = load_settings(&sp);
            app.manage(AppState { vault: Mutex::new(None), settings: Mutex::new(settings), settings_path: sp, watcher: Mutex::new(None) });
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                let _ = app.global_shortcut().register("CmdOrCtrl+Shift+N");
            }
            #[cfg(debug_assertions)]
            devbridge::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_language,
            set_graph_level,
            open_vault,
            close_vault,
            vault_info,
            rescan,
            list_documents,
            get_document,
            save_document,
            create_document,
            rename_document,
            delete_document,
            resolve_link,
            resolve_many,
            names,
            backlinks,
            verse_mentions,
            scripture_page,
            ensure_scripture_page,
            coverage,
            graph,
            search,
            suggest,
            tags,
            places,
            candidates,
            source_trail,
            source_children,
            unresolved_links,
            find_source_by_url,
            detect_passages,
            books,
            fetch_url_metadata,
            hidden_dir,
            ui_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
