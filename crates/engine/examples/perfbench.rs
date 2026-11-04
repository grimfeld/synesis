//! Engine timings on a generated Vault. Driven by `scripts/perf-compare.mjs`,
//! which builds this file at two commits and runs them side by side.
//!
//! `perfbench gen <dir> [scale]`: write a Vault (scale 1: 3,000 Notes, 1,000
//! Places, 30 regions with 2,000-point Borders, 300 Characters, 3,000 Events).
//! `perfbench run <vault> <data> [--keep]`: print `name<TAB>median ms` lines.
//! Without `--keep` the data folder is wiped first and `open_cold` is timed.
//!
//! Only `Vault::open`, `scan` and `query` are used, and queries are read from
//! JSON, so this file builds at older commits too: a query an older engine
//! does not know prints `n/a`.
use engine::query::Query;
use engine::scripture::Lang;
use engine::Vault;
use std::fmt::Write as _;
use std::path::Path;
use std::time::Instant;

/// The queries timed, as the UI sends them. `placeFacts` took minutes before
/// #59: a base older than that fix runs it, 40 times, at that speed.
const QUERIES: &[(&str, &str)] = &[
    ("q_place_facts", r#"{"kind":"placeFacts"}"#),
    ("q_timeline", r#"{"kind":"timeline"}"#),
    ("q_event_links", r#"{"kind":"eventLinks"}"#),
    ("q_journeys", r#"{"kind":"journeys"}"#),
    ("q_place_ties", r#"{"kind":"placeTies","id":null}"#),
    ("q_regions", r#"{"kind":"regions"}"#),
    ("q_borders", r#"{"kind":"borders"}"#),
];

fn main() {
    let a: Vec<String> = std::env::args().collect();
    match a.get(1).map(String::as_str) {
        Some("gen") => generate(Path::new(&a[2]), a.get(3).map_or(1.0, |s| s.parse().expect("scale"))),
        Some("run") => run(Path::new(&a[2]), Path::new(&a[3]), a.iter().any(|x| x == "--keep")),
        _ => eprintln!("usage: perfbench gen <dir> [scale] | perfbench run <vault> <data> [--keep]"),
    }
}

// ---- timing ---------------------------------------------------------------

fn median_ms(n: usize, mut f: impl FnMut()) -> f64 {
    let mut v: Vec<f64> = (0..n)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed().as_secs_f64() * 1e3
        })
        .collect();
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}

fn report(name: &str, ms: Option<f64>) {
    match ms {
        Some(ms) => println!("{name}\t{ms:.1}"),
        None => println!("{name}\tn/a"),
    }
}

fn run(root: &Path, data: &Path, keep: bool) {
    if !keep {
        let _ = std::fs::remove_dir_all(data);
        let t = Instant::now();
        drop(Vault::open(root, data, Lang::En).expect("open"));
        report("open_cold", Some(t.elapsed().as_secs_f64() * 1e3));
    }
    report("open_warm", Some(median_ms(5, || drop(Vault::open(root, data, Lang::En).expect("open")))));
    let mut v = Vault::open(root, data, Lang::En).expect("open");
    report("scan_nochange", Some(median_ms(10, || drop(v.scan().expect("scan")))));
    let place = root.join("Places/place 0.md");
    let original = std::fs::read_to_string(&place).expect("place 0");
    let mut k = 0;
    report(
        "scan_one_place",
        Some(median_ms(10, || {
            k += 1;
            std::fs::write(&place, format!("{original}\n{k}\n")).expect("write");
            v.scan().expect("scan");
        })),
    );
    for (name, json) in QUERIES {
        let ms = serde_json::from_str::<Query>(json)
            .ok()
            .map(|q| median_ms(10, || drop(v.query(q.clone()).expect(name))));
        report(name, ms);
    }
}

// ---- the Vault ------------------------------------------------------------

/// xorshift64: the same Vault on every machine and at every commit.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn write(dir: &Path, rel: &str, text: &str) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).expect("mkdir");
    std::fs::write(p, text).expect("write");
}

fn generate(dir: &Path, scale: f64) {
    let n = |base: f64| ((base * scale) as usize).max(1);
    let (notes, places, regions, characters, events) = (n(3000.0), n(1000.0), n(30.0), n(300.0), n(3000.0));
    let mut r = Rng(0x5eed_5eed_5eed_5eed);
    let books = ["Gen", "Exo", "Isa", "Jer", "Mat", "Joh", "Rom", "Psa"];
    for i in 0..notes {
        let mut body = String::new();
        for j in 0..8 {
            let (p, c, b) = (r.below(places), r.below(characters), books[r.below(books.len())]);
            let (ch, v, end, link) = (1 + r.below(20), 1 + r.below(20), 21 + r.below(10), r.below(places));
            let _ = write!(
                body,
                "Paragraph {j} about Place {p} and Character {c}, see {b} {ch}:{v}-{end} and [[Place {link}]].\n\n"
            );
        }
        write(dir, &format!("Notes/note {i}.md"), &format!("---\ntype: note\ntitle: \"Note {i}\"\ntags: [\"t{}\"]\n---\n{body}", i % 20));
    }
    for i in 0..places {
        let (lat, lon) = (29.0 + r.unit() * 6.0, 33.0 + r.unit() * 5.0);
        write(dir, &format!("Places/place {i}.md"), &format!("---\ntype: place\ntitle: \"Place {i}\"\nlat: {lat:.4}\nlon: {lon:.4}\n---\nA place.\n"));
    }
    for i in 0..regions {
        let (lat, lon, rad) = (29.0 + r.unit() * 6.0, 33.0 + r.unit() * 5.0, 0.5 + r.unit());
        let k = 2000;
        let mut ring: Vec<[f64; 2]> = (0..k)
            .map(|j| {
                let t = std::f64::consts::TAU * j as f64 / k as f64;
                [lon + rad * t.cos() * (0.8 + 0.2 * r.unit()), lat + rad * t.sin() * (0.8 + 0.2 * r.unit())]
            })
            .collect();
        ring.push(ring[0]);
        let gj = serde_json::json!({"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [ring]}}]});
        write(dir, &format!("Places/region {i}.geojson"), &gj.to_string());
        write(
            dir,
            &format!("Places/region {i}.md"),
            &format!("---\ntype: place\ntitle: \"Region {i}\"\nkind: region\nlat: {lat:.4}\nlon: {lon:.4}\nborder: \"[[region {i}.geojson]]\"\n---\nA region.\n"),
        );
    }
    let list = |r: &mut Rng, what: &str, n: usize| {
        (0..3).map(|_| format!("\"[[{what} {}]]\"", r.below(n))).collect::<Vec<_>>().join(", ")
    };
    for i in 0..characters {
        let pl = list(&mut r, "Place", places);
        write(dir, &format!("Characters/character {i}.md"), &format!("---\ntype: character\ntitle: \"Character {i}\"\nplaces: [{pl}]\n---\nSomeone.\n"));
    }
    for i in 0..events {
        let (start, place, ch) = (500 + r.below(1500), r.below(places), list(&mut r, "Character", characters));
        write(
            dir,
            &format!("Events/event {i}.md"),
            &format!("---\ntype: event\ntitle: \"Event {i}\"\nstart: \"{start} BCE\"\nplace: \"[[Place {place}]]\"\ncharacters: [{ch}]\n---\nSomething happened (Gen 1:1).\n"),
        );
    }
}
