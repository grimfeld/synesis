//! Pairing: a peer-to-peer transport over Iroh (ADR 0008).
//!
//! Paired Devices mirror each other's `<vault>/.bible-study/sync/<device>/`
//! folders. Nothing else changes: the folder-sync importer (sync.rs) picks
//! the received snapshots up exactly as if a cloud folder had delivered them.
//!
//! One vault = one membership (members, removed nodes, vault key, invite
//! secret), kept per Device in the vault's local data directory. Between
//! peers the members and removals merge as sets: members grow, removals grow,
//! and a removal always wins (#65, #85). `version` orders only a member's name
//! and platform. The vault key and the invite secret are this Device's own and
//! never travel in a merge.
//!
//! Joining: the newcomer connects to the node named in the Invite, sends the
//! invite secret, and polls until a paired Device approves it and hands over
//! the membership. An Invite is single use and lasts `INVITE_TTL` (#89).
//!
//! Protocol (ALPN `synesis/sync/1`): one bidirectional stream per request,
//! postcard-encoded `Request` then `Response`. A "round" between two peers
//! exchanges memberships, then manifests, then pushes and pulls the snapshot
//! files each side lacks. Rounds run on connect, on local change, and every
//! 30 seconds.
//!
//! A round also carries the Vault's config files whole (ADR 0016) and every
//! picture in `Attachments/` (ADR 0020). An attachment is immutable once
//! written, so it is matched by content hash and fetched when missing; nothing
//! is ever deleted or overwritten. Region Borders (`.geojson` files beside
//! their Places, ADR 0023) travel whole too, newest stamp wins, like config,
//! and a deleted one travels as a tombstone.
//!
//! One connection per peer is kept open and reused by both sides' rounds, so a
//! peer is online for as long as it is reachable, not just during a round. An
//! unreachable peer is retried soon (1s, doubling up to 30s), each dial is
//! bounded, and peers are dialled in parallel so one gone Device cannot hold
//! up the others. Each peer's own address (home relay, direct addresses) is
//! remembered in `peers.json`, so the next dial goes straight to it instead
//! of waiting on address lookup.

use crate::border::BorderEntry;
use crate::config::{self, ConfigEntry};
use crate::device_id::DeviceId;
use crate::sync::{write_durable, ROSTER_DAMAGED, SYNC_DIR};
use crate::vault::HIDDEN_DIR;
use base64::Engine as _;
use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode, RelayUrl, SecretKey};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tokio::sync::{mpsc, Notify};

pub const ALPN: &[u8] = b"synesis/sync/1";
const MEMBERSHIP_FILE: &str = "pairing.json";
const KEY_FILE: &str = "pairing.key";
const MAX_FILE: usize = 64 * 1024 * 1024;
/// The most a node that is not a member may send in one request (#70): a
/// `Join` or a `Membership` with capped strings, never a file.
const MAX_STRANGER_REQUEST: usize = 16 * 1024;
/// How long a non-member's connection may stay open for its one request.
const STRANGER_TIMEOUT: Duration = Duration::from_secs(10);
/// How long an Invite opens the door after it is shown (#89).
pub const INVITE_TTL: Duration = Duration::from_secs(15 * 60);
/// Join requests waiting for an answer at once; the oldest goes first (#89).
const MAX_PENDING: usize = 8;
/// The longest Device name or platform a peer may claim, in characters.
const MAX_LABEL: usize = 64;
/// How far a peer's membership version may run ahead of this one's and still
/// order a member's name and platform (#85). A peer claiming more is not
/// believed about them; its members and removals still merge.
const MAX_VERSION_LEAD: u64 = 1_000;
const PEERS_FILE: &str = "peers.json";
const ROUND_EVERY: Duration = Duration::from_secs(30);
const JOIN_POLL: Duration = Duration::from_secs(2);
/// A dial that has not connected by then counts as unreachable for this pass.
const DIAL_TIMEOUT: Duration = Duration::from_secs(10);
/// How long the first pass waits for a home relay before dialling anyway.
const ONLINE_TIMEOUT: Duration = Duration::from_secs(10);
/// First retry after a peer could not be reached; doubles up to `ROUND_EVERY`.
const RETRY_FIRST: Duration = Duration::from_secs(1);

pub type NodeId = [u8; 32];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Member {
    pub node: NodeId,
    /// The Device's sync folder name (`sync/<device>/`). A peer cannot name a
    /// folder that is not a Device id (#90).
    pub device_id: DeviceId,
    pub name: String,
    pub platform: String,
}

impl Member {
    /// The card with its labels cut to `MAX_LABEL` characters, as a peer's
    /// claim is kept (#89).
    fn capped(mut self) -> Member {
        for s in [&mut self.name, &mut self.platform] {
            if let Some((i, _)) = s.char_indices().nth(MAX_LABEL) {
                s.truncate(i);
            }
        }
        self
    }
}

/// Everything a Device knows about who shares this vault.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct Membership {
    /// Orders a member's name and platform between peers, nothing else.
    pub version: u64,
    /// This Device's own; set from the approval that admitted it and never
    /// taken from a merge (#85).
    pub vault_key: Option<[u8; 32]>,
    /// This Device's own Invite secret. Never sent to a peer: each Device's
    /// Invite carries its own (#85, #89).
    pub invite_secret: Option<[u8; 32]>,
    pub members: Vec<Member>,
    pub removed: Vec<NodeId>,
    /// The sync folder of every Device ever removed, so a removal can reach
    /// the folder as well as the peer: a node id names a peer, and the
    /// snapshots live under a device id. Never forgotten, for the same reason
    /// `removed` is not — a retired Device that reappears is not trusted again
    /// by virtue of reappearing. Read by `sync::Roster`.
    #[serde(default, deserialize_with = "crate::device_id::lenient_list")]
    pub removed_devices: Vec<DeviceId>,
}

impl Membership {
    /// The membership saved for this Vault; empty when there is none. A file
    /// that is there but unreadable is an error, never an empty membership
    /// (#66): that would forget every removal, and the next save would make
    /// the loss permanent.
    fn load(dir: &Path) -> crate::Result<Membership> {
        match fs::read_to_string(dir.join(MEMBERSHIP_FILE)) {
            Ok(s) => serde_json::from_str(&s).map_err(|_| crate::Error::Invalid(ROSTER_DAMAGED.into())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Membership::default()),
            Err(_) => Err(crate::Error::Invalid(ROSTER_DAMAGED.into())),
        }
    }
    fn save(&self, dir: &Path) -> crate::Result<()> {
        write_durable(&dir.join(MEMBERSHIP_FILE), serde_json::to_string_pretty(self)?.as_bytes())
    }
    pub fn is_member(&self, node: &NodeId) -> bool {
        !self.removed.contains(node) && self.members.iter().any(|m| &m.node == node)
    }
    fn bump(&mut self) {
        self.version = self.version.saturating_add(1);
    }
    /// What a member is told: everything but this Device's secrets.
    fn public(&self) -> Membership {
        Membership { vault_key: None, invite_secret: None, ..self.clone() }
    }
    /// What a newcomer is told when approved: the members and the vault key.
    fn for_joiner(&self) -> Membership {
        Membership { vault_key: self.vault_key, ..self.public() }
    }
    /// What a removed Device is told: that it, and who else, was removed (#89).
    fn for_removed(&self) -> Membership {
        Membership { version: self.version, removed: self.removed.clone(), removed_devices: self.removed_devices.clone(), ..Default::default() }
    }
    /// Why `m` may not become a member, if it may not: it was removed, its
    /// folder was retired, or another member already holds that folder.
    /// Re-pairing a retired Device means a fresh id (#89).
    fn refuses(&self, m: &Member) -> Option<&'static str> {
        if self.removed.contains(&m.node) {
            Some("this Device was removed from the Vault")
        } else if self.removed_devices.contains(&m.device_id) {
            Some("this Device's id was retired from the Vault")
        } else if self.members.iter().any(|x| x.device_id == m.device_id && x.node != m.node) {
            Some("another Device already uses this Device's id")
        } else {
            None
        }
    }
    /// Merge a peer's membership. Members and removals are sets that only
    /// grow, and a removal wins over any member it names, so two Devices
    /// that each approve a newcomer while apart both keep both (#65), and no
    /// version number can drop a member or a removal (#85). A higher version,
    /// within `MAX_VERSION_LEAD`, updates a member's name and platform.
    /// Secrets are never taken. Returns whether anything changed.
    fn merge(&mut self, other: &Membership) -> bool {
        let before = self.clone();
        for r in &other.removed {
            if !self.removed.contains(r) {
                self.removed.push(*r);
            }
        }
        for d in &other.removed_devices {
            if !self.removed_devices.contains(d) {
                self.removed_devices.push(d.clone());
            }
        }
        let believed = other.version <= self.version.saturating_add(MAX_VERSION_LEAD);
        let newer = believed && other.version > self.version;
        for m in &other.members {
            let m = m.clone().capped();
            match self.members.iter_mut().find(|x| x.node == m.node) {
                // A member's folder is its own for good: only the card moves.
                Some(x) => {
                    if newer {
                        x.name = m.name;
                        x.platform = m.platform;
                    }
                }
                None => {
                    if self.refuses(&m).is_none() {
                        self.members.push(m);
                    }
                }
            }
        }
        let (removed, retired) = (&self.removed, &self.removed_devices);
        self.members.retain(|m| !removed.contains(&m.node) && !retired.contains(&m.device_id));
        if newer {
            self.version = other.version;
        }
        *self != before
    }
}

/// Compare two secrets in time that does not depend on where they differ.
fn same_secret(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let diff = a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y));
    std::hint::black_box(diff) == 0
}

/// What a QR code / pairing code carries.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Invite {
    pub host: NodeId,
    pub relay: Option<String>,
    pub secret: [u8; 32],
    /// Which Vault this Invite is for (ADR 0014), so the joining Device can
    /// refuse a folder that already holds a different one, and can say what it
    /// is about to join before accepting.
    pub vault_id: String,
    pub vault_name: String,
}

impl Invite {
    pub fn encode(&self) -> String {
        let bytes = postcard::to_allocvec(self).expect("invite serialises");
        format!("synesis:{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
    }
    pub fn decode(code: &str) -> Option<Invite> {
        let b = code.trim().strip_prefix("synesis:")?;
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(b).ok()?;
        postcard::from_bytes(&bytes).ok()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entry {
    pub device: String,
    pub name: String,
    pub size: u64,
    pub mtime_ms: i64,
}

#[derive(Debug, Serialize, Deserialize)]
enum Request {
    /// Newcomer with the invite secret; polled until approved.
    Join { secret: [u8; 32], member: Member },
    /// Membership exchange; the reply carries the responder's membership.
    Membership(Membership),
    Manifest(Vec<Entry>),
    GetFile { device: String, name: String },
    PutFile { entry: Entry, bytes: Vec<u8> },
    /// The dialler's own address; the reply carries the responder's. Last in
    /// the enum so older peers still decode every other request.
    Hello(EndpointAddr),
    /// The Vault's config files (ADR 0016), after `Hello` for the same reason:
    /// an older peer fails only this request and the snapshot round stands.
    ConfigManifest(Vec<ConfigEntry>),
    GetConfig(String),
    PutConfig { name: String, bytes: Vec<u8> },
    /// Pictures in `Attachments/` (ADR 0020), last again: an older peer fails
    /// only these and the rest of the round stands.
    AttachmentManifest(Vec<AttachmentEntry>),
    GetAttachment(String),
    PutAttachment { entry: AttachmentEntry, bytes: Vec<u8> },
    /// Region Borders (ADR 0023), vault-relative `.geojson` paths. Last, so
    /// an older peer fails only these. A manifest entry may be a tombstone,
    /// which `DeleteBorder` passes on.
    BorderManifest(Vec<BorderEntry>),
    GetBorder(String),
    PutBorder { entry: BorderEntry, bytes: Vec<u8> },
    DeleteBorder(BorderEntry),
}

#[derive(Debug, Serialize, Deserialize)]
enum Response {
    Pending,
    Approved(Membership),
    Denied,
    Membership(Membership),
    Manifest(Vec<Entry>),
    File(Option<Vec<u8>>),
    Ok,
    Hello(EndpointAddr),
    ConfigManifest(Vec<ConfigEntry>),
    AttachmentManifest(Vec<AttachmentEntry>),
    BorderManifest(Vec<BorderEntry>),
    /// The Invite a newcomer used has expired, been used or been replaced
    /// (#89). Last, so an older peer fails only this reply.
    Expired,
}

/// One picture in `Attachments/`, as a peer advertises it (ADR 0020).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttachmentEntry {
    /// The file name, directly inside `Attachments/`.
    pub name: String,
    pub size: u64,
    /// SHA-256 of the bytes: what makes two files the same picture.
    pub hash: [u8; 32],
}

/// What the UI hears from the node.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Event {
    JoinRequest { node: String, member: Member },
    Approved,
    Denied,
    Peer { node: String, connected: bool },
    Synced { files: usize },
    Membership,
    Error { message: String },
    /// Config files a peer delivered (ADR 0016), named relative to `.bible-study/`.
    Config { names: Vec<String> },
    /// Pictures a peer delivered (ADR 0020), vault-relative paths.
    Attachments { names: Vec<String> },
    /// Border files a peer delivered (ADR 0023), vault-relative paths.
    Borders { names: Vec<String> },
    /// The Invite this Device is joining through has expired or was already
    /// used (#89): a new one is needed.
    InviteExpired,
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub node: String,
    pub relay: Option<String>,
    pub connected: Vec<String>,
    pub pending: Vec<Member>,
    pub members: Vec<Member>,
    pub joining: bool,
}

struct State {
    membership: Membership,
    /// Join requests waiting for an answer, oldest first, at most `MAX_PENDING`.
    pending: Vec<Member>,
    /// When this Device's current Invite secret was first shown. Kept in
    /// memory only, so a restart closes every Invite shown before it.
    invite_issued: Option<Instant>,
    /// The live connection to each member, whoever dialled it.
    conns: HashMap<NodeId, Connection>,
    /// Members a dial is in flight to, so a pass never starts a second one.
    dialing: HashSet<NodeId>,
    /// Each peer's last self-reported address (`peers.json`).
    addrs: HashMap<NodeId, EndpointAddr>,
    joining: Option<Invite>,
}

impl State {
    /// Whether `secret` opens this Device's Invite now.
    fn invite_open(&self, secret: &[u8; 32]) -> bool {
        self.membership.invite_secret.is_some_and(|s| same_secret(&s, secret))
            && self.invite_issued.is_some_and(|t| t.elapsed() < INVITE_TTL)
    }
    /// Hold a join request for an answer, dropping the oldest beyond
    /// `MAX_PENDING` so a stream of strangers cannot grow the list (#89).
    fn add_pending(&mut self, m: Member) {
        if self.pending.len() >= MAX_PENDING {
            self.pending.remove(0);
        }
        self.pending.push(m);
    }
    /// Close the current Invite: the next one shown has a new secret.
    fn rotate_invite(&mut self) {
        self.membership.invite_secret = Some(rand::random());
        self.invite_issued = None;
    }
    /// After a removal: a removed Device may have seen the vault key and an
    /// Invite, so both are replaced (#89).
    fn rotate_secrets(&mut self) {
        if self.membership.vault_key.is_some() {
            self.membership.vault_key = Some(rand::random());
        }
        self.rotate_invite();
    }
    /// Merge a peer's membership, replacing this Device's secrets when the
    /// merge brought a removal. Returns whether anything changed.
    fn merge(&mut self, theirs: &Membership) -> bool {
        let removals = (self.membership.removed.len(), self.membership.removed_devices.len());
        let changed = self.membership.merge(theirs);
        if (self.membership.removed.len(), self.membership.removed_devices.len()) != removals {
            self.rotate_secrets();
        }
        changed
    }
}

pub struct Node {
    endpoint: Endpoint,
    /// Which Vault this node is pairing for, so an Invite can name it.
    vault: crate::meta::VaultMeta,
    sync_dir: PathBuf,
    /// `.bible-study/`, where the config files live.
    hidden_dir: PathBuf,
    local_dir: PathBuf,
    me: Member,
    state: Arc<Mutex<State>>,
    events: mpsc::Sender<Event>,
    changed: Arc<Notify>,
    relay: Option<RelayUrl>,
    /// False when relays are disabled (tests): there is no home relay to wait for.
    relays: bool,
    /// `Attachments/`, whose pictures travel whole (ADR 0020).
    attachments_dir: PathBuf,
    /// The Vault itself, where Border files sit beside their Places (ADR 0023).
    vault_root: PathBuf,
    /// Each attachment's hash, keyed by name and kept while its size and
    /// modification time stand, so a round every 30 seconds does not reread
    /// every picture in the Vault.
    hashes: Mutex<HashMap<String, KnownHash>>,
}

/// An attachment's size, modification time and hash.
type KnownHash = (u64, i64, [u8; 32]);

pub fn node_id_hex(id: &NodeId) -> String {
    hex::encode(id)
}

fn mtime_ms(p: &Path) -> i64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Load or create this Device's long-lived node key (one per app data dir).
///
/// A key file that is there but unreadable is an error, not a reason to make
/// a new key (#66): a new key is a new identity, and every peer would stop
/// recognising this Device.
fn node_secret(device_dir: &Path) -> crate::Result<SecretKey> {
    let p = device_dir.join(KEY_FILE);
    match fs::read_to_string(&p) {
        Ok(s) => {
            let arr = hex::decode(s.trim()).ok().and_then(|b| <[u8; 32]>::try_from(b).ok()).ok_or_else(|| {
                crate::Error::Invalid(format!("this Device's pairing key ({}) is damaged", p.display()))
            })?;
            Ok(SecretKey::from_bytes(&arr))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let k = SecretKey::generate();
            write_durable(&p, hex::encode(k.to_bytes()).as_bytes())?;
            Ok(k)
        }
        Err(e) => Err(e.into()),
    }
}

fn load_addrs(dir: &Path) -> HashMap<NodeId, EndpointAddr> {
    let saved: HashMap<String, EndpointAddr> = fs::read_to_string(dir.join(PEERS_FILE)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    saved.into_iter().filter_map(|(k, v)| Some((hex::decode(k).ok()?.try_into().ok()?, v))).collect()
}

fn save_addrs(dir: &Path, addrs: &HashMap<NodeId, EndpointAddr>) {
    let by_hex: HashMap<String, &EndpointAddr> = addrs.iter().map(|(k, v)| (node_id_hex(k), v)).collect();
    // Only a hint for the next dial: losing it costs an address lookup.
    if let Ok(json) = serde_json::to_string_pretty(&by_hex) {
        let _ = write_durable(&dir.join(PEERS_FILE), json.as_bytes());
    }
}

fn endpoint_addr(id: &NodeId, relay: Option<&str>) -> Option<EndpointAddr> {
    let id = EndpointId::from_bytes(id).ok()?;
    let mut addr = EndpointAddr::new(id);
    if let Some(r) = relay.and_then(|r| r.parse::<RelayUrl>().ok()) {
        addr = addr.with_relay_url(r);
    }
    Some(addr)
}

impl Node {
    /// Start the node. `device_dir` holds the node key (shared by every vault
    /// on this Device); `local_dir` is the vault's per-Device data folder.
    /// `relay`: custom relay URL, `None` for Iroh's public relays,
    /// `Some("")` to disable relays (tests).
    pub async fn start(vault_root: &Path, device_dir: &Path, local_dir: &Path, me: Member, relay: Option<String>, events: mpsc::Sender<Event>) -> crate::Result<Arc<Node>> {
        let secret = node_secret(device_dir)?;
        // Damaged pairing data pauses pairing rather than starting it afresh (#66).
        let mut membership = Membership::load(local_dir)?;
        let mut builder = Endpoint::builder(iroh::endpoint::presets::N0).secret_key(secret).alpns(vec![ALPN.to_vec()]);
        let mut relay_url = None;
        match relay.as_deref() {
            Some("") => builder = builder.relay_mode(RelayMode::Disabled),
            Some(url) => {
                let parsed: RelayUrl = url.parse().map_err(|e| crate::Error::Invalid(format!("relay url: {e}")))?;
                builder = builder.relay_mode(RelayMode::Custom(iroh::RelayMap::from_iter([parsed.clone()])));
                relay_url = Some(parsed);
            }
            None => {}
        }
        let endpoint = builder.bind().await.map_err(|e| crate::Error::Invalid(format!("p2p bind: {e}")))?;
        // This Device's card may have changed since it was recorded (a better
        // name, an OS upgrade): refresh it so every peer shows the new one.
        let my_id = *endpoint.id().as_bytes();
        if let Some(mine) = membership.members.iter_mut().find(|m| m.node == my_id) {
            if mine.name != me.name || mine.platform != me.platform {
                mine.name = me.name.clone();
                mine.platform = me.platform.clone();
                membership.bump();
                membership.save(local_dir)?;
            }
        }
        let node = Arc::new(Node {
            endpoint,
            vault: crate::meta::VaultMeta::adopt(vault_root)?,
            sync_dir: vault_root.join(HIDDEN_DIR).join(SYNC_DIR),
            hidden_dir: vault_root.join(HIDDEN_DIR),
            local_dir: local_dir.to_path_buf(),
            me,
            state: Arc::new(Mutex::new(State {
                membership,
                pending: Vec::new(),
                invite_issued: None,
                conns: HashMap::new(),
                dialing: HashSet::new(),
                addrs: load_addrs(local_dir),
                joining: None,
            })),
            events,
            changed: Arc::new(Notify::new()),
            relay: relay_url,
            relays: relay.as_deref() != Some(""),
            attachments_dir: vault_root.join(crate::attachments::FOLDER),
            vault_root: vault_root.to_path_buf(),
            hashes: Mutex::new(HashMap::new()),
        });
        tokio::spawn(Node::accept_loop(node.clone()));
        tokio::spawn(Node::dial_loop(node.clone()));
        Ok(node)
    }

    pub fn id(&self) -> NodeId {
        *self.endpoint.id().as_bytes()
    }
    pub fn addr(&self) -> EndpointAddr {
        self.endpoint.addr()
    }
    pub fn membership(&self) -> Membership {
        self.state.lock().unwrap().membership.clone()
    }
    /// Wake the dial loop: something local changed, push it now. The wake is
    /// kept when the loop is mid-round, so a change made then is not lost.
    pub fn notify_changed(&self) {
        self.changed.notify_one();
    }

    fn relay_hint(&self) -> Option<String> {
        self.relay.as_ref().map(|r| r.to_string()).or_else(|| self.endpoint.addr().relay_urls().next().map(|r| r.to_string()))
    }

    /// Save the membership; a failure is told to the UI rather than lost.
    fn persist(&self, m: &Membership) {
        if let Err(e) = m.save(&self.local_dir) {
            let _ = self.events.try_send(Event::Error { message: format!("saving the pairing data: {e}") });
        }
    }

    /// The Invite for this vault, and how long it stays open. Creates the
    /// vault key on first use. The secret is kept while the Invite is open,
    /// so showing the code twice shows the same code; once it has expired or
    /// admitted a Device (#89), a new one is made.
    pub fn invite(&self) -> (Invite, Duration) {
        let mut st = self.state.lock().unwrap();
        let open = st.invite_issued.filter(|t| t.elapsed() < INVITE_TTL).filter(|_| st.membership.invite_secret.is_some());
        let issued = match open {
            Some(t) => t,
            None => {
                st.membership.invite_secret = Some(rand::random());
                *st.invite_issued.insert(Instant::now())
            }
        };
        let m = &mut st.membership;
        if m.vault_key.is_none() {
            m.vault_key = Some(rand::random());
        }
        if !m.members.iter().any(|x| x.node == self.id()) {
            let mut me = self.me.clone();
            me.node = self.id();
            m.members.push(me);
            m.bump();
        }
        let invite = Invite {
            host: self.id(),
            relay: self.relay_hint(),
            secret: m.invite_secret.expect("set above"),
            vault_id: self.vault.id.clone(),
            vault_name: self.vault.name.clone(),
        };
        self.persist(&st.membership);
        (invite, INVITE_TTL.saturating_sub(issued.elapsed()))
    }

    /// Replace the invite secret; old codes stop working.
    pub fn revoke_invite(&self) {
        let mut st = self.state.lock().unwrap();
        st.rotate_invite();
        self.persist(&st.membership);
    }

    pub fn status(&self) -> Status {
        let st = self.state.lock().unwrap();
        Status {
            node: node_id_hex(&self.id()),
            relay: self.relay_hint(),
            connected: st.conns.iter().filter(|(_, c)| c.close_reason().is_none()).map(|(n, _)| node_id_hex(n)).collect(),
            pending: st.pending.clone(),
            members: st.membership.members.clone(),
            joining: st.joining.is_some(),
        }
    }

    /// Approve or deny a pending join. Either answer uses up the Invite
    /// (#89). Approval adds the member, unless it was removed, its id was
    /// retired, or another member holds that id: a removed Device stays
    /// removed, and a wiped one comes back with a fresh id. Returns whether
    /// the Device was admitted, or for a denial whether it was pending.
    pub fn approve(&self, node: &NodeId, allow: bool) -> bool {
        let mut st = self.state.lock().unwrap();
        let Some(i) = st.pending.iter().position(|m| &m.node == node) else { return false };
        let member = st.pending.remove(i);
        st.rotate_invite();
        let admitted = allow && st.membership.refuses(&member).is_none();
        if admitted {
            st.membership.members.push(member);
            st.membership.bump();
        }
        self.persist(&st.membership);
        drop(st);
        self.changed.notify_one();
        admitted || !allow
    }

    /// Remove a Device from the vault; every peer will refuse it from now on.
    /// Retire a Device by its sync folder name, whether or not it is still a
    /// member.
    ///
    /// `remove` needs a node id, which only a Device that paired through this
    /// roster has. A Device retired before removals were recorded — or one
    /// whose folder arrived from a peer that had it — is known by its folder
    /// alone, and that is exactly the Device whose snapshots must stop being
    /// trusted.
    pub fn forget_device(&self, device: &DeviceId) {
        let mut st = self.state.lock().unwrap();
        let m = &mut st.membership;
        if m.removed_devices.contains(device) {
            return;
        }
        m.removed_devices.push(device.clone());
        // A member holding that folder goes too, so it is not re-admitted on
        // the next round.
        if let Some(node) = m.members.iter().find(|x| x.device_id == *device).map(|x| x.node) {
            m.members.retain(|x| x.node != node);
            if !m.removed.contains(&node) {
                m.removed.push(node);
            }
            if let Some(c) = st.conns.remove(&node) {
                c.close(iroh::endpoint::VarInt::from_u32(0), b"removed");
            }
        }
        st.membership.bump();
        st.rotate_secrets();
        self.persist(&st.membership);
        drop(st);
        self.changed.notify_one();
    }

    pub fn remove(&self, node: &NodeId) {
        let mut st = self.state.lock().unwrap();
        let m = &mut st.membership;
        // Take the device id before dropping the Member: the folder to stop
        // trusting is named by the device, not by the node.
        let device = m.members.iter().find(|x| &x.node == node).map(|x| x.device_id.clone());
        m.members.retain(|x| &x.node != node);
        if !m.removed.contains(node) {
            m.removed.push(*node);
        }
        if let Some(d) = device {
            if !m.removed_devices.contains(&d) {
                m.removed_devices.push(d);
            }
        }
        m.bump();
        st.rotate_secrets();
        self.persist(&st.membership);
        if let Some(c) = st.conns.remove(node) {
            c.close(iroh::endpoint::VarInt::from_u32(0), b"removed");
        }
        drop(st);
        self.changed.notify_one();
    }

    /// Start joining through an Invite: keeps asking the host until approved.
    pub fn join(self: &Arc<Self>, invite: Invite) {
        self.state.lock().unwrap().joining = Some(invite.clone());
        let node = self.clone();
        tokio::spawn(async move {
            loop {
                let still = node.state.lock().unwrap().joining.clone();
                let Some(inv) = still else { return };
                let Some(addr) = endpoint_addr(&inv.host, inv.relay.as_deref()) else {
                    node.emit(Event::Error { message: "bad invite".into() }).await;
                    return;
                };
                let mut me = node.me.clone();
                me.node = node.id();
                let connected = match tokio::time::timeout(DIAL_TIMEOUT, node.endpoint.connect(addr, ALPN)).await {
                    Ok(r) => r.map_err(|e| format!("connect: {e}")),
                    Err(_) => Err("connect: timed out".to_string()),
                };
                match connected {
                    Ok(conn) => match request(&conn, &Request::Join { secret: inv.secret, member: me }).await {
                        Ok(Response::Approved(m)) => {
                            {
                                let mut st = node.state.lock().unwrap();
                                // The host's secret is its own (#85): this
                                // Device makes its own when it shows an Invite.
                                st.membership = Membership { invite_secret: None, ..m };
                                st.invite_issued = None;
                                node.persist(&st.membership);
                                st.joining = None;
                            }
                            node.emit(Event::Approved).await;
                            node.changed.notify_one();
                            return;
                        }
                        Ok(Response::Denied) => {
                            node.state.lock().unwrap().joining = None;
                            node.emit(Event::Denied).await;
                            return;
                        }
                        Ok(Response::Expired) => {
                            node.state.lock().unwrap().joining = None;
                            node.emit(Event::InviteExpired).await;
                            return;
                        }
                        Ok(_) => {}
                        Err(e) => node.emit(Event::Error { message: e }).await,
                    },
                    Err(message) => node.emit(Event::Error { message }).await,
                }
                tokio::time::sleep(JOIN_POLL).await;
            }
        });
    }

    async fn emit(&self, e: Event) {
        let _ = self.events.send(e).await;
    }

    // ---------------------------------------------------------------- server

    async fn serve(&self, remote: NodeId, mut send: SendStream, mut recv: RecvStream) -> Result<(), String> {
        // Who is asking decides how much is read (#70): a stranger is never
        // buffered more than a join request's worth.
        let is_member = self.state.lock().unwrap().membership.is_member(&remote);
        let limit = if is_member { MAX_FILE + 4096 } else { MAX_STRANGER_REQUEST };
        let bytes = recv.read_to_end(limit).await.map_err(|e| e.to_string())?;
        let req: Request = postcard::from_bytes(&bytes).map_err(|e| e.to_string())?;
        let resp = match req {
            Request::Join { secret, member } => {
                // Decide under the lock, announce after it (guards must not live across awaits).
                let (resp, announce) = {
                    let mut st = self.state.lock().unwrap();
                    let member = Member { node: remote, ..member }.capped();
                    if st.membership.removed.contains(&remote) {
                        (Response::Denied, None)
                    } else if st.membership.is_member(&remote) {
                        (Response::Approved(st.membership.for_joiner()), None)
                    } else if st.pending.iter().any(|m| m.node == remote) {
                        // Its Invite was checked when it first asked.
                        (Response::Pending, None)
                    } else if !st.invite_open(&secret) {
                        (Response::Expired, None)
                    } else if st.membership.refuses(&member).is_some() {
                        (Response::Denied, None)
                    } else {
                        st.add_pending(member.clone());
                        (Response::Pending, Some(member))
                    }
                };
                if let Some(member) = announce {
                    self.emit(Event::JoinRequest { node: node_id_hex(&remote), member }).await;
                }
                resp
            }
            // A removed Device may still ask for the membership: that is how
            // it learns it was removed. It learns nothing else (#89).
            Request::Membership(theirs) => {
                let (resp, changed) = {
                    let mut st = self.state.lock().unwrap();
                    if is_member {
                        let changed = st.merge(&theirs);
                        if changed {
                            self.persist(&st.membership);
                        }
                        (Response::Membership(st.membership.public()), changed)
                    } else if st.membership.removed.contains(&remote) {
                        (Response::Membership(st.membership.for_removed()), false)
                    } else {
                        (Response::Denied, false)
                    }
                };
                if changed {
                    self.emit(Event::Membership).await;
                }
                resp
            }
            _ if !is_member => Response::Denied,
            Request::Hello(addr) => {
                self.learn_addr(remote, addr);
                Response::Hello(self.endpoint.addr())
            }
            Request::Manifest(_) => Response::Manifest(self.manifest()),
            Request::GetFile { device, name } => Response::File(self.read_file(&device, &name)),
            Request::PutFile { entry, bytes } => {
                self.write_file(&entry, &bytes);
                self.emit(Event::Synced { files: 1 }).await;
                Response::Ok
            }
            Request::ConfigManifest(_) => Response::ConfigManifest(config::manifest(&self.hidden_dir)),
            Request::GetConfig(name) => Response::File(config::read(&self.hidden_dir, &name)),
            Request::PutConfig { name, bytes } => {
                if config::accept(&self.hidden_dir, &name, &bytes) {
                    self.emit(Event::Config { names: vec![name] }).await;
                }
                Response::Ok
            }
            Request::AttachmentManifest(_) => Response::AttachmentManifest(self.attachment_manifest()),
            Request::GetAttachment(name) => Response::File(self.read_attachment(&name)),
            Request::PutAttachment { entry, bytes } => {
                if let Some(name) = self.accept_attachment(&entry, &bytes) {
                    self.emit(Event::Attachments { names: vec![name] }).await;
                }
                Response::Ok
            }
            Request::BorderManifest(_) => {
                Response::BorderManifest(crate::border::manifest(&self.vault_root, &self.local_dir))
            }
            Request::GetBorder(name) => Response::File(crate::border::offered(&self.vault_root, &self.local_dir, &name)),
            Request::PutBorder { entry, bytes } => {
                if crate::border::accept(&self.vault_root, &self.local_dir, &entry.name, &bytes, entry.stamp) {
                    self.emit(Event::Borders { names: vec![entry.name] }).await;
                }
                Response::Ok
            }
            Request::DeleteBorder(entry) => {
                if entry.deleted && crate::border::forget(&self.vault_root, &self.local_dir, &entry.name, entry.stamp) {
                    self.emit(Event::Borders { names: vec![entry.name] }).await;
                }
                Response::Ok
            }
        };
        let out = postcard::to_allocvec(&resp).map_err(|e| e.to_string())?;
        send.write_all(&out).await.map_err(|e| e.to_string())?;
        send.finish().map_err(|e| e.to_string())?;
        let _ = send.stopped().await;
        Ok(())
    }

    async fn accept_loop(node: Arc<Node>) {
        while let Some(incoming) = node.endpoint.accept().await {
            let node = node.clone();
            tokio::spawn(async move {
                let Ok(conn) = incoming.await else { return };
                let remote_id: NodeId = *conn.remote_id().as_bytes();
                let member = node.state.lock().unwrap().membership.is_member(&remote_id);
                if member {
                    node.adopt(conn);
                    // A member reached us: run our half of the round now
                    // rather than on our next timer.
                    node.changed.notify_one();
                } else {
                    // A joining or removed Device, or a member this one has
                    // not heard of yet: answered, never kept (#70).
                    node.serve_stranger(remote_id, &conn).await;
                }
            });
        }
    }

    /// Keep `conn` as the connection to its member and serve the peer's
    /// requests on it until it closes. Either side's rounds use it.
    fn adopt(self: &Arc<Self>, conn: Connection) {
        let remote: NodeId = *conn.remote_id().as_bytes();
        let fresh = {
            let mut st = self.state.lock().unwrap();
            let live = st.conns.get(&remote).is_some_and(|c| c.close_reason().is_none());
            st.conns.insert(remote, conn.clone());
            !live
        };
        let node = self.clone();
        tokio::spawn(async move {
            if fresh {
                node.emit(Event::Peer { node: node_id_hex(&remote), connected: true }).await;
            }
            node.serve_conn(remote, &conn).await;
            // Only the connection still on record speaks for the peer: an
            // older one closing after a newer replaced it changes nothing.
            let gone = {
                let mut st = node.state.lock().unwrap();
                let current = st.conns.get(&remote).is_some_and(|c| c.stable_id() == conn.stable_id());
                if current {
                    st.conns.remove(&remote);
                }
                current
            };
            if gone {
                node.emit(Event::Peer { node: node_id_hex(&remote), connected: false }).await;
                // Redial now: the peer may only have changed networks.
                node.changed.notify_one();
            }
        });
    }

    /// Serve a node that is not a member: one request at a time, each read
    /// capped by `serve` and bounded in time, and the connection closed once
    /// it falls idle. A stranger can then hold at most one small request in
    /// memory per connection, however many streams it opens (#70).
    async fn serve_stranger(&self, remote: NodeId, conn: &Connection) {
        while let Ok(Ok((send, recv))) = tokio::time::timeout(STRANGER_TIMEOUT, conn.accept_bi()).await {
            if tokio::time::timeout(STRANGER_TIMEOUT, self.serve(remote, send, recv)).await.is_err() {
                break;
            }
        }
        conn.close(iroh::endpoint::VarInt::from_u32(0), b"not a member");
    }

    async fn serve_conn(self: &Arc<Self>, remote: NodeId, conn: &Connection) {
        while let Ok((send, recv)) = conn.accept_bi().await {
            let node = self.clone();
            tokio::spawn(async move {
                let _ = node.serve(remote, send, recv).await;
            });
        }
    }

    fn learn_addr(&self, node: NodeId, addr: EndpointAddr) {
        if addr.id.as_bytes() != &node {
            return;
        }
        let mut st = self.state.lock().unwrap();
        if st.addrs.get(&node) != Some(&addr) {
            st.addrs.insert(node, addr);
            save_addrs(&self.local_dir, &st.addrs);
        }
    }

    /// Where to dial a member: its own last reported address, else a relay hint.
    fn dial_addr(&self, node: &NodeId) -> Option<EndpointAddr> {
        let st = self.state.lock().unwrap();
        let hint = st.joining.as_ref().and_then(|i| i.relay.clone()).or_else(|| self.relay_hint());
        match st.addrs.get(node) {
            Some(known) if known.relay_urls().next().is_some() => Some(known.clone()),
            Some(known) => {
                let mut addr = known.clone();
                if let Some(r) = hint.and_then(|r| r.parse::<RelayUrl>().ok()) {
                    addr = addr.with_relay_url(r);
                }
                Some(addr)
            }
            None => endpoint_addr(node, hint.as_deref()),
        }
    }

    /// Swap addresses with a peer just dialled. A peer too old to know the
    /// request fails it, which is fine: it is then found as before.
    async fn hello(&self, conn: &Connection) {
        let remote: NodeId = *conn.remote_id().as_bytes();
        if let Ok(Response::Hello(addr)) = request(conn, &Request::Hello(self.endpoint.addr())).await {
            self.learn_addr(remote, addr);
        }
    }

    // ---------------------------------------------------------------- client

    async fn dial_loop(node: Arc<Node>) {
        // Dialling before this Device has a home relay mostly fails, and a
        // failed first pass is what used to cost a whole ROUND_EVERY.
        if node.relays {
            let _ = tokio::time::timeout(ONLINE_TIMEOUT, node.endpoint.online()).await;
        }
        let mut retry = RETRY_FIRST;
        loop {
            let members: Vec<Member> = {
                let st = node.state.lock().unwrap();
                st.membership.members.iter().filter(|m| m.node != node.id()).cloned().collect()
            };
            let mut pass = tokio::task::JoinSet::new();
            for m in members {
                let node = node.clone();
                pass.spawn(async move { node.sync_with(m).await });
            }
            let mut all_reached = true;
            while let Some(reached) = pass.join_next().await {
                all_reached &= reached.unwrap_or(false);
            }
            let wait = if all_reached {
                retry = RETRY_FIRST;
                ROUND_EVERY
            } else {
                let w = retry;
                retry = (retry * 2).min(ROUND_EVERY);
                w
            };
            tokio::select! {
                _ = node.changed.notified() => {}
                _ = tokio::time::sleep(wait) => {}
            }
        }
    }

    /// One round with one member over its live connection. Without one,
    /// start a dial and return false: the dial runs on its own, so an
    /// unreachable member never holds up the round with a reachable one.
    async fn sync_with(self: &Arc<Self>, m: Member) -> bool {
        let live = self.state.lock().unwrap().conns.get(&m.node).filter(|c| c.close_reason().is_none()).cloned();
        let Some(conn) = live else {
            self.dial(m.node);
            return false;
        };
        if let Err(e) = self.round(&conn).await {
            // A connection that closed mid-round is the peer going away, not
            // an error: its closing already woke the loop to redial.
            if conn.close_reason().is_none() {
                self.emit(Event::Error { message: format!("{}: {e}", m.name) }).await;
            }
        }
        true
    }

    /// Dial a member in the background; on success, wake the loop for a round.
    fn dial(self: &Arc<Self>, node: NodeId) {
        if !self.state.lock().unwrap().dialing.insert(node) {
            return;
        }
        let me = self.clone();
        tokio::spawn(async move {
            let conn = match me.dial_addr(&node) {
                Some(addr) => tokio::time::timeout(DIAL_TIMEOUT, me.endpoint.connect(addr, ALPN)).await.ok().and_then(|r| r.ok()),
                None => None,
            };
            if let Some(conn) = &conn {
                me.adopt(conn.clone());
                me.hello(conn).await;
            }
            me.state.lock().unwrap().dialing.remove(&node);
            if conn.is_some() {
                me.changed.notify_one();
            }
        });
    }

    /// One sync round with a peer: memberships, manifests, then files both ways.
    async fn round(&self, conn: &Connection) -> Result<(), String> {
        let mine_m = self.membership();
        if let Response::Membership(theirs) = request(conn, &Request::Membership(mine_m.public())).await? {
            let changed = {
                let mut st = self.state.lock().unwrap();
                let c = st.merge(&theirs);
                if c {
                    self.persist(&st.membership);
                }
                c
            };
            if changed {
                self.emit(Event::Membership).await;
            }
        }
        let mine = self.manifest();
        let theirs = match request(conn, &Request::Manifest(mine.clone())).await? {
            Response::Manifest(t) => t,
            _ => return Err("bad manifest reply".into()),
        };
        let key = |e: &Entry| (e.device.clone(), e.name.clone());
        let mine_by: HashMap<_, _> = mine.iter().map(|e| (key(e), e)).collect();
        let theirs_by: HashMap<_, _> = theirs.iter().map(|e| (key(e), e)).collect();
        let mut pulled = 0;
        // Pull what they have newer, except my own device folder.
        for (k, e) in &theirs_by {
            if self.me.device_id == e.device.as_str() {
                continue;
            }
            let newer = mine_by.get(k).is_none_or(|m| e.mtime_ms > m.mtime_ms || (e.mtime_ms == m.mtime_ms && e.size != m.size));
            if newer {
                if let Response::File(Some(bytes)) = request(conn, &Request::GetFile { device: e.device.clone(), name: e.name.clone() }).await? {
                    self.write_file(e, &bytes);
                    pulled += 1;
                }
            }
        }
        // Push what I have newer, except their own device folder.
        let their_device = self.state.lock().unwrap().membership.members.iter().find(|m| m.node == *conn.remote_id().as_bytes()).map(|m| m.device_id.clone());
        for (k, e) in &mine_by {
            if their_device.as_ref().is_some_and(|d| *d == e.device.as_str()) {
                continue;
            }
            let newer = theirs_by.get(k).is_none_or(|t| e.mtime_ms > t.mtime_ms || (e.mtime_ms == t.mtime_ms && e.size != t.size));
            if newer {
                if let Some(bytes) = self.read_file(&e.device, &e.name) {
                    request(conn, &Request::PutFile { entry: (*e).clone(), bytes }).await?;
                }
            }
        }
        if pulled > 0 {
            self.emit(Event::Synced { files: pulled }).await;
        }
        // A peer on an older version cannot answer this; its snapshots synced
        // all the same, so the round still counts.
        let _ = self.config_round(conn).await;
        // Likewise for attachments (ADR 0020).
        let _ = self.attachment_round(conn).await;
        // And Borders (ADR 0023).
        let _ = self.border_round(conn).await;
        Ok(())
    }

    /// Border files both ways, whole, newest stamp wins (ADR 0023): a Border
    /// is edited in place, so it travels like a config file, not a picture,
    /// and a deletion travels as a tombstone. `accept` and `forget` compare
    /// with what is on disk here, so a stale manifest never does harm.
    async fn border_round(&self, conn: &Connection) -> Result<(), String> {
        let mine = crate::border::manifest(&self.vault_root, &self.local_dir);
        let theirs = match request(conn, &Request::BorderManifest(mine.clone())).await? {
            Response::BorderManifest(t) => t,
            _ => return Err("bad border manifest reply".into()),
        };
        let (take, give) = crate::border::exchange(&mine, &theirs);
        let mut got = Vec::new();
        for e in take {
            if self.take_border(conn, e).await? {
                got.push(e.name.clone());
            }
        }
        for e in give {
            self.give_border(conn, e).await?;
        }
        if !got.is_empty() {
            self.emit(Event::Borders { names: got }).await;
        }
        Ok(())
    }

    /// Take a peer's newer Border, or its deletion. Returns whether anything
    /// changed here.
    async fn take_border(&self, conn: &Connection, e: &BorderEntry) -> Result<bool, String> {
        let (root, local) = (&self.vault_root, &self.local_dir);
        if e.deleted {
            return Ok(crate::border::forget(root, local, &e.name, e.stamp));
        }
        Ok(match request(conn, &Request::GetBorder(e.name.clone())).await? {
            Response::File(Some(bytes)) => crate::border::accept(root, local, &e.name, &bytes, e.stamp),
            _ => false,
        })
    }

    /// Give a peer this Device's newer Border, or its deletion.
    async fn give_border(&self, conn: &Connection, e: &BorderEntry) -> Result<(), String> {
        let req = if e.deleted {
            Some(Request::DeleteBorder(e.clone()))
        } else {
            crate::border::read_file(&self.vault_root, &e.name)
                .map(|bytes| Request::PutBorder { entry: e.clone(), bytes })
        };
        if let Some(req) = req {
            request(conn, &req).await?;
        }
        Ok(())
    }

    async fn attachment_round(&self, conn: &Connection) -> Result<(), String> {
        let mine = self.attachment_manifest();
        let theirs = match request(conn, &Request::AttachmentManifest(mine.clone())).await? {
            Response::AttachmentManifest(t) => t,
            _ => return Err("bad attachment manifest reply".into()),
        };
        let my_hashes: HashSet<[u8; 32]> = mine.iter().map(|e| e.hash).collect();
        let their_hashes: HashSet<[u8; 32]> = theirs.iter().map(|e| e.hash).collect();
        let mut got = Vec::new();
        let mut seen = HashSet::new();
        for e in &theirs {
            if my_hashes.contains(&e.hash) || !seen.insert(e.hash) || !Self::attachment_name_ok(&e.name) {
                continue;
            }
            if let Response::File(Some(bytes)) = request(conn, &Request::GetAttachment(e.name.clone())).await? {
                if let Some(name) = self.accept_attachment(e, &bytes) {
                    got.push(name);
                }
            }
        }
        let mut sent = HashSet::new();
        for e in &mine {
            if their_hashes.contains(&e.hash) || !sent.insert(e.hash) {
                continue;
            }
            if let Some(bytes) = self.read_attachment(&e.name) {
                request(conn, &Request::PutAttachment { entry: e.clone(), bytes }).await?;
            }
        }
        if !got.is_empty() {
            self.emit(Event::Attachments { names: got }).await;
        }
        Ok(())
    }

    /// Config files both ways, whole, newest stamp wins (ADR 0016).
    async fn config_round(&self, conn: &Connection) -> Result<(), String> {
        let mine = config::manifest(&self.hidden_dir);
        let theirs = match request(conn, &Request::ConfigManifest(mine.clone())).await? {
            Response::ConfigManifest(t) => t,
            _ => return Err("bad config manifest reply".into()),
        };
        let mine_by: HashMap<_, _> = mine.iter().map(|e| (e.name.as_str(), e)).collect();
        let theirs_by: HashMap<_, _> = theirs.iter().map(|e| (e.name.as_str(), e)).collect();
        let mut got = Vec::new();
        for e in &theirs {
            if config::is_newer(e, mine_by.get(e.name.as_str()).copied()) {
                if let Response::File(Some(bytes)) = request(conn, &Request::GetConfig(e.name.clone())).await? {
                    if config::accept(&self.hidden_dir, &e.name, &bytes) {
                        got.push(e.name.clone());
                    }
                }
            }
        }
        for e in &mine {
            if config::is_newer(e, theirs_by.get(e.name.as_str()).copied()) {
                if let Some(bytes) = config::read(&self.hidden_dir, &e.name) {
                    request(conn, &Request::PutConfig { name: e.name.clone(), bytes }).await?;
                }
            }
        }
        if !got.is_empty() {
            self.emit(Event::Config { names: got }).await;
        }
        Ok(())
    }

    // ---------------------------------------------------------------- files

    fn manifest(&self) -> Vec<Entry> {
        let mut out = Vec::new();
        let Ok(devices) = fs::read_dir(&self.sync_dir) else { return out };
        let removed = self.state.lock().unwrap().membership.removed_devices.clone();
        for d in devices.flatten() {
            if !d.path().is_dir() {
                continue;
            }
            // Only a folder named by a Device id is a Device's (#90).
            let Some(device) = DeviceId::parse(&d.file_name().to_string_lossy()) else { continue };
            // A retired Device's folder is not advertised, so a peer that
            // still holds it does not learn of it from here and mirroring
            // stops spreading it.
            if removed.contains(&device) {
                continue;
            }
            let device = String::from(device);
            if let Ok(files) = fs::read_dir(d.path()) {
                for f in files.flatten() {
                    let p = f.path();
                    if !p.is_file() {
                        continue;
                    }
                    let name = f.file_name().to_string_lossy().to_string();
                    if !(name.ends_with(".loro") || name == "device.json") {
                        continue;
                    }
                    let size = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                    out.push(Entry { device: device.clone(), name, size, mtime_ms: mtime_ms(&p) });
                }
            }
        }
        out
    }

    /// A name a peer sent is used as one path component on this Device, so it
    /// must stay one on every platform. On Windows `c:x` joins as a
    /// drive-relative path, `x:y` names an alternate data stream, and `CON` or
    /// a trailing dot is not the file it says; none of them is a name this app
    /// ever makes.
    fn safe(name: &str) -> bool {
        const RESERVED: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];
        let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
        let numbered = (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit();
        !name.is_empty()
            && name != "."
            && name != ".."
            && !name.ends_with(['.', ' '])
            && !name.chars().any(|c| c.is_control() || "/\\:<>\"|?*".contains(c))
            && !RESERVED.contains(&stem.as_str())
            && !numbered
    }

    fn read_file(&self, device: &str, name: &str) -> Option<Vec<u8>> {
        let device = DeviceId::parse(device)?;
        if !Self::safe(name) {
            return None;
        }
        fs::read(self.sync_dir.join(&device).join(name)).ok()
    }

    /// Store a snapshot a peer sent. The folder is named by a Device id,
    /// compared case-blind with this Device's own and the retired ones, since
    /// the disk may not tell `01abc` from `01ABC` (#90).
    fn write_file(&self, e: &Entry, bytes: &[u8]) {
        let Some(device) = DeviceId::parse(&e.device) else { return };
        if !Self::safe(&e.name) || device == self.me.device_id {
            return;
        }
        // A peer that has not yet merged the removal will still offer the
        // retired Device's snapshots; refusing them here is what keeps the
        // folder from coming back.
        if self.state.lock().unwrap().membership.removed_devices.contains(&device) {
            return;
        }
        let dir = self.sync_dir.join(&device);
        let _ = fs::create_dir_all(&dir);
        let path = dir.join(&e.name);
        // The file keeps the peer's time so every Device agrees on which copy
        // is newer, but a clock far ahead is pulled back to a day past this
        // one: a time near `i64::MAX` would win every round and does not fit
        // in a file time everywhere.
        let mtime = config::clamp_stamp(e.mtime_ms);
        if fs::read(&path).is_ok_and(|mine| mine == bytes) {
            // Nothing new. A fast clock offers the same file every round;
            // touching it would make it look freshly arrived each time.
            if config::plausible(e.mtime_ms) && e.mtime_ms > mtime_ms(&path) {
                Self::set_mtime(&path, mtime);
            }
            return;
        }
        let tmp = dir.join(format!("{}.part", e.name));
        if fs::write(&tmp, bytes).is_ok() && fs::rename(&tmp, &path).is_ok() {
            Self::set_mtime(&path, mtime);
        }
    }

    fn set_mtime(path: &Path, ms: i64) {
        if let Some(t) = config::file_time(ms) {
            let _ = fs::File::options().write(true).open(path).and_then(|f| f.set_modified(t));
        }
    }

    // ---------------------------------------------------------- attachments

    /// A plain picture name directly inside `Attachments/`: no separators, no
    /// dot-dot, not hidden, and a type we serve (ADR 0012).
    fn attachment_name_ok(name: &str) -> bool {
        Self::safe(name) && !name.starts_with('.') && !name.contains("..") && crate::attachments::is_supported(name)
    }

    fn attachment_manifest(&self) -> Vec<AttachmentEntry> {
        let mut out = Vec::new();
        let Ok(files) = fs::read_dir(&self.attachments_dir) else { return out };
        let mut cache = self.hashes.lock().unwrap();
        let mut present = HashSet::new();
        for f in files.flatten() {
            let p = f.path();
            let name = f.file_name().to_string_lossy().to_string();
            if !Self::attachment_name_ok(&name) {
                continue;
            }
            let Ok(meta) = fs::metadata(&p) else { continue };
            if !meta.is_file() || meta.len() as usize > MAX_FILE {
                continue;
            }
            let (size, mtime) = (meta.len(), mtime_ms(&p));
            let hash = match cache.get(&name) {
                Some(&(s, m, h)) if s == size && m == mtime => h,
                _ => {
                    let Ok(bytes) = fs::read(&p) else { continue };
                    let h = sha256(&bytes);
                    cache.insert(name.clone(), (size, mtime, h));
                    h
                }
            };
            present.insert(name.clone());
            out.push(AttachmentEntry { name, size, hash });
        }
        cache.retain(|n, _| present.contains(n));
        out
    }

    fn read_attachment(&self, name: &str) -> Option<Vec<u8>> {
        if !Self::attachment_name_ok(name) {
            return None;
        }
        fs::read(self.attachments_dir.join(name)).ok().filter(|b| b.len() <= MAX_FILE)
    }

    /// Store a picture a peer sent, and return the vault-relative path it was
    /// stored under, or `None` when nothing was written.
    ///
    /// Never overwrites: a name this Device already uses for other bytes keeps
    /// them, and the incoming picture takes the next free name, `name 2.ext`
    /// (ADR 0020). Bytes that do not match the advertised hash are refused.
    fn accept_attachment(&self, e: &AttachmentEntry, bytes: &[u8]) -> Option<String> {
        if !Self::attachment_name_ok(&e.name) || bytes.len() > MAX_FILE || sha256(bytes) != e.hash {
            return None;
        }
        let _ = fs::create_dir_all(&self.attachments_dir);
        // Two peers can deliver different bytes under one name at once. Picking
        // the name and renaming into it is not atomic, so without this both
        // would pick `name 2.ext` and the second rename would replace the first.
        static ACCEPTING: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _one_at_a_time = ACCEPTING.lock().unwrap_or_else(|p| p.into_inner());
        let name = free_attachment_name(&self.attachments_dir, &e.name, &e.hash)?;
        let dest = self.attachments_dir.join(&name);
        if dest.exists() {
            // Already here under that name, byte for byte.
            return None;
        }
        // Hidden and not a picture type, so a half-written file is never
        // advertised or shown.
        let tmp = self.attachments_dir.join(format!(".{name}.part"));
        if fs::write(&tmp, bytes).is_err() || fs::rename(&tmp, &dest).is_err() {
            let _ = fs::remove_file(&tmp);
            return None;
        }
        Some(format!("{}/{name}", crate::attachments::FOLDER))
    }

    pub async fn shutdown(&self) {
        self.endpoint.close().await;
    }
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    use sha2::Digest as _;
    sha2::Sha256::digest(bytes).into()
}

/// The name an incoming picture is stored under: its own when free or already
/// holding the same bytes, else the first `stem N.ext` that is (ADR 0020).
fn free_attachment_name(dir: &Path, name: &str, hash: &[u8; 32]) -> Option<String> {
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, e),
        _ => return None,
    };
    for n in 1..10_000 {
        let candidate = if n == 1 { name.to_string() } else { format!("{stem} {n}.{ext}") };
        match fs::read(dir.join(&candidate)) {
            Err(_) => return Some(candidate),
            Ok(existing) if &sha256(&existing) == hash => return Some(candidate),
            Ok(_) => continue,
        }
    }
    None
}

async fn request(conn: &Connection, req: &Request) -> Result<Response, String> {
    let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
    let bytes = postcard::to_allocvec(req).map_err(|e| e.to_string())?;
    send.write_all(&bytes).await.map_err(|e| e.to_string())?;
    send.finish().map_err(|e| e.to_string())?;
    let reply = recv.read_to_end(MAX_FILE + 4096).await.map_err(|e| e.to_string())?;
    postcard::from_bytes(&reply).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_peer_name_stays_one_path_component() {
        for ok in ["01ABC.loro", "device.json", "01JDEVICE", "athens 2.png"] {
            assert!(Node::safe(ok), "{ok}");
        }
        for bad in [
            "", ".", "..", "a/b", "a\\b", "c:map.png", "x:y.png", "CON", "nul.png", "com1.loro",
            "lpt9", "trailing.", "trailing ", "a|b", "a?b", "a*b", "a<b", "a\"b", "tab\there",
        ] {
            assert!(!Node::safe(bad), "{bad:?}");
        }
    }

    fn member(device: &DeviceId, name: &str) -> Member {
        Member { node: [0; 32], device_id: device.clone(), name: name.into(), platform: "test".into() }
    }

    fn id() -> DeviceId {
        DeviceId::generate()
    }

    fn with_node(node: u8, device: &DeviceId, name: &str) -> Member {
        Member { node: [node; 32], ..member(device, name) }
    }

    async fn start(dir: &Path, me: Member) -> Arc<Node> {
        let (tx, _rx) = mpsc::channel(64);
        Node::start(dir, &dir.join("device"), &dir.join("local"), me, Some(String::new()), tx).await.unwrap()
    }

    #[test]
    fn invite_roundtrip_and_membership_merge() {
        let inv = Invite {
            host: [7; 32],
            relay: Some("https://relay.example".into()),
            secret: [9; 32],
            vault_id: "01VAULT".into(),
            vault_name: "main".into(),
        };
        let code = inv.encode();
        assert!(code.starts_with("synesis:"));
        assert_eq!(Invite::decode(&code), Some(inv));
        assert_eq!(Invite::decode("nope"), None);

        let (da, db) = (id(), id());
        let mut a = Membership { version: 1, members: vec![with_node(1, &da, "A")], ..Default::default() };
        let b = Membership { version: 2, members: vec![with_node(1, &da, "A"), with_node(2, &db, "B")], removed: vec![[3; 32]], ..Default::default() };
        assert!(a.merge(&b));
        assert_eq!(a.version, 2);
        assert_eq!(a.members.len(), 2);
        let older = Membership { version: 1, removed: vec![[4; 32]], ..Default::default() };
        assert!(a.merge(&older));
        assert!(a.removed.contains(&[4; 32]) && a.removed.contains(&[3; 32]));
    }

    /// #65: two Devices each approve a different newcomer while apart. When
    /// they meet, both keep both, whatever their versions.
    #[test]
    fn members_approved_apart_are_both_kept() {
        let (dx, dy, dp, dq) = (id(), id(), id(), id());
        let base = vec![with_node(1, &dx, "X"), with_node(2, &dy, "Y")];
        let mut x = Membership { version: 5, members: [base.clone(), vec![with_node(3, &dp, "Phone")]].concat(), ..Default::default() };
        let mut y = Membership { version: 5, members: [base.clone(), vec![with_node(4, &dq, "Tablet")]].concat(), ..Default::default() };
        let (x0, y0) = (x.clone(), y.clone());
        assert!(x.merge(&y0));
        assert!(y.merge(&x0));
        for m in [&x, &y] {
            assert!(m.is_member(&[3; 32]) && m.is_member(&[4; 32]), "an approved Device was dropped: {m:?}");
        }
        // And with one side ahead: the higher version no longer replaces the list.
        let mut behind = Membership { version: 1, members: [base.clone(), vec![with_node(3, &dp, "Phone")]].concat(), ..Default::default() };
        let ahead = Membership { version: 9, members: base, ..Default::default() };
        behind.merge(&ahead);
        assert!(behind.is_member(&[3; 32]), "a newer membership dropped a member");
    }

    /// #65: a removal and an approval of the same Device made apart: the
    /// removal wins, on both sides.
    #[test]
    fn a_removal_wins_over_an_approval_made_apart() {
        let dp = id();
        let mut approving = Membership { version: 7, members: vec![with_node(3, &dp, "Phone")], ..Default::default() };
        let mut removing = Membership { version: 2, removed: vec![[3; 32]], removed_devices: vec![dp.clone()], ..Default::default() };
        let (a0, r0) = (approving.clone(), removing.clone());
        approving.merge(&r0);
        removing.merge(&a0);
        assert!(!approving.is_member(&[3; 32]) && !removing.is_member(&[3; 32]));
        assert!(approving.members.is_empty() && removing.members.is_empty());
    }

    /// #85: a peer claiming a huge version neither takes the list over nor
    /// stops this Device from changing anything afterwards, and the secrets
    /// never move in a merge.
    #[test]
    fn a_huge_version_takes_nothing_over() {
        let (dx, dm) = (id(), id());
        let mut mine = Membership { version: 3, vault_key: Some([1; 32]), invite_secret: Some([2; 32]), members: vec![with_node(1, &dx, "X")], ..Default::default() };
        let hostile = Membership {
            version: u64::MAX,
            vault_key: Some([9; 32]),
            invite_secret: Some([9; 32]),
            members: vec![with_node(1, &dx, "Renamed"), with_node(8, &dm, "Mallory")],
            ..Default::default()
        };
        mine.merge(&hostile);
        assert_eq!(mine.vault_key, Some([1; 32]), "the vault key came from a merge");
        assert_eq!(mine.invite_secret, Some([2; 32]), "the invite secret came from a merge");
        assert_eq!(mine.version, 3, "an absurd version was adopted");
        assert_eq!(mine.members[0].name, "X", "an absurd version renamed a member");
        assert!(mine.is_member(&[1; 32]));
        // Mallory is a member now (a member admitted it), and can be removed for good.
        mine.removed.push([8; 32]);
        mine.bump();
        mine.merge(&hostile);
        assert!(!mine.is_member(&[8; 32]), "a removal was undone by a huge version");
        // Bumping at the top saturates rather than panicking under the lock.
        let mut top = Membership { version: u64::MAX, ..Default::default() };
        top.bump();
        assert_eq!(top.version, u64::MAX);
    }

    /// A member another Device sends cannot claim a retired id, or a folder
    /// a member already holds, and keeps its labels short (#89, #90).
    #[test]
    fn a_merged_member_cannot_claim_a_folder() {
        let (dx, retired) = (id(), id());
        let mut mine = Membership { members: vec![with_node(1, &dx, "X")], removed_devices: vec![retired.clone()], ..Default::default() };
        let long = "n".repeat(10_000);
        let theirs = Membership {
            members: vec![with_node(2, &dx, "Thief"), with_node(3, &retired, "Ghost"), with_node(4, &id(), &long)],
            ..Default::default()
        };
        mine.merge(&theirs);
        assert!(!mine.is_member(&[2; 32]), "a second node took a member's folder");
        assert!(!mine.is_member(&[3; 32]), "a retired id came back through a merge");
        let kept = mine.members.iter().find(|m| m.node == [4; 32]).unwrap();
        assert_eq!(kept.name.chars().count(), MAX_LABEL);
    }

    /// #89: what each kind of peer is told about the membership.
    #[test]
    fn secrets_stay_on_this_device() {
        let m = Membership {
            version: 4,
            vault_key: Some([1; 32]),
            invite_secret: Some([2; 32]),
            members: vec![with_node(1, &id(), "X")],
            removed: vec![[5; 32]],
            removed_devices: vec![id()],
        };
        let public = m.public();
        assert!(public.vault_key.is_none() && public.invite_secret.is_none());
        assert_eq!(public.members, m.members);
        let joiner = m.for_joiner();
        assert_eq!(joiner.vault_key, m.vault_key);
        assert!(joiner.invite_secret.is_none());
        let removed = m.for_removed();
        assert!(removed.vault_key.is_none() && removed.invite_secret.is_none() && removed.members.is_empty());
        assert_eq!((removed.version, &removed.removed, &removed.removed_devices), (4, &m.removed, &m.removed_devices));
    }

    /// A retired Device's folder is named by its device id, and that travels
    /// between peers the way the node removal does: a newer membership never
    /// drops what this one already knew, so the folder cannot come back by
    /// meeting a peer that has not heard of the removal yet.
    #[test]
    fn a_removed_device_is_never_forgotten_by_a_merge() {
        let (phone, tablet, laptop) = (id(), id(), id());
        let mut a = Membership { version: 1, removed_devices: vec![phone.clone()], ..Default::default() };
        let newer = Membership { version: 9, removed_devices: vec![tablet.clone()], ..Default::default() };
        assert!(a.merge(&newer));
        assert!(a.removed_devices.contains(&phone), "a newer membership dropped a removal");
        assert!(a.removed_devices.contains(&tablet));

        // An older peer's removal is still taken, and taken only once.
        let older = Membership { version: 1, removed_devices: vec![laptop.clone(), phone.clone()], ..Default::default() };
        assert!(a.merge(&older));
        assert_eq!(a.removed_devices.iter().filter(|d| **d == phone).count(), 1);
        assert!(a.removed_devices.contains(&laptop));

        // Nothing new to learn.
        assert!(!a.merge(&older));
    }

    /// Retiring a Device by its folder name reaches one that is still a member
    /// and one that never was — a Device retired before removals were recorded
    /// is known by its folder alone, and that is the Device to stop trusting.
    #[tokio::test]
    async fn a_device_can_be_retired_by_its_folder_alone() {
        let dir = tempfile::tempdir().unwrap();
        let node = start(dir.path(), member(&id(), "Self")).await;

        // A Device that is still a member: the folder and the peer both go.
        let paired = [7u8; 32];
        let tablet = id();
        {
            let mut st = node.state.lock().unwrap();
            st.membership.members.push(Member { node: paired, ..member(&tablet, "Tablet") });
        }
        node.forget_device(&tablet);
        let m = node.membership();
        assert!(m.removed_devices.contains(&tablet));
        assert!(!m.is_member(&paired), "the retired Device is still a member");

        // A Device that never paired through this roster, which is how the
        // phone whose folder outlived it looks. No node id to go by.
        let ghost = id();
        node.forget_device(&ghost);
        let m = node.membership();
        assert!(m.removed_devices.contains(&ghost), "a folder-only Device could not be retired");

        // Idempotent, and it persists for the next Sync to read.
        let before = node.membership().version;
        node.forget_device(&ghost);
        assert_eq!(node.membership().version, before, "retiring twice bumped the version");
        let saved = fs::read_to_string(dir.path().join("local").join(MEMBERSHIP_FILE)).unwrap();
        assert!(saved.contains(ghost.as_str()), "the retirement was not written for sync to read");
        node.shutdown().await;
    }

    /// #89: a retired id is never re-admitted, even by approval: a removal
    /// that one Device lifted would come back from every peer that still has
    /// it, and the retired folder's old snapshots with it. A wiped Device comes
    /// back with a fresh id, and that one is admitted.
    #[tokio::test]
    async fn approving_a_retired_device_id_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let node = start(dir.path(), member(&id(), "Self")).await;

        let phone = id();
        let their_node = [42u8; 32];
        node.forget_device(&phone);

        node.state.lock().unwrap().pending.push(Member { node: their_node, ..member(&phone, "Phone") });
        assert!(!node.approve(&their_node, true), "a retired id was admitted");
        let m = node.membership();
        assert!(m.removed_devices.contains(&phone), "approval lifted a retirement");
        assert!(!m.is_member(&their_node));

        // A lowercase spelling of the same id is the same id (#90).
        let sneaky = DeviceId::parse(&phone.as_str().to_lowercase()).unwrap();
        node.state.lock().unwrap().pending.push(Member { node: their_node, ..member(&sneaky, "Phone") });
        assert!(!node.approve(&their_node, true), "a lowercased retired id was admitted");

        // Wiped and paired again under a fresh id: admitted.
        node.state.lock().unwrap().pending.push(Member { node: their_node, ..member(&id(), "Phone") });
        assert!(node.approve(&their_node, true));
        assert!(node.membership().is_member(&their_node));

        // A removed node stays removed whatever id it brings.
        node.remove(&their_node);
        node.state.lock().unwrap().pending.push(Member { node: their_node, ..member(&id(), "Phone") });
        assert!(!node.approve(&their_node, true), "a removed node was admitted again");
        node.shutdown().await;
    }

    /// #89: an Invite is single use and expires; removing a Device replaces
    /// the vault key and the Invite.
    #[tokio::test]
    async fn an_invite_is_single_use_and_expires() {
        let dir = tempfile::tempdir().unwrap();
        let node = start(dir.path(), member(&id(), "Self")).await;

        let (first, left) = node.invite();
        assert!(left <= INVITE_TTL && left > INVITE_TTL - Duration::from_secs(5));
        assert_eq!(node.invite().0.secret, first.secret, "showing the code again changed it");
        assert!(node.state.lock().unwrap().invite_open(&first.secret));
        assert!(!node.state.lock().unwrap().invite_open(&[0; 32]));

        // Used: an approval closes it.
        node.state.lock().unwrap().pending.push(Member { node: [5; 32], ..member(&id(), "Phone") });
        assert!(node.approve(&[5; 32], true));
        assert!(!node.state.lock().unwrap().invite_open(&first.secret), "an Invite admitted a second Device");
        let (second, _) = node.invite();
        assert_ne!(second.secret, first.secret);

        // Expired: the window has passed.
        node.state.lock().unwrap().invite_issued = Some(Instant::now() - INVITE_TTL);
        assert!(!node.state.lock().unwrap().invite_open(&second.secret), "an expired Invite still opened");
        let (third, _) = node.invite();
        assert_ne!(third.secret, second.secret, "an expired Invite was shown again");

        // Removing a Device replaces the key and closes the Invite.
        let key = node.membership().vault_key;
        node.remove(&[5; 32]);
        assert_ne!(node.membership().vault_key, key, "the vault key survived a removal");
        assert!(!node.state.lock().unwrap().invite_open(&third.secret), "an Invite survived a removal");

        // A removal learnt from a peer does the same.
        let (fourth, _) = node.invite();
        let key = node.membership().vault_key;
        let theirs = Membership { removed: vec![[6; 32]], ..Default::default() };
        assert!(node.state.lock().unwrap().merge(&theirs));
        assert_ne!(node.membership().vault_key, key);
        assert!(!node.state.lock().unwrap().invite_open(&fourth.secret));
        node.shutdown().await;
    }

    /// #66: damaged pairing data is an error, not a fresh start: an empty
    /// membership would forget every removal, a new key a new identity.
    #[tokio::test]
    async fn damaged_pairing_data_does_not_start_afresh() {
        let dir = tempfile::tempdir().unwrap();
        let local = dir.path().join("local");
        fs::create_dir_all(&local).unwrap();
        fs::write(local.join(MEMBERSHIP_FILE), "{\"version\": 3, \"removed_dev").unwrap();
        let (tx, _rx) = mpsc::channel(4);
        let err = Node::start(dir.path(), &dir.path().join("device"), &local, member(&id(), "Self"), Some(String::new()), tx).await.err().expect("a torn pairing.json was read as empty");
        assert!(err.to_string().contains("damaged"), "{err}");
        assert!(fs::read_to_string(local.join(MEMBERSHIP_FILE)).unwrap().contains("removed_dev"), "the damaged file was overwritten");

        let other = tempfile::tempdir().unwrap();
        fs::create_dir_all(other.path().join("device")).unwrap();
        fs::write(other.path().join("device").join(KEY_FILE), "abc").unwrap();
        assert!(node_secret(&other.path().join("device")).is_err(), "a torn node key was replaced");

        // A good save is whole, with no temporary file left beside it.
        let m = Membership { version: 2, removed_devices: vec![id()], ..Default::default() };
        let fresh = other.path().join("fresh");
        m.save(&fresh).unwrap();
        assert_eq!(Membership::load(&fresh).unwrap(), m);
        assert_eq!(fs::read_dir(&fresh).unwrap().count(), 1);
    }

    /// #89, #70: a stranger with a used, expired or wrong Invite is told so;
    /// a removed Device gets no secrets; join requests are capped.
    #[tokio::test]
    async fn strangers_get_little() {
        let dir = tempfile::tempdir().unwrap();
        let vault_a = dir.path().join("a");
        let vault_s = dir.path().join("s");
        let a = start(&vault_a, member(&id(), "A")).await;
        let s = start(&vault_s, member(&id(), "Stranger")).await;
        let addr = a.addr();
        let ask = |req: Request| {
            let (s, addr) = (s.clone(), addr.clone());
            async move {
                let conn = s.endpoint.connect(addr, ALPN).await.unwrap();
                request(&conn, &req).await
            }
        };
        let me = Member { node: [0; 32], ..member(&id(), "Stranger") };

        // A wrong secret, and then a stale one.
        let (invite, _) = a.invite();
        assert!(matches!(ask(Request::Join { secret: [0; 32], member: me.clone() }).await, Ok(Response::Expired)));
        a.revoke_invite();
        assert!(matches!(ask(Request::Join { secret: invite.secret, member: me.clone() }).await, Ok(Response::Expired)));

        // A good one: pending, with its labels capped.
        let (invite, _) = a.invite();
        let long = Member { name: "x".repeat(5_000), ..me.clone() };
        assert!(matches!(ask(Request::Join { secret: invite.secret, member: long }).await, Ok(Response::Pending)));
        assert_eq!(a.status().pending[0].name.chars().count(), MAX_LABEL);

        // A request bigger than a join is refused before it is read whole.
        let big = Request::PutFile { entry: Entry { device: id().into(), name: "x.loro".into(), size: 0, mtime_ms: 0 }, bytes: vec![0; 64 * 1024] };
        assert!(ask(big).await.is_err(), "a stranger's large request was read");

        // A removed Device learns of its removal and nothing else.
        let node_s = s.id();
        {
            let mut st = a.state.lock().unwrap();
            st.pending.clear();
            st.membership.members.push(Member { node: node_s, ..member(&id(), "Stranger") });
        }
        a.remove(&node_s);
        match ask(Request::Membership(Membership::default())).await {
            Ok(Response::Membership(m)) => {
                assert!(m.removed.contains(&node_s));
                assert!(m.vault_key.is_none() && m.invite_secret.is_none() && m.members.is_empty(), "a removed Device was told the secrets: {m:?}");
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(ask(Request::Join { secret: a.invite().0.secret, member: me.clone() }).await, Ok(Response::Denied)));

        // At most MAX_PENDING requests wait; the oldest goes.
        for i in 0..(MAX_PENDING as u8 + 3) {
            a.state.lock().unwrap().add_pending(Member { node: [100 + i; 32], ..member(&id(), "N") });
        }
        let pending = a.status().pending;
        assert_eq!(pending.len(), MAX_PENDING);
        assert_eq!(pending[0].node, [103; 32], "the oldest requests were not the ones dropped");
        a.shutdown().await;
        s.shutdown().await;
    }

    /// #90: a peer cannot write into this Device's own folder or a retired
    /// one by spelling its id in lower case, nor anywhere that is not a
    /// Device id.
    #[tokio::test]
    async fn a_peer_cannot_spell_a_folder_differently() {
        let dir = tempfile::tempdir().unwrap();
        let mine = id();
        let node = start(dir.path(), member(&mine, "Self")).await;
        let retired = id();
        node.forget_device(&retired);
        let entry = |device: String| Entry { device, name: "DOC.loro".into(), size: 3, mtime_ms: 0 };
        for device in [mine.as_str().to_lowercase(), retired.as_str().to_lowercase(), "..".into(), "phone".into()] {
            node.write_file(&entry(device.clone()), b"bad");
            assert!(node.read_file(&device, "DOC.loro").is_none(), "{device} was written");
        }
        let sync = dir.path().join(HIDDEN_DIR).join(SYNC_DIR);
        assert!(!sync.exists() || fs::read_dir(&sync).unwrap().count() == 0, "a folder was made");
        // A good id in lower case lands in its canonical folder.
        let other = id();
        node.write_file(&entry(other.as_str().to_lowercase()), b"ok!");
        assert_eq!(fs::read(sync.join(other.as_str()).join("DOC.loro")).unwrap(), b"ok!");
        node.shutdown().await;
    }

    /// Two nodes on one machine, relays disabled: invite, join, approve, then
    /// a snapshot written on A shows up in B's sync folder — in seconds, even
    /// with a member A can never reach, and both sides see each other online.
    #[tokio::test]
    async fn pair_and_mirror_locally() {
        let dir = tempfile::tempdir().unwrap();
        let vault_a = dir.path().join("a");
        let vault_b = dir.path().join("b");
        for v in [&vault_a, &vault_b] {
            fs::create_dir_all(v.join(HIDDEN_DIR).join(SYNC_DIR)).unwrap();
        }
        let (tx_a, mut rx_a) = mpsc::channel(64);
        let (tx_b, mut rx_b) = mpsc::channel(64);
        let dev_a = id();
        let a = Node::start(&vault_a, &dir.path().join("dev-a"), &dir.path().join("local-a"), member(&dev_a, "A"), Some(String::new()), tx_a).await.unwrap();
        let b = Node::start(&vault_b, &dir.path().join("dev-b"), &dir.path().join("local-b"), member(&id(), "B"), Some(String::new()), tx_b).await.unwrap();

        // Without relays the invite carries no address; give B A's direct addresses.
        let mut invite = a.invite().0;
        invite.relay = None;
        let addr = a.addr();
        // Seed B's address book by connecting once through the explicit addr.
        b.endpoint.connect(addr.clone(), ALPN).await.ok();
        b.join(invite);

        let join = tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                if let Some(Event::JoinRequest { node, .. }) = rx_a.recv().await {
                    return node;
                }
            }
        })
        .await
        .expect("A hears the join request");
        let node_b: NodeId = hex::decode(join).unwrap().try_into().unwrap();
        // A member that is never online: dialling it must not hold up B.
        {
            let gone = *SecretKey::generate().public().as_bytes();
            let mut st = a.state.lock().unwrap();
            st.membership.members.push(Member { node: gone, ..member(&id(), "Gone") });
        }
        assert!(a.approve(&node_b, true));
        tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                if let Some(Event::Approved) = rx_b.recv().await {
                    return;
                }
            }
        })
        .await
        .expect("B is approved");
        assert!(b.membership().is_member(&a.id()));
        // The joiner has the vault key, and not the host's Invite secret.
        assert_eq!(b.membership().vault_key, a.membership().vault_key);
        assert!(b.membership().invite_secret.is_none(), "the host's Invite secret travelled");

        // One connection, online on both sides, not only the side that accepted it.
        let (hex_a, hex_b) = (node_id_hex(&a.id()), node_id_hex(&node_b));
        tokio::time::timeout(Duration::from_secs(5), async {
            while !(a.status().connected.contains(&hex_b) && b.status().connected.contains(&hex_a)) {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await
        .expect("A and B both see the other online");

        // A publishes a snapshot; B receives it in A's device folder.
        let snap = vault_a.join(HIDDEN_DIR).join(SYNC_DIR).join(&dev_a);
        fs::create_dir_all(&snap).unwrap();
        fs::write(snap.join("DOC1.loro"), b"snapshot bytes").unwrap();
        a.notify_changed();
        let target = vault_b.join(HIDDEN_DIR).join(SYNC_DIR).join(&dev_a).join("DOC1.loro");
        tokio::time::timeout(Duration::from_secs(3), async {
            while fs::read(&target).ok().as_deref() != Some(b"snapshot bytes") {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        })
        .await
        .expect("B mirrors A's snapshot");

        // Config files travel too (ADR 0016): a Skin written on B reaches A.
        config::write(&vault_b.join(HIDDEN_DIR), "skins/sepia.json", serde_json::json!({ "name": "Sepia" })).unwrap();
        b.notify_changed();
        let skin = vault_a.join(HIDDEN_DIR).join("skins").join("sepia.json");
        tokio::time::timeout(Duration::from_secs(3), async {
            while !fs::read_to_string(&skin).unwrap_or_default().contains("Sepia") {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        })
        .await
        .expect("A receives B's Skin");

        // Pictures travel too (ADR 0020): A's reaches B; B's own picture of
        // the same name is kept and A's lands beside it; a non-picture stays.
        let att_a = vault_a.join(crate::attachments::FOLDER);
        let att_b = vault_b.join(crate::attachments::FOLDER);
        fs::create_dir_all(&att_a).unwrap();
        fs::create_dir_all(&att_b).unwrap();
        fs::write(att_b.join("athens.png"), b"B's athens").unwrap();
        fs::write(att_a.join("athens.png"), b"A's athens").unwrap();
        fs::write(att_a.join("paul.jpg"), b"paul bytes").unwrap();
        fs::write(att_a.join("page.html"), b"<html>").unwrap();
        a.notify_changed();
        tokio::time::timeout(Duration::from_secs(5), async {
            while !(att_b.join("paul.jpg").exists() && att_b.join("athens 2.png").exists()) {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        })
        .await
        .expect("B receives A's pictures");
        assert_eq!(fs::read(att_b.join("paul.jpg")).unwrap(), b"paul bytes");
        assert_eq!(fs::read(att_b.join("athens.png")).unwrap(), b"B's athens", "B's own picture is never overwritten");
        assert_eq!(fs::read(att_b.join("athens 2.png")).unwrap(), b"A's athens");
        assert!(!att_b.join("page.html").exists(), "only pictures travel");
        // The next rounds settle: nothing is fetched again under yet another name.
        a.notify_changed();
        b.notify_changed();
        tokio::time::sleep(Duration::from_secs(1)).await;
        assert!(!att_b.join("athens 3.png").exists());
        assert!(!att_a.join("athens 3.png").exists());
        assert_eq!(fs::read(att_a.join("athens.png")).unwrap(), b"A's athens");

        // Borders travel too (ADR 0023): drawn on A, then edited on B. Only
        // the files a region names: another GeoJSON file stays where it is.
        let rel = "Places/Judah.geojson";
        let (local_a, local_b) = (dir.path().join("local-a"), dir.path().join("local-b"));
        crate::border::write(&vault_a, rel, &[[31.0, 35.0], [31.0, 36.0], [32.0, 36.0]]).unwrap();
        crate::border::write(&vault_a, "Maps/roads.geojson", &[[31.0, 35.0], [31.0, 36.0], [32.0, 36.0]]).unwrap();
        crate::border::set_named(&local_a, [rel.to_string()]).unwrap();
        a.notify_changed();
        tokio::time::timeout(Duration::from_secs(5), async {
            while !vault_b.join(rel).exists() {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        })
        .await
        .expect("B receives A's Border");
        assert!(!vault_b.join("Maps/roads.geojson").exists(), "a file no region names travelled");
        crate::border::set_named(&local_b, [rel.to_string()]).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        crate::border::write(&vault_b, rel, &[[30.0, 35.0], [31.0, 36.0], [32.0, 36.0]]).unwrap();
        b.notify_changed();
        let edited = fs::read(vault_b.join(rel)).unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while fs::read(vault_a.join(rel)).ok().as_ref() != Some(&edited) {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        })
        .await
        .expect("A receives B's edit of the Border");
        // Deleted on A: B drops its copy rather than pushing it back.
        crate::border::remove(&vault_a, &local_a, rel).unwrap();
        crate::border::set_named(&local_a, Vec::<String>::new()).unwrap();
        a.notify_changed();
        tokio::time::timeout(Duration::from_secs(5), async {
            while vault_b.join(rel).exists() {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        })
        .await
        .expect("B deletes the Border A deleted");
        b.notify_changed();
        tokio::time::sleep(Duration::from_secs(1)).await;
        assert!(!vault_a.join(rel).exists(), "a deleted Border came back");

        // Each remembers the other's own address for the next dial.
        for (local, peer) in [("local-a", &hex_b), ("local-b", &hex_a)] {
            let saved = fs::read_to_string(dir.path().join(local).join(PEERS_FILE)).unwrap_or_default();
            assert!(saved.contains(peer.as_str()), "{local} did not remember its peer's address");
        }

        // Removal propagates: A removes B, B learns it on the next round.
        a.remove(&node_b);
        tokio::time::timeout(Duration::from_secs(5), async {
            while b.membership().is_member(&node_b) {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        })
        .await
        .expect("B sees its removal");
        a.shutdown().await;
        b.shutdown().await;
    }

    /// A snapshot stamped near `i64::MAX` by a peer is kept, but its time is
    /// pulled back to a day past this clock, so it neither wins every round
    /// nor overflows a file time (#83). Offered again unchanged, it is left
    /// alone rather than touched as if freshly arrived.
    #[tokio::test]
    async fn a_far_future_snapshot_time_is_pulled_back() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, _rx) = mpsc::channel(16);
        let node = Node::start(dir.path(), &dir.path().join("device"), &dir.path().join("local"), member("self", "Self"), Some(String::new()), tx).await.unwrap();
        let entry = Entry { device: "phone".into(), name: "DOC.loro".into(), size: 3, mtime_ms: i64::MAX };
        node.write_file(&entry, b"abc");
        let path = node.sync_dir.join("phone").join("DOC.loro");
        assert_eq!(fs::read(&path).unwrap(), b"abc");
        let stamped = mtime_ms(&path);
        assert!(stamped > config::now_ms() && stamped <= config::now_ms() + config::MAX_SKEW_MS, "{stamped}");

        std::thread::sleep(Duration::from_millis(20));
        node.write_file(&entry, b"abc");
        assert_eq!(mtime_ms(&path), stamped, "an unchanged snapshot was touched again");

        // A real update from that Device still lands.
        let update = Entry { size: 4, mtime_ms: config::now_ms(), ..entry };
        node.write_file(&update, b"abcd");
        assert_eq!(fs::read(&path).unwrap(), b"abcd");
        node.shutdown().await;
    }
}
