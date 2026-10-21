use luora_z_core::{TraceNode, decode::parse_tx, trace_tx};
use serde::Deserialize;
use zcash_primitives::transaction::TxVersion;
use zcash_primitives::transaction::components::orchard as orchard_serialization;

#[derive(Deserialize)]
struct Fixture {
    network: String,
    hex: String,
}

const ALL: [&str; 7] = [
    "v4-transparent",
    "v4-coinbase",
    "v5-sapling",
    "v5-orchard",
    "v6-ironwood",
    "v6-coinbase-ironwood",
    "v6-testnet-ironwood-pczt",
];

fn load(name: &str) -> (Vec<u8>, Vec<TraceNode>) {
    let path = format!("{}/tests/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let fx: Fixture = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let bytes = hex::decode(&fx.hex).unwrap();
    let nodes = trace_tx(&fx.hex, &fx.network).unwrap();
    (bytes, nodes)
}

fn node<'a>(nodes: &'a [TraceNode], id: &str) -> &'a TraceNode {
    nodes.iter().find(|n| n.id == id).unwrap_or_else(|| panic!("no node {id}"))
}

fn slice<'a>(bytes: &'a [u8], n: &TraceNode) -> &'a [u8] {
    &bytes[n.offset..n.offset + n.length]
}

#[test]
fn top_level_nodes_tile_the_whole_transaction() {
    for name in ALL {
        let (bytes, nodes) = load(name);
        let root = node(&nodes, "tx");
        assert_eq!((root.offset, root.length), (0, bytes.len()), "{name}");
        let mut end = 0;
        for child in nodes.iter().filter(|n| n.parent_id.as_deref() == Some("tx")) {
            assert_eq!(child.offset, end, "{name}: {} starts at {} not {end}", child.id, child.offset);
            end = child.offset + child.length;
        }
        assert_eq!(end, bytes.len(), "{name}: last node ends at {end}, size {}", bytes.len());
        assert_eq!(nodes.iter().map(|n| n.offset + n.length).max().unwrap(), bytes.len(), "{name}");
    }
}

#[test]
fn children_sit_inside_their_parent_in_byte_order() {
    for name in ALL {
        let (_, nodes) = load(name);
        for parent in &nodes {
            let mut cursor = parent.offset;
            for child in nodes.iter().filter(|n| n.parent_id.as_deref() == Some(parent.id.as_str())) {
                assert!(child.offset >= cursor, "{name}: {} overlaps the previous sibling", child.id);
                assert!(child.offset + child.length <= parent.offset + parent.length, "{name}: {} leaves {}", child.id, parent.id);
                assert_eq!(child.depth, parent.depth + 1, "{name}: depth of {}", child.id);
                cursor = child.offset + child.length;
            }
        }
    }
}

#[test]
fn bundle_bytes_match_librustzcash_serialisation() {
    for name in ALL {
        let (bytes, nodes) = load(name);
        let tx = parse_tx(&bytes).unwrap();
        let mut transparent = vec![];
        tx.write_transparent(&mut transparent).unwrap();
        assert_eq!(slice(&bytes, node(&nodes, "transparent")), &transparent[..], "{name}: transparent");

        match tx.version() {
            TxVersion::V4 => {
                let header = node(&nodes, "header");
                assert_eq!(slice(&bytes, header), &bytes[..8], "{name}");
                let mut whole = vec![];
                tx.write_v4(&mut whole).unwrap();
                assert_eq!(whole, bytes, "{name}: v4 round trip");
            }
            TxVersion::V5 => {
                let mut header = vec![];
                tx.write_v5_header(&mut header).unwrap();
                assert_eq!(slice(&bytes, node(&nodes, "header")), &header[..], "{name}: header");
                let mut sapling = vec![];
                tx.write_v5_sapling(&mut sapling).unwrap();
                assert_eq!(slice(&bytes, node(&nodes, "sapling")), &sapling[..], "{name}: sapling");
                let mut orchard = vec![];
                orchard_serialization::write_v5_bundle(tx.orchard_bundle(), &mut orchard).unwrap();
                assert_eq!(slice(&bytes, node(&nodes, "orchard")), &orchard[..], "{name}: orchard");
            }
            _ => {
                let mut header = vec![];
                tx.write_v6_header(&mut header).unwrap();
                assert_eq!(slice(&bytes, node(&nodes, "header")), &header[..], "{name}: header");
                let mut sapling = vec![];
                tx.write_v5_sapling(&mut sapling).unwrap();
                assert_eq!(slice(&bytes, node(&nodes, "sapling")), &sapling[..], "{name}: sapling");
                let mut orchard = vec![];
                orchard_serialization::write_v6_bundle(tx.orchard_bundle(), &mut orchard).unwrap();
                assert_eq!(slice(&bytes, node(&nodes, "orchard")), &orchard[..], "{name}: orchard");
                let mut ironwood = vec![];
                orchard_serialization::write_v6_bundle(tx.ironwood_bundle(), &mut ironwood).unwrap();
                assert_eq!(slice(&bytes, node(&nodes, "ironwood")), &ironwood[..], "{name}: ironwood");
            }
        }
    }
}

#[test]
fn element_fields_point_at_the_parsed_values() {
    for name in ALL {
        let (bytes, nodes) = load(name);
        let tx = parse_tx(&bytes).unwrap();
        if let Some(t) = tx.transparent_bundle() {
            for (i, input) in t.vin.iter().enumerate() {
                let mut expected = vec![];
                input.write(&mut expected).unwrap();
                assert_eq!(slice(&bytes, node(&nodes, &format!("vin-{i}"))), &expected[..], "{name}: vin {i}");
            }
            for (i, output) in t.vout.iter().enumerate() {
                let mut expected = vec![];
                output.write(&mut expected).unwrap();
                assert_eq!(slice(&bytes, node(&nodes, &format!("vout-{i}"))), &expected[..], "{name}: vout {i}");
            }
        }
        for (pool, bundle) in [("orchard", tx.orchard_bundle()), ("ironwood", tx.ironwood_bundle())] {
            let Some(bundle) = bundle else { continue };
            for (i, action) in bundle.actions().iter().enumerate() {
                let n = node(&nodes, &format!("{pool}-action-{i}"));
                let field = |name: &str| n.fields.iter().find(|f| f.name == name).unwrap().value.clone();
                assert_eq!(field("nullifier"), hex::encode(action.nullifier().to_bytes()), "{name}: {pool} nf {i}");
                assert_eq!(field("cmx"), hex::encode(action.cmx().to_bytes()), "{name}: {pool} cmx {i}");
                assert_eq!(&bytes[n.offset + 32..n.offset + 64], &action.nullifier().to_bytes()[..], "{name}");
                assert!(n.fields.iter().filter(|f| f.encrypted).count() == 2, "{name}: ciphertexts flagged encrypted");
            }
        }
        if let Some(s) = tx.sapling_bundle() {
            for (i, spend) in s.shielded_spends().iter().enumerate() {
                let n = node(&nodes, &format!("sapling-spend-{i}"));
                let nf = n.fields.iter().find(|f| f.name == "nullifier").unwrap();
                assert_eq!(nf.value, hex::encode(spend.nullifier().0), "{name}: sapling nf {i}");
            }
            for (i, output) in s.shielded_outputs().iter().enumerate() {
                let n = node(&nodes, &format!("sapling-output-{i}"));
                let cmu = n.fields.iter().find(|f| f.name == "cmu").unwrap();
                assert_eq!(cmu.value, hex::encode(output.cmu().to_bytes()), "{name}: sapling cmu {i}");
            }
        }
    }
}

#[test]
fn v6_ironwood_offsets_follow_zip_229() {
    let (bytes, nodes) = load("v6-ironwood");
    assert_eq!((node(&nodes, "header").offset, node(&nodes, "header").length), (0, 20));
    assert_eq!(node(&nodes, "transparent").offset, 20);
    let ironwood = node(&nodes, "ironwood");
    assert_eq!(ironwood.offset + ironwood.length, bytes.len());
    let action = node(&nodes, "ironwood-action-0");
    assert_eq!(action.length, 820);
}
