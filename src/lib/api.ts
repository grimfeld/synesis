// Typed wrappers over the Tauri commands. Mirrors the Rust types in
// crates/engine and src-tauri/src/lib.rs. The UI never touches files.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type DocType =
  | "note"
  | "clipping"
  | "composition"
  | "source"
  | "book"
  | "chapter"
  | "verse"
  | "place"
  | "character"
  | "concept"
  | "event"
  | "journey"
  | "other";

export const CREATABLE_TYPES: DocType[] = [
  "note",
  "clipping",
  "composition",
  "source",
  "place",
  "character",
  "concept",
  "event",
  "journey",
];
export const SUBJECT_TYPES: DocType[] = [
  "book",
  "chapter",
  "verse",
  "place",
  "character",
  "concept",
  "event",
  "journey",
];
export const SCRIPTURE_TYPES: DocType[] = ["book", "chapter", "verse"];
/**
 * Documents whose name may be matched in prose (ADR 0011).
 *
 * One rule read in two directions: these gather Unlinked mentions on their
 * Hub, and exactly these can turn up as a Linkable while writing. Mirrors
 * `DocType::is_linkable_target` in the engine.
 */
export const LINKABLE_TARGET_TYPES: DocType[] = [
  "source",
  "place",
  "character",
  "concept",
  "event",
  "journey",
];
/** Pages whose body is the point; they open in the editor. */
export const WRITING_TYPES: DocType[] = ["note", "clipping", "composition"];
/** Pages that gather what points at them (Sources and Subjects); they open as a view. */
export const HUB_TYPES: DocType[] = [
  "source",
  "book",
  "chapter",
  "verse",
  "place",
  "character",
  "concept",
  "event",
  "journey",
];

export type Lang = "en" | "fr";
export type GraphLevel = "book" | "chapter" | "verse";
export type Unit = "book" | "chapter" | "verse" | "range";

export interface DocSummary {
  id: string;
  path: string;
  title: string;
  /**
   * What to show where only one line fits: a Clipping's own words, every other
   * type's title (ADR 0013). Never empty, so it needs no fallback — prefer it
   * over `title` anywhere a document is rendered as a row, a node or a card.
   */
  label: string;
  type: DocType;
  mtime: number;
  book: number | null;
  chapter: number | null;
  verse: number | null;
  lat: number | null;
  lon: number | null;
  first_verse: number | null;
  /** An Event's `start` Date as written (ADR 0005); null on every other type. */
  start: string | null;
  /** An Event's `end` Date as written; null when absent or on every other type. */
  end: string | null;
}

/** One `file` node's identity: which document, and which part of it. */
export interface BoardRef {
  path: string;
  subpath: string | null;
}

/** The text one Board card shows for its document (PLAN §17.12). */
export interface BoardExcerpt {
  /** Opening body text, plain and capped. Empty when there is no prose. */
  text: string;
  /** The node's `subpath` no longer resolves; the card says so rather than
   *  silently showing something other than what was pinned. */
  subpath_missing: boolean;
  /** Inbound link count, for a Subject Hub whose body says nothing. */
  mentions: number | null;
}

export interface PassageInfo {
  display: string;
  book: number;
  start_chapter: number;
  start_verse: number | null;
  end_chapter: number;
  end_verse: number | null;
  unit: Unit;
}

export interface DetectedRange {
  from: number;
  to: number;
  passages: PassageInfo[];
  inferred: boolean;
}

export interface LinkRange {
  from: number;
  to: number;
  target: string;
  alias: string | null;
  embed: boolean;
  property: string | null;
  resolved: DocSummary | null;
}

export interface TagRange {
  from: number;
  to: number;
  name: string;
  in_frontmatter: boolean;
  resolved: DocSummary | null;
}

export type Frontmatter = Record<string, unknown>;

/** Property types (ADR 0006): one per name, vault-wide. */
export type PropertyType =
  "text" | "number" | "date" | "calendar" | "link" | "list" | "checkbox";
export const PROPERTY_TYPES: PropertyType[] = [
  "text",
  "number",
  "date",
  "calendar",
  "link",
  "list",
  "checkbox",
];
/** Names the app owns; never retyped by the user. */
export const RESERVED_PROPERTIES = ["id", "type", "title", "tags"];

export interface PropertySchema {
  types: Record<string, PropertyType>;
}

export interface DocumentPayload {
  summary: DocSummary;
  text: string;
  frontmatter: Frontmatter;
  body_offset: number;
  links: LinkRange[];
  tags: TagRange[];
  references: DetectedRange[];
}

export type BacklinkKind = "link" | "embed" | "tag" | "property" | "mention";

export interface Backlink {
  doc: DocSummary;
  kind: BacklinkKind;
  via: string | null;
  property: string | null;
  excerpt: string;
  start: number;
  inferred: boolean;
}

export interface UnlinkedMention {
  doc: DocSummary;
  /** Byte offsets into the document's body, handed straight back to the engine. */
  start: number;
  end: number;
  /** The text as written, which the inserted link preserves. */
  matched: string;
  excerpt: string;
}

export interface UnlinkedMentions {
  items: UnlinkedMention[];
  /** The real count, which may exceed `items.length`. */
  total: number;
}

export interface Linkable {
  doc: DocSummary;
  count: number;
  /** UTF-16 offsets over the whole editor text, for selecting in CodeMirror. */
  start: number;
  end: number;
  matched: string;
  /** Non-empty when the title is shared: the user picks before anything is written. */
  ambiguous: DocSummary[];
}

export interface AmbiguousTitle {
  title: string;
  docs: DocSummary[];
}

/** What a linking edit changed, so a batch can be undone. */
export interface LinkedEdit {
  id: string;
  before: string;
}

export interface LinkResult {
  linked: LinkedEdit[];
  /** Ids skipped because the file had changed since it was indexed. */
  skipped: string[];
}

export interface VerseCount {
  verse: number;
  count: number;
}

export interface CoverageCell {
  book: number;
  chapter: number;
  count: number;
}

export interface GraphNode {
  id: string;
  label: string;
  type: DocType;
  doc_id: string | null;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SearchHit {
  doc: DocSummary;
  snippet: string;
}

/** A Date in the Bible's chronology (ADR 0005). Astronomical year: 1 BCE is 0. */
export interface BibleDate {
  year: number;
  month: number | null;
  day: number | null;
  approx: boolean;
}

/** One Date-typed Property on a document; `date` is null when the text did not parse. */
export interface DatedProperty {
  doc: DocSummary;
  name: string;
  text: string;
  date: BibleDate | null;
  precision: "year" | "month" | "day" | null;
}

/** An Event naming a Subject through its `place` or `characters` Property. */
export interface EventLink {
  event: string;
  subject: string;
}

/** One Tag carried by a dated document: the Timeline's Tag filter (PLAN §17). */
export interface DocTag {
  doc: string;
  tag: string;
}

/**
 * What the Map's filters know about one Place beyond its summary (PLAN §19.5):
 * its Tags, the Books it is mentioned in, and how many documents mention it.
 */
export interface PlaceFact {
  doc: string;
  tags: string[];
  books: number[];
  mentions: number;
}

/** Why a Stop cannot be drawn, or "ok" when it can (PLAN §19.8). */
export type StopStatus = "ok" | "no_coords" | "unresolved" | "not_a_place";

/** One Stop on a Journey: the Place named at one position in the route. */
export interface JourneyStop {
  /** The link target as written, so an unresolved Stop can still be named. */
  target: string;
  doc: DocSummary | null;
  status: StopStatus;
}

/** A Journey and its Stops in travel order (ADR 0010). */
export interface Journey {
  doc: DocSummary;
  stops: JourneyStop[];
}

/** A hit in the bundled Bible-place gazetteer (OpenBible.info, CC BY 4.0). */
export interface GazetteerHit {
  name: string;
  lat: number;
  lon: number;
  modern_name: string;
  verses: number;
}

/** A named moment in a Composition's history (ADR 0007). */
export interface Version {
  key: string;
  label: string;
  /** Unix milliseconds. */
  created: number;
  frontier: string;
}

export interface HistoryPoint {
  frontier: string;
  /** Unix seconds, 0 when unknown. */
  timestamp: number;
  lamport: number;
  peer: string;
  ops: number;
}

export interface Candidate {
  doc: DocSummary;
  shared_tags: string[];
  shared_passages: string[];
  score: number;
  /** The Composition already Mentions this document (link, Embed or Tag). */
  used: boolean;
  /** The document sits on the Composition's Board: placed, not yet committed. */
  on_board: boolean;
}

/** A node on a Board. JSON Canvas 1.0 (ADR 0009). */
export interface CanvasNode {
  id: string;
  type: "text" | "file" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  /** `text` nodes: the bubble's markdown. */
  text?: string;
  /** `file` nodes: the vault-relative path of the document. */
  file?: string;
  /** `file` nodes: a heading or block within it, always starting with `#`. */
  subpath?: string;
  /** `group` nodes: the label on the box. */
  label?: string;
  /**
   * Fields this app does not understand, written by Obsidian or one of its
   * plugins. Carried through untouched: a key we drop is a key we destroy.
   */
  [extra: string]: unknown;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  fromEnd?: "none" | "arrow";
  toNode: string;
  toSide?: "top" | "right" | "bottom" | "left";
  toEnd?: "none" | "arrow";
  color?: string;
  label?: string;
  [extra: string]: unknown;
}

export interface Board {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [extra: string]: unknown;
}

export interface TrailEntry {
  doc: DocSummary;
  source: DocSummary;
  locator: string | null;
}

export interface UnresolvedLink {
  target: string;
  count: number;
}

/**
 * One Source as the Library draws it (ADR 0012). Which Shelf it lands on is
 * decided in `src/lib/library.ts`, not here.
 */
export interface LibraryEntry {
  id: string;
  title: string;
  /** The `kind` property as written; may be empty or unknown. */
  kind: string;
  /** A URL, a vault-relative path, or empty for a Cover the app draws. */
  cover: string;
  /** The `date` property as written; loosely formatted by design (ADR 0005). */
  date: string;
  /** The Source this sits inside; null makes it top-level. */
  parent_id: string | null;
  /** Direct children only — the card's "12 chapters". */
  child_count: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface BookMeta {
  number: number;
  name: string;
  english: string;
  chapters: number[];
  hebrew_aramaic: boolean;
}

export interface UrlMeta {
  url: string;
  title: string | null;
  /**
   * `og:image`, offered as a remote Cover (ADR 0012). Often a site logo rather
   * than real cover art, so it is a suggestion the user can replace.
   */
  image: string | null;
  site: string | null;
  date: string | null;
  description: string | null;
}

export interface Settings {
  vault_path: string | null;
  lang: Lang;
  recent: string[];
  graph_level: GraphLevel | null;
  sync_method: SyncMethod | null;
  relay_url: string | null;
  background_sync: boolean;
  timeline_hidden_types: DocType[];
  timeline_in_view: boolean;
  /** Map: Book numbers the Places must be mentioned in (PLAN §19.13). */
  map_books: number[];
  /** Map: hide Places nothing mentions. */
  map_mentioned_only: boolean;
}

export interface PairingMember {
  node: number[];
  device_id: string;
  name: string;
  platform: string;
}

export interface PairingStatus {
  node: string;
  relay: string | null;
  connected: string[];
  pending: PairingMember[];
  members: PairingMember[];
  joining: boolean;
}

export type PairingEvent =
  | { kind: "join_request"; node: string; member: PairingMember }
  | { kind: "approved" }
  | { kind: "denied" }
  | { kind: "peer"; node: string; connected: boolean }
  | { kind: "synced"; files: number }
  | { kind: "membership" }
  | { kind: "error"; message: string };

export type SyncMethod =
  "pairing" | "icloud" | "syncthing" | "provider" | "none";

export interface DeviceInfo {
  id: string;
  name: string;
  platform: string;
  last_snapshot: number;
  is_self: boolean;
}

export interface FoundVault {
  path: string;
  devices: DeviceInfo[];
}

export interface SyncLocation {
  method: "icloud" | "syncthing" | "onedrive" | "gdrive" | "dropbox";
  root: string;
  exists: boolean;
  suggested: string;
}

export interface SyncLocations {
  platform: string;
  home: string;
  can_pick_folder: boolean;
  locations: SyncLocation[];
  found: FoundVault[];
}

export interface VaultInfo {
  root: string;
  documents: number;
}

export interface ChangedPayload {
  changed: DocSummary[];
  removed: string[];
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  setLanguage: (lang: Lang) => invoke<void>("set_language", { lang }),
  setSyncMethod: (method: SyncMethod | null) =>
    invoke<void>("set_sync_method", { method }),
  syncStatus: () => invoke<DeviceInfo[]>("sync_status"),
  syncLocations: () => invoke<SyncLocations>("sync_locations"),
  pairingStatus: () => invoke<PairingStatus | null>("pairing_status"),
  pairingInvite: () => invoke<{ code: string }>("pairing_invite"),
  pairingRevokeInvite: () => invoke<{ code: string }>("pairing_revoke_invite"),
  pairingJoin: (code: string, path: string) =>
    invoke<PairingStatus>("pairing_join", { code, path }),
  pairingApprove: (node: string, allow: boolean) =>
    invoke<boolean>("pairing_approve", { node, allow }),
  pairingRemove: (node: string) => invoke<void>("pairing_remove", { node }),
  pairingStop: () => invoke<void>("pairing_stop"),
  pairingSyncNow: () => invoke<PairingStatus | null>("pairing_sync_now"),
  setRelay: (url: string | null) => invoke<void>("set_relay", { url }),
  setBackgroundSync: (enabled: boolean) =>
    invoke<void>("set_background_sync", { enabled }),
  onPairingEvent: (cb: (e: PairingEvent) => void): Promise<UnlistenFn> =>
    listen<PairingEvent>("pairing:event", (e) => cb(e.payload)),
  setGraphLevel: (level: GraphLevel) =>
    invoke<void>("set_graph_level", { level }),
  setTimelineFilters: (hiddenTypes: DocType[], inView: boolean) =>
    invoke<void>("set_timeline_filters", { hiddenTypes, inView }),
  openVault: (path?: string) =>
    invoke<VaultInfo>("open_vault", { path: path ?? null }),
  closeVault: () => invoke<void>("close_vault"),
  vaultInfo: () => invoke<VaultInfo>("vault_info"),
  rescan: () => invoke<DocSummary[]>("rescan"),
  listDocuments: (docType?: DocType) =>
    invoke<DocSummary[]>("list_documents", { docType: docType ?? null }),
  getDocument: (id: string) => invoke<DocumentPayload>("get_document", { id }),
  saveDocument: (id: string, text: string) =>
    invoke<DocumentPayload>("save_document", { id, text }),
  createDocument: (
    docType: DocType,
    title: string,
    fields?: Frontmatter,
    body?: string,
  ) =>
    invoke<DocumentPayload>("create_document", {
      docType,
      title,
      fields: fields ?? null,
      body: body ?? null,
    }),
  renameDocument: (id: string, title: string) =>
    invoke<DocumentPayload>("rename_document", { id, title }),
  deleteDocument: (id: string) => invoke<void>("delete_document", { id }),
  resolveLink: (target: string) =>
    invoke<DocSummary | null>("resolve_link", { target }),
  resolveMany: (targets: string[]) =>
    invoke<(DocSummary | null)[]>("resolve_many", { targets }),
  backlinks: (id: string) => invoke<Backlink[]>("backlinks", { id }),
  unlinkedMentions: (id: string) =>
    invoke<UnlinkedMentions>("unlinked_mentions", { id }),
  linkables: (id: string, text: string) =>
    invoke<Linkable[]>("linkables", { id, text }),
  ambiguousTitles: () => invoke<AmbiguousTitle[]>("ambiguous_titles"),
  linkMentions: (
    targetId: string,
    mentions: { docId: string; start: number; end: number; matched: string }[],
  ) =>
    invoke<LinkResult>("link_mentions", {
      targetId,
      mentions: mentions.map((m) => ({
        doc_id: m.docId,
        start: m.start,
        end: m.end,
        matched: m.matched,
      })),
    }),
  undoLinkMentions: (texts: [string, string][]) =>
    invoke<void>("undo_link_mentions", { texts }),
  verseMentions: (book: number, chapter?: number, verse?: number) =>
    invoke<Backlink[]>("verse_mentions", {
      book,
      chapter: chapter ?? null,
      verse: verse ?? null,
    }),
  scripturePage: (book: number, chapter?: number, verse?: number) =>
    invoke<DocSummary | null>("scripture_page", {
      book,
      chapter: chapter ?? null,
      verse: verse ?? null,
    }),
  ensureScripturePage: (book: number, chapter?: number, verse?: number) =>
    invoke<DocSummary>("ensure_scripture_page", {
      book,
      chapter: chapter ?? null,
      verse: verse ?? null,
    }),
  coverage: () => invoke<CoverageCell[]>("coverage"),
  verseCoverage: (book: number, chapter: number) =>
    invoke<VerseCount[]>("verse_coverage", { book, chapter }),
  graph: (level: GraphLevel) => invoke<Graph>("graph", { level }),
  search: (query: string, limit = 30) =>
    invoke<SearchHit[]>("search", { query, limit }),
  suggest: (prefix: string, limit = 12) =>
    invoke<DocSummary[]>("suggest", { prefix, limit }),
  tags: () => invoke<TagCount[]>("tags"),
  taggedDocuments: (tag: string) =>
    invoke<DocSummary[]>("tagged_documents", { tag }),
  places: () => invoke<DocSummary[]>("places"),
  propertySchema: () => invoke<PropertySchema>("property_schema"),
  setPropertyType: (name: string, propType: PropertyType) =>
    invoke<PropertySchema>("set_property_type", { name, propType }),
  datesOf: (id: string) => invoke<DatedProperty[]>("dates_of", { id }),
  timeline: () => invoke<DatedProperty[]>("timeline"),
  eventsNaming: (id: string) => invoke<DocSummary[]>("events_naming", { id }),
  eventLinks: () => invoke<EventLink[]>("event_links"),
  timelineTags: () => invoke<DocTag[]>("timeline_tags"),
  placeFacts: () => invoke<PlaceFact[]>("place_facts"),
  journeys: () => invoke<Journey[]>("journeys"),
  setMapFilters: (books: number[], mentionedOnly: boolean) =>
    invoke<void>("set_map_filters", { books, mentionedOnly }),
  versions: (id: string) => invoke<Version[]>("versions", { id }),
  saveVersion: (id: string, label: string) =>
    invoke<Version>("save_version", { id, label }),
  deleteVersion: (id: string, key: string) =>
    invoke<void>("delete_version", { id, key }),
  textAt: (id: string, frontier: string) =>
    invoke<string>("text_at", { id, frontier }),
  history: (id: string) => invoke<HistoryPoint[]>("history", { id }),
  gazetteer: (query: string, limit = 8) =>
    invoke<GazetteerHit[]>("gazetteer", { query, limit }),
  candidates: (id: string) => invoke<Candidate[]>("candidates", { id }),
  getBoard: (id: string) => invoke<Board | null>("get_board", { id }),
  saveBoard: (id: string, board: Board) =>
    invoke<void>("save_board", { id, board }),
  boardsReferencing: (id: string) =>
    invoke<DocSummary[]>("boards_referencing", { id }),
  boardExcerpts: (refs: BoardRef[]) =>
    invoke<Record<string, BoardExcerpt>>("board_excerpts", { refs }),
  boardAt: (id: string, frontier: string) =>
    invoke<Board | null>("board_at", { id, frontier }),
  exportBoard: (path: string, data: string, base64: boolean) =>
    invoke<void>("export_board", { path, data, base64 }),
  /** Every Source with what a Library card needs, in one call (ADR 0012). */
  library: () => invoke<LibraryEntry[]>("library"),
  /** Copy a picture into `Attachments/`; returns its vault-relative path. */
  attachImage: (title: string, path: string) =>
    invoke<string>("attach_image", { title, path }),
  /** Download a remote Cover into `Attachments/`, at the user's request. */
  saveRemoteCover: (title: string, url: string) =>
    invoke<string>("save_remote_cover", { title, url }),
  /** Read a stored picture back as a data URL. */
  readAttachment: (path: string) => invoke<string>("read_attachment", { path }),
  sourceTrail: (id: string) => invoke<TrailEntry[]>("source_trail", { id }),
  /**
   * Every Clipping with the Citation it names, newest first (ADR 0013).
   * `sourceId` narrows to one Source, for its Hub's Clippings section.
   */
  clippings: (sourceId?: string) =>
    invoke<TrailEntry[]>("clippings", { sourceId: sourceId ?? null }),
  /** The Tags on each of `ids`, for filtering a list already in hand. */
  tagsOf: (ids: string[]) =>
    invoke<Record<string, string[]>>("tags_of", { ids }),
  sourceChildren: (id: string) =>
    invoke<DocSummary[]>("source_children", { id }),
  unresolvedLinks: () => invoke<UnresolvedLink[]>("unresolved_links"),
  findSourceByUrl: (url: string) =>
    invoke<DocSummary | null>("find_source_by_url", { url }),
  detectPassages: (text: string) =>
    invoke<DetectedRange[]>("detect_passages", { text }),
  books: () => invoke<BookMeta[]>("books"),
  fetchUrlMetadata: (url: string) =>
    invoke<UrlMeta>("fetch_url_metadata", { url }),

  onVaultChanged: (cb: (p: ChangedPayload) => void): Promise<UnlistenFn> =>
    listen<ChangedPayload>("vault:changed", (e) => cb(e.payload)),
  onQuickCapture: (cb: () => void): Promise<UnlistenFn> =>
    listen("quick-capture", () => cb()),
};

/** Book / chapter / verse of a packed VerseId. */
export function unpackVerse(v: number): {
  book: number;
  chapter: number;
  verse: number;
} {
  return {
    book: Math.floor(v / 1_000_000),
    chapter: Math.floor(v / 1000) % 1000,
    verse: v % 1000,
  };
}

/** Frontmatter value as display string. */
export function fmString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(fmString).join(", ");
  return JSON.stringify(v);
}

/** Strip [[ ]] from a property link value. */
export function linkTarget(v: unknown): string | null {
  const s = fmString(v).trim();
  const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(s);
  return m ? m[1].trim() : s || null;
}

export interface NameEntry {
  name: string;
  id: string;
  type: DocType;
  alias: boolean;
}
export const namesApi = {
  names: () => invoke<NameEntry[]>("names"),
};
