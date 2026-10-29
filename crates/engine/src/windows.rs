//! Windows (spec #35, issue #51): which documents each desktop Window shows,
//! so that an edit made in one Window reaches every other Window showing the
//! same document, and only those.
//!
//! Every Window talks to the same engine process. Each tells it the set of
//! documents its Panes hold open; an edit comes in from one Window and goes
//! out to the others that show its document. The Tauri shell does the
//! sending; this is the bookkeeping, kept free of Tauri so it can be tested.

use std::collections::{BTreeMap, BTreeSet};

/// The label of the Window the app starts with.
pub const MAIN: &str = "main";

#[derive(Debug, Default)]
pub struct Windows {
    shown: BTreeMap<String, BTreeSet<String>>,
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

    /// `window` now shows exactly `ids`.
    pub fn show(&mut self, window: &str, ids: impl IntoIterator<Item = String>) {
        let ids: BTreeSet<String> = ids.into_iter().collect();
        if ids.is_empty() {
            self.shown.remove(window);
        } else {
            self.shown.insert(window.to_string(), ids);
        }
    }

    /// `window` closed.
    pub fn forget(&mut self, window: &str) {
        self.shown.remove(window);
        self.start.remove(window);
    }

    /// The Windows other than `from` that show `id`: where its edit goes.
    pub fn recipients(&self, from: &str, id: &str) -> Vec<String> {
        self.shown
            .iter()
            .filter(|(w, ids)| w.as_str() != from && ids.contains(id))
            .map(|(w, _)| w.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn an_edit_reaches_the_other_windows_showing_its_document() {
        let mut w = Windows::new();
        w.show("main", ids(&["notes/a.md", "notes/b.md"]));
        w.show("doc-1", ids(&["notes/a.md"]));
        w.show("doc-2", ids(&["notes/c.md"]));
        assert_eq!(w.recipients("main", "notes/a.md"), ids(&["doc-1"]));
        assert_eq!(w.recipients("doc-1", "notes/a.md"), ids(&["main"]));
        assert!(w.recipients("main", "notes/b.md").is_empty());
    }

    #[test]
    fn a_window_that_stops_showing_a_document_hears_no_more_of_it() {
        let mut w = Windows::new();
        w.show("main", ids(&["a"]));
        w.show("doc-1", ids(&["a"]));
        w.show("doc-1", ids(&["b"]));
        assert!(w.recipients("main", "a").is_empty());
        w.show("doc-1", ids(&[]));
        assert!(w.recipients("main", "b").is_empty());
    }

    #[test]
    fn a_closed_window_hears_nothing() {
        let mut w = Windows::new();
        w.show("main", ids(&["a"]));
        let label = w.create("a");
        w.show(&label, ids(&["a"]));
        w.forget(&label);
        assert!(w.recipients("main", "a").is_empty());
        assert_eq!(w.take_start(&label), None);
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
}
