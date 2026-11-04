//! Fetching a web address the user typed or a Vault holds: a Cover or a page's
//! metadata (ADR 0012). The address may come from a shared or synced Vault, so
//! it must not reach into the user's own network (a router page, a NAS) by
//! itself or through a redirect, and must not fill memory (issue #88).
//!
//! Every host name goes through [`PublicOnly`], which connects only to public
//! addresses; an address written as an IP literal never reaches a resolver,
//! so each hop's URL, the first one and every redirect, is checked by
//! [`check_hop`] as well.

use std::error::Error;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::{redirect, Client, Response, Url};

/// The most a Cover may weigh.
pub const COVER_LIMIT: usize = 32 * 1024 * 1024;
/// The most of a page read for its metadata.
pub const PAGE_LIMIT: usize = 2 * 1024 * 1024;

const MAX_REDIRECTS: usize = 10;

/// A client that only talks to the public internet, on every redirect hop.
pub fn client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .user_agent("Synesis/0.1 (+https://github.com/grimfeld/synesis)")
        .timeout(timeout)
        .dns_resolver(Arc::new(PublicOnly))
        .redirect(redirect::Policy::custom(|attempt| {
            match check_redirect(attempt.previous().len(), attempt.url()) {
                Ok(()) => attempt.follow(),
                Err(e) => attempt.error(e),
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

/// GET `url` after checking it, as [`client`] checks every redirect.
pub async fn get(client: &Client, url: &str) -> Result<Response, String> {
    let parsed = Url::parse(url).map_err(|e| format!("not a web address: {e}"))?;
    check_hop(&parsed)?;
    client
        .get(parsed)
        .send()
        .await
        .map_err(|e| describe(&e))
}

/// The error with its causes, so a refused address says why rather than
/// only "error sending request".
fn describe(e: &(dyn Error + 'static)) -> String {
    let mut out = e.to_string();
    let mut cause = e.source();
    while let Some(c) = cause {
        out.push_str(": ");
        out.push_str(&c.to_string());
        cause = c.source();
    }
    out
}

/// The body, refused once it passes `limit` bytes rather than read whole.
pub async fn body(mut res: Response, limit: usize) -> Result<Vec<u8>, String> {
    let too_big = || format!("larger than {} MB", limit / (1024 * 1024));
    if res.content_length().is_some_and(|n| n > limit as u64) {
        return Err(too_big());
    }
    let mut out = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        if out.len() + chunk.len() > limit {
            return Err(too_big());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// Whether to follow a redirect to `url` after `hops` addresses so far.
fn check_redirect(hops: usize, url: &Url) -> Result<(), String> {
    if hops > MAX_REDIRECTS {
        return Err("too many redirects".into());
    }
    check_hop(url)
}

/// A hop the client may take: http or https, and not an IP literal outside
/// the public internet. Host names are checked when resolved.
pub fn check_hop(url: &Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("not a web address: {url}"));
    }
    let host = url
        .host_str()
        .ok_or_else(|| format!("not a web address: {url}"))?;
    // An IPv6 literal comes bracketed; a name does not parse as an address.
    let Ok(ip) = host.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>() else {
        return Ok(());
    };
    if is_public(ip) {
        Ok(())
    } else {
        Err(refused(&ip.to_string()))
    }
}

fn refused(host: &str) -> String {
    format!("{host} is on a private network; save the picture and add it from a file instead")
}

/// Resolves a host name to its public addresses only.
struct PublicOnly;

impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();
            let all: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            // One private answer is enough to refuse: a name that also points
            // inside the network is not one to trust with the rest.
            if all.is_empty() || all.iter().any(|a| !is_public(a.ip())) {
                return Err(Box::<dyn Error + Send + Sync>::from(refused(&host)));
            }
            Ok(Box::new(all.into_iter()) as Addrs)
        })
    }
}

/// Whether `ip` is on the public internet: not loopback, private, link-local,
/// unique-local, shared (CGNAT), unspecified, multicast or reserved.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4() {
            Some(v4) => is_public_v4(v4),
            None => is_public_v6(v6),
        },
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || a == 0
        // 100.64.0.0/10, shared address space (carrier-grade NAT).
        || (a == 100 && (64..128).contains(&b))
        // 192.0.0.0/24, protocol assignments.
        || (a == 192 && b == 0 && ip.octets()[2] == 0)
        // 198.18.0.0/15, benchmarking.
        || (a == 198 && (18..20).contains(&b))
        // 240.0.0.0/4, reserved.
        || a >= 240)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        // fc00::/7, unique local.
        || (first & 0xfe00) == 0xfc00
        // fe80::/10, link local.
        || (first & 0xffc0) == 0xfe80
        // fec0::/10, the old site-local.
        || (first & 0xffc0) == 0xfec0
        // 64:ff9b::/96 and friends would reach IPv4 through NAT64; the IPv4
        // inside could be private, so refuse the prefix.
        || first == 0x0064
        // 2001:db8::/32, documentation.
        || (first == 0x2001 && ip.segments()[1] == 0x0db8))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn private_and_local_addresses_are_not_public() {
        for s in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.5.4",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "255.255.255.255",
            "224.0.0.1",
            "::1",
            "::",
            "fe80::1",
            "fd00::1",
            "fc00::1",
            "::ffff:192.168.1.1",
            "::ffff:127.0.0.1",
            "64:ff9b::a00:1",
            "::10.0.0.1",
        ] {
            assert!(!is_public(ip(s)), "{s}");
        }
        for s in ["93.184.216.34", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"] {
            assert!(is_public(ip(s)), "{s}");
        }
    }

    #[test]
    fn a_hop_is_http_to_a_public_or_named_host() {
        let ok = |s: &str| check_hop(&Url::parse(s).unwrap()).is_ok();
        assert!(ok("https://example.com/cover.jpg"));
        assert!(ok("http://93.184.216.34/x.png"));
        assert!(!ok("http://192.168.1.1/admin"));
        assert!(!ok("http://127.0.0.1:8080/"));
        assert!(!ok("http://[::1]/"));
        assert!(!ok("http://[::ffff:10.0.0.1]/"));
        assert!(!ok("file:///etc/passwd"));
        assert!(!ok("ftp://example.com/x.jpg"));
    }

    #[tokio::test]
    async fn a_name_that_resolves_inside_the_network_is_refused() {
        let name: Name = "localhost".parse().unwrap();
        assert!(PublicOnly.resolve(name).await.is_err());
    }

    #[test]
    fn a_redirect_is_checked_like_the_first_hop() {
        let url = |s: &str| Url::parse(s).unwrap();
        assert!(check_redirect(1, &url("https://example.com/b.jpg")).is_ok());
        assert!(check_redirect(1, &url("http://192.168.1.1/")).is_err());
        assert!(check_redirect(1, &url("http://169.254.169.254/latest")).is_err());
        assert!(check_redirect(MAX_REDIRECTS + 1, &url("https://example.com/")).is_err());
    }

    #[tokio::test]
    async fn the_first_hop_is_checked_before_connecting() {
        let c = client(Duration::from_secs(5)).unwrap();
        assert!(get(&c, "http://127.0.0.1:9/").await.is_err());
        assert!(get(&c, "http://localhost:9/").await.unwrap_err().contains("private network"));
    }
}
