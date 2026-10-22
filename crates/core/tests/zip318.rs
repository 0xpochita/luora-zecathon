use luora_z_core::{Zip318View, zip318_tx};
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    network: String,
    height: u32,
    hex: String,
}

fn view(name: &str) -> Zip318View {
    let path = format!("{}/tests/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let fx: Fixture = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    zip318_tx(&fx.hex, &fx.network, fx.height).unwrap()
}

fn ok_of(view: &Zip318View, field: &str) -> Option<bool> {
    view.reasons.iter().find(|r| r.field == field).unwrap().ok
}

fn detail_of<'a>(view: &'a Zip318View, field: &str) -> &'a str {
    &view.reasons.iter().find(|r| r.field == field).unwrap().detail
}

#[test]
fn canonical_ten_zec_crossing_conforms_as_a_transfer() {
    let v = view("v6-zip318-transfer");
    assert_eq!(v.classification, "transfer");
    assert_eq!(ok_of(&v, "sole-destination-value"), Some(true));
    assert!(detail_of(&v, "sole-destination-value").starts_with("10 ZEC enters Ironwood"));
    assert_eq!(ok_of(&v, "expiry"), Some(true));
    assert!(detail_of(&v, "expiry").contains("3,594,240"));
    assert_eq!(ok_of(&v, "fee"), Some(true));
    assert_eq!(ok_of(&v, "anchor-on-grid"), None);
    assert!(v.reasons.iter().all(|r| r.zip.number == 318));
}

#[test]
fn odd_amount_crossing_is_nonconforming_because_of_its_value() {
    let v = view("v6-zip318-odd-amount");
    assert_eq!(v.classification, "nonconforming");
    assert_eq!(ok_of(&v, "sole-destination-value"), Some(false));
    assert!(detail_of(&v, "sole-destination-value").starts_with("0.09775 ZEC enters Ironwood. It is not a {1,2,5}×10^k denomination"));
    assert_eq!(ok_of(&v, "source-actions"), Some(true));
    assert_eq!(ok_of(&v, "expiry"), Some(true));
    assert_eq!(ok_of(&v, "fee"), Some(true));
}

#[test]
fn preparation_shape_stays_unknown_without_a_viewing_key() {
    let v = view("v6-zip318-preparation");
    assert_eq!(v.classification, "unknown");
    assert_eq!(ok_of(&v, "source-actions"), Some(true));
    assert!(detail_of(&v, "source-actions").starts_with("16 Orchard actions"));
    assert_eq!(ok_of(&v, "send-to-self"), None);
    assert_eq!(ok_of(&v, "fee"), Some(true));
}

#[test]
fn non_migration_transactions_are_not_labelled() {
    for name in ["v4-transparent", "v4-coinbase", "v5-sapling", "v5-orchard", "v6-ironwood", "v6-coinbase-ironwood"] {
        assert_eq!(view(name).classification, "not-a-migration-shape", "{name}");
    }
}
