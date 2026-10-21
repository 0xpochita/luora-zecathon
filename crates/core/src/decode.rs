use std::collections::HashMap;

use orchard::bundle::Authorized as OrchardAuthorized;
use zcash_address::{ToAddress, ZcashAddress};
use zcash_primitives::transaction::fees::FeeRule as _;
use zcash_primitives::transaction::fees::transparent::InputSize;
use zcash_primitives::transaction::fees::zip317::{
    FeeRule, GRACE_ACTIONS, MARGINAL_FEE, P2PKH_STANDARD_INPUT_SIZE, P2PKH_STANDARD_OUTPUT_SIZE,
};
use zcash_primitives::transaction::{Transaction, TxVersion};
use zcash_protocol::consensus::{BlockHeight, BranchId, NetworkUpgrade, Parameters};
use zcash_protocol::value::{BalanceError, ZatBalance, Zatoshis};
use zcash_transparent::address::TransparentAddress;
use zcash_transparent::bundle::{OutPoint, TxOut};

use crate::model::*;
use crate::network::{Net, branch_display_name, branch_hex};

pub const ZIP2009_MARGINAL_FEE: u64 = 1_000;
pub const ZIP2009_MAINNET_HEIGHT: u32 = 3_590_000;

pub fn zip2009_active(net: Net, height: BlockHeight) -> bool {
    matches!(net, Net::Main) && u32::from(height) >= ZIP2009_MAINNET_HEIGHT
}

pub const HALO2_PROOF_BASE_BYTES: usize = 2720;
pub const HALO2_PROOF_PER_ACTION_BYTES: usize = 2272;
pub const MAX_TX_BYTES: usize = 2_000_000;

pub fn canonical_halo2_proof_bytes(actions: usize) -> usize {
    HALO2_PROOF_BASE_BYTES + HALO2_PROOF_PER_ACTION_BYTES * actions
}

pub fn hex_to_bytes(input: &str) -> Result<Vec<u8>, CoreError> {
    let compact: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    let trimmed = compact.strip_prefix("0x").unwrap_or(&compact);
    if trimmed.is_empty() {
        return Err(CoreError::new("empty-input", "no transaction hex was given"));
    }
    if trimmed.len() / 2 > MAX_TX_BYTES {
        return Err(CoreError::new(
            "too-large",
            format!(
                "input is {} bytes; a Zcash transaction is at most {MAX_TX_BYTES} bytes",
                trimmed.len() / 2
            ),
        ));
    }
    hex::decode(trimmed)
        .map_err(|e| CoreError::new("bad-hex", format!("input is not valid hex: {e}")))
}

pub fn display_hex(bytes: &[u8; 32]) -> String {
    let mut reversed = *bytes;
    reversed.reverse();
    hex::encode(reversed)
}

pub fn version_number(version: TxVersion) -> u32 {
    version.header() & 0x7FFF_FFFF
}

fn branch_for_pre_v5_parse(header: u32) -> BranchId {
    match header & 0x7FFF_FFFF {
        3 => BranchId::Overwinter,
        4 => BranchId::Canopy,
        _ => BranchId::Sprout,
    }
}

pub fn parse_tx(bytes: &[u8]) -> Result<Transaction, CoreError> {
    if bytes.len() < 4 {
        return Err(CoreError::new(
            "too-short",
            format!("{} bytes is too short for a transaction header", bytes.len()),
        ));
    }
    let header = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    let mut reader = bytes;
    let tx = Transaction::read(&mut reader, branch_for_pre_v5_parse(header)).map_err(|e| {
        CoreError::new(
            "parse-failed",
            format!("zcash_primitives could not parse this transaction: {e}"),
        )
    })?;
    if !reader.is_empty() {
        return Err(CoreError::new(
            "trailing-bytes",
            format!("transaction parsed but {} unparsed bytes follow it", reader.len()),
        ));
    }
    Ok(tx)
}

pub fn has_explicit_branch_id(tx: &Transaction) -> bool {
    !matches!(tx.version(), TxVersion::Sprout(_) | TxVersion::V3 | TxVersion::V4)
}

pub fn is_null_outpoint(outpoint: &OutPoint) -> bool {
    outpoint.hash() == &[0u8; 32] && outpoint.n() == u32::MAX
}

pub fn is_coinbase(tx: &Transaction) -> bool {
    tx.transparent_bundle().is_some_and(|b| b.is_coinbase())
}

fn compact_size_len(n: usize) -> usize {
    match n {
        0..=0xfc => 1,
        0xfd..=0xffff => 3,
        0x1_0000..=0xffff_ffff => 5,
        _ => 9,
    }
}

fn serialized_input_size(script_len: usize) -> usize {
    36 + compact_size_len(script_len) + script_len + 4
}

fn script_pub_key_bytes(output: &TxOut) -> &[u8] {
    &output.script_pubkey().0.0
}

fn serialized_output_size(output: &TxOut) -> usize {
    let script_len = script_pub_key_bytes(output).len();
    8 + compact_size_len(script_len) + script_len
}

pub fn transparent_address(output: &TxOut, net: Net) -> Option<String> {
    let network = net.network_type();
    output.recipient_address().map(|addr| match addr {
        TransparentAddress::PublicKeyHash(hash) => {
            ZcashAddress::from_transparent_p2pkh(network, hash).encode()
        }
        TransparentAddress::ScriptHash(hash) => {
            ZcashAddress::from_transparent_p2sh(network, hash).encode()
        }
    })
}

fn orchard_like(
    bundle: &orchard::Bundle<OrchardAuthorized, ZatBalance>,
    tx_version: TxVersion,
    is_ironwood: bool,
) -> OrchardLikeBundle {
    let flags = bundle.flags();
    let is_v6 = matches!(tx_version, TxVersion::V6);
    let reserved_mask: u8 = if is_v6 && is_ironwood { 0b1111_1000 } else { 0b1111_1100 };
    let actions = bundle.actions().len();
    OrchardLikeBundle {
        actions,
        flags: OrchardLikeFlags {
            spends_enabled: flags.spends_enabled(),
            outputs_enabled: flags.outputs_enabled(),
            cross_address_enabled: is_v6.then(|| flags.cross_address_enabled()),
            reserved_bits_zero: bundle.flag_byte() & reserved_mask == 0,
        },
        value_balance_zat: i64::from(*bundle.value_balance()),
        anchor: display_hex(&bundle.anchor().to_bytes()),
        proof_bytes: bundle.authorization().proof().as_ref().len(),
        canonical_proof_bytes: canonical_halo2_proof_bytes(actions),
        nullifiers: bundle
            .actions()
            .iter()
            .map(|a| hex::encode(a.nullifier().to_bytes()))
            .collect(),
        commitments: bundle
            .actions()
            .iter()
            .map(|a| hex::encode(a.cmx().to_bytes()))
            .collect(),
    }
}

pub struct FeeInputs {
    pub transparent_input_sizes: Vec<usize>,
    pub transparent_output_sizes: Vec<usize>,
    pub sapling_spends: usize,
    pub sapling_outputs: usize,
    pub orchard_actions: usize,
    pub ironwood_actions: usize,
    pub joinsplits: usize,
}

impl FeeInputs {
    pub fn of(tx: &Transaction) -> Self {
        let (transparent_input_sizes, transparent_output_sizes) = match tx.transparent_bundle() {
            Some(b) => (
                b.vin
                    .iter()
                    .map(|i| serialized_input_size(i.script_sig().0.0.len()))
                    .collect(),
                b.vout.iter().map(serialized_output_size).collect(),
            ),
            None => (vec![], vec![]),
        };
        let (sapling_spends, sapling_outputs) = tx.sapling_bundle().map_or((0, 0), |b| {
            (b.shielded_spends().len(), b.shielded_outputs().len())
        });
        FeeInputs {
            transparent_input_sizes,
            transparent_output_sizes,
            sapling_spends,
            sapling_outputs,
            orchard_actions: tx.orchard_bundle().map_or(0, |b| b.actions().len()),
            ironwood_actions: tx.ironwood_bundle().map_or(0, |b| b.actions().len()),
            joinsplits: tx.sprout_bundle().map_or(0, |b| b.joinsplits.len()),
        }
    }

    pub fn logical_actions(&self) -> usize {
        let t_in: usize = self.transparent_input_sizes.iter().sum();
        let t_out: usize = self.transparent_output_sizes.iter().sum();
        t_in.div_ceil(P2PKH_STANDARD_INPUT_SIZE)
            .max(t_out.div_ceil(P2PKH_STANDARD_OUTPUT_SIZE))
            + 2 * self.joinsplits
            + self.sapling_spends.max(self.sapling_outputs)
            + self.orchard_actions
            + self.ironwood_actions
    }

    pub fn conventional_fee(&self, net: Net, height: BlockHeight) -> u64 {
        if zip2009_active(net, height) {
            return self.zip2009_fee();
        }
        self.zip317_fee(net, height)
    }

    pub fn zip2009_fee(&self) -> u64 {
        ZIP2009_MARGINAL_FEE * self.logical_actions().max(GRACE_ACTIONS) as u64
    }

    pub fn zip317_fee(&self, net: Net, height: BlockHeight) -> u64 {
        if self.joinsplits > 0 {
            return u64::from(MARGINAL_FEE) * self.logical_actions().max(GRACE_ACTIONS) as u64;
        }
        FeeRule::standard()
            .fee_required(
                &net,
                height,
                self.transparent_input_sizes.iter().map(|s| InputSize::Known(*s)),
                self.transparent_output_sizes.iter().copied(),
                self.sapling_spends,
                self.sapling_outputs,
                self.orchard_actions,
                self.ironwood_actions,
            )
            .map(u64::from)
            .unwrap_or(u64::MAX)
    }
}

pub fn fee_rule_height(tx: &Transaction, net: Net) -> BlockHeight {
    tx.consensus_branch_id()
        .network_upgrade()
        .and_then(|nu| net.activation_height(nu))
        .or_else(|| net.activation_height(NetworkUpgrade::Overwinter))
        .unwrap_or(BlockHeight::from_u32(0))
}

pub fn decode(bytes: &[u8], net: Net) -> Result<DecodedTx, CoreError> {
    let tx = parse_tx(bytes)?;
    let version = tx.version();
    let explicit_branch = has_explicit_branch_id(&tx);
    let branch = tx.consensus_branch_id();

    let transparent = match tx.transparent_bundle() {
        Some(b) => Transparent {
            inputs: b
                .vin
                .iter()
                .map(|i| TransparentInput {
                    prev_txid: display_hex(i.prevout().hash()),
                    prev_index: i.prevout().n(),
                    script_sig_bytes: i.script_sig().0.0.len(),
                    sequence: i.sequence(),
                    is_coinbase: is_null_outpoint(i.prevout()),
                })
                .collect(),
            outputs: b
                .vout
                .iter()
                .map(|o| TransparentOutput {
                    value_zat: u64::from(o.value()),
                    script_pub_key: hex::encode(script_pub_key_bytes(o)),
                    address: transparent_address(o, net),
                })
                .collect(),
        },
        None => Transparent { inputs: vec![], outputs: vec![] },
    };

    let sapling = tx.sapling_bundle().map(|b| SaplingBundle {
        spends: b.shielded_spends().len(),
        outputs: b.shielded_outputs().len(),
        value_balance_zat: i64::from(*b.value_balance()),
        anchor: b.shielded_spends().first().map(|s| {
            let mut bytes = s.anchor().to_bytes();
            bytes.reverse();
            hex::encode(bytes)
        }),
        proof_bytes_each: b
            .shielded_spends()
            .first()
            .map(|s| s.zkproof().len())
            .or_else(|| b.shielded_outputs().first().map(|o| o.zkproof().len()))
            .unwrap_or(0),
        nullifiers: b
            .shielded_spends()
            .iter()
            .map(|s| display_hex(&s.nullifier().0))
            .collect(),
        commitments: b
            .shielded_outputs()
            .iter()
            .map(|o| display_hex(&o.cmu().to_bytes()))
            .collect(),
    });

    let fee_inputs = FeeInputs::of(&tx);

    Ok(DecodedTx {
        txid: tx.txid().to_string(),
        version: version_number(version),
        version_group_id: format!("0x{:08x}", version.version_group_id()),
        consensus_branch_id: explicit_branch.then(|| branch_hex(branch)),
        upgrade: explicit_branch.then(|| branch_display_name(branch)),
        lock_time: tx.lock_time(),
        expiry_height: u32::from(tx.expiry_height()),
        size_bytes: bytes.len(),
        transparent,
        sapling,
        orchard: tx.orchard_bundle().map(|b| orchard_like(b, version, false)),
        ironwood: tx.ironwood_bundle().map(|b| orchard_like(b, version, true)),
        zip317: Zip317 {
            logical_actions: fee_inputs.logical_actions(),
            conventional_fee_zat: fee_inputs.conventional_fee(net, fee_rule_height(&tx, net)),
        },
    })
}

pub fn transparent_input_count(tx: &Transaction) -> usize {
    tx.transparent_bundle().map_or(0, |b| b.vin.len())
}

pub fn fee_paid(tx: &Transaction, input_values: &[Option<u64>]) -> Result<Option<u64>, CoreError> {
    if is_coinbase(tx) {
        return Ok(None);
    }
    let inputs = transparent_input_count(tx);
    if input_values.len() != inputs {
        return Err(CoreError::new(
            "input-values-mismatch",
            format!(
                "transaction has {inputs} transparent inputs but {} input values were given",
                input_values.len()
            ),
        ));
    }
    let mut by_outpoint: HashMap<([u8; 32], u32), Option<u64>> = HashMap::new();
    if let Some(b) = tx.transparent_bundle() {
        for (input, value) in b.vin.iter().zip(input_values) {
            by_outpoint.insert((*input.prevout().hash(), input.prevout().n()), *value);
        }
    }
    tx.fee_paid(|outpoint: &OutPoint| -> Result<Option<Zatoshis>, BalanceError> {
        match by_outpoint.get(&(*outpoint.hash(), outpoint.n())).copied().flatten() {
            Some(v) => Zatoshis::from_u64(v).map(Some),
            None => Ok(None),
        }
    })
    .map(|fee| fee.map(u64::from))
    .map_err(|e| {
        CoreError::new(
            "fee-out-of-range",
            format!("inputs minus outputs does not give a valid fee: {e}"),
        )
    })
}

pub fn fee_zat(bytes: &[u8], input_values: &[Option<u64>]) -> Result<Option<u64>, CoreError> {
    fee_paid(&parse_tx(bytes)?, input_values)
}
