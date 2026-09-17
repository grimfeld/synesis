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
const ROUND_EVERY: Duration = Duration::from_secs(30);
const JOIN_POLL: Duration = Duration::from_secs(2);

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
            *self = other.clone();
            for r in removed.drain(..) {
                if !self.removed.contains(&r) {
                    self.removed.push(r);
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
    connected: HashSet<NodeId>,
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
            state: Arc::new(Mutex::new(State { membership, pending: HashMap::new(), connected: HashSet::new(), joining: None })),
            events,
            changed: Arc::new(Notify::new()),
            relay: relay_url,
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
    /// Wake the dial loop: something local changed, push it now.
    pub fn notify_changed(&self) {
        self.changed.notify_waiters();
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
            connected: st.connected.iter().map(node_id_hex).collect(),
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
            m.members.retain(|x| x.node != member.node);
            m.members.push(member);
            m.version += 1;
            m.save(&self.local_dir);
        }
        drop(st);
        self.changed.notify_waiters();
        true
    }

    /// Remove a Device from the vault; every peer will refuse it from now on.
    pub fn remove(&self, node: &NodeId) {
        let mut st = self.state.lock().unwrap();
        let m = &mut st.membership;
        m.members.retain(|x| &x.node != node);
        if !m.removed.contains(node) {
            m.removed.push(*node);
        }
        m.version += 1;
        m.save(&self.local_dir);
        st.connected.remove(node);
        drop(st);
        self.changed.notify_waiters();
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
                match node.endpoint.connect(addr, ALPN).await {
                    Ok(conn) => match request(&conn, &Request::Join { secret: inv.secret, member: me }).await {
                        Ok(Response::Approved(m)) => {
                            {
                                let mut st = node.state.lock().unwrap();
                                st.membership = m;
                                st.membership.save(&node.local_dir);
                                st.joining = None;
                            }
                            node.emit(Event::Approved).await;
                            node.changed.notify_waiters();
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
                    Err(e) => node.emit(Event::Error { message: format!("connect: {e}") }).await,
                }
                tokio::time::sleep(JOIN_POLL).await;
            }
        });
    }

    async fn emit(&self, e: Event) {
        let _ = self.events.send(e).await;
    }

    // ---------------------------------------------------------------- server

    async fn accept_loop(node: Arc<Node>) {
        while let Some(incoming) = node.endpoint.accept().await {
            let node = node.clone();
            tokio::spawn(async move {
                let Ok(conn) = incoming.await else { return };
                let remote_id: NodeId = *conn.remote_id().as_bytes();
                let member = node.state.lock().unwrap().membership.is_member(&remote_id);
                if member {
                    node.state.lock().unwrap().connected.insert(remote_id);
                    node.emit(Event::Peer { node: node_id_hex(&remote_id), connected: true }).await;
                }
                loop {
                    let Ok((send, recv)) = conn.accept_bi().await else { break };
                    let node = node.clone();
                    tokio::spawn(async move {
                        let _ = node.serve(remote_id, send, recv).await;
                    });
                }
                if member {
                    node.state.lock().unwrap().connected.remove(&remote_id);
                    node.emit(Event::Peer { node: node_id_hex(&remote_id), connected: false }).await;
                }
            });
        }
    }

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

    // ---------------------------------------------------------------- client

    async fn dial_loop(node: Arc<Node>) {
        loop {
            let members: Vec<Member> = {
                let st = node.state.lock().unwrap();
                st.membership.members.iter().filter(|m| m.node != node.id()).cloned().collect()
            };
            for m in members {
                let relay = node.state.lock().unwrap().joining.as_ref().and_then(|i| i.relay.clone()).or_else(|| node.relay_hint());
                let Some(addr) = endpoint_addr(&m.node, relay.as_deref()) else { continue };
                match node.endpoint.connect(addr, ALPN).await {
                    Ok(conn) => {
                        let r = node.round(&conn).await;
                        conn.close(iroh::endpoint::VarInt::from_u32(0), b"done");
                        if let Err(e) = r {
                            node.emit(Event::Error { message: format!("{}: {e}", m.name) }).await;
                        }
                    }
                    Err(_) => {}
                }
            }
            tokio::select! {
                _ = node.changed.notified() => {}
                _ = tokio::time::sleep(ROUND_EVERY) => {}
            }
        }
    }

    /// One sync round with a peer we dialled: memberships, manifests, then files both ways.
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
        for d in devices.flatten() {
            if !d.path().is_dir() {
                continue;
            }
            let device = d.file_name().to_string_lossy().to_string();
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

    /// Two nodes on one machine, relays disabled: invite, join, approve, then
    /// a snapshot written on A shows up in B's sync folder.
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

        // A publishes a snapshot; B receives it in A's device folder.
        let snap = vault_a.join(HIDDEN_DIR).join(SYNC_DIR).join("dev-a");
        fs::create_dir_all(&snap).unwrap();
        fs::write(snap.join("DOC1.loro"), b"snapshot bytes").unwrap();
        a.notify_changed();
        let target = vault_b.join(HIDDEN_DIR).join(SYNC_DIR).join("dev-a").join("DOC1.loro");
        tokio::time::timeout(Duration::from_secs(30), async {
            while fs::read(&target).ok().as_deref() != Some(b"snapshot bytes") {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        })
        .await
        .expect("B mirrors A's snapshot");

        // Removal propagates: A removes B, B learns it on the next round.
        a.remove(&node_b);
        tokio::time::timeout(Duration::from_secs(30), async {
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
