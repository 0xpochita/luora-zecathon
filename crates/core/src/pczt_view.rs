use std::convert::Infallible;

use base64::Engine as _;
use pczt::Pczt;
use pczt::roles::verifier::Verifier;
use zcash_address::unified::{self, Encoding as _, Receiver};
use zcash_address::{ConversionError, ToAddress, TryFromAddress, ZcashAddress};
use zcash_primitives::transaction::fees::zip317::{
    GRACE_ACTIONS, MARGINAL_FEE, P2PKH_STANDARD_INPUT_SIZE, P2PKH_STANDARD_OUTPUT_SIZE,
};
use zcash_protocol::consensus::{BranchId, NetworkType, Parameters};
use zcash_protocol::value::Zatoshis;
use zcash_transparent::address::{Script, TransparentAddress};
use zcash_transparent::bundle::TxOut;

use crate::checks::fmt_zat;
use crate::model::{Check, CheckStatus, CoreError, PcztAction, PcztRole, PcztView, ZipRef};
use crate::network::{Net, branch_display_name, branch_hex};

const PCZT_MAGIC: &[u8; 4] = b"PCZT";
const SLIP44_MAINNET: u32 = 133;
const SLIP44_TESTNET: u32 = 1;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Pool {
    Transparent,
    Sapling,
    Orchard,
    Ironwood,
}

impl Pool {
    fn name(self) -> &'static str {
        match self {
            Pool::Transparent => "transparent",
            Pool::Sapling => "sapling",
            Pool::Orchard => "orchard",
            Pool::Ironwood => "ironwood",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Pool::Transparent => "Transparent",
            Pool::Sapling => "Sapling",
            Pool::Orchard => "Orchard",
            Pool::Ironwood => "Ironwood",
        }
    }
}

#[derive(Clone, Debug)]
enum RecipientBytes {
    Transparent(TransparentAddress),
    Sapling([u8; 43]),
    OrchardProtocol([u8; 43]),
}

impl RecipientBytes {
    fn receiver(&self) -> Receiver {
        match self {
            RecipientBytes::Transparent(TransparentAddress::PublicKeyHash(h)) => Receiver::P2pkh(*h),
            RecipientBytes::Transparent(TransparentAddress::ScriptHash(h)) => Receiver::P2sh(*h),
            RecipientBytes::Sapling(b) => Receiver::Sapling(*b),
            RecipientBytes::OrchardProtocol(b) => Receiver::Orchard(*b),
        }
    }

    fn encode(&self, network: NetworkType) -> String {
        match self {
            RecipientBytes::Transparent(TransparentAddress::PublicKeyHash(h)) => {
                ZcashAddress::from_transparent_p2pkh(network, *h).encode()
            }
            RecipientBytes::Transparent(TransparentAddress::ScriptHash(h)) => {
                ZcashAddress::from_transparent_p2sh(network, *h).encode()
            }
            RecipientBytes::Sapling(b) => ZcashAddress::from_sapling(network, *b).encode(),
            RecipientBytes::OrchardProtocol(b) => {
                match unified::Address::try_from_items(unified::Revision::R0, vec![unified::Uitem::Data(Receiver::Orchard(*b))]) {
                    Ok(ua) => ZcashAddress::from_unified(network, ua).encode(),
                    Err(_) => hex::encode(b),
                }
            }
        }
    }
}

#[derive(Clone, Debug)]
struct Entry {
    pool: Pool,
    index: usize,
    is_input: bool,
    value: Option<u64>,
    recipient: Option<RecipientBytes>,
    user_address: Option<String>,
    proof: bool,
    signature: bool,
    dummy_key: bool,
    has_derivation: bool,
    has_witness: bool,
    script_len: Option<usize>,
    p2pkh: bool,
}

impl Entry {
    fn new(pool: Pool, index: usize, is_input: bool) -> Self {
        Entry {
            pool,
            index,
            is_input,
            value: None,
            recipient: None,
            user_address: None,
            proof: false,
            signature: false,
            dummy_key: false,
            has_derivation: false,
            has_witness: false,
            script_len: None,
            p2pkh: false,
        }
    }
}

#[derive(Clone, Debug, Default)]
struct ShieldedBundleState {
    present: bool,
    actions: usize,
    proof_present: bool,
    proof_bytes: Option<usize>,
    bsk_present: bool,
    anchor_set: bool,
}

struct Collected {
    entries: Vec<Entry>,
    sapling: ShieldedBundleState,
    orchard: ShieldedBundleState,
    ironwood: ShieldedBundleState,
}

struct AddressNetwork(NetworkType);

impl TryFromAddress for AddressNetwork {
    type Error = Infallible;

    fn try_from_sapling(net: NetworkType, _: [u8; 43]) -> Result<Self, ConversionError<Infallible>> {
        Ok(Self(net))
    }
    fn try_from_unified(net: NetworkType, _: unified::Address) -> Result<Self, ConversionError<Infallible>> {
        Ok(Self(net))
    }
    fn try_from_transparent_p2pkh(net: NetworkType, _: [u8; 20]) -> Result<Self, ConversionError<Infallible>> {
        Ok(Self(net))
    }
    fn try_from_transparent_p2sh(net: NetworkType, _: [u8; 20]) -> Result<Self, ConversionError<Infallible>> {
        Ok(Self(net))
    }
    fn try_from_tex(net: NetworkType, _: [u8; 20]) -> Result<Self, ConversionError<Infallible>> {
        Ok(Self(net))
    }
}

pub fn decode_input(input: &str) -> Result<Vec<u8>, CoreError> {
    let compact: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.is_empty() {
        return Err(CoreError::new("empty-input", "no PCZT was given"));
    }
    if compact.len() % 2 == 0 && compact.chars().all(|c| c.is_ascii_hexdigit()) {
        if let Ok(bytes) = hex::decode(&compact) {
            if bytes.starts_with(PCZT_MAGIC) {
                return Ok(bytes);
            }
        }
    }
    let engines = [
        base64::engine::general_purpose::STANDARD,
        base64::engine::general_purpose::URL_SAFE,
        base64::engine::general_purpose::STANDARD_NO_PAD,
        base64::engine::general_purpose::URL_SAFE_NO_PAD,
    ];
    for engine in engines {
        if let Ok(bytes) = engine.decode(&compact) {
            return Ok(bytes);
        }
    }
    Err(CoreError::new(
        "bad-encoding",
        "input is neither hex starting with \"PCZT\" nor base64",
    ))
}

fn script_address(script: Script) -> Option<TransparentAddress> {
    TxOut::new(Zatoshis::ZERO, script).recipient_address()
}

fn verify_error<E: std::fmt::Debug>(pool: &str, e: E) -> CoreError {
    CoreError::new("pczt-invalid", format!("the pczt crate could not parse the {pool} bundle: {e:?}"))
}

fn collect(pczt: Pczt) -> Result<Collected, CoreError> {
    let mut entries: Vec<Entry> = vec![];
    let mut sapling = ShieldedBundleState::default();
    let mut orchard = ShieldedBundleState::default();
    let mut ironwood = ShieldedBundleState::default();

    let verifier = Verifier::new(pczt)
        .with_transparent(|bundle| {
            for (index, input) in bundle.inputs().iter().enumerate() {
                let mut e = Entry::new(Pool::Transparent, index, true);
                e.value = Some(u64::from(*input.value()));
                let address = script_address(Script::from(input.script_pubkey()));
                e.p2pkh = matches!(address, Some(TransparentAddress::PublicKeyHash(_)));
                e.recipient = address.map(RecipientBytes::Transparent);
                e.signature = input.script_sig().is_some() || !input.partial_signatures().is_empty();
                e.script_len = input.script_sig().as_ref().map(|s| Script::from(s).0.0.len());
                e.has_derivation = !input.bip32_derivation().is_empty();
                entries.push(e);
            }
            for (index, output) in bundle.outputs().iter().enumerate() {
                let mut e = Entry::new(Pool::Transparent, index, false);
                e.value = Some(u64::from(*output.value()));
                let script = Script::from(output.script_pubkey());
                e.script_len = Some(script.0.0.len());
                e.recipient = script_address(script).map(RecipientBytes::Transparent);
                e.user_address = output.user_address().clone();
                entries.push(e);
            }
            Ok::<(), pczt::roles::verifier::TransparentError<Infallible>>(())
        })
        .map_err(|e| verify_error("transparent", e))?
        .with_sapling(|bundle| {
            sapling.present = !bundle.spends().is_empty() || !bundle.outputs().is_empty();
            sapling.actions = bundle.spends().len().max(bundle.outputs().len());
            sapling.bsk_present = bundle.bsk().is_some();
            sapling.anchor_set = true;
            sapling.proof_present = bundle.spends().iter().all(|s| s.zkproof().is_some())
                && bundle.outputs().iter().all(|o| o.zkproof().is_some());
            for (index, spend) in bundle.spends().iter().enumerate() {
                let mut e = Entry::new(Pool::Sapling, index, true);
                e.value = spend.value().map(|v| v.inner());
                e.recipient = spend.recipient().map(|r| RecipientBytes::Sapling(r.to_bytes()));
                e.proof = spend.zkproof().is_some();
                e.signature = spend.spend_auth_sig().is_some();
                e.dummy_key = spend.dummy_ask().is_some();
                e.has_derivation = spend.zip32_derivation().is_some();
                e.has_witness = spend.witness().is_some();
                entries.push(e);
            }
            for (index, output) in bundle.outputs().iter().enumerate() {
                let mut e = Entry::new(Pool::Sapling, index, false);
                e.value = output.value().map(|v| v.inner());
                e.recipient = output.recipient().map(|r| RecipientBytes::Sapling(r.to_bytes()));
                e.user_address = output.user_address().clone();
                e.proof = output.zkproof().is_some();
                e.has_derivation = output.zip32_derivation().is_some();
                entries.push(e);
            }
            Ok::<(), pczt::roles::verifier::SaplingError<Infallible>>(())
        })
        .map_err(|e| verify_error("Sapling", e))?;

    let mut collect_orchard_like =
        |pool: Pool, state: &mut ShieldedBundleState, bundle: &orchard::pczt::Bundle| {
            state.present = !bundle.actions().is_empty();
            state.actions = bundle.actions().len();
            state.proof_present = bundle.zkproof().is_some();
            state.proof_bytes = bundle.zkproof().as_ref().map(|p| p.as_ref().len());
            state.bsk_present = bundle.bsk().is_some();
            state.anchor_set = !*bundle.anchor_deferred();
            for (index, action) in bundle.actions().iter().enumerate() {
                let spend = action.spend();
                let output = action.output();
                let mut e = Entry::new(pool, index, false);
                e.value = output.value().map(|v| v.inner());
                e.recipient = output
                    .recipient()
                    .map(|r| RecipientBytes::OrchardProtocol(r.to_raw_address_bytes()));
                e.user_address = output.user_address().clone();
                e.proof = bundle.zkproof().is_some();
                e.signature = spend.spend_auth_sig().is_some();
                e.dummy_key = spend.dummy_sk().is_some();
                e.has_derivation = spend.zip32_derivation().is_some();
                e.has_witness = spend.witness().is_some();
                entries.push(e);
            }
        };

    let verifier = verifier
        .with_orchard(|bundle| {
            collect_orchard_like(Pool::Orchard, &mut orchard, bundle);
            Ok::<(), pczt::roles::verifier::OrchardError<Infallible>>(())
        })
        .map_err(|e| verify_error("Orchard", e))?;
    verifier
        .with_ironwood(|bundle| {
            collect_orchard_like(Pool::Ironwood, &mut ironwood, bundle);
            Ok::<(), pczt::roles::verifier::OrchardError<Infallible>>(())
        })
        .map_err(|e| verify_error("Ironwood", e))?;

    Ok(Collected { entries, sapling, orchard, ironwood })
}

fn zip374(clause: &str) -> Option<ZipRef> {
    Some(ZipRef {
        number: 374,
        clause: Some(clause.to_string()),
        url: "https://zips.z.cash/zip-0374".to_string(),
    })
}

fn make_check(id: &str, title: &str, status: CheckStatus, detail: String, zip: Option<ZipRef>, source: &str) -> Check {
    Check {
        id: id.to_string(),
        title: title.to_string(),
        status,
        detail,
        zip,
        source: Some(source.to_string()),
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

fn describe(e: &Entry) -> String {
    format!(
        "{} {} {}",
        e.pool.label(),
        if e.pool == Pool::Orchard || e.pool == Pool::Ironwood {
            "action"
        } else if e.is_input {
            if e.pool == Pool::Sapling { "spend" } else { "input" }
        } else {
            "output"
        },
        e.index
    )
}

fn user_address_check(entries: &[Entry], network: NetworkType) -> Check {
    let source = "librustzcash#3155 (Signer never cross-checks user_address); ZIP 374 Signer";
    let title = "Shown address matches the committed recipient";
    let with_user_address: Vec<&Entry> = entries.iter().filter(|e| e.user_address.is_some()).collect();
    if with_user_address.is_empty() {
        return make_check(
            "user-address-matches-recipient",
            title,
            CheckStatus::Na,
            "No output carries a user_address, so there is nothing a Signer would display to cross-check.".to_string(),
            zip374("Signer: MUST confirm user_address contains the output's recipient"),
            source,
        );
    }
    let mut problems = vec![];
    let mut good = 0;
    for e in &with_user_address {
        let shown = e.user_address.as_deref().unwrap_or_default();
        let parsed = match ZcashAddress::try_from_encoded(shown) {
            Ok(a) => a,
            Err(err) => {
                problems.push(format!("{} shows \"{shown}\", which is not a valid Zcash address ({err})", describe(e)));
                continue;
            }
        };
        let Some(recipient) = &e.recipient else {
            problems.push(format!(
                "{} shows {shown} but its recipient field is redacted, so nothing proves where the value goes",
                describe(e)
            ));
            continue;
        };
        if let Ok(AddressNetwork(shown_net)) = parsed.clone().convert::<AddressNetwork>() {
            if shown_net != network {
                problems.push(format!(
                    "{} shows {shown}, an address for {shown_net:?}, but the PCZT is for {network:?}",
                    describe(e)
                ));
                continue;
            }
        }
        if parsed.matches_receiver(&recipient.receiver()) {
            good += 1;
        } else {
            problems.push(format!(
                "{} shows {shown} but the committed recipient is {}",
                describe(e),
                recipient.encode(network)
            ));
        }
    }
    if problems.is_empty() {
        make_check(
            "user-address-matches-recipient",
            title,
            CheckStatus::Pass,
            format!(
                "All {} with a user_address pay a recipient contained in the address shown.",
                plural(good, "output", "outputs")
            ),
            zip374("Signer: MUST confirm user_address contains the output's recipient"),
            source,
        )
    } else {
        make_check(
            "user-address-matches-recipient",
            title,
            CheckStatus::Fail,
            format!(
                "{}. A Signer that displays user_address would show the user a different destination than the one being signed. Do not sign.",
                problems.join("; ")
            ),
            zip374("Signer: MUST confirm user_address contains the output's recipient"),
            source,
        )
    }
}

fn dummy_keys_check(entries: &[Entry], io_finalized: bool) -> Check {
    let source = "librustzcash pczt/src/roles/io_finalizer (clears dummy_ask / dummy_sk after signing dummy spends)";
    let title = "Dummy spending keys cleared";
    let with_keys: Vec<String> = entries.iter().filter(|e| e.dummy_key).map(describe).collect();
    let clause = "Signer: MUST reject a PCZT that contains dummy_ask or dummy_sk";
    if with_keys.is_empty() {
        make_check(
            "dummy-keys-cleared",
            title,
            CheckStatus::Pass,
            "No dummy_ask or dummy_sk is present, so a Signer is not handed spending key material.".to_string(),
            zip374(clause),
            source,
        )
    } else if !io_finalized {
        make_check(
            "dummy-keys-cleared",
            title,
            CheckStatus::Warn,
            format!(
                "{} still carry dummy spending keys. That is expected before the IO Finalizer runs; it signs the dummy spends and clears them. Do not send this PCZT to a Signer yet.",
                with_keys.join(", ")
            ),
            zip374(clause),
            source,
        )
    } else {
        make_check(
            "dummy-keys-cleared",
            title,
            CheckStatus::Fail,
            format!(
                "{} carry dummy spending keys although the IO Finalizer has run. A Signer MUST reject this PCZT.",
                with_keys.join(", ")
            ),
            zip374(clause),
            source,
        )
    }
}

fn signatures_check(entries: &[Entry]) -> Check {
    let source = "librustzcash#2768 (Keystone returned unsigned PCZTs; the Combiner merged them silently)";
    let title = "All signatures present before extraction";
    let needing: Vec<&Entry> = entries
        .iter()
        .filter(|e| e.is_input || e.pool == Pool::Orchard || e.pool == Pool::Ironwood)
        .collect();
    if needing.is_empty() {
        return make_check(
            "all-signatures-present",
            title,
            CheckStatus::Na,
            "Nothing in this PCZT needs a signature yet.".to_string(),
            zip374("Transaction Extractor"),
            source,
        );
    }
    let missing: Vec<String> = needing.iter().filter(|e| !e.signature).map(|e| describe(e)).collect();
    if missing.is_empty() {
        make_check(
            "all-signatures-present",
            title,
            CheckStatus::Pass,
            format!("All {} that need authorization are signed.", plural(needing.len(), "input or action", "inputs and actions")),
            zip374("Transaction Extractor"),
            source,
        )
    } else {
        make_check(
            "all-signatures-present",
            title,
            CheckStatus::Warn,
            format!(
                "{} of {} still lack a signature: {}. The Transaction Extractor will fail (for example Orchard(Extract(MissingSpendAuthSig))). If a hardware signer returned this PCZT, it came back unsigned.",
                missing.len(),
                needing.len(),
                missing.join(", ")
            ),
            zip374("Transaction Extractor"),
            source,
        )
    }
}

fn signed_value_sum(sum: (u64, bool)) -> i128 {
    if sum.1 { -(sum.0 as i128) } else { sum.0 as i128 }
}

fn fee_and_expiry_check(pczt: &Pczt, entries: &[Entry], net: Net, collected: &Collected) -> Check {
    let source = "zcash-devtool#146 and #243 (pczt inspect shows neither fee nor expiry)";
    let title = "Fee and expiry";
    let global = pczt.global();
    let t_in: i128 = entries
        .iter()
        .filter(|e| e.pool == Pool::Transparent && e.is_input)
        .map(|e| e.value.unwrap_or(0) as i128)
        .sum();
    let t_out: i128 = entries
        .iter()
        .filter(|e| e.pool == Pool::Transparent && !e.is_input)
        .map(|e| e.value.unwrap_or(0) as i128)
        .sum();
    let fee = t_in - t_out
        + *pczt.sapling().value_sum()
        + signed_value_sum(*pczt.orchard().value_sum())
        + signed_value_sum(*pczt.ironwood().value_sum());

    let input_sizes: Option<Vec<usize>> = entries
        .iter()
        .filter(|e| e.pool == Pool::Transparent && e.is_input)
        .map(|e| match e.script_len {
            Some(len) => Some(36 + 1 + len + 4),
            None if e.p2pkh => Some(P2PKH_STANDARD_INPUT_SIZE),
            None => None,
        })
        .collect();
    let output_size: usize = entries
        .iter()
        .filter(|e| e.pool == Pool::Transparent && !e.is_input)
        .map(|e| 8 + 1 + e.script_len.unwrap_or(25))
        .sum();
    let sapling_spends = entries.iter().filter(|e| e.pool == Pool::Sapling && e.is_input).count();
    let sapling_outputs = entries.iter().filter(|e| e.pool == Pool::Sapling && !e.is_input).count();
    let conventional = input_sizes.map(|sizes| {
        let t_in_size: usize = sizes.iter().sum();
        let logical = t_in_size.div_ceil(P2PKH_STANDARD_INPUT_SIZE).max(output_size.div_ceil(P2PKH_STANDARD_OUTPUT_SIZE))
            + sapling_spends.max(sapling_outputs)
            + collected.orchard.actions
            + collected.ironwood.actions;
        (logical, u64::from(MARGINAL_FEE) * logical.max(GRACE_ACTIONS) as u64)
    });

    let branch = BranchId::try_from(*global.consensus_branch_id()).ok();
    let expiry = *global.expiry_height();
    let branch_text = match branch {
        Some(b) => format!("branch {} ({})", branch_hex(b), branch_display_name(b)),
        None => format!("unknown branch 0x{:08x}", global.consensus_branch_id()),
    };
    let expiry_text = if expiry == 0 {
        "nExpiryHeight is 0 (never expires)".to_string()
    } else {
        let epoch = branch.and_then(|b| b.height_bounds(&net));
        match epoch {
            Some((_, Some(end))) if expiry >= u32::from(end) => format!(
                "expires at height {expiry}, after {branch_text} ends at height {}, so it cannot be mined that late",
                u32::from(end)
            ),
            _ => format!("expires at height {expiry} under {branch_text}"),
        }
    };

    let mut status = CheckStatus::Pass;
    let fee_text = if fee < 0 {
        status = CheckStatus::Fail;
        format!("outputs exceed inputs by {}; the transaction cannot balance", fmt_zat(-fee))
    } else {
        match conventional {
            Some((logical, conventional)) if (fee as u64) < conventional => {
                status = CheckStatus::Warn;
                format!(
                    "fee is {}, below the ZIP 317 conventional {} for {logical} logical actions",
                    fmt_zat(fee),
                    fmt_zat(conventional as i128)
                )
            }
            Some((logical, conventional)) => format!(
                "fee is {} (ZIP 317 conventional fee for {logical} logical actions is {})",
                fmt_zat(fee),
                fmt_zat(conventional as i128)
            ),
            None => format!("fee is {}; the conventional fee needs the size of non-P2PKH inputs", fmt_zat(fee)),
        }
    };
    if let Some(b) = branch {
        if let Some((_, Some(end))) = b.height_bounds(&net) {
            if expiry != 0 && expiry >= u32::from(end) && status == CheckStatus::Pass {
                status = CheckStatus::Warn;
            }
        }
    }
    make_check(
        "fee-and-expiry",
        title,
        status,
        format!("{}; {}.", capitalize(&fee_text), expiry_text),
        Some(ZipRef {
            number: 317,
            clause: Some("Fee calculation".to_string()),
            url: "https://zips.z.cash/zip-0317".to_string(),
        }),
        source,
    )
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn network_check(pczt: &Pczt, net: Net) -> Option<Check> {
    let coin_type = *pczt.global().coin_type();
    let expected = match net.network_type() {
        NetworkType::Main => SLIP44_MAINNET,
        NetworkType::Test | NetworkType::Regtest => SLIP44_TESTNET,
    };
    (coin_type != expected).then(|| {
        make_check(
            "coin-type",
            "PCZT network matches the selected network",
            CheckStatus::Warn,
            format!(
                "Global.coin_type is {coin_type} but the selected network uses SLIP 44 coin type {expected}. Addresses below are rendered for the selected network."
            ),
            zip374("Global.coin_type"),
            "librustzcash pczt/src/common.rs Global::coin_type",
        )
    })
}

fn roles(pczt: &Pczt, collected: &Collected) -> Vec<PcztRole> {
    let global = pczt.global();
    let entries = &collected.entries;
    let shielded: Vec<(&str, &ShieldedBundleState)> = [
        ("Sapling", &collected.sapling),
        ("Orchard", &collected.orchard),
        ("Ironwood", &collected.ironwood),
    ]
    .into_iter()
    .filter(|(_, s)| s.present)
    .collect();
    let has_any = !entries.is_empty();
    let has_shielded = !shielded.is_empty();
    let t_inputs: Vec<&Entry> = entries.iter().filter(|e| e.pool == Pool::Transparent && e.is_input).collect();

    let creator = PcztRole {
        name: "Creator",
        done: true,
        evidence: format!(
            "Global fields are set: v{} transaction, branch 0x{:08x}, expiry height {}, coin type {}.",
            global.tx_version(),
            global.consensus_branch_id(),
            global.expiry_height(),
            global.coin_type()
        ),
    };

    let t_out = entries.iter().filter(|e| e.pool == Pool::Transparent && !e.is_input).count();
    let constructor = PcztRole {
        name: "Constructor",
        done: has_any,
        evidence: if has_any {
            format!(
                "{} transparent inputs, {t_out} transparent outputs, {} Sapling spends, {} Sapling outputs, {} Orchard actions, {} Ironwood actions.",
                t_inputs.len(),
                entries.iter().filter(|e| e.pool == Pool::Sapling && e.is_input).count(),
                entries.iter().filter(|e| e.pool == Pool::Sapling && !e.is_input).count(),
                collected.orchard.actions,
                collected.ironwood.actions
            )
        } else {
            "No inputs, outputs or actions have been added.".to_string()
        },
    };

    let modifiable_cleared = !global.inputs_modifiable() && !global.outputs_modifiable() && !global.shielded_modifiable();
    let bsk_all = shielded.iter().all(|(_, s)| s.bsk_present);
    let io_done = has_any && modifiable_cleared && bsk_all;
    let io_finalizer = PcztRole {
        name: "IO Finalizer",
        done: io_done,
        evidence: format!(
            "tx_modifiable is 0x{:02x} ({}); {}.",
            global.tx_modifiable(),
            if modifiable_cleared { "inputs, outputs and shielded set are locked" } else { "still modifiable" },
            if has_shielded {
                shielded
                    .iter()
                    .map(|(name, s)| format!("{name} bsk {}", if s.bsk_present { "set" } else { "missing" }))
                    .collect::<Vec<_>>()
                    .join(", ")
            } else {
                "no shielded bundle needs a bsk".to_string()
            }
        ),
    };

    let derivations = entries.iter().filter(|e| e.has_derivation).count();
    let witnesses = entries.iter().filter(|e| e.has_witness).count();
    let updater = PcztRole {
        name: "Updater",
        done: derivations > 0 || witnesses > 0,
        evidence: format!(
            "{} with key derivation paths, {} with Merkle witnesses.",
            plural(derivations, "entry", "entries"),
            plural(witnesses, "spend", "spends")
        ),
    };

    let prover_done = has_shielded && shielded.iter().all(|(_, s)| s.proof_present);
    let prover = PcztRole {
        name: "Prover",
        done: prover_done,
        evidence: if has_shielded {
            shielded
                .iter()
                .map(|(name, s)| match (s.proof_present, s.proof_bytes) {
                    (true, Some(bytes)) => format!("{name} proof present ({bytes} bytes)"),
                    (true, None) => format!("{name} proofs present"),
                    (false, _) => format!("{name} proof missing"),
                })
                .collect::<Vec<_>>()
                .join(", ")
                + "."
        } else {
            "No shielded bundle, so no proof is needed.".to_string()
        },
    };

    let needing: Vec<&Entry> = entries
        .iter()
        .filter(|e| e.is_input || e.pool == Pool::Orchard || e.pool == Pool::Ironwood)
        .collect();
    let signed = needing.iter().filter(|e| e.signature).count();
    let signer = PcztRole {
        name: "Signer",
        done: !needing.is_empty() && signed == needing.len(),
        evidence: format!("{signed} of {} inputs and actions carry a signature.", needing.len()),
    };

    let combiner = PcztRole {
        name: "Combiner",
        done: false,
        evidence: "Combining leaves no marker in a single PCZT; compare the PCZTs that were merged instead.".to_string(),
    };

    let finalized = t_inputs.iter().filter(|e| e.script_len.is_some()).count();
    let spend_finalizer = PcztRole {
        name: "Spend Finalizer",
        done: !t_inputs.is_empty() && finalized == t_inputs.len(),
        evidence: if t_inputs.is_empty() {
            "No transparent inputs, so there is no script_sig to build.".to_string()
        } else {
            format!("{finalized} of {} transparent inputs have a script_sig.", t_inputs.len())
        },
    };

    let mut missing = vec![];
    if !t_inputs.is_empty() && finalized < t_inputs.len() {
        missing.push(format!("{} script_sig", t_inputs.len() - finalized));
    }
    if has_shielded && !prover_done {
        missing.push("proofs".to_string());
    }
    if signed < needing.len() {
        missing.push(format!("{} signatures", needing.len() - signed));
    }
    if !bsk_all {
        missing.push("binding signing keys (bsk)".to_string());
    }
    if shielded.iter().any(|(_, s)| !s.anchor_set) {
        missing.push("anchors".to_string());
    }
    let extractor = PcztRole {
        name: "Extractor",
        done: false,
        evidence: if !has_any {
            "Nothing to extract yet.".to_string()
        } else if missing.is_empty() {
            "Every field the Transaction Extractor checks is present; the PCZT is ready to extract.".to_string()
        } else {
            format!("Not extractable yet: missing {}.", missing.join(", "))
        },
    };

    vec![creator, constructor, io_finalizer, updater, prover, signer, combiner, spend_finalizer, extractor]
}

pub fn inspect(input: &str, net: Net) -> Result<PcztView, CoreError> {
    let bytes = decode_input(input)?;
    if !bytes.starts_with(PCZT_MAGIC) {
        return Err(CoreError::new("not-pczt", "data does not start with the PCZT magic bytes"));
    }
    let pczt = Pczt::parse(&bytes)
        .map_err(|e| CoreError::new("pczt-parse-failed", format!("the pczt crate could not parse this PCZT: {e:?}")))?;
    let collected = collect(pczt.clone())?;
    let network = net.network_type();

    let roles = roles(&pczt, &collected);
    let io_finalized = roles.iter().any(|r| r.name == "IO Finalizer" && r.done);

    let actions = collected
        .entries
        .iter()
        .map(|e| PcztAction {
            pool: e.pool.name(),
            kind: match (e.pool, e.is_input) {
                (Pool::Orchard | Pool::Ironwood, _) => "action",
                (_, true) => "input",
                (_, false) => "output",
            },
            index: e.index,
            value_zat: e.value,
            recipient: e.recipient.as_ref().map(|r| r.encode(network)),
            user_address: e.user_address.clone(),
            proof: e.proof,
            signature: e.signature,
        })
        .collect();

    let mut checks = vec![
        user_address_check(&collected.entries, network),
        dummy_keys_check(&collected.entries, io_finalized),
        signatures_check(&collected.entries),
        fee_and_expiry_check(&pczt, &collected.entries, net, &collected),
    ];
    if let Some(c) = network_check(&pczt, net) {
        checks.push(c);
    }
    Ok(PcztView { roles, actions, checks })
}
