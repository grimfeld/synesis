//! Open a vault and print what the engine sees. `cargo run -p engine --example inspect -- <vault> [data-dir]`
use engine::index::GraphLevel;
use engine::scripture::Lang;
use engine::Vault;

fn main() -> engine::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let root = std::path::PathBuf::from(args.get(1).expect("vault path"));
    let data = args
        .get(2)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("bsv-inspect-data"));
    let v = Vault::open(&root, &data, Lang::En)?;
    let info = v.info()?;
    println!(
        "root={} documents={} device={:?}",
        info.root,
        info.documents,
        v.device_id()
    );
    for d in v.list(None)? {
        let bl = v.backlinks(&d.id)?;
        println!(
            "{:<10} {:<45} backlinks={}",
            d.doc_type.as_str(),
            d.path,
            bl.len()
        );
        for b in bl.iter().take(4) {
            println!(
                "             <- {} [{:?}{}] {}",
                b.doc.title,
                b.kind,
                b.via
                    .as_deref()
                    .map(|v| format!(" via {v}"))
                    .unwrap_or_default(),
                b.excerpt.chars().take(60).collect::<String>()
            );
        }
    }
    let g = v.graph(GraphLevel::Chapter)?;
    println!("graph: {} nodes, {} edges", g.nodes.len(), g.edges.len());
    println!(
        "coverage: {:?}",
        v.coverage()?
            .iter()
            .map(|c| format!("{}:{}={}", c.book, c.chapter, c.count))
            .collect::<Vec<_>>()
    );
    println!(
        "unresolved: {:?}",
        v.unresolved()?
            .iter()
            .map(|u| u.target.clone())
            .collect::<Vec<_>>()
    );
    println!(
        "search 'endur': {:?}",
        v.search("endur", 5)?
            .iter()
            .map(|h| h.doc.title.clone())
            .collect::<Vec<_>>()
    );
    for c in v.list(Some(engine::document::DocType::Composition))? {
        println!(
            "candidates for {}: {:?}",
            c.title,
            v.candidates(&c.id)?
                .iter()
                .map(|x| (
                    x.doc.title.clone(),
                    x.shared_tags.clone(),
                    x.shared_passages.clone()
                ))
                .collect::<Vec<_>>()
        );
    }
    for s in v.list(Some(engine::document::DocType::Source))? {
        println!(
            "trail for {}: {:?}",
            s.title,
            match v.query(engine::query::Query::SourceTrail { id: s.id.clone() })? {
                engine::query::Answer::Entries(e) => e,
                _ => unreachable!(),
            }
            .iter()
                .map(|t| (t.doc.title.clone(), t.locator.clone()))
                .collect::<Vec<_>>()
        );
    }
    Ok(())
}
