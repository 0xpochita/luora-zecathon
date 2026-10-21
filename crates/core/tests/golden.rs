use luora_z_core::{Check, CheckStatus, DecodedTx, check_tx, decode_tx, fee_zat, inspect_pczt, upgrade_at};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    network: String,
    txid: String,
    height: u32,
    hex: String,
    transparent_input_values_zat: Vec<Option<u64>>,
}

fn fixture(name: &str) -> Fixture {
    let path = format!("{}/tests/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

const ALL: [&str; 7] = [
    "v6-testnet-ironwood-pczt",
    "v4-transparent",
    "v4-coinbase",
    "v5-sapling",
    "v5-orchard",
    "v6-ironwood",
    "v6-coinbase-ironwood",
];

fn decoded(name: &str) -> (Fixture, DecodedTx) {
    let fx = fixture(name);
    let tx = decode_tx(&fx.hex, &fx.network).unwrap();
    (fx, tx)
}

fn status_of(checks: &[Check], id: &str) -> CheckStatus {
    checks.iter().find(|c| c.id == id).unwrap().status
}

#[test]
fn every_fixture_txid_round_trips() {
    for name in ALL {
        let (fx, tx) = decoded(name);
        assert_eq!(tx.txid, fx.txid, "{name}");
        assert_eq!(tx.size_bytes, fx.hex.len() / 2, "{name}");
    }
}

#[test]
fn no_fixture_fails_a_check_at_its_mined_height() {
    for name in ALL {
        let fx = fixture(name);
        let checks = check_tx(&fx.hex, &fx.network, fx.height, &fx.transparent_input_values_zat).unwrap();
        assert_eq!(checks.len(), 10, "{name}");
        for c in &checks {
            assert_ne!(c.status, CheckStatus::Fail, "{name}: {} {}", c.id, c.detail);
        }
    }
}

#[test]
fn v4_transparent_fields() {
    let (_, tx) = decoded("v4-transparent");
    assert_eq!(tx.version, 4);
    assert_eq!(tx.version_group_id, "0x892f2085");
    assert_eq!(tx.consensus_branch_id, None);
    assert_eq!(tx.transparent.inputs.len(), 1);
    assert_eq!(tx.transparent.outputs.len(), 2);
    assert!(tx.transparent.outputs.iter().all(|o| o.address.as_deref().is_some_and(|a| a.starts_with("t1"))));
    assert!(tx.sapling.is_none() && tx.orchard.is_none() && tx.ironwood.is_none());
}

#[test]
fn v5_sapling_fields() {
    let (_, tx) = decoded("v5-sapling");
    assert_eq!(tx.version, 5);
    assert_eq!(tx.upgrade.as_deref(), Some("NU5"));
    let sapling = tx.sapling.unwrap();
    assert_eq!((sapling.spends, sapling.outputs), (1, 2));
    assert_eq!(sapling.proof_bytes_each, 192);
    assert!(sapling.anchor.is_some());
    assert_eq!(tx.transparent.outputs.len(), 48);
    let out: u64 = tx.transparent.outputs.iter().map(|o| o.value_zat).sum();
    let fee = fee_zat(&fixture("v5-sapling").hex, &[]).unwrap().unwrap();
    assert_eq!(sapling.value_balance_zat, (out + fee) as i64);
}

#[test]
fn v5_orchard_fields() {
    let (_, tx) = decoded("v5-orchard");
    assert_eq!(tx.consensus_branch_id.as_deref(), Some("0xc8e71055"));
    let orchard = tx.orchard.unwrap();
    assert_eq!(orchard.actions, 2);
    assert_eq!(orchard.proof_bytes, orchard.canonical_proof_bytes);
    assert_eq!(orchard.flags.cross_address_enabled, None);
    assert!(orchard.flags.reserved_bits_zero);
    assert_eq!(orchard.nullifiers.len(), 2);
    assert_eq!(orchard.commitments.len(), 2);
}

#[test]
fn v6_ironwood_fields_and_fee() {
    let fx = fixture("v6-ironwood");
    let tx = decode_tx(&fx.hex, "main").unwrap();
    assert_eq!(tx.version, 6);
    assert_eq!(tx.version_group_id, "0xd884b698");
    assert_eq!(tx.consensus_branch_id.as_deref(), Some("0x37a5165b"));
    assert_eq!(tx.upgrade.as_deref(), Some("NU6.3"));
    assert!(tx.orchard.is_none());
    let ironwood = tx.ironwood.unwrap();
    assert_eq!(ironwood.actions, 1);
    assert_eq!(ironwood.value_balance_zat, -351_830);
    assert_eq!(ironwood.proof_bytes, 4_992);
    assert_eq!(ironwood.flags.cross_address_enabled, Some(true));
    assert_eq!(fee_zat(&fx.hex, &fx.transparent_input_values_zat).unwrap(), Some(15_000));
    assert_eq!(fee_zat(&fx.hex, &[Some(509_384), None]).unwrap(), None);
    assert_eq!(tx.zip317.conventional_fee_zat, 15_000);
}

#[test]
fn v6_coinbase_ironwood_rules() {
    let fx = fixture("v6-coinbase-ironwood");
    let tx = decode_tx(&fx.hex, "main").unwrap();
    assert!(tx.transparent.inputs[0].is_coinbase);
    assert_eq!(tx.expiry_height, fx.height);
    let ironwood = tx.ironwood.unwrap();
    assert!(!ironwood.flags.spends_enabled);
    let checks = check_tx(&fx.hex, "main", fx.height, &[None]).unwrap();
    assert_eq!(status_of(&checks, "coinbase-shielded"), CheckStatus::Pass);
    assert_eq!(status_of(&checks, "expiry"), CheckStatus::Pass);
    let one_block_later = check_tx(&fx.hex, "main", fx.height + 1, &[None]).unwrap();
    assert_eq!(status_of(&one_block_later, "expiry"), CheckStatus::Fail);
}

#[test]
fn pre_nu63_orchard_tx_fails_after_nu63() {
    let fx = fixture("v5-orchard");
    let nu63 = 3_428_143;
    let checks = check_tx(&fx.hex, "main", nu63, &[]).unwrap();
    assert_eq!(status_of(&checks, "branch-id"), CheckStatus::Fail);
    assert_eq!(status_of(&checks, "orchard-cross-address"), CheckStatus::Fail);
    assert_eq!(status_of(&checks, "orchard-turnstile"), CheckStatus::Pass);
    assert_eq!(status_of(&checks, "expiry"), CheckStatus::Fail);
}

#[test]
fn orchard_inside_the_zip257_window_fails() {
    let fx = fixture("v5-orchard");
    let checks = check_tx(&fx.hex, "main", 3_363_426, &[]).unwrap();
    assert_eq!(status_of(&checks, "orchard-after-nu62"), CheckStatus::Fail);
    let before = check_tx(&fx.hex, "main", 3_363_425, &[]).unwrap();
    assert_eq!(status_of(&before, "orchard-after-nu62"), CheckStatus::Na);
}

#[test]
fn v6_before_nu63_is_rejected() {
    let fx = fixture("v6-ironwood");
    let checks = check_tx(&fx.hex, "main", 3_428_142, &fx.transparent_input_values_zat).unwrap();
    assert_eq!(status_of(&checks, "version"), CheckStatus::Fail);
    assert_eq!(status_of(&checks, "branch-id"), CheckStatus::Fail);
}

#[test]
fn low_fee_is_a_warning_not_a_failure() {
    let fx = fixture("v4-transparent");
    let checks = check_tx(&fx.hex, "main", fx.height, &fx.transparent_input_values_zat).unwrap();
    let fee = checks.iter().find(|c| c.id == "zip317-fee").unwrap();
    assert_eq!(fee.status, CheckStatus::Warn);
    assert!(fee.detail.contains("2,450 zat"), "{}", fee.detail);
    let unknown = check_tx(&fx.hex, "main", fx.height, &[None]).unwrap();
    assert_eq!(status_of(&unknown, "zip317-fee"), CheckStatus::Na);
}

#[test]
fn upgrade_at_follows_zcash_protocol() {
    let at = upgrade_at("main", 3_428_143).unwrap();
    assert_eq!((at.name.as_str(), at.branch_id.as_str(), at.activation_height), ("NU6.3", "0x37a5165b", 3_428_143));
    assert_eq!(upgrade_at("main", 3_428_142).unwrap().name, "NU6.2");
    assert_eq!(upgrade_at("test", 4_134_000).unwrap().name, "NU6.3");
    assert_eq!(upgrade_at("regtest", 1).unwrap().name, "NU6.3");
}

#[test]
fn bad_input_is_a_typed_error() {
    assert_eq!(decode_tx("zz", "main").unwrap_err().code, "bad-hex");
    assert_eq!(decode_tx("", "main").unwrap_err().code, "empty-input");
    assert_eq!(decode_tx("00", "mainnet").unwrap_err().code, "bad-network");
    let fx = fixture("v6-ironwood");
    assert_eq!(decode_tx(&fx.hex[..200], "main").unwrap_err().code, "parse-failed");
    assert_eq!(decode_tx(&format!("{}00", fx.hex), "main").unwrap_err().code, "trailing-bytes");
}

fn pczt_fixture(name: &str) -> String {
    let path = format!("{}/tests/fixtures/pczt/{name}.pczt", env!("CARGO_MANIFEST_DIR"));
    hex::encode(std::fs::read(path).unwrap())
}

fn role_done(view: &luora_z_core::PcztView, name: &str) -> bool {
    view.roles.iter().find(|r| r.name == name).unwrap().done
}

fn pczt_check(view: &luora_z_core::PcztView, id: &str) -> CheckStatus {
    status_of(&view.checks, id)
}

#[test]
fn pczt_created_by_devtool() {
    let view = inspect_pczt(&pczt_fixture("1-created"), "test").unwrap();
    assert!(role_done(&view, "Creator") && role_done(&view, "Constructor"));
    assert!(role_done(&view, "IO Finalizer") && role_done(&view, "Updater"));
    assert!(!role_done(&view, "Prover") && !role_done(&view, "Signer"));
    assert_eq!(view.actions.len(), 5);
    assert!(view.actions.iter().all(|a| a.pool == "ironwood"));
    let paid: Vec<_> = view.actions.iter().filter(|a| a.user_address.is_some()).collect();
    assert_eq!(paid.len(), 1);
    assert_eq!(paid[0].value_zat, Some(10_000_000));
    assert_eq!(pczt_check(&view, "user-address-matches-recipient"), CheckStatus::Pass);
    assert_eq!(pczt_check(&view, "dummy-keys-cleared"), CheckStatus::Pass);
    assert_eq!(pczt_check(&view, "all-signatures-present"), CheckStatus::Warn);
    let fee = view.checks.iter().find(|c| c.id == "fee-and-expiry").unwrap();
    assert_eq!(fee.status, CheckStatus::Pass);
    assert!(fee.detail.contains("25,000 zat"), "{}", fee.detail);
}

#[test]
fn pczt_proven_then_signed_then_combined() {
    let proven = inspect_pczt(&pczt_fixture("2-proven"), "test").unwrap();
    assert!(role_done(&proven, "Prover") && !role_done(&proven, "Signer"));
    let signed = inspect_pczt(&pczt_fixture("3-signed"), "test").unwrap();
    assert!(!role_done(&signed, "Prover") && role_done(&signed, "Signer"));
    let combined = inspect_pczt(&pczt_fixture("5-combined-signed"), "test").unwrap();
    assert!(role_done(&combined, "Prover") && role_done(&combined, "Signer"));
    assert_eq!(pczt_check(&combined, "all-signatures-present"), CheckStatus::Pass);
    let extractor = combined.roles.iter().find(|r| r.name == "Extractor").unwrap();
    assert!(extractor.evidence.contains("ready to extract"), "{}", extractor.evidence);
}

#[test]
fn pczt_signer_that_skipped_ironwood_is_caught() {
    let view = inspect_pczt(&pczt_fixture("4-combined-unsigned"), "test").unwrap();
    assert!(role_done(&view, "Prover") && !role_done(&view, "Signer"));
    let sigs = view.checks.iter().find(|c| c.id == "all-signatures-present").unwrap();
    assert_eq!(sigs.status, CheckStatus::Warn);
    assert!(sigs.detail.contains("Ironwood action 3"), "{}", sigs.detail);
}

#[test]
fn pczt_accepts_base64_and_rejects_garbage() {
    use base64::Engine as _;
    let bytes = hex::decode(pczt_fixture("1-created")).unwrap();
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    assert_eq!(inspect_pczt(&b64, "test").unwrap().actions.len(), 5);
    assert_eq!(inspect_pczt("0011", "test").unwrap_err().code, "not-pczt");
    let mainnet = inspect_pczt(&b64, "main").unwrap();
    assert!(mainnet.checks.iter().any(|c| c.id == "coin-type" && c.status == CheckStatus::Warn));
}

#[test]
fn testnet_ironwood_tx_built_from_the_pczt() {
    let fx = fixture("v6-testnet-ironwood-pczt");
    let tx = decode_tx(&fx.hex, "test").unwrap();
    assert_eq!(tx.txid, fx.txid);
    assert_eq!(tx.upgrade.as_deref(), Some("NU7"));
    let ironwood = tx.ironwood.unwrap();
    assert_eq!(ironwood.actions, 5);
    assert_eq!(ironwood.value_balance_zat, 25_000);
    assert_eq!(fee_zat(&fx.hex, &[]).unwrap(), Some(25_000));
}
