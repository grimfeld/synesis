//! Pairing: a peer-to-peer transport over Iroh (ADR 0008).
//!
//! Paired Devices mirror each other's `<vault>/.bible-study/sync/<device>/`
//! folders. Nothing else changes: the folder-sync importer (sync.rs) picks
//! the received snapshots up exactly as if a cloud folder had delivered them.
//!
//! One vault = one membership (members, removed nodes, vault key, invite
//! secret), kept per Device in the vault's local data directory and merged
//! between peers by version number. Joining: the newcomer connects to the
//! node named in the Invite, sends the invite secret, and polls until a
//! paired Device approves it and hands over the membership.
//!
//! Protocol (ALPN `synesis/sync/1`): one bidirectional stream per request,
//! postcard-encoded `Request` then `Response`. A "round" between two peers
//! exchanges memberships, then manifests, then pushes and pulls the snapshot
//! files each side lacks. Rounds run on connect, on local change, and every
//! 30 seconds.
//!
//! One connection per peer is kept open and reused by both sides' rounds, so a
//! peer is online for as long as it is reachable, not just during a round. An
//! unreachable peer is retried soon (1s, doubling up to 30s), each dial is
//! bounded, and peers are dialled in parallel so one gone Device cannot hold
//! up the others. Each peer's own address (home relay, direct addresses) is
//! remembered in `peers.json`, so the next dial goes straight to it instead
//! of waiting on address lookup.

use crate::sync::SYNC_DIR;
use crate::vault::HIDDEN_DIR;
use base64::Engine as _;
use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode, RelayUrl, SecretKey};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};
use tokio::sync::{mpsc, Notify};

pub const ALPN: &[u8] = b"synesis/sync/1";
const MEMBERSHIP_FILE: &str = "pairing.json";
const KEY_FILE: &str = "pairing.key";
const MAX_FILE: usize = 64 * 1024 * 1024;
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
    /// The Device's sync folder name (`sync/<device>/`).
    pub device_id: String,
    pub name: String,
    pub platform: String,
}

/// Everything a Device knows about who shares this vault. Merged by `version`.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct Membership {
    pub version: u64,
    pub vault_key: Option<[u8; 32]>,
    pub invite_secret: Option<[u8; 32]>,
    pub members: Vec<Member>,
    pub removed: Vec<NodeId>,
    /// The sync folder of every Device ever removed, so a removal can reach
    /// the folder as well as the peer: a node id names a peer, and the
    /// snapshots live under a device id. Never forgotten, for the same reason
    /// `removed` is not — a retired Device that reappears is not trusted again
    /// by virtue of reappearing. Read by `sync::Roster`.
    #[serde(default)]
    pub removed_devices: Vec<String>,
}

impl Membership {
    fn load(dir: &Path) -> Membership {
        fs::read_to_string(dir.join(MEMBERSHIP_FILE)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }
    fn save(&self, dir: &Path) {
        let _ = fs::create_dir_all(dir);
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = fs::write(dir.join(MEMBERSHIP_FILE), json);
        }
    }
    pub fn is_member(&self, node: &NodeId) -> bool {
        !self.removed.contains(node) && self.members.iter().any(|m| &m.node == node)
    }
    /// Take whichever side is newer; removals are never forgotten.
    fn merge(&mut self, other: &Membership) -> bool {
        let mut changed = false;
        if other.version > self.version {
            let mut removed = self.removed.clone();
            let mut removed_devices = self.removed_devices.clone();
            *self = other.clone();
            for r in removed.drain(..) {
                if !self.removed.contains(&r) {
                    self.removed.push(r);
                }
            }
            for d in removed_devices.drain(..) {
                if !self.removed_devices.contains(&d) {
                    self.removed_devices.push(d);
                }
            }
            changed = true;
        } else {
            for r in &other.removed {
                if !self.removed.contains(r) {
                    self.removed.push(*r);
                    changed = true;
                }
            }
            for d in &other.removed_devices {
                if !self.removed_devices.contains(d) {
                    self.removed_devices.push(d.clone());
                    changed = true;
                }
            }
        }
        if changed {
            self.members.retain(|m| !self.removed.contains(&m.node));
        }
        changed
    }
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
    pending: HashMap<NodeId, Member>,
    /// The live connection to each member, whoever dialled it.
    conns: HashMap<NodeId, Connection>,
    /// Members a dial is in flight to, so a pass never starts a second one.
    dialing: HashSet<NodeId>,
    /// Each peer's last self-reported address (`peers.json`).
    addrs: HashMap<NodeId, EndpointAddr>,
    joining: Option<Invite>,
}

pub struct Node {
    endpoint: Endpoint,
    /// Which Vault this node is pairing for, so an Invite can name it.
    vault: crate::meta::VaultMeta,
    sync_dir: PathBuf,
    local_dir: PathBuf,
    me: Member,
    state: Arc<Mutex<State>>,
    events: mpsc::Sender<Event>,
    changed: Arc<Notify>,
    relay: Option<RelayUrl>,
    /// False when relays are disabled (tests): there is no home relay to wait for.
    relays: bool,
}

pub fn node_id_hex(id: &NodeId) -> String {
    hex::encode(id)
}

fn mtime_ms(p: &Path) -> i64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Load or create this Device's long-lived node key (one per app data dir).
fn node_secret(device_dir: &Path) -> SecretKey {
    let p = device_dir.join(KEY_FILE);
    if let Ok(s) = fs::read_to_string(&p) {
        if let Ok(bytes) = hex::decode(s.trim()) {
            if let Ok(arr) = <[u8; 32]>::try_from(bytes) {
                return SecretKey::from_bytes(&arr);
            }
        }
    }
    let k = SecretKey::generate();
    let _ = fs::create_dir_all(device_dir);
    let _ = fs::write(&p, hex::encode(k.to_bytes()));
    k
}

fn load_addrs(dir: &Path) -> HashMap<NodeId, EndpointAddr> {
    let saved: HashMap<String, EndpointAddr> = fs::read_to_string(dir.join(PEERS_FILE)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    saved.into_iter().filter_map(|(k, v)| Some((hex::decode(k).ok()?.try_into().ok()?, v))).collect()
}

fn save_addrs(dir: &Path, addrs: &HashMap<NodeId, EndpointAddr>) {
    let by_hex: HashMap<String, &EndpointAddr> = addrs.iter().map(|(k, v)| (node_id_hex(k), v)).collect();
    if let Ok(json) = serde_json::to_string_pretty(&by_hex) {
        let _ = fs::create_dir_all(dir);
        let _ = fs::write(dir.join(PEERS_FILE), json);
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
        let secret = node_secret(device_dir);
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
        let mut membership = Membership::load(local_dir);
        // This Device's card may have changed since it was recorded (a better
        // name, an OS upgrade): refresh it so every peer shows the new one.
        let my_id = *endpoint.id().as_bytes();
        if let Some(mine) = membership.members.iter_mut().find(|m| m.node == my_id) {
            if mine.name != me.name || mine.platform != me.platform {
                mine.name = me.name.clone();
                mine.platform = me.platform.clone();
                membership.version += 1;
                membership.save(local_dir);
            }
        }
        let node = Arc::new(Node {
            endpoint,
            vault: crate::meta::VaultMeta::adopt(vault_root)?,
            sync_dir: vault_root.join(HIDDEN_DIR).join(SYNC_DIR),
            local_dir: local_dir.to_path_buf(),
            me,
            state: Arc::new(Mutex::new(State { membership, pending: HashMap::new(), conns: HashMap::new(), dialing: HashSet::new(), addrs: load_addrs(local_dir), joining: None })),
            events,
            changed: Arc::new(Notify::new()),
            relay: relay_url,
            relays: relay.as_deref() != Some(""),
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

    /// The Invite for this vault: creates the vault key and invite secret on first use.
    pub fn invite(&self) -> Invite {
        let mut st = self.state.lock().unwrap();
        let m = &mut st.membership;
        let mut changed = false;
        if m.vault_key.is_none() {
            m.vault_key = Some(rand::random());
            changed = true;
        }
        if m.invite_secret.is_none() {
            m.invite_secret = Some(rand::random());
            changed = true;
        }
        if !m.members.iter().any(|x| x.node == self.id()) {
            let mut me = self.me.clone();
            me.node = self.id();
            m.members.push(me);
            changed = true;
        }
        if changed {
            m.version += 1;
            m.save(&self.local_dir);
        }
        Invite {
            host: self.id(),
            relay: self.relay_hint(),
            secret: m.invite_secret.unwrap(),
            vault_id: self.vault.id.clone(),
            vault_name: self.vault.name.clone(),
        }
    }

    /// Replace the invite secret; old codes stop working.
    pub fn revoke_invite(&self) {
        let mut st = self.state.lock().unwrap();
        st.membership.invite_secret = Some(rand::random());
        st.membership.version += 1;
        st.membership.save(&self.local_dir);
    }

    pub fn status(&self) -> Status {
        let st = self.state.lock().unwrap();
        Status {
            node: node_id_hex(&self.id()),
            relay: self.relay_hint(),
            connected: st.conns.iter().filter(|(_, c)| c.close_reason().is_none()).map(|(n, _)| node_id_hex(n)).collect(),
            pending: st.pending.values().cloned().collect(),
            members: st.membership.members.clone(),
            joining: st.joining.is_some(),
        }
    }

    /// Approve or deny a pending join. Approval adds the member and bumps the version.
    pub fn approve(&self, node: &NodeId, allow: bool) -> bool {
        let mut st = self.state.lock().unwrap();
        let Some(member) = st.pending.remove(node) else { return false };
        if allow {
            let m = &mut st.membership;
            // Approving is the deliberate act that lifts a retirement, and the
            // only one: a Device that was evicted, wiped and paired again is
            // admitted here, and its folder has to be trusted from now on.
            // Without this a Device could be removed but never re-paired.
            m.removed.retain(|n| n != &member.node);
            m.removed_devices.retain(|d| d != &member.device_id);
            m.members.retain(|x| x.node != member.node);
            m.members.push(member);
            m.version += 1;
            m.save(&self.local_dir);
        }
        drop(st);
        self.changed.notify_one();
        true
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
    pub fn forget_device(&self, device: &str) {
        let mut st = self.state.lock().unwrap();
        let m = &mut st.membership;
        if m.removed_devices.iter().any(|d| d == device) {
            return;
        }
        m.removed_devices.push(device.to_string());
        // A member holding that folder goes too, so it is not re-admitted on
        // the next round.
        if let Some(node) = m.members.iter().find(|x| x.device_id == device).map(|x| x.node) {
            m.members.retain(|x| x.node != node);
            if !m.removed.contains(&node) {
                m.removed.push(node);
            }
            if let Some(c) = st.conns.remove(&node) {
                c.close(iroh::endpoint::VarInt::from_u32(0), b"removed");
            }
        }
        st.membership.version += 1;
        st.membership.save(&self.local_dir);
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
        m.version += 1;
        m.save(&self.local_dir);
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
                                st.membership = m;
                                st.membership.save(&node.local_dir);
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
        let bytes = recv.read_to_end(MAX_FILE + 4096).await.map_err(|e| e.to_string())?;
        let req: Request = postcard::from_bytes(&bytes).map_err(|e| e.to_string())?;
        let is_member = self.state.lock().unwrap().membership.is_member(&remote);
        let resp = match req {
            Request::Join { secret, member } => {
                // Decide under the lock, announce after it (guards must not live across awaits).
                let (resp, announce) = {
                    let mut st = self.state.lock().unwrap();
                    if st.membership.removed.contains(&remote) || st.membership.invite_secret != Some(secret) {
                        (Response::Denied, None)
                    } else if st.membership.is_member(&remote) {
                        (Response::Approved(st.membership.clone()), None)
                    } else {
                        let first = !st.pending.contains_key(&remote);
                        let mut member = member;
                        member.node = remote;
                        st.pending.insert(remote, member.clone());
                        (Response::Pending, first.then_some(member))
                    }
                };
                if let Some(member) = announce {
                    self.emit(Event::JoinRequest { node: node_id_hex(&remote), member }).await;
                }
                resp
            }
            // A removed Device may still ask for the membership: that is how it learns it was removed.
            Request::Membership(theirs) => {
                let removed = self.state.lock().unwrap().membership.removed.contains(&remote);
                if !is_member && !removed {
                    Response::Denied
                } else {
                    let mine = {
                        let mut st = self.state.lock().unwrap();
                        if is_member && st.membership.merge(&theirs) {
                            st.membership.save(&self.local_dir);
                        }
                        st.membership.clone()
                    };
                    Response::Membership(mine)
                }
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
                    // A joining or removed Device: answered, never kept.
                    node.serve_conn(remote_id, &conn).await;
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
        if let Response::Membership(theirs) = request(conn, &Request::Membership(mine_m)).await? {
            let changed = {
                let mut st = self.state.lock().unwrap();
                let c = st.membership.merge(&theirs);
                if c {
                    st.membership.save(&self.local_dir);
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
            if e.device == self.me.device_id {
                continue;
            }
            let newer = mine_by.get(k).map_or(true, |m| e.mtime_ms > m.mtime_ms || (e.mtime_ms == m.mtime_ms && e.size != m.size));
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
            if Some(&e.device) == their_device.as_ref() {
                continue;
            }
            let newer = theirs_by.get(k).map_or(true, |t| e.mtime_ms > t.mtime_ms || (e.mtime_ms == t.mtime_ms && e.size != t.size));
            if newer {
                if let Some(bytes) = self.read_file(&e.device, &e.name) {
                    request(conn, &Request::PutFile { entry: (*e).clone(), bytes }).await?;
                }
            }
        }
        if pulled > 0 {
            self.emit(Event::Synced { files: pulled }).await;
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
            let device = d.file_name().to_string_lossy().to_string();
            // A retired Device's folder is not advertised, so a peer that
            // still holds it does not learn of it from here and mirroring
            // stops spreading it.
            if removed.contains(&device) {
                continue;
            }
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

    fn safe(name: &str) -> bool {
        !name.is_empty() && !name.contains(['/', '\\']) && name != "." && name != ".."
    }

    fn read_file(&self, device: &str, name: &str) -> Option<Vec<u8>> {
        if !Self::safe(device) || !Self::safe(name) {
            return None;
        }
        fs::read(self.sync_dir.join(device).join(name)).ok()
    }

    fn write_file(&self, e: &Entry, bytes: &[u8]) {
        if !Self::safe(&e.device) || !Self::safe(&e.name) || e.device == self.me.device_id {
            return;
        }
        // A peer that has not yet merged the removal will still offer the
        // retired Device's snapshots; refusing them here is what keeps the
        // folder from coming back.
        if self.state.lock().unwrap().membership.removed_devices.contains(&e.device) {
            return;
        }
        let dir = self.sync_dir.join(&e.device);
        let _ = fs::create_dir_all(&dir);
        let tmp = dir.join(format!("{}.part", e.name));
        if fs::write(&tmp, bytes).is_ok() {
            let _ = fs::rename(&tmp, dir.join(&e.name));
            let t = UNIX_EPOCH + Duration::from_millis(e.mtime_ms.max(0) as u64);
            let _ = fs::File::open(dir.join(&e.name)).and_then(|f| f.set_modified(t));
        }
    }

    pub async fn shutdown(&self) {
        self.endpoint.close().await;
    }
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

    fn member(device: &str, name: &str) -> Member {
        Member { node: [0; 32], device_id: device.into(), name: name.into(), platform: "test".into() }
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

        let mut a = Membership { version: 1, members: vec![member("a", "A")], ..Default::default() };
        let b = Membership { version: 2, members: vec![member("a", "A"), member("b", "B")], removed: vec![[3; 32]], ..Default::default() };
        assert!(a.merge(&b));
        assert_eq!(a.version, 2);
        assert_eq!(a.members.len(), 2);
        let older = Membership { version: 1, removed: vec![[4; 32]], ..Default::default() };
        assert!(a.merge(&older));
        assert!(a.removed.contains(&[4; 32]) && a.removed.contains(&[3; 32]));
    }

    /// A retired Device's folder is named by its device id, and that travels
    /// between peers the way the node removal does: a newer membership never
    /// drops what this one already knew, so the folder cannot come back by
    /// meeting a peer that has not heard of the removal yet.
    #[test]
    fn a_removed_device_is_never_forgotten_by_a_merge() {
        let mut a = Membership { version: 1, removed_devices: vec!["01PHONE".into()], ..Default::default() };
        let newer = Membership { version: 9, removed_devices: vec!["01TABLET".into()], ..Default::default() };
        assert!(a.merge(&newer));
        assert!(a.removed_devices.contains(&"01PHONE".to_string()), "a newer membership dropped a removal");
        assert!(a.removed_devices.contains(&"01TABLET".to_string()));

        // An older peer's removal is still taken, and taken only once.
        let older = Membership { version: 1, removed_devices: vec!["01LAPTOP".into(), "01PHONE".into()], ..Default::default() };
        assert!(a.merge(&older));
        assert_eq!(a.removed_devices.iter().filter(|d| *d == "01PHONE").count(), 1);
        assert!(a.removed_devices.contains(&"01LAPTOP".to_string()));

        // Nothing new to learn.
        assert!(!a.merge(&older));
    }

    /// Retiring a Device by its folder name reaches one that is still a member
    /// and one that never was — a Device retired before removals were recorded
    /// is known by its folder alone, and that is the Device to stop trusting.
    #[tokio::test]
    async fn a_device_can_be_retired_by_its_folder_alone() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, _rx) = mpsc::channel(16);
        let node = Node::start(dir.path(), &dir.path().join("device"), &dir.path().join("local"), member("self", "Self"), Some(String::new()), tx).await.unwrap();

        // A Device that is still a member: the folder and the peer both go.
        let paired = [7u8; 32];
        {
            let mut st = node.state.lock().unwrap();
            st.membership.members.push(Member { node: paired, ..member("tablet", "Tablet") });
        }
        node.forget_device("tablet");
        let m = node.membership();
        assert!(m.removed_devices.contains(&"tablet".to_string()));
        assert!(!m.is_member(&paired), "the retired Device is still a member");

        // A Device that never paired through this roster, which is how the
        // phone whose folder outlived it looks. No node id to go by.
        node.forget_device("ghost");
        let m = node.membership();
        assert!(m.removed_devices.contains(&"ghost".to_string()), "a folder-only Device could not be retired");

        // Idempotent, and it persists for the next Sync to read.
        let before = node.membership().version;
        node.forget_device("ghost");
        assert_eq!(node.membership().version, before, "retiring twice bumped the version");
        let saved = fs::read_to_string(dir.path().join("local").join(MEMBERSHIP_FILE)).unwrap();
        assert!(saved.contains("ghost"), "the retirement was not written for sync to read");
        node.shutdown().await;
    }

    /// Approving is what lifts a retirement, and the only thing that does: a
    /// Device evicted, wiped and paired again must be trustable, or it could be
    /// removed and never come back.
    #[tokio::test]
    async fn approving_a_device_again_lifts_its_retirement() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, _rx) = mpsc::channel(16);
        let me = member("self", "Self");
        let node = Node::start(dir.path(), &dir.path().join("device"), &dir.path().join("local"), me, Some(String::new()), tx).await.unwrap();

        let returning = member("phone", "Phone");
        let their_node = [42u8; 32];
        let returning = Member { node: their_node, ..returning };

        node.forget_device("phone");
        assert!(node.membership().removed_devices.contains(&"phone".to_string()));

        // It comes back and is approved.
        node.state.lock().unwrap().pending.insert(their_node, returning);
        assert!(node.approve(&their_node, true));
        let m = node.membership();
        assert!(!m.removed_devices.contains(&"phone".to_string()), "an approved Device is still retired");
        assert!(!m.removed.contains(&their_node), "an approved Device's node is still removed");
        assert!(m.is_member(&their_node));
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
        let a = Node::start(&vault_a, &dir.path().join("dev-a"), &dir.path().join("local-a"), member("dev-a", "A"), Some(String::new()), tx_a).await.unwrap();
        let b = Node::start(&vault_b, &dir.path().join("dev-b"), &dir.path().join("local-b"), member("dev-b", "B"), Some(String::new()), tx_b).await.unwrap();

        // Without relays the invite carries no address; give B A's direct addresses.
        let mut invite = a.invite();
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
            st.membership.members.push(Member { node: gone, ..member("dev-gone", "Gone") });
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
        let snap = vault_a.join(HIDDEN_DIR).join(SYNC_DIR).join("dev-a");
        fs::create_dir_all(&snap).unwrap();
        fs::write(snap.join("DOC1.loro"), b"snapshot bytes").unwrap();
        a.notify_changed();
        let target = vault_b.join(HIDDEN_DIR).join(SYNC_DIR).join("dev-a").join("DOC1.loro");
        tokio::time::timeout(Duration::from_secs(3), async {
            while fs::read(&target).ok().as_deref() != Some(b"snapshot bytes") {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        })
        .await
        .expect("B mirrors A's snapshot");

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
}
