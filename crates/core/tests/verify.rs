#![cfg(feature = "verify")]

use luora_z_core::decode::parse_tx;
use luora_z_core::verify_tx;

fn fixture_hex(name: &str) -> String {
    let path = format!("{}/tests/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    json["hex"].as_str().unwrap().to_string()
}

fn flip_byte_inside(tx_hex: &str, needle: &[u8], offset: usize) -> String {
    let mut bytes = hex::decode(tx_hex).unwrap();
    let start = bytes.windows(needle.len()).position(|w| w == needle).unwrap();
    bytes[start + offset] ^= 0x01;
    hex::encode(bytes)
}

#[test]
fn real_ironwood_proof_verifies_and_a_flipped_byte_does_not() {
    let hex = fixture_hex("v6-ironwood");
    assert!(verify_tx(&hex).unwrap().all_valid);
    let tx = parse_tx(&hex::decode(&hex).unwrap()).unwrap();
    let proof = tx.ironwood_bundle().unwrap().authorization().proof().as_ref().to_vec();
    let tampered = flip_byte_inside(&hex, &proof, proof.len() / 2);
    let report = verify_tx(&tampered).unwrap();
    assert!(!report.all_valid);
}

#[test]
fn real_sapling_proofs_verify_and_a_flipped_byte_does_not() {
    let hex = fixture_hex("v5-sapling");
    let report = verify_tx(&hex).unwrap();
    assert_eq!(report.proofs.len(), 3);
    assert!(report.all_valid);
    let tx = parse_tx(&hex::decode(&hex).unwrap()).unwrap();
    let proof = tx.sapling_bundle().unwrap().shielded_outputs()[0].zkproof().to_vec();
    let tampered = flip_byte_inside(&hex, &proof, 100);
    let report = verify_tx(&tampered);
    assert!(report.map(|r| !r.all_valid).unwrap_or(true));
}
