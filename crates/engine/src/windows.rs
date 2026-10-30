//! Windows (spec #35, issue #51): the bookkeeping that lets two desktop
//! Windows show the same document and always show the same text.
//!
//! Every Window talks to the same engine process, so the engine is the one
//! authority that orders their edits. A Window showing a document joins its
//! *session*: the engine keeps the text as the Windows have agreed it and a
//! numbered log of the changes that got it there. A Window sends each change
//! as an operation on the revision it last saw (`sync`). The engine takes it
//! only when that revision is still the latest; otherwise it hands back the
//! changes the Window missed, and the Window rebases its own over them
//! (`src/lib/textOp.ts`, `src/lib/docSync.ts`) and sends it again. The engine
//! never transforms anything: it orders, so two Windows typing at the same
//! instant both keep every keystroke.
//!
//! A change is a text operation in the shape the UI makes them: a list of
//! parts, a positive number keeps that many characters, a negative one
//! deletes that many, a string inserts it. Lengths are UTF-16 code units, as
//! the editor counts them, so the session holds its text as UTF-16.
//!
//! The Tauri shell sends the events; this is kept free of Tauri so it can be
//! tested.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, VecDeque};
use std::hash::{Hash, Hasher};

/// The label of the Window the app starts with. Also in `src/lib/windows.ts`
/// (`MAIN_WINDOW`); secondary Windows are `doc-<n>` (`create`), which
/// `src-tauri/capabilities/default.json` grants as `doc-*`.
pub const MAIN: &str = "main";

/// One part of a text operation: keep (n > 0) or delete (n < 0) characters,
/// or insert a string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Part {
    Count(i64),
    Insert(String),
}

/// A change to a whole text, from its first character to its last.
pub type Op = Vec<Part>;

/// How many characters `op` applies to, and how many it leaves.
fn lengths(op: &Op) -> (usize, usize) {
    let (mut base, mut target) = (0usize, 0usize);
    for p in op {
        match p {
            Part::Count(n) if *n >= 0 => {
                base += *n as usize;
                target += *n as usize;
            }
            Part::Count(n) => base += n.unsigned_abs() as usize,
            Part::Insert(s) => target += s.encode_utf16().count(),
        }
    }
    (base, target)
}

/// `op` applied to `text`, or why it does not fit.
pub fn apply(op: &Op, text: &[u16]) -> Result<Vec<u16>, String> {
    let (base, target) = lengths(op);
    if base != text.len() {
        return Err(format!("a change for {base} characters, on a text of {}", text.len()));
    }
    let mut out = Vec::with_capacity(target);
    let mut at = 0usize;
    for p in op {
        match p {
            Part::Count(n) if *n >= 0 => {
                out.extend_from_slice(&text[at..at + *n as usize]);
                at += *n as usize;
            }
            Part::Count(n) => at += n.unsigned_abs() as usize,
            Part::Insert(s) => out.extend(s.encode_utf16()),
        }
    }
    Ok(out)
}

const fn is_high(c: u16) -> bool {
    c >= 0xd800 && c <= 0xdbff
}
const fn is_low(c: u16) -> bool {
    c >= 0xdc00 && c <= 0xdfff
}

/// The smallest single change from `a` to `b`: their common start and end are
/// kept. Never splits a surrogate pair. None when they are equal.
pub fn diff(a: &[u16], b: &[u16]) -> Option<Op> {
    if a == b {
        return None;
    }
    let max = a.len().min(b.len());
    let mut start = 0;
    while start < max && a[start] == b[start] {
        start += 1;
    }
    if start > 0 && is_high(a[start - 1]) {
        start -= 1;
    }
    let mut end = 0;
    while end < max - start && a[a.len() - 1 - end] == b[b.len() - 1 - end] {
        end += 1;
    }
    if end > 0 && is_low(a[a.len() - end]) {
        end -= 1;
    }
    let mut op = Vec::new();
    if start > 0 {
        op.push(Part::Count(start as i64));
    }
    let insert = &b[start..b.len() - end];
    if !insert.is_empty() {
        op.push(Part::Insert(String::from_utf16_lossy(insert)));
    }
    let deleted = a.len() - end - start;
    if deleted > 0 {
        op.push(Part::Count(-(deleted as i64)));
    }
    if end > 0 {
        op.push(Part::Count(end as i64));
    }
    Some(op)
}

fn hash_text(s: &str) -> u64 {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

/// One change in a session's log.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Entry {
    pub op: Op,
    /// The change brings the text to what the file now holds (an edit made
    /// outside the app): it needs no saving.
    pub disk: bool,
}

/// A Window's sync request for one document.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub id: String,
    /// Which of the Window's live documents asks (`Member`).
    #[serde(default)]
    pub client: u64,
    /// The last revision the Window has seen.
    pub base: u64,
    /// A change made in the Window, on `base`.
    #[serde(default)]
    pub op: Option<Op>,
    /// The file as the Window just read it: the watcher saw it change.
    #[serde(default)]
    pub disk: Option<String>,
    /// Take `disk` as the text even if a Window's typing is not saved yet (Reload).
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SyncReply {
    /// The revision the Window is at once it has applied `ops` (and, when
    /// `accepted`, its own change).
    pub rev: u64,
    /// The changes since `base` the Window has not seen, oldest first.
    pub ops: Vec<Entry>,
    /// The Window's change was taken (`ops` is then empty: it was on the latest revision).
    pub accepted: bool,
    /// `disk` is an edit made outside the app while typing here is not saved:
    /// the Window shows that the file changed rather than taking it.
    pub external: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Joined {
    pub rev: u64,
    /// The text as the Windows already showing the document have it.
    pub text: String,
}

/// How many recent saves a session remembers, to know the watcher's echo of
/// a Window's own save from an edit made elsewhere.
const SAVES_KEPT: usize = 16;

#[derive(Debug)]
struct Session {
    text: Vec<u16>,
    /// The revision of `text`: changes taken so far.
    rev: u64,
    /// The changes from revision `log_start` on.
    log: VecDeque<Entry>,
    log_start: u64,
    /// The live documents showing it, with the revision each has seen.
    members: BTreeMap<Member, u64>,
    /// The texts Windows saved lately, as hashes, newest last.
    saved: VecDeque<u64>,
    /// What the file holds as far as this session knows: its text when the
    /// session began, the last save, or the last edit taken from the disk.
    on_disk: u64,
}

impl Session {
    fn text(&self) -> String {
        String::from_utf16_lossy(&self.text)
    }

    fn push(&mut self, entry: Entry) -> Result<(), String> {
        self.text = apply(&entry.op, &self.text)?;
        self.log.push_back(entry);
        self.rev += 1;
        Ok(())
    }

    fn since(&self, base: u64) -> Result<Vec<Entry>, String> {
        if base < self.log_start || base > self.rev {
            return Err(format!("revision {base} is not in this session"));
        }
        Ok(self.log.iter().skip((base - self.log_start) as usize).cloned().collect())
    }

    /// Drop the changes every member has seen.
    fn trim(&mut self) {
        let seen = self.members.values().copied().min().unwrap_or(self.rev);
        while self.log_start < seen && !self.log.is_empty() {
            self.log.pop_front();
            self.log_start += 1;
        }
    }
}

/// One live document in one Window. A Window can hold two for a moment, one
/// still saving as it closes while the next opens, so the Window alone does
/// not name it.
type Member = (String, u64);

fn member(window: &str, client: u64) -> Member {
    (window.to_string(), client)
}

#[derive(Debug, Default)]
pub struct Windows {
    sessions: BTreeMap<String, Session>,
    /// The document a new Window opens on, until it asks for it.
    start: BTreeMap<String, String>,
    next: u64,
}

impl Windows {
    pub fn new() -> Self {
        Self::default()
    }

    /// A label for a new Window that will open on `doc`. Labels are never reused.
    pub fn create(&mut self, doc: &str) -> String {
        self.next += 1;
        let label = format!("doc-{}", self.next);
        self.start.insert(label.clone(), doc.to_string());
        label
    }

    /// The document `window` was opened on, once: a reload starts as the Window left it.
    pub fn take_start(&mut self, window: &str) -> Option<String> {
        self.start.remove(window)
    }

    /// `window` shows `id`, which it read as `text`. A Window already showing
    /// it decides the text: the newcomer takes theirs, typing not saved yet included.
    pub fn join(&mut self, window: &str, client: u64, id: &str, text: &str) -> Joined {
        let s = self.sessions.entry(id.to_string()).or_insert_with(|| Session {
            text: text.encode_utf16().collect(),
            rev: 0,
            log: VecDeque::new(),
            log_start: 0,
            members: BTreeMap::new(),
            saved: VecDeque::new(),
            on_disk: hash_text(text),
        });
        s.members.insert(member(window, client), s.rev);
        Joined { rev: s.rev, text: s.text() }
    }

    /// That live document no longer shows `id`. The last one out ends the session.
    pub fn leave(&mut self, window: &str, client: u64, id: &str) {
        if let Some(s) = self.sessions.get_mut(id) {
            s.members.remove(&member(window, client));
            if s.members.is_empty() {
                self.sessions.remove(id);
            } else {
                s.trim();
            }
        }
    }

    /// `window` closed: it shows nothing any more.
    pub fn forget(&mut self, window: &str) {
        self.start.remove(window);
        for s in self.sessions.values_mut() {
            s.members.retain(|(w, _), _| w != window);
        }
        self.sessions.retain(|_, s| !s.members.is_empty());
        for s in self.sessions.values_mut() {
            s.trim();
        }
    }

    /// The Vault changed: no text of the one left may reach a document of the
    /// new one that has the same id.
    pub fn vault_changed(&mut self) {
        self.sessions.clear();
        self.start.clear();
    }

    /// A Window saved `id` as `text` (what the file now holds).
    pub fn saved(&mut self, id: &str, text: &str) {
        if let Some(s) = self.sessions.get_mut(id) {
            let h = hash_text(text);
            s.saved.push_back(h);
            while s.saved.len() > SAVES_KEPT {
                s.saved.pop_front();
            }
            s.on_disk = h;
        }
    }

    /// The Windows other than `from` showing `id`: the ones to tell it changed.
    pub fn others(&self, from: &str, id: &str) -> Vec<String> {
        self.sessions
            .get(id)
            .map(|s| {
                let mut w: Vec<String> =
                    s.members.keys().map(|(w, _)| w.clone()).filter(|w| w != from).collect();
                w.dedup();
                w
            })
            .unwrap_or_default()
    }

    /// A Window's request: take its change, or a change read from the disk,
    /// and hand back what it has not seen. The bool says whether the text
    /// changed, so the others should be told.
    pub fn sync(&mut self, window: &str, req: SyncRequest) -> Result<(SyncReply, bool), String> {
        let s = self
            .sessions
            .get_mut(&req.id)
            .filter(|s| s.members.contains_key(&member(window, req.client)))
            .ok_or_else(|| format!("{} is not open in this Window", req.id))?;
        let mut reply = SyncReply { rev: s.rev, ops: Vec::new(), accepted: false, external: false };
        let mut changed = false;
        if let Some(op) = req.op {
            if req.base == s.rev {
                s.push(Entry { op, disk: false })?;
                reply.accepted = true;
                changed = true;
            }
        } else if let Some(disk) = req.disk {
            let h = hash_text(&disk);
            let own_save = s.saved.contains(&h);
            if req.force || (!own_save && s.on_disk == hash_text(&s.text())) {
                // Everything the Windows agreed on is saved, so the file is
                // newer: take it, as a change, so typing not yet sent survives.
                let new: Vec<u16> = disk.encode_utf16().collect();
                if let Some(op) = diff(&s.text, &new) {
                    s.push(Entry { op, disk: true })?;
                    changed = true;
                }
                s.on_disk = h;
            } else if !own_save {
                reply.external = true;
            }
        }
        if !reply.accepted {
            reply.ops = s.since(req.base)?;
        }
        reply.rev = s.rev;
        s.members.insert(member(window, req.client), reply.rev);
        s.trim();
        Ok((reply, changed))
    }

    /// The text the Windows agreed for `id`, if a session holds it.
    pub fn text(&self, id: &str) -> Option<String> {
        self.sessions.get(id).map(Session::text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    fn ins(at: i64, s: &str, rest: i64) -> Op {
        let mut op = vec![];
        if at > 0 {
            op.push(Part::Count(at));
        }
        op.push(Part::Insert(s.into()));
        if rest > 0 {
            op.push(Part::Count(rest));
        }
        op
    }

    fn req(id: &str, base: u64) -> SyncRequest {
        SyncRequest { id: id.into(), base, ..Default::default() }
    }

    #[test]
    fn an_operation_keeps_deletes_and_inserts_in_utf16() {
        let op = vec![Part::Count(2), Part::Insert("é😀".into()), Part::Count(-1), Part::Count(1)];
        assert_eq!(String::from_utf16_lossy(&apply(&op, &u("abcd")).unwrap()), "abé😀d");
        assert!(apply(&op, &u("abc")).is_err());
    }

    #[test]
    fn a_diff_is_one_change_and_never_splits_a_surrogate_pair() {
        let a = u("say 😀 now");
        let b = u("say 😃 now");
        let op = diff(&a, &b).unwrap();
        assert_eq!(apply(&op, &a).unwrap(), b);
        assert!(op.contains(&Part::Insert("😃".into())));
        assert_eq!(diff(&a, &a), None);
    }

    #[test]
    fn a_newcomer_takes_the_text_the_others_have() {
        let mut w = Windows::new();
        assert_eq!(w.join("main", 0, "a", "one").text, "one");
        let (r, _) = w.sync("main", SyncRequest { op: Some(ins(3, " two", 0)), ..req("a", 0) }).unwrap();
        assert!(r.accepted);
        // The file still says "one": the second Window reads it, and is given the typing.
        let j = w.join("doc-1", 0, "a", "one");
        assert_eq!(j, Joined { rev: 1, text: "one two".into() });
    }

    #[test]
    fn a_change_on_an_old_revision_is_handed_back_what_it_missed() {
        let mut w = Windows::new();
        w.join("main", 0, "a", "ab");
        w.join("doc-1", 0, "a", "ab");
        let (r, changed) = w.sync("main", SyncRequest { op: Some(ins(0, "x", 2)), ..req("a", 0) }).unwrap();
        assert!(r.accepted && changed);
        assert_eq!(r.rev, 1);
        assert_eq!(w.others("main", "a"), vec!["doc-1".to_string()]);
        // doc-1 typed on revision 0 too: refused, and given main's change.
        let (r, changed) = w.sync("doc-1", SyncRequest { op: Some(ins(2, "y", 0)), ..req("a", 0) }).unwrap();
        assert!(!r.accepted && !changed);
        assert_eq!(r.ops, vec![Entry { op: ins(0, "x", 2), disk: false }]);
        assert_eq!(r.rev, 1);
        // Rebased, it is taken.
        let (r, _) = w.sync("doc-1", SyncRequest { op: Some(ins(3, "y", 0)), ..req("a", 1) }).unwrap();
        assert!(r.accepted);
        assert_eq!(w.text("a").unwrap(), "xaby");
        // A pull: main is told of doc-1's change.
        let (r, _) = w.sync("main", req("a", 1)).unwrap();
        assert_eq!(r.ops, vec![Entry { op: ins(3, "y", 0), disk: false }]);
        assert_eq!(r.rev, 2);
    }

    #[test]
    fn a_change_that_does_not_fit_is_an_error() {
        let mut w = Windows::new();
        w.join("main", 0, "a", "ab");
        assert!(w.sync("main", SyncRequest { op: Some(ins(0, "x", 5)), ..req("a", 0) }).is_err());
        assert_eq!(w.text("a").unwrap(), "ab");
    }

    #[test]
    fn a_window_that_has_not_joined_cannot_change_the_text() {
        let mut w = Windows::new();
        w.join("main", 0, "a", "ab");
        assert!(w.sync("doc-1", SyncRequest { op: Some(ins(0, "x", 2)), ..req("a", 0) }).is_err());
    }

    #[test]
    fn the_last_window_out_ends_the_session_and_a_closed_one_hears_nothing() {
        let mut w = Windows::new();
        w.join("main", 0, "a", "ab");
        let label = w.create("a");
        w.join(&label, 0, "a", "ab");
        w.forget(&label);
        assert!(w.others("main", "a").is_empty());
        assert_eq!(w.take_start(&label), None);
        w.leave("main", 0, "a");
        assert_eq!(w.text("a"), None);
    }

    #[test]
    fn a_live_document_closing_does_not_take_the_next_one_out() {
        let mut w = Windows::new();
        w.join("main", 1, "a", "x");
        w.join("doc-1", 1, "a", "x");
        // main reopens the document while the old copy is still saving.
        w.join("main", 2, "a", "x");
        w.leave("main", 1, "a");
        let r = w.sync("main", SyncRequest { client: 2, op: Some(ins(1, "y", 0)), ..req("a", 0) });
        assert!(r.unwrap().0.accepted);
        assert_eq!(w.others("doc-1", "a"), vec!["main".to_string()]);
    }

    #[test]
    fn changes_every_window_has_seen_are_dropped() {
        let mut w = Windows::new();
        w.join("main", 0, "a", "");
        w.join("doc-1", 0, "a", "");
        w.sync("main", SyncRequest { op: Some(ins(0, "x", 0)), ..req("a", 0) }).unwrap();
        w.sync("doc-1", req("a", 0)).unwrap();
        let s = &w.sessions["a"];
        assert_eq!((s.log_start, s.log.len()), (1, 0));
    }

    #[test]
    fn a_vault_change_ends_every_session() {
        let mut w = Windows::new();
        w.join("main", 0, "notes/a.md", "old vault");
        w.create("notes/a.md");
        w.vault_changed();
        // The same id in the new Vault starts from its own file.
        assert_eq!(w.join("main", 0, "notes/a.md", "new vault").text, "new vault");
        assert!(w.sync("doc-1", req("notes/a.md", 0)).is_err());
        assert_eq!(w.take_start("doc-1"), None);
    }

    #[test]
    fn the_echo_of_a_windows_own_save_is_not_an_outside_edit() {
        let mut w = Windows::new();
        w.join("main", 0, "a", "one");
        w.join("doc-1", 0, "a", "one");
        w.sync("main", SyncRequest { op: Some(ins(3, " two", 0)), ..req("a", 0) }).unwrap();
        w.saved("a", "one two");
        // doc-1, a step behind, sees main's save on disk.
        let (r, changed) = w.sync("doc-1", SyncRequest { disk: Some("one two".into()), ..req("a", 0) }).unwrap();
        assert!(!r.external && !changed);
        assert_eq!(r.ops.len(), 1);
        assert_eq!(w.text("a").unwrap(), "one two");
    }

    #[test]
    fn an_outside_edit_is_taken_when_everything_is_saved() {
        let mut w = Windows::new();
        w.join("main", 0, "a", "one");
        w.join("doc-1", 0, "a", "one");
        let (r, changed) = w.sync("main", SyncRequest { disk: Some("one!".into()), ..req("a", 0) }).unwrap();
        assert!(!r.external && changed);
        assert_eq!(r.ops, vec![Entry { op: vec![Part::Count(3), Part::Insert("!".into())], disk: true }]);
        // The other Window reading the same file changes nothing more.
        let (r, changed) = w.sync("doc-1", SyncRequest { disk: Some("one!".into()), ..req("a", 0) }).unwrap();
        assert!(!changed);
        assert_eq!(r.ops.len(), 1);
        assert_eq!(w.text("a").unwrap(), "one!");
    }

    #[test]
    fn an_outside_edit_over_unsaved_typing_is_shown_not_taken_unless_forced() {
        let mut w = Windows::new();
        w.join("main", 0, "a", "one");
        w.sync("main", SyncRequest { op: Some(ins(3, " two", 0)), ..req("a", 0) }).unwrap();
        let (r, changed) = w.sync("main", SyncRequest { disk: Some("uno".into()), ..req("a", 1) }).unwrap();
        assert!(r.external && !changed);
        assert_eq!(w.text("a").unwrap(), "one two");
        let (r, changed) =
            w.sync("main", SyncRequest { disk: Some("uno".into()), force: true, ..req("a", 1) }).unwrap();
        assert!(!r.external && changed);
        assert_eq!(w.text("a").unwrap(), "uno");
    }

    #[test]
    fn a_new_window_opens_once_on_its_document_under_a_fresh_label() {
        let mut w = Windows::new();
        let one = w.create("notes/a.md");
        let two = w.create("notes/b.md");
        assert_ne!(one, two);
        assert_ne!(one, MAIN);
        assert_eq!(w.take_start(&one).as_deref(), Some("notes/a.md"));
        assert_eq!(w.take_start(&one), None);
        assert_eq!(w.take_start(&two).as_deref(), Some("notes/b.md"));
    }

    #[test]
    fn a_request_reads_as_the_ui_sends_it() {
        let r: SyncRequest =
            serde_json::from_str(r#"{"id":"a","base":3,"op":[2,"hé",-1,4]}"#).unwrap();
        assert_eq!(r.op.unwrap(), vec![Part::Count(2), Part::Insert("hé".into()), Part::Count(-1), Part::Count(4)]);
        assert!(r.disk.is_none() && !r.force);
    }
}
