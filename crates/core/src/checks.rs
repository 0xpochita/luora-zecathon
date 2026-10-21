use orchard::bundle::Authorized as OrchardAuthorized;
use zcash_primitives::transaction::{Transaction, TxVersion};
use zcash_protocol::consensus::{BlockHeight, BranchId, NetworkUpgrade, Parameters};
use zcash_protocol::value::ZatBalance;

use crate::decode::{
    FeeInputs, canonical_halo2_proof_bytes, fee_paid, has_explicit_branch_id, is_coinbase,
    parse_tx, version_number,
};
use crate::model::{Check, CheckStatus, CoreError, ZipRef};
use crate::network::{Net, branch_display_name, branch_hex};

pub const MAX_EXPIRY_HEIGHT: u32 = 499_999_999;

const ZEBRA_REV: &str = "zebra 6d1e414d";
const LIBRUSTZCASH_REV: &str = "librustzcash 8672a4b2";

fn zip(number: u32, clause: &str) -> Option<ZipRef> {
    Some(ZipRef {
        number,
        clause: Some(clause.to_string()),
        url: format!("https://zips.z.cash/zip-{number:04}"),
    })
}

fn group_thousands(digits: &str) -> String {
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

pub fn fmt_zat(value: i128) -> String {
    let sign = if value < 0 { "-" } else { "" };
    let abs = value.unsigned_abs();
    let whole = abs / 100_000_000;
    let frac = abs % 100_000_000;
    let zec = if frac == 0 {
        whole.to_string()
    } else {
        let frac = format!("{frac:08}");
        format!("{whole}.{}", frac.trim_end_matches('0'))
    };
    format!("{sign}{} zat ({sign}{zec} ZEC)", group_thousands(&abs.to_string()))
}

fn fmt_height(height: u32) -> String {
    group_thousands(&height.to_string())
}

fn check(
    id: &str,
    title: &str,
    status: CheckStatus,
    detail: String,
    zip: Option<ZipRef>,
    source: &str,
) -> Check {
    Check {
        id: id.to_string(),
        title: title.to_string(),
        status,
        detail,
        zip,
        source: Some(source.to_string()),
    }
}

fn nu_active(net: Net, nu: NetworkUpgrade, height: BlockHeight) -> bool {
    net.is_nu_active(nu, height)
}

fn activation(net: Net, nu: NetworkUpgrade) -> String {
    net.activation_height(nu)
        .map(|h| format!("height {}", fmt_height(u32::from(h))))
        .unwrap_or_else(|| "a height not yet scheduled on this network".to_string())
}

fn branch_id_check(tx: &Transaction, net: Net, height: BlockHeight) -> Check {
    let expected = BranchId::for_height(&net, height);
    let title = "Consensus branch ID matches the height";
    let source = format!(
        "{ZEBRA_REV} zebra-consensus/src/transaction/check.rs:885 consensus_branch_id; {LIBRUSTZCASH_REV} components/zcash_protocol/src/consensus.rs:943 BranchId::for_height"
    );
    let at = format!("at height {}", fmt_height(u32::from(height)));
    if !has_explicit_branch_id(tx) {
        return check(
            "branch-id",
            title,
            CheckStatus::Na,
            format!(
                "v{} transactions carry no nConsensusBranchId field; their signatures commit to the branch active {at}, which is {} ({}).",
                version_number(tx.version()),
                branch_display_name(expected),
                branch_hex(expected)
            ),
            zip(225, "nConsensusBranchId, constrained in protocol spec § 7.1.2"),
            &source,
        );
    }
    let actual = tx.consensus_branch_id();
    let zip_number = if matches!(tx.version(), TxVersion::V6) { 229 } else { 225 };
    if actual == expected {
        check(
            "branch-id",
            title,
            CheckStatus::Pass,
            format!(
                "nConsensusBranchId is {} ({}), the branch active {at}.",
                branch_hex(actual),
                branch_display_name(actual)
            ),
            zip(zip_number, "nConsensusBranchId, constrained in protocol spec § 7.1.2"),
            &source,
        )
    } else {
        check(
            "branch-id",
            title,
            CheckStatus::Fail,
            format!(
                "nConsensusBranchId is {} ({}) but the branch active {at} is {} ({}). Zebra rejects this with TransactionError::WrongConsensusBranchId; rebuild the transaction for {}.",
                branch_hex(actual),
                branch_display_name(actual),
                branch_hex(expected),
                branch_display_name(expected),
                branch_display_name(expected)
            ),
            zip(zip_number, "nConsensusBranchId, constrained in protocol spec § 7.1.2"),
            &source,
        )
    }
}

fn version_check(tx: &Transaction, net: Net, height: BlockHeight) -> Check {
    let branch = BranchId::for_height(&net, height);
    let version = tx.version();
    let v = version_number(version);
    let source = format!(
        "{LIBRUSTZCASH_REV} zcash_primitives/src/transaction/mod.rs:235 TxVersion::valid_in_branch"
    );
    let (zip_number, clause) = match version {
        TxVersion::V6 => (229, "Version 6 transaction format, valid from NU6.3"),
        TxVersion::V5 => (225, "Version 5 transaction format, valid from NU5"),
        _ => (2003, "Disallow version 4 transactions (from NU7)"),
    };
    let valid = version.valid_in_branch(branch);
    check(
        "version",
        "Transaction version allowed at this height",
        if valid { CheckStatus::Pass } else { CheckStatus::Fail },
        if valid {
            format!(
                "v{v} (version group 0x{:08x}) is allowed under {} at height {}.",
                version.version_group_id(),
                branch_display_name(branch),
                fmt_height(u32::from(height))
            )
        } else {
            format!(
                "v{v} (version group 0x{:08x}) is not allowed under {} at height {}. {}",
                version.version_group_id(),
                branch_display_name(branch),
                fmt_height(u32::from(height)),
                match version {
                    TxVersion::V6 => format!(
                        "v6 needs NU6.3, which activates at {}.",
                        activation(net, NetworkUpgrade::Nu6_3)
                    ),
                    TxVersion::V5 => format!(
                        "v5 needs NU5, which activates at {}.",
                        activation(net, NetworkUpgrade::Nu5)
                    ),
                    _ => format!(
                        "v4 is no longer accepted from NU7 ({}); rebuild as v5 or v6.",
                        activation(net, NetworkUpgrade::Nu7)
                    ),
                }
            )
        },
        zip(zip_number, clause),
        &source,
    )
}

fn expiry_check(tx: &Transaction, net: Net, height: BlockHeight) -> Check {
    let expiry = u32::from(tx.expiry_height());
    let h = u32::from(height);
    let coinbase = is_coinbase(tx);
    let nu5 = nu_active(net, NetworkUpgrade::Nu5, height);
    let title = "Expiry height";
    if coinbase && nu5 {
        let source = format!(
            "{ZEBRA_REV} zebra-consensus/src/transaction/check.rs:506 coinbase_expiry_height"
        );
        return if expiry == h {
            check(
                "expiry",
                title,
                CheckStatus::Pass,
                format!(
                    "Coinbase nExpiryHeight is {}, equal to the block height as required from NU5.",
                    fmt_height(expiry)
                ),
                zip(203, "Changes for NU5"),
                &source,
            )
        } else {
            check(
                "expiry",
                title,
                CheckStatus::Fail,
                format!(
                    "Coinbase nExpiryHeight is {} but from NU5 it must equal the block height {} (TransactionError::CoinbaseExpiryBlockHeight).",
                    fmt_height(expiry),
                    fmt_height(h)
                ),
                zip(203, "Changes for NU5"),
                &source,
            )
        };
    }
    let source = format!(
        "{ZEBRA_REV} zebra-consensus/src/transaction/check.rs:547 non_coinbase_expiry_height"
    );
    if !tx.version().has_overwinter() {
        return check(
            "expiry",
            title,
            CheckStatus::Na,
            "Pre-Overwinter transactions have no nExpiryHeight field.".to_string(),
            zip(203, "Specification"),
            &source,
        );
    }
    if expiry > MAX_EXPIRY_HEIGHT {
        return check(
            "expiry",
            title,
            CheckStatus::Fail,
            format!(
                "nExpiryHeight is {}, above the maximum {} (TransactionError::MaximumExpiryHeight).",
                fmt_height(expiry),
                fmt_height(MAX_EXPIRY_HEIGHT)
            ),
            zip(203, "Specification"),
            &source,
        );
    }
    if expiry == 0 {
        return check(
            "expiry",
            title,
            CheckStatus::Pass,
            "nExpiryHeight is 0, so the transaction never expires.".to_string(),
            zip(203, "Specification"),
            &source,
        );
    }
    if h <= expiry {
        check(
            "expiry",
            title,
            CheckStatus::Pass,
            format!(
                "nExpiryHeight is {}; a block at height {} is within it ({} blocks to spare).",
                fmt_height(expiry),
                fmt_height(h),
                fmt_height(expiry - h)
            ),
            zip(203, "Specification"),
            &source,
        )
    } else {
        check(
            "expiry",
            title,
            CheckStatus::Fail,
            format!(
                "nExpiryHeight is {} but the height is {}, {} blocks later. Zebra rejects this with TransactionError::ExpiredTransaction; rebuild with a later expiry.",
                fmt_height(expiry),
                fmt_height(h),
                fmt_height(h - expiry)
            ),
            zip(203, "Specification"),
            &source,
        )
    }
}

type OrchardBundle = orchard::Bundle<OrchardAuthorized, ZatBalance>;

fn reserved_flags_check(tx: &Transaction) -> Check {
    let source = "orchard 0.16.0 src/bundle.rs:400 Flags::from_byte (zcash_primitives rejects reserved bits while parsing)";
    let is_v6 = matches!(tx.version(), TxVersion::V6);
    let mut parts = vec![];
    for (name, bundle, reserved) in [
        ("flagsOrchard", tx.orchard_bundle(), "bits 2..7"),
        ("flagsIronwood", tx.ironwood_bundle(), "bits 3..7"),
    ] {
        if let Some(b) = bundle {
            parts.push(format!("{name} is 0x{:02x}; reserved {reserved} are zero", b.flag_byte()));
        }
    }
    if parts.is_empty() {
        return check(
            "reserved-flags",
            "Reserved flag bits are zero",
            CheckStatus::Na,
            "No Orchard or Ironwood bundle, so there are no flag bytes.".to_string(),
            zip(229, "flagsOrchard / flagsIronwood reserved bits"),
            source,
        );
    }
    check(
        "reserved-flags",
        "Reserved flag bits are zero",
        CheckStatus::Pass,
        format!("{}.", parts.join("; ")),
        zip(if is_v6 { 229 } else { 225 }, "flagsOrchard / flagsIronwood reserved bits"),
        source,
    )
}

fn turnstile_check(tx: &Transaction, net: Net, height: BlockHeight) -> Check {
    let source = format!(
        "{ZEBRA_REV} zebra-consensus/src/transaction/check.rs:217 orchard_value_balance_non_negative"
    );
    let title = "Orchard turnstile: no new value into Orchard";
    let Some(bundle) = tx.orchard_bundle() else {
        return check(
            "orchard-turnstile",
            title,
            CheckStatus::Na,
            "No Orchard bundle; valueBalanceOrchard is 0.".to_string(),
            zip(258, "Consensus rules from NU6.3 activation"),
            &source,
        );
    };
    let balance = i64::from(*bundle.value_balance());
    if !nu_active(net, NetworkUpgrade::Nu6_3, height) {
        return check(
            "orchard-turnstile",
            title,
            CheckStatus::Na,
            format!(
                "valueBalanceOrchard is {}; the turnstile applies from NU6.3 ({}).",
                fmt_zat(balance.into()),
                activation(net, NetworkUpgrade::Nu6_3)
            ),
            zip(258, "Consensus rules from NU6.3 activation"),
            &source,
        );
    }
    if balance >= 0 {
        check(
            "orchard-turnstile",
            title,
            CheckStatus::Pass,
            format!(
                "valueBalanceOrchard is {}, so value only leaves the Orchard pool.",
                fmt_zat(balance.into())
            ),
            zip(258, "Consensus rules from NU6.3 activation"),
            &source,
        )
    } else {
        check(
            "orchard-turnstile",
            title,
            CheckStatus::Fail,
            format!(
                "valueBalanceOrchard is {}: this moves value into the Orchard pool, which NU6.3 forbids (TransactionError::NegativeOrchardValueBalance). Send new shielded value to the Ironwood pool instead.",
                fmt_zat(balance.into())
            ),
            zip(258, "Consensus rules from NU6.3 activation"),
            &source,
        )
    }
}

fn cross_address_check(tx: &Transaction, net: Net, height: BlockHeight) -> Check {
    let source = format!(
        "{ZEBRA_REV} zebra-consensus/src/transaction/check.rs:184 orchard_cross_address_disabled"
    );
    let title = "Orchard cross-address transfers disabled";
    let Some(bundle) = tx.orchard_bundle() else {
        return check(
            "orchard-cross-address",
            title,
            CheckStatus::Na,
            "No Orchard bundle.".to_string(),
            zip(258, "Consensus rules from NU6.3 activation"),
            &source,
        );
    };
    if !nu_active(net, NetworkUpgrade::Nu6_3, height) {
        return check(
            "orchard-cross-address",
            title,
            CheckStatus::Na,
            format!(
                "The cross-address restriction applies from NU6.3 ({}).",
                activation(net, NetworkUpgrade::Nu6_3)
            ),
            zip(258, "Consensus rules from NU6.3 activation"),
            &source,
        );
    }
    let protocol = bundle.bundle_version().protocol_version();
    let enabled = bundle.flags().cross_address_enabled();
    if !enabled {
        check(
            "orchard-cross-address",
            title,
            CheckStatus::Pass,
            format!(
                "The {} Orchard actions are bound to the NU6.3 circuit, where enableCrossAddress is 0 (flagsOrchard 0x{:02x}).",
                bundle.actions().len(),
                bundle.flag_byte()
            ),
            zip(258, "Consensus rules from NU6.3 activation"),
            &source,
        )
    } else {
        check(
            "orchard-cross-address",
            title,
            CheckStatus::Fail,
            format!(
                "The {} Orchard actions were built for {:?} (branch {}), which permits cross-address transfers; after NU6.3 every Orchard action must have enableCrossAddress = 0 and verify under the NU6.3 circuit key. Rebuild against branch {}.",
                bundle.actions().len(),
                protocol,
                branch_hex(tx.consensus_branch_id()),
                branch_hex(BranchId::Nu6_3)
            ),
            zip(258, "Consensus rules from NU6.3 activation"),
            &source,
        )
    }
}

fn orchard_mitigation_check(tx: &Transaction, net: Net, height: BlockHeight) -> Check {
    let source = format!(
        "{ZEBRA_REV} zebra-chain/src/parameters/network.rs:26 MAINNET_TEMPORARY_ORCHARD_DISABLING_SOFT_FORK_HEIGHT; zebra-consensus/src/transaction.rs:850"
    );
    let title = "Orchard temporarily disabled before NU6.2";
    let actions = tx.orchard_bundle().map_or(0, |b| b.actions().len());
    let h = u32::from(height);
    let window = net.temporary_orchard_disabling_height().and_then(|start| {
        net.activation_height(NetworkUpgrade::Nu6_2).map(|end| (start, u32::from(end)))
    });
    let Some((start, end)) = window else {
        return check(
            "orchard-after-nu62",
            title,
            CheckStatus::Na,
            "This network has no temporary Orchard-disabling window.".to_string(),
            zip(257, "Orchard temporary vulnerability mitigation"),
            &source,
        );
    };
    let in_window = h >= start && h < end;
    let window_text = format!("heights {} to {}", fmt_height(start), fmt_height(end - 1));
    if !in_window {
        return check(
            "orchard-after-nu62",
            title,
            CheckStatus::Na,
            format!(
                "Height {} is outside the mitigation window ({window_text}).",
                fmt_height(h)
            ),
            zip(257, "Orchard temporary vulnerability mitigation"),
            &source,
        );
    }
    if version_number(tx.version()) >= 5 && actions > 0 {
        check(
            "orchard-after-nu62",
            title,
            CheckStatus::Fail,
            format!(
                "Height {} is inside the window ({window_text}) where v5+ transactions MUST NOT contain Orchard actions, and this one has {actions}. Wait for NU6.2 at height {}.",
                fmt_height(h),
                fmt_height(end)
            ),
            zip(257, "Orchard temporary vulnerability mitigation"),
            &source,
        )
    } else {
        check(
            "orchard-after-nu62",
            title,
            CheckStatus::Pass,
            format!(
                "Height {} is inside the window ({window_text}) and the transaction has no Orchard actions.",
                fmt_height(h)
            ),
            zip(257, "Orchard temporary vulnerability mitigation"),
            &source,
        )
    }
}

fn proof_length_check(tx: &Transaction, net: Net, height: BlockHeight) -> Check {
    let source = format!(
        "{ZEBRA_REV} zebra-consensus/src/transaction.rs:873 (Orchard, from NU6.2) and :884 (Ironwood)"
    );
    let title = "Halo 2 proof has canonical length";
    let canonical_rule_active = nu_active(net, NetworkUpgrade::Nu6_2, height);
    let mut status = CheckStatus::Na;
    let mut parts = vec![];
    let bundles: [(&str, Option<&OrchardBundle>, bool); 2] = [
        ("Orchard", tx.orchard_bundle(), canonical_rule_active),
        ("Ironwood", tx.ironwood_bundle(), true),
    ];
    for (name, bundle, enforced) in bundles {
        let Some(b) = bundle else { continue };
        let n = b.actions().len();
        let actual = b.authorization().proof().as_ref().len();
        let expected = canonical_halo2_proof_bytes(n);
        let ok = actual == expected;
        let this = match (ok, enforced) {
            (true, _) => CheckStatus::Pass,
            (false, true) => CheckStatus::Fail,
            (false, false) => CheckStatus::Warn,
        };
        status = worst(status, this);
        parts.push(format!(
            "{name} proof is {} bytes for {n} action{}; canonical is 2720 + 2272 × {n} = {} bytes{}",
            group_thousands(&actual.to_string()),
            if n == 1 { "" } else { "s" },
            group_thousands(&expected.to_string()),
            match (ok, enforced) {
                (true, _) => String::new(),
                (false, true) => format!(" (TransactionError::{name}ProofSize)"),
                (false, false) => " (not enforced before NU6.2)".to_string(),
            }
        ));
    }
    if parts.is_empty() {
        parts.push("No Orchard or Ironwood bundle, so there is no Halo 2 proof".to_string());
    }
    check(
        "proof-length",
        title,
        status,
        format!("{}.", parts.join("; ")),
        zip(257, "Canonical Orchard Action proof length"),
        &source,
    )
}

fn worst(a: CheckStatus, b: CheckStatus) -> CheckStatus {
    fn rank(s: CheckStatus) -> u8 {
        match s {
            CheckStatus::Na => 0,
            CheckStatus::Pass => 1,
            CheckStatus::Warn => 2,
            CheckStatus::Fail => 3,
        }
    }
    if rank(b) > rank(a) { b } else { a }
}

fn coinbase_shielded_check(tx: &Transaction, net: Net, height: BlockHeight) -> Check {
    let source = format!(
        "{ZEBRA_REV} zebra-consensus/src/transaction/check.rs:277 coinbase_tx_no_prevout_joinsplit_spend and :246 coinbase_orchard_component_empty"
    );
    let title = "Coinbase shielded rules";
    if !is_coinbase(tx) {
        return check(
            "coinbase-shielded",
            title,
            CheckStatus::Na,
            "Not a coinbase transaction.".to_string(),
            zip(213, "Specification"),
            &source,
        );
    }
    let mut failures = vec![];
    let mut notes = vec![];
    if let Some(b) = tx.sprout_bundle() {
        failures.push(format!("it has {} JoinSplits", b.joinsplits.len()));
    }
    if let Some(b) = tx.sapling_bundle() {
        if !b.shielded_spends().is_empty() {
            failures.push(format!("it has {} Sapling spends", b.shielded_spends().len()));
        }
        if !b.shielded_outputs().is_empty() {
            if nu_active(net, NetworkUpgrade::Heartwood, height) {
                notes.push(format!("{} Sapling outputs", b.shielded_outputs().len()));
            } else {
                failures.push("it has Sapling outputs before Heartwood".to_string());
            }
        }
    }
    if let Some(b) = tx.orchard_bundle() {
        if nu_active(net, NetworkUpgrade::Nu6_3, height) {
            failures.push(format!(
                "it has {} Orchard actions, but from NU6.3 a coinbase Orchard component must be empty (TransactionError::CoinbaseHasOrchardActions)",
                b.actions().len()
            ));
        } else if b.flags().spends_enabled() {
            failures.push("enableSpendsOrchard is 1 (TransactionError::CoinbaseHasEnableSpendsOrchard)".to_string());
        } else {
            notes.push(format!("{} Orchard actions with spends disabled", b.actions().len()));
        }
    }
    if let Some(b) = tx.ironwood_bundle() {
        if b.flags().spends_enabled() {
            failures.push("enableSpendsIronwood is 1".to_string());
        } else {
            notes.push(format!("{} Ironwood actions with spends disabled", b.actions().len()));
        }
    }
    let (zip_number, clause) = if nu_active(net, NetworkUpgrade::Nu6_3, height) {
        (213, "Once the NU6.3 network upgrade activates")
    } else {
        (213, "Specification")
    };
    if failures.is_empty() {
        check(
            "coinbase-shielded",
            title,
            CheckStatus::Pass,
            if notes.is_empty() {
                "Coinbase with transparent outputs only: no JoinSplits, no shielded spends.".to_string()
            } else {
                format!(
                    "Coinbase has {}; no JoinSplits and no shielded spends. Shielded coinbase outputs must also decrypt with the all-zero OVK, which needs the note plaintexts and is not checked here.",
                    notes.join(" and ")
                )
            },
            zip(zip_number, clause),
            &source,
        )
    } else {
        check(
            "coinbase-shielded",
            title,
            CheckStatus::Fail,
            format!("Coinbase breaks the rules: {}.", failures.join("; ")),
            zip(zip_number, clause),
            &source,
        )
    }
}

fn fee_check(tx: &Transaction, net: Net, height: BlockHeight, input_values: &[Option<u64>]) -> Check {
    let source = format!(
        "{LIBRUSTZCASH_REV} zcash_primitives/src/transaction/fees/zip317.rs:172 FeeRule::fee_required and zcash_primitives/src/transaction/mod.rs:677 TransactionData::fee_paid"
    );
    let title = "ZIP 317 conventional fee";
    let fee_inputs = FeeInputs::of(tx);
    let conventional = fee_inputs.conventional_fee(net, height);
    let logical = fee_inputs.logical_actions();
    if is_coinbase(tx) {
        return check(
            "zip317-fee",
            title,
            CheckStatus::Na,
            "Coinbase transactions pay no fee.".to_string(),
            zip(317, "Fee calculation"),
            &source,
        );
    }
    let fee = match fee_paid(tx, input_values) {
        Ok(Some(fee)) => fee,
        Ok(None) => {
            return check(
                "zip317-fee",
                title,
                CheckStatus::Na,
                format!(
                    "Conventional fee is {} for {logical} logical actions, but the value of at least one of the {} transparent inputs is unknown, so the fee paid cannot be computed.",
                    fmt_zat(conventional.into()),
                    fee_inputs.transparent_input_sizes.len()
                ),
                zip(317, "Fee calculation"),
                &source,
            );
        }
        Err(e) if e.code == "input-values-mismatch" => {
            return check(
                "zip317-fee",
                title,
                CheckStatus::Na,
                format!("Cannot compute the fee: {}.", e.message),
                zip(317, "Fee calculation"),
                &source,
            );
        }
        Err(e) => {
            return check(
                "zip317-fee",
                title,
                CheckStatus::Fail,
                format!("The inputs do not cover the outputs: {}.", e.message),
                zip(317, "Fee calculation"),
                &source,
            );
        }
    };
    if fee >= conventional {
        check(
            "zip317-fee",
            title,
            CheckStatus::Pass,
            format!(
                "Fee paid is {}; the conventional fee for {logical} logical actions is {}.",
                fmt_zat(fee.into()),
                fmt_zat(conventional.into())
            ),
            zip(317, "Fee calculation"),
            &source,
        )
    } else {
        let marginal = 5_000u64;
        let unpaid = (conventional - fee).div_ceil(marginal);
        check(
            "zip317-fee",
            title,
            CheckStatus::Warn,
            format!(
                "Fee paid is {}, below the conventional {} for {logical} logical actions ({unpaid} unpaid actions). Still consensus-valid, but nodes may not relay it and miners deprioritise it.",
                fmt_zat(fee.into()),
                fmt_zat(conventional.into())
            ),
            zip(317, "Transaction relaying"),
            &source,
        )
    }
}

pub fn run_checks(
    bytes: &[u8],
    net: Net,
    height: u32,
    input_values: &[Option<u64>],
) -> Result<Vec<Check>, CoreError> {
    let tx = parse_tx(bytes)?;
    let height = BlockHeight::from_u32(height);
    Ok(vec![
        branch_id_check(&tx, net, height),
        version_check(&tx, net, height),
        expiry_check(&tx, net, height),
        reserved_flags_check(&tx),
        turnstile_check(&tx, net, height),
        cross_address_check(&tx, net, height),
        orchard_mitigation_check(&tx, net, height),
        proof_length_check(&tx, net, height),
        coinbase_shielded_check(&tx, net, height),
        fee_check(&tx, net, height, input_values),
    ])
}
