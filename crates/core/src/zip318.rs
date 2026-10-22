use zcash_primitives::transaction::{Transaction, TxVersion};
use zcash_protocol::consensus::BlockHeight;
use zcash_protocol::value::Zatoshis;
use zcash_protocol::zip318::{
    BlockSpacing, CROSSING_DESTINATION_ACTIONS, CROSSING_SOURCE_ACTIONS, PoolMigrationConstants, Zip318Classification,
    Zip318Evidence, Zip318TxKind, classify,
};

use crate::checks::{fmt_height, group_thousands, zip};
use crate::decode::{FeeInputs, fee_paid, is_coinbase, parse_tx};
use crate::model::{CoreError, Zip318Reason, Zip318View};
use crate::network::Net;

struct ObserverConstants(Net);

impl PoolMigrationConstants for ObserverConstants {
    fn block_spacing(&self) -> BlockSpacing {
        BlockSpacing::for_network(&self.0)
    }
}

pub fn fmt_zec(zat: u64) -> String {
    let whole = zat / 100_000_000;
    let frac = zat % 100_000_000;
    let whole = group_thousands(&whole.to_string());
    if frac == 0 {
        format!("{whole} ZEC")
    } else {
        format!("{whole}.{} ZEC", format!("{frac:08}").trim_end_matches('0'))
    }
}

fn reason(field: &'static str, ok: Option<bool>, detail: String, clause: &str) -> Zip318Reason {
    Zip318Reason { field, ok, detail, zip: zip(318, clause).expect("zip ref") }
}

const SHAPE: &str = "Canonical migration transaction structure";
const PREPARATION: &str = "Note preparation transactions";

fn plural(n: usize, word: &str) -> String {
    if n == 1 { format!("1 {word}") } else { format!("{n} {word}s") }
}

pub fn zip318_view(bytes: &[u8], net: Net, height: u32) -> Result<Zip318View, CoreError> {
    let tx = parse_tx(bytes)?;
    Ok(view(&tx, net, BlockHeight::from_u32(height)))
}

fn not_a_migration(detail: String) -> Zip318View {
    Zip318View {
        classification: "not-a-migration-shape",
        reasons: vec![reason("shape", None, detail, SHAPE)],
    }
}

fn view(tx: &Transaction, net: Net, height: BlockHeight) -> Zip318View {
    if !matches!(tx.version(), TxVersion::V5 | TxVersion::V6) || is_coinbase(tx) {
        return not_a_migration(
            "ZIP 318 migration transactions are non-coinbase v5 or v6 transactions that spend from Orchard.".to_string(),
        );
    }
    let Some(orchard) = tx.orchard_bundle() else {
        return not_a_migration("No Orchard bundle, so nothing leaves the ZIP 318 source pool.".to_string());
    };
    let constants = ObserverConstants(net);
    let source_actions = orchard.actions().len();
    let ironwood = tx.ironwood_bundle();
    let destination_actions = ironwood.map_or(0, |b| b.actions().len());
    let transparent = tx.transparent_bundle().map_or((0, 0), |b| (b.vin.len(), b.vout.len()));
    let sapling = tx
        .sapling_bundle()
        .map_or((0, 0), |b| (b.shielded_spends().len(), b.shielded_outputs().len()));
    let sprout = tx.sprout_bundle().map_or(0, |b| b.joinsplits.len());
    let other_bundles_present = transparent != (0, 0) || sapling != (0, 0) || sprout > 0;

    let destination_inflow = ironwood
        .map(|b| i64::from(*b.value_balance()))
        .filter(|balance| *balance < 0)
        .map(|balance| balance.unsigned_abs());
    let sole_destination_value = if destination_actions == CROSSING_DESTINATION_ACTIONS {
        destination_inflow.and_then(|v| Zatoshis::from_u64(v).ok())
    } else {
        None
    };

    let expiry = u32::from(tx.expiry_height());
    let expiry_is_canonical = constants.is_canonical_expiry_value(tx.expiry_height());
    let canonical_here = u32::from(constants.canonical_expiry(height));
    let (modulus, window) = constants.expiry_window();

    let fee = if other_bundles_present { None } else { fee_paid(tx, &[]).ok().flatten() };
    let fee_inputs = FeeInputs::of(tx);
    let canonical_fee = fee_inputs.zip317_fee(net, height);
    let fee_is_canonical = fee.map(|f| f == canonical_fee);

    let evidence = Zip318Evidence::default()
        .with_source_actions(Some(source_actions))
        .with_destination_actions(Some(destination_actions))
        .with_other_bundles_present(Some(other_bundles_present))
        .with_source_is_send_to_self(None)
        .with_sole_destination_value(sole_destination_value)
        .with_expiry_is_canonical(Some(expiry_is_canonical))
        .with_anchor_on_grid(None)
        .with_fee_is_canonical(fee_is_canonical);
    let classification = classify(&evidence, &constants);

    if destination_actions == 0 && classification == Zip318Classification::Nonconforming && source_actions != constants.preparation_tx_actions() {
        return not_a_migration(format!(
            "{} and no Ironwood bundle: an ordinary Orchard transaction, not a crossing and not padded to the {} actions of a preparation transaction.",
            plural(source_actions, "Orchard action"),
            constants.preparation_tx_actions()
        ));
    }

    let mut reasons = Vec::new();
    match destination_actions {
        0 => reasons.push(reason(
            "source-actions",
            Some(source_actions == constants.preparation_tx_actions()),
            format!(
                "{} and no Ironwood bundle. A preparation transaction is padded to exactly {} Orchard actions.",
                plural(source_actions, "Orchard action"),
                constants.preparation_tx_actions()
            ),
            PREPARATION,
        )),
        CROSSING_DESTINATION_ACTIONS => reasons.push(reason(
            "source-actions",
            Some(source_actions == CROSSING_SOURCE_ACTIONS),
            format!(
                "{}. A crossing spends one Orchard note in a bundle padded to exactly {CROSSING_SOURCE_ACTIONS} actions, so a change output is not visible.",
                plural(source_actions, "Orchard action")
            ),
            SHAPE,
        )),
        _ => reasons.push(reason(
            "source-actions",
            None,
            format!("{}. Not judged: the Ironwood action count already rules out both shapes.", plural(source_actions, "Orchard action")),
            SHAPE,
        )),
    }
    reasons.push(reason(
        "destination-actions",
        Some(destination_actions <= CROSSING_DESTINATION_ACTIONS),
        match destination_actions {
            0 => "No Ironwood bundle: the preparation shape, which never crosses the turnstile.".to_string(),
            CROSSING_DESTINATION_ACTIONS => {
                "1 Ironwood action: the single canonical output of a crossing, unpadded.".to_string()
            }
            n => format!("{n} Ironwood actions. A crossing has exactly 1, a preparation transaction none."),
        },
        SHAPE,
    ));
    reasons.push(reason(
        "other-bundles",
        Some(!other_bundles_present),
        if other_bundles_present {
            format!(
                "Carries {} transparent inputs, {} transparent outputs, {} Sapling spends, {} Sapling outputs and {} JoinSplits. ZIP 318 transactions carry none.",
                transparent.0, transparent.1, sapling.0, sapling.1, sprout
            )
        } else {
            "No transparent, Sapling or Sprout parts, as ZIP 318 requires.".to_string()
        },
        SHAPE,
    ));
    if destination_actions == CROSSING_DESTINATION_ACTIONS {
        reasons.push(match sole_destination_value {
            Some(value) => {
                let canonical = constants.is_canonical_denomination(value);
                let zec = fmt_zec(u64::from(value));
                reason(
                    "sole-destination-value",
                    Some(canonical),
                    if canonical {
                        format!(
                            "{zec} enters Ironwood, a {{1,2,5}}×10^k denomination between {} and {}, shared by every wallet that crosses the same amount.",
                            fmt_zec(u64::from(constants.max_residual_value())),
                            fmt_zec(u64::from(constants.denomination_cap()))
                        )
                    } else {
                        format!(
                            "{zec} enters Ironwood. It is not a {{1,2,5}}×10^k denomination between {} and {}, so the amount alone can single this transaction out.",
                            fmt_zec(u64::from(constants.max_residual_value())),
                            fmt_zec(u64::from(constants.denomination_cap()))
                        )
                    },
                    "Amount selection, canonical quantization",
                )
            }
            None => reason(
                "sole-destination-value",
                None,
                format!(
                    "valueBalanceIronwood is {}, so no value enters Ironwood and the crossing amount is not determined.",
                    ironwood.map_or(0, |b| i64::from(*b.value_balance()))
                ),
                "Amount selection, canonical quantization",
            ),
        });
    }
    reasons.push(reason(
        "expiry",
        Some(expiry_is_canonical),
        if expiry_is_canonical {
            format!(
                "Expiry height {} is on the rolling expiry grid (a multiple of {} blocks, at least {}), shared by every migration transaction scheduled in the same 30-day period. A transaction scheduled at height {} gets {}.",
                fmt_height(expiry),
                fmt_height(modulus),
                fmt_height(window),
                fmt_height(u32::from(height)),
                fmt_height(canonical_here)
            )
        } else {
            format!(
                "Expiry height {} is not on the rolling expiry grid (multiples of {} blocks, at least {}). A ZIP 318 transaction scheduled at height {} uses {}.",
                fmt_height(expiry),
                fmt_height(modulus),
                fmt_height(window),
                fmt_height(u32::from(height)),
                fmt_height(canonical_here)
            )
        },
        SHAPE,
    ));
    reasons.push(reason(
        "fee",
        fee_is_canonical,
        match fee {
            Some(f) if f == canonical_fee => format!(
                "Fee {} is the ZIP 317 conventional fee for {}, the canonical fee.",
                fmt_zec(f),
                plural(fee_inputs.logical_actions(), "logical action")
            ),
            Some(f) => format!(
                "Fee {} differs from the canonical {} (ZIP 317 conventional fee for {}).",
                fmt_zec(f),
                fmt_zec(canonical_fee),
                plural(fee_inputs.logical_actions(), "logical action")
            ),
            None => "Not judged: the fee of a transaction with transparent inputs needs their values.".to_string(),
        },
        SHAPE,
    ));
    if destination_actions == 0 {
        reasons.push(reason(
            "send-to-self",
            None,
            "Unknown. Whether the outputs pay the sender's own wallet needs its viewing key, which Luora never asks for.".to_string(),
            PREPARATION,
        ));
    }
    if destination_actions == CROSSING_DESTINATION_ACTIONS {
        reasons.push(reason(
            "anchor-on-grid",
            None,
            format!(
                "Unknown. Whether the Orchard anchor is a boundary of the {}-block anchor grid needs a tree-state lookup by anchor, which Luora does not make.",
                constants.anchor_bucket_interval().block_count()
            ),
            "Anchor-height bucketing and cohorts",
        ));
    }

    Zip318View {
        classification: match classification {
            Zip318Classification::Conforms(Zip318TxKind::Preparation) => "preparation",
            Zip318Classification::Conforms(Zip318TxKind::Transfer) => "transfer",
            Zip318Classification::Nonconforming => "nonconforming",
            Zip318Classification::Unknown => "unknown",
        },
        reasons,
    }
}
