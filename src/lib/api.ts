// Typed wrappers over the Tauri commands. Mirrors the Rust types in
// crates/engine and src-tauri/src/lib.rs. The UI never touches files.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppearanceMode, Skin } from "./skin";

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

/**
 * What the engine says one document type is (`DocTypeInfo` in vault.rs).
 *
 * These used to be six arrays written out here by hand, mirroring predicates
 * the engine already computed — the `is_linkable_target` comment said so out
 * loud. Now the engine sends its answer with `VaultInfo` and the arrays below
 * are derived from it, so a new type cannot be a Subject on one side of the
 * boundary and not the other.
 */
export interface DocTypeInfo {
  type: DocType;
  is_scripture: boolean;
  is_subject: boolean;
  is_hub: boolean;
  is_writing: boolean;
  is_creatable: boolean;
  is_linkable_target: boolean;
  folder: string;
}

/** Types the user can make, in the order the New dialog offers them. */
export let CREATABLE_TYPES: DocType[] = [];
/** Scripture and the Topical Subjects. */
export let SUBJECT_TYPES: DocType[] = [];
export let SCRIPTURE_TYPES: DocType[] = [];
/** Documents whose name may be matched in prose (ADR 0011). */
export let LINKABLE_TARGET_TYPES: DocType[] = [];
/** Pages whose body is the point; they open in the editor. */
export let WRITING_TYPES: DocType[] = [];
/** Pages that gather what points at them; they open as a view. */
export let HUB_TYPES: DocType[] = [];

/**
 * Fill the type tables from what the engine sent.
 *
 * Called once as a vault opens, before any view renders, so every call site
 * stays synchronous — routing asks `HUB_TYPES.includes(type)` during render
 * and cannot wait for a fetch.
 */
export function setDocTypes(info: DocTypeInfo[]): void {
  const of = (p: (d: DocTypeInfo) => boolean) =>
    info.filter(p).map((d) => d.type);
  CREATABLE_TYPES = of((d) => d.is_creatable);
  SUBJECT_TYPES = of((d) => d.is_subject);
  SCRIPTURE_TYPES = of((d) => d.is_scripture);
  LINKABLE_TARGET_TYPES = of((d) => d.is_linkable_target);
  WRITING_TYPES = of((d) => d.is_writing);
  HUB_TYPES = of((d) => d.is_hub);
}

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
  /** The Vaults this Device holds (ADR 0014). */
  vaults: KnownVault[];
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
  /** This Device's side of the Vault's Skin (PLAN §24.5). */
  appearance_mode: AppearanceMode;
  /** This Device's Text scale, 1 = the Skin's own sizes. */
  text_scale: number;
}

/** What the Vault wears (ADR 0017): a Skin id, or null for the default. */
export interface Appearance {
  skin: string | null;
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
  | { kind: "error"; message: string }
  /** Config files a peer delivered (ADR 0016), relative to `.bible-study/`. */
  | { kind: "config"; names: string[] };

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

/** Whether this Device may write a Vault where its owner can find it (ADR 0015). */
export interface StorageAccess {
  /** Android: all-files access. Elsewhere nothing stands in the way. */
  needed: boolean;
  granted: boolean;
}

export interface SyncLocations {
  platform: string;
  /** Where new Vaults go: `<Documents>/Synesis`, or the private fallback. */
  home: string;
  can_pick_folder: boolean;
  /** Mobile: the path comes from the Vault's name and is never typed. */
  app_decides_path: boolean;
  storage: StorageAccess;
  locations: SyncLocation[];
  found: FoundVault[];
}

export interface VaultInfo {
  root: string;
  documents: number;
  doc_types: DocTypeInfo[];
  /** What this Vault is and what to call it (ADR 0014). */
  meta: VaultMeta;
}

/** A Vault's own identity, which travels with it rather than with its folder. */
export interface VaultMeta {
  id: string;
  name: string;
}

/** A Vault this Device holds (ADR 0014). Not a recents entry. */
export interface KnownVault {
  id: string;
  name: string;
  path: string;
}

/**
 * Whether a folder can receive the Vault being joined.
 *
 * `occupied` is the answer that matters: another Vault lives there, and
 * joining would merge the two permanently.
 */
export type JoinCheck =
  | { kind: "free" }
  | { kind: "same" }
  | { kind: "occupied"; name: string; id: string };

/** What an Invite is for, before accepting it. */
export interface InviteInfo {
  vault_name: string;
  vault_id: string;
  check: JoinCheck;
}

export interface ChangedPayload {
  changed: DocSummary[];
  removed: string[];
}

/**
 * A question for the index (`crates/engine/src/query.rs`).
 *
 * One command carries every read, so adding a question is a variant on both
 * sides rather than a command, a bridge arm and a method here — the shape that
 * let `set_map_filters` ship without a bridge arm and fail only in a browser.
 */
export type Query =
  | { kind: "list"; docType: DocType | null }
  | { kind: "places" }
  | { kind: "library" }
  | { kind: "clippings"; sourceId: string | null }
  | { kind: "backlinks"; id: string }
  | { kind: "sourceTrail"; id: string }
  | { kind: "sourceChildren"; id: string }
  | { kind: "tagsOf"; ids: string[] }
  | { kind: "unresolvedLinks" }
  | { kind: "boardsReferencing"; id: string }
  | { kind: "boardExcerpts"; refs: BoardRef[] }
  | { kind: "unlinkedMentions"; id: string }
  | { kind: "ambiguousTitles" }
  | { kind: "candidates"; id: string }
  | { kind: "graph"; level: GraphLevel }
  | { kind: "search"; text: string; limit: number }
  | { kind: "suggest"; prefix: string; limit: number }
  | { kind: "tags" }
  | { kind: "tagged"; tag: string }
  | { kind: "coverage" }
  | { kind: "verseCoverage"; book: number; chapter: number }
  | {
      kind: "verseMentions";
      book: number;
      chapter: number | null;
      verse: number | null;
    }
  | {
      kind: "scripturePage";
      book: number;
      chapter: number | null;
      verse: number | null;
    }
  | { kind: "datesOf"; id: string }
  | { kind: "timeline" }
  | { kind: "eventsNaming"; id: string }
  | { kind: "eventLinks" }
  | { kind: "timelineTags" }
  | { kind: "journeys" }
  | { kind: "placeFacts" };

/** What the index answered: a tag and the value under it. */
interface Answer {
  kind: string;
  value: unknown;
}

/**
 * Ask the index a question.
 *
 * The caller names the result type, as it did when each read was its own
 * command; the `Answer` tag is what the engine uses to stay exhaustive, and is
 * unwrapped here rather than at every call site.
 */
async function query<T>(q: Query): Promise<T> {
  const a = await invoke<Answer>("query", { query: q });
  return a.value as T;
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  setLanguage: (lang: Lang) => invoke<void>("set_language", { lang }),
  setSyncMethod: (method: SyncMethod | null) =>
    invoke<void>("set_sync_method", { method }),
  syncStatus: () => invoke<DeviceInfo[]>("sync_status"),
  syncLocations: () => invoke<SyncLocations>("sync_locations"),
  /** Re-checked whenever the window regains focus: the grant happens outside the app. */
  storageAccess: () => invoke<StorageAccess>("storage_access"),
  requestStorageAccess: () => invoke<void>("request_storage_access"),
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
  setDeviceAppearance: (mode: AppearanceMode, textScale: number) =>
    invoke<void>("set_device_appearance", { mode, textScale }),
  skins: () => invoke<Skin[]>("skins"),
  saveSkin: (skin: Skin) => invoke<Skin>("save_skin", { skin }),
  deleteSkin: (id: string) => invoke<void>("delete_skin", { id }),
  readSkinFile: (path: string) => invoke<Skin>("read_skin_file", { path }),
  exportSkin: (skin: Skin, path: string) => invoke<void>("export_skin", { skin, path }),
  /** The Skin gallery's index as published (PLAN §26); read it with `readIndex`. */
  skinGallery: () => invoke<unknown>("skin_gallery"),
  gallerySkin: (file: string) => invoke<Skin>("gallery_skin", { file }),
  appearance: () => invoke<Appearance>("appearance"),
  setAppearance: (appearance: Appearance) => invoke<void>("set_appearance", { appearance }),
  /** Config files another Device delivered (ADR 0016), relative to `.bible-study/`. */
  onConfigChanged: (cb: (names: string[]) => void): Promise<UnlistenFn> =>
    listen<string[]>("config:changed", (e) => cb(e.payload)),
  setGraphLevel: (level: GraphLevel) =>
    invoke<void>("set_graph_level", { level }),
  setTimelineFilters: (hiddenTypes: DocType[], inView: boolean) =>
    invoke<void>("set_timeline_filters", { hiddenTypes, inView }),
  // The type tables are filled here rather than by the caller: every route
  // into an open vault goes through one of these two, so nothing can forget.
  openVault: async (path?: string) => {
    const i = await invoke<VaultInfo>("open_vault", { path: path ?? null });
    setDocTypes(i.doc_types);
    return i;
  },
  closeVault: () => invoke<void>("close_vault"),
  /** Stop listing a Vault here. The folder and its documents stay. */
  forgetVault: (id: string) => invoke<KnownVault[]>("forget_vault", { id }),
  /**
   * Take this Device out of a Vault: its snapshots are withdrawn so the other
   * Devices stop mirroring them, and this Device's history for it is dropped.
   *
   * `deleteDocuments` also removes the folder and cannot be undone. Without
   * it the folder is left as plain markdown that Obsidian still opens. The
   * Vault must be open: leaving runs the engine, which holds only the open one.
   */
  leaveVault: (id: string, deleteDocuments: boolean) =>
    invoke<KnownVault[]>("leave_vault", { id, deleteDocuments }),
  /**
   * Stop holding another Device's snapshots in the open Vault, and retire it so
   * its folder is not trusted again if it comes back. The Vault's documents
   * stay: a Device leaving takes its history, not the work.
   */
  forgetDevice: (device: string) =>
    invoke<DeviceInfo[]>("forget_device", { device }),
  /** Vaults sitting where the user cannot browse them (ADR 0015), by id. */
  hiddenVaults: () => invoke<string[]>("hidden_vaults"),
  /** Move a Vault to the folder this Device would choose for it today. */
  moveVault: (id: string) => invoke<VaultInfo>("move_vault", { id }),
  /** Rename the open Vault; the name travels to every Device that holds it. */
  renameVault: (name: string) => invoke<VaultInfo>("rename_vault", { name }),
  /** Where a Vault of this name could go here without disturbing anything. */
  suggestVaultPath: (name: string) =>
    invoke<string>("suggest_vault_path", { name }),
  /** Which Vault a code is for, and whether `path` can receive it. */
  inspectInvite: (code: string, path: string) =>
    invoke<InviteInfo>("inspect_invite", { code, path }),
  vaultInfo: async () => {
    const i = await invoke<VaultInfo>("vault_info");
    setDocTypes(i.doc_types);
    return i;
  },
  rescan: () => invoke<DocSummary[]>("rescan"),
  listDocuments: (docType?: DocType) =>
    query<DocSummary[]>({ kind: "list", docType: docType ?? null }),
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
  backlinks: (id: string) => query<Backlink[]>({ kind: "backlinks", id }),
  unlinkedMentions: (id: string) =>
    query<UnlinkedMentions>({ kind: "unlinkedMentions", id }),
  linkables: (id: string, text: string) =>
    invoke<Linkable[]>("linkables", { id, text }),
  ambiguousTitles: () => query<AmbiguousTitle[]>({ kind: "ambiguousTitles" }),
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
    query<Backlink[]>({
      kind: "verseMentions",
      book,
      chapter: chapter ?? null,
      verse: verse ?? null,
    }),
  scripturePage: (book: number, chapter?: number, verse?: number) =>
    query<DocSummary | null>({
      kind: "scripturePage",
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
  coverage: () => query<CoverageCell[]>({ kind: "coverage" }),
  verseCoverage: (book: number, chapter: number) =>
    query<VerseCount[]>({ kind: "verseCoverage", book, chapter }),
  graph: (level: GraphLevel) => query<Graph>({ kind: "graph", level }),
  search: (text: string, limit = 30) =>
    query<SearchHit[]>({ kind: "search", text, limit }),
  suggest: (prefix: string, limit = 12) =>
    query<DocSummary[]>({ kind: "suggest", prefix, limit }),
  tags: () => query<TagCount[]>({ kind: "tags" }),
  taggedDocuments: (tag: string) =>
    query<DocSummary[]>({ kind: "tagged", tag }),
  places: () => query<DocSummary[]>({ kind: "places" }),
  propertySchema: () => invoke<PropertySchema>("property_schema"),
  setPropertyType: (name: string, propType: PropertyType) =>
    invoke<PropertySchema>("set_property_type", { name, propType }),
  datesOf: (id: string) => query<DatedProperty[]>({ kind: "datesOf", id }),
  timeline: () => query<DatedProperty[]>({ kind: "timeline" }),
  eventsNaming: (id: string) =>
    query<DocSummary[]>({ kind: "eventsNaming", id }),
  eventLinks: () => query<EventLink[]>({ kind: "eventLinks" }),
  timelineTags: () => query<DocTag[]>({ kind: "timelineTags" }),
  placeFacts: () => query<PlaceFact[]>({ kind: "placeFacts" }),
  journeys: () => query<Journey[]>({ kind: "journeys" }),
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
  candidates: (id: string) => query<Candidate[]>({ kind: "candidates", id }),
  getBoard: (id: string) => invoke<Board | null>("get_board", { id }),
  saveBoard: (id: string, board: Board) =>
    invoke<void>("save_board", { id, board }),
  boardsReferencing: (id: string) =>
    query<DocSummary[]>({ kind: "boardsReferencing", id }),
  boardExcerpts: (refs: BoardRef[]) =>
    query<Record<string, BoardExcerpt>>({ kind: "boardExcerpts", refs }),
  boardAt: (id: string, frontier: string) =>
    invoke<Board | null>("board_at", { id, frontier }),
  exportBoard: (path: string, data: string, base64: boolean) =>
    invoke<void>("export_board", { path, data, base64 }),
  /** Every Source with what a Library card needs, in one call (ADR 0012). */
  library: () => query<LibraryEntry[]>({ kind: "library" }),
  /** Copy a picture into `Attachments/`; returns its vault-relative path. */
  attachImage: (title: string, path: string) =>
    invoke<string>("attach_image", { title, path }),
  /** Download a remote Cover into `Attachments/`, at the user's request. */
  saveRemoteCover: (title: string, url: string) =>
    invoke<string>("save_remote_cover", { title, url }),
  /** Read a stored picture back as a data URL. */
  readAttachment: (path: string) => invoke<string>("read_attachment", { path }),
  sourceTrail: (id: string) => query<TrailEntry[]>({ kind: "sourceTrail", id }),
  /**
   * Every Clipping with the Citation it names, newest first (ADR 0013).
   * `sourceId` narrows to one Source, for its Hub's Clippings section.
   */
  clippings: (sourceId?: string) =>
    query<TrailEntry[]>({ kind: "clippings", sourceId: sourceId ?? null }),
  /** The Tags on each of `ids`, for filtering a list already in hand. */
  tagsOf: (ids: string[]) =>
    query<Record<string, string[]>>({ kind: "tagsOf", ids }),
  sourceChildren: (id: string) =>
    query<DocSummary[]>({ kind: "sourceChildren", id }),
  unresolvedLinks: () => query<UnresolvedLink[]>({ kind: "unresolvedLinks" }),
  findSourceByUrl: (url: string) =>
    invoke<DocSummary | null>("find_source_by_url", { url }),
  detectPassages: (text: string) =>
    invoke<DetectedRange[]>("detect_passages", { text }),
  books: () => invoke<BookMeta[]>("books"),
  fetchUrlMetadata: (url: string) =>
    invoke<UrlMeta>("fetch_url_metadata", { url }),

  onVaultChanged: (cb: (p: ChangedPayload) => void): Promise<UnlistenFn> =>
    listen<ChangedPayload>("vault:changed", (e) => cb(e.payload)),
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
