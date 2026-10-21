use zcash_primitives::transaction::{Transaction, TxVersion};

use crate::decode::{display_hex, has_explicit_branch_id, is_null_outpoint, parse_tx, transparent_address, version_number};
use crate::model::*;
use crate::network::{Net, branch_display_name, branch_hex};

pub const SAPLING_SPEND_V4_BYTES: usize = 32 + 32 + 32 + 32 + GROTH_PROOF_BYTES + SIG_BYTES;
pub const SAPLING_OUTPUT_V4_BYTES: usize = 32 + 32 + 32 + ENC_CIPHERTEXT_BYTES + OUT_CIPHERTEXT_BYTES + GROTH_PROOF_BYTES;
pub const SAPLING_SPEND_V5_BYTES: usize = 32 + 32 + 32;
pub const SAPLING_OUTPUT_V5_BYTES: usize = 32 + 32 + 32 + ENC_CIPHERTEXT_BYTES + OUT_CIPHERTEXT_BYTES;
pub const ORCHARD_ACTION_BYTES: usize = 32 + 32 + 32 + 32 + 32 + ENC_CIPHERTEXT_BYTES + OUT_CIPHERTEXT_BYTES;
pub const GROTH_PROOF_BYTES: usize = 192;
pub const SIG_BYTES: usize = 64;
pub const ENC_CIPHERTEXT_BYTES: usize = 580;
pub const OUT_CIPHERTEXT_BYTES: usize = 80;

struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<(usize, &'a [u8]), CoreError> {
        let start = self.pos;
        let end = start
            .checked_add(n)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| CoreError::new("trace-failed", format!("byte {start}: expected {n} more bytes")))?;
        self.pos = end;
        Ok((start, &self.bytes[start..end]))
    }

    fn compact_size(&mut self) -> Result<u64, CoreError> {
        let (_, first) = self.take(1)?;
        Ok(match first[0] {
            0xfd => u16::from_le_bytes(self.take(2)?.1.try_into().unwrap()) as u64,
            0xfe => u32::from_le_bytes(self.take(4)?.1.try_into().unwrap()) as u64,
            0xff => u64::from_le_bytes(self.take(8)?.1.try_into().unwrap()),
            n => n as u64,
        })
    }

    fn count(&mut self, expected: usize, what: &str) -> Result<(), CoreError> {
        let at = self.pos;
        let n = self.compact_size()?;
        if n != expected as u64 {
            return Err(CoreError::new(
                "trace-failed",
                format!("byte {at}: {what} count is {n} but the parsed transaction has {expected}"),
            ));
        }
        Ok(())
    }
}

fn field(name: &str, value: impl Into<String>, display: impl Into<String>) -> TraceField {
    TraceField { name: name.into(), value: value.into(), display: display.into(), encrypted: false }
}

fn hex_field(name: &str, bytes: &[u8]) -> TraceField {
    let value = hex::encode(bytes);
    let display = short(&value);
    field(name, value, display)
}

fn encrypted_field(name: &str, bytes: &[u8]) -> TraceField {
    TraceField {
        name: name.into(),
        value: hex::encode(bytes),
        display: format!("{} B, encrypted", bytes.len()),
        encrypted: true,
    }
}

fn size_field(name: &str, bytes: &[u8]) -> TraceField {
    field(name, hex::encode(bytes), format!("{} B", bytes.len()))
}

fn short(value: &str) -> String {
    if value.len() <= 20 {
        value.to_string()
    } else {
        format!("{}…{}", &value[..8], &value[value.len() - 6..])
    }
}

pub fn format_zec(zat: i64) -> String {
    let sign = if zat < 0 { "-" } else { "" };
    let abs = zat.unsigned_abs();
    let whole = abs / 100_000_000;
    let frac = format!("{:08}", abs % 100_000_000);
    let frac = frac.trim_end_matches('0');
    if frac.is_empty() {
        format!("{sign}{whole} ZEC")
    } else {
        format!("{sign}{whole}.{frac} ZEC")
    }
}

fn value_field(name: &str, zat: i64) -> TraceField {
    field(name, zat.to_string(), format_zec(zat))
}

struct Builder {
    nodes: Vec<TraceNode>,
}

impl Builder {
    fn push(
        &mut self,
        id: impl Into<String>,
        parent: Option<&str>,
        kind: &'static str,
        label: impl Into<String>,
        offset: usize,
        fields: Vec<TraceField>,
    ) -> usize {
        let depth = match parent {
            None => 0,
            Some(p) => self.nodes.iter().find(|n| n.id == p).map_or(0, |n| n.depth + 1),
        };
        self.nodes.push(TraceNode {
            id: id.into(),
            parent_id: parent.map(str::to_string),
            depth,
            kind,
            label: label.into(),
            offset,
            length: 0,
            fields,
        });
        self.nodes.len() - 1
    }

    fn close(&mut self, index: usize, end: usize) {
        let node = &mut self.nodes[index];
        node.length = end - node.offset;
    }
}

fn plural(n: usize, noun: &str) -> String {
    format!("{n} {noun}{}", if n == 1 { "" } else { "s" })
}

fn trace_transparent(tx: &Transaction, net: Net, cur: &mut Cursor, b: &mut Builder) -> Result<(), CoreError> {
    let (vin, vout) = tx.transparent_bundle().map_or((&[][..], &[][..]), |t| (&t.vin[..], &t.vout[..]));
    let start = cur.pos;
    let node = b.push(
        "transparent",
        Some("tx"),
        "TRANSPARENT",
        if vin.is_empty() && vout.is_empty() { "empty".to_string() } else { format!("{} in · {} out", vin.len(), vout.len()) },
        start,
        vec![field("inputs", vin.len().to_string(), vin.len().to_string()), field("outputs", vout.len().to_string(), vout.len().to_string())],
    );
    cur.count(vin.len(), "transparent input")?;
    for (i, input) in vin.iter().enumerate() {
        let (offset, _) = cur.take(36)?;
        let script_len = cur.compact_size()? as usize;
        let (_, script) = cur.take(script_len)?;
        let (_, seq) = cur.take(4)?;
        let coinbase = is_null_outpoint(input.prevout());
        let prevout = format!("{}:{}", display_hex(input.prevout().hash()), input.prevout().n());
        let mut fields = vec![];
        if coinbase {
            fields.push(size_field("coinbaseScript", script));
        } else {
            fields.push(field("prevout", prevout.clone(), format!("{}:{}", short(&display_hex(input.prevout().hash())), input.prevout().n())));
            fields.push(size_field("scriptSig", script));
        }
        fields.push(field("sequence", hex::encode(seq), format!("0x{:08x}", u32::from_le_bytes(seq.try_into().unwrap()))));
        let n = b.push(format!("vin-{i}"), Some("transparent"), "VIN", if coinbase { format!("#{i} coinbase") } else { format!("#{i}") }, offset, fields);
        b.close(n, cur.pos);
    }
    cur.count(vout.len(), "transparent output")?;
    for (i, output) in vout.iter().enumerate() {
        let (offset, _) = cur.take(8)?;
        let script_len = cur.compact_size()? as usize;
        let (_, script) = cur.take(script_len)?;
        let value = u64::from(output.value()) as i64;
        let mut fields = vec![value_field("value", value)];
        if let Some(address) = transparent_address(output, net) {
            fields.push(field("address", address.clone(), short(&address)));
        }
        fields.push(hex_field("scriptPubKey", script));
        let n = b.push(format!("vout-{i}"), Some("transparent"), "VOUT", format!("#{i} · {}", format_zec(value)), offset, fields);
        b.close(n, cur.pos);
    }
    b.close(node, cur.pos);
    Ok(())
}

fn trace_sapling_v4(tx: &Transaction, cur: &mut Cursor, b: &mut Builder) -> Result<(), CoreError> {
    let bundle = tx.sapling_bundle();
    let spends = bundle.map_or(&[][..], |s| s.shielded_spends());
    let outputs = bundle.map_or(&[][..], |s| s.shielded_outputs());
    let value_balance = bundle.map_or(0, |s| i64::from(*s.value_balance()));
    let start = cur.pos;
    let node = b.push(
        "sapling",
        Some("tx"),
        "SAPLING",
        if spends.is_empty() && outputs.is_empty() { "empty".to_string() } else { format!("{} · {}", plural(spends.len(), "spend"), plural(outputs.len(), "output")) },
        start,
        vec![value_field("valueBalance", value_balance)],
    );
    let (offset, _) = cur.take(8)?;
    let n = b.push("sapling-balance", Some("sapling"), "BALANCE", format_zec(value_balance), offset, vec![value_field("valueBalanceSapling", value_balance)]);
    b.close(n, cur.pos);
    cur.count(spends.len(), "Sapling spend")?;
    for i in 0..spends.len() {
        let (offset, _) = cur.take(0)?;
        let (_, cv) = cur.take(32)?;
        let (_, anchor) = cur.take(32)?;
        let (_, nf) = cur.take(32)?;
        let (_, rk) = cur.take(32)?;
        let (_, proof) = cur.take(GROTH_PROOF_BYTES)?;
        let (_, sig) = cur.take(SIG_BYTES)?;
        let n = b.push(
            format!("sapling-spend-{i}"),
            Some("sapling"),
            "SPEND",
            format!("#{i}"),
            offset,
            vec![hex_field("cv", cv), hex_field("anchor", anchor), hex_field("nullifier", nf), hex_field("rk", rk), size_field("zkproof", proof), size_field("spendAuthSig", sig)],
        );
        b.close(n, cur.pos);
    }
    cur.count(outputs.len(), "Sapling output")?;
    for i in 0..outputs.len() {
        let (offset, _) = cur.take(0)?;
        let (_, cv) = cur.take(32)?;
        let (_, cmu) = cur.take(32)?;
        let (_, epk) = cur.take(32)?;
        let (_, enc) = cur.take(ENC_CIPHERTEXT_BYTES)?;
        let (_, out) = cur.take(OUT_CIPHERTEXT_BYTES)?;
        let (_, proof) = cur.take(GROTH_PROOF_BYTES)?;
        let n = b.push(
            format!("sapling-output-{i}"),
            Some("sapling"),
            "OUTPUT",
            format!("#{i}"),
            offset,
            vec![hex_field("cv", cv), hex_field("cmu", cmu), hex_field("ephemeralKey", epk), encrypted_field("encCiphertext", enc), encrypted_field("outCiphertext", out), size_field("zkproof", proof)],
        );
        b.close(n, cur.pos);
    }
    b.close(node, cur.pos);
    Ok(())
}

fn trace_sapling_v5(tx: &Transaction, cur: &mut Cursor, b: &mut Builder) -> Result<(), CoreError> {
    let bundle = tx.sapling_bundle();
    let spends = bundle.map_or(0, |s| s.shielded_spends().len());
    let outputs = bundle.map_or(0, |s| s.shielded_outputs().len());
    let value_balance = bundle.map_or(0, |s| i64::from(*s.value_balance()));
    let start = cur.pos;
    let node = b.push(
        "sapling",
        Some("tx"),
        "SAPLING",
        if spends == 0 && outputs == 0 { "empty".to_string() } else { format!("{} · {}", plural(spends, "spend"), plural(outputs, "output")) },
        start,
        vec![value_field("valueBalance", value_balance)],
    );
    cur.count(spends, "Sapling spend")?;
    for i in 0..spends {
        let (offset, _) = cur.take(0)?;
        let (_, cv) = cur.take(32)?;
        let (_, nf) = cur.take(32)?;
        let (_, rk) = cur.take(32)?;
        let n = b.push(format!("sapling-spend-{i}"), Some("sapling"), "SPEND", format!("#{i}"), offset, vec![hex_field("cv", cv), hex_field("nullifier", nf), hex_field("rk", rk)]);
        b.close(n, cur.pos);
    }
    cur.count(outputs, "Sapling output")?;
    for i in 0..outputs {
        let (offset, _) = cur.take(0)?;
        let (_, cv) = cur.take(32)?;
        let (_, cmu) = cur.take(32)?;
        let (_, epk) = cur.take(32)?;
        let (_, enc) = cur.take(ENC_CIPHERTEXT_BYTES)?;
        let (_, out) = cur.take(OUT_CIPHERTEXT_BYTES)?;
        let n = b.push(
            format!("sapling-output-{i}"),
            Some("sapling"),
            "OUTPUT",
            format!("#{i}"),
            offset,
            vec![hex_field("cv", cv), hex_field("cmu", cmu), hex_field("ephemeralKey", epk), encrypted_field("encCiphertext", enc), encrypted_field("outCiphertext", out)],
        );
        b.close(n, cur.pos);
    }
    if spends + outputs > 0 {
        let (offset, _) = cur.take(8)?;
        let mut fields = vec![value_field("valueBalanceSapling", value_balance)];
        if spends > 0 {
            let (_, anchor) = cur.take(32)?;
            fields.push(hex_field("anchorSapling", anchor));
        }
        let n = b.push("sapling-balance", Some("sapling"), "BALANCE", format_zec(value_balance), offset, fields);
        b.close(n, cur.pos);
    }
    for i in 0..spends {
        let (offset, proof) = cur.take(GROTH_PROOF_BYTES)?;
        let n = b.push(format!("sapling-spend-proof-{i}"), Some("sapling"), "PROOF", format!("spend #{i} · Groth16"), offset, vec![size_field("zkproof", proof)]);
        b.close(n, cur.pos);
    }
    for i in 0..spends {
        let (offset, sig) = cur.take(SIG_BYTES)?;
        let n = b.push(format!("sapling-spend-sig-{i}"), Some("sapling"), "AUTH SIG", format!("spend #{i}"), offset, vec![size_field("spendAuthSig", sig)]);
        b.close(n, cur.pos);
    }
    for i in 0..outputs {
        let (offset, proof) = cur.take(GROTH_PROOF_BYTES)?;
        let n = b.push(format!("sapling-output-proof-{i}"), Some("sapling"), "PROOF", format!("output #{i} · Groth16"), offset, vec![size_field("zkproof", proof)]);
        b.close(n, cur.pos);
    }
    if spends + outputs > 0 {
        let (offset, sig) = cur.take(SIG_BYTES)?;
        let n = b.push("sapling-binding", Some("sapling"), "BINDING SIG", "bindingSigSapling", offset, vec![size_field("bindingSig", sig)]);
        b.close(n, cur.pos);
    }
    b.close(node, cur.pos);
    Ok(())
}

fn trace_orchard_like(
    pool: &'static str,
    kind: &'static str,
    bundle: Option<&orchard::Bundle<orchard::bundle::Authorized, zcash_protocol::value::ZatBalance>>,
    cur: &mut Cursor,
    b: &mut Builder,
) -> Result<(), CoreError> {
    let actions = bundle.map_or(0, |o| o.actions().len());
    let value_balance = bundle.map_or(0, |o| i64::from(*o.value_balance()));
    let start = cur.pos;
    let node = b.push(
        pool,
        Some("tx"),
        kind,
        if actions == 0 { "empty".to_string() } else { plural(actions, "action") },
        start,
        if actions == 0 { vec![] } else { vec![value_field("valueBalance", value_balance)] },
    );
    cur.count(actions, "action")?;
    if let Some(o) = bundle {
        for i in 0..actions {
            let (offset, _) = cur.take(0)?;
            let (_, cv) = cur.take(32)?;
            let (_, nf) = cur.take(32)?;
            let (_, rk) = cur.take(32)?;
            let (_, cmx) = cur.take(32)?;
            let (_, epk) = cur.take(32)?;
            let (_, enc) = cur.take(ENC_CIPHERTEXT_BYTES)?;
            let (_, out) = cur.take(OUT_CIPHERTEXT_BYTES)?;
            let n = b.push(
                format!("{pool}-action-{i}"),
                Some(pool),
                "ACTION",
                format!("#{i}"),
                offset,
                vec![
                    hex_field("cv", cv),
                    hex_field("nullifier", nf),
                    hex_field("rk", rk),
                    hex_field("cmx", cmx),
                    hex_field("ephemeralKey", epk),
                    encrypted_field("encCiphertext", enc),
                    encrypted_field("outCiphertext", out),
                ],
            );
            b.close(n, cur.pos);
        }
        let (offset, flags) = cur.take(1)?;
        let (_, _) = cur.take(8)?;
        let (_, anchor) = cur.take(32)?;
        let n = b.push(
            format!("{pool}-balance"),
            Some(pool),
            "BALANCE",
            format_zec(value_balance),
            offset,
            vec![field("flags", hex::encode(flags), format!("0b{:08b}", flags[0])), value_field("valueBalance", value_balance), hex_field("anchor", anchor)],
        );
        b.close(n, cur.pos);
        let proof_at = cur.pos;
        let proof_len = cur.compact_size()? as usize;
        if proof_len != o.authorization().proof().as_ref().len() {
            return Err(CoreError::new("trace-failed", format!("byte {proof_at}: proof length does not match the parsed bundle")));
        }
        let (_, proof) = cur.take(proof_len)?;
        let n = b.push(format!("{pool}-proof"), Some(pool), "PROOF", format!("Halo 2 · {proof_len} B"), proof_at, vec![size_field("proofs", proof)]);
        b.close(n, cur.pos);
        for i in 0..actions {
            let (offset, sig) = cur.take(SIG_BYTES)?;
            let n = b.push(format!("{pool}-sig-{i}"), Some(pool), "AUTH SIG", format!("action #{i}"), offset, vec![size_field("spendAuthSig", sig)]);
            b.close(n, cur.pos);
        }
        let (offset, sig) = cur.take(SIG_BYTES)?;
        let n = b.push(format!("{pool}-binding"), Some(pool), "BINDING SIG", "bindingSig", offset, vec![size_field("bindingSig", sig)]);
        b.close(n, cur.pos);
    }
    b.close(node, cur.pos);
    Ok(())
}

pub fn trace(bytes: &[u8], net: Net) -> Result<Vec<TraceNode>, CoreError> {
    let tx = parse_tx(bytes)?;
    let version = tx.version();
    let number = version_number(version);
    if number < 4 {
        return Err(CoreError::new("trace-unsupported", format!("v{number} transactions are not traced; v4, v5 and v6 are")));
    }
    let explicit = has_explicit_branch_id(&tx);
    let branch = tx.consensus_branch_id();
    let upgrade = explicit.then(|| branch_display_name(branch));
    let mut b = Builder { nodes: vec![] };
    let mut cur = Cursor { bytes, pos: 0 };
    let mut tx_label = format!("v{number}");
    if let Some(u) = &upgrade {
        tx_label.push_str(&format!(" · {u}"));
    }
    tx_label.push_str(&format!(" · {} bytes", bytes.len()));
    let txid = tx.txid().to_string();
    let root = b.push("tx", None, "TX", tx_label, 0, vec![field("txid", txid.clone(), short(&txid)), field("size", bytes.len().to_string(), format!("{} B", bytes.len()))]);

    let (offset, header) = cur.take(4)?;
    let (_, group) = cur.take(4)?;
    let mut header_fields = vec![
        field("version", number.to_string(), format!("v{number}")),
        field("fOverwintered", ((u32::from_le_bytes(header.try_into().unwrap()) >> 31) == 1).to_string(), ((u32::from_le_bytes(header.try_into().unwrap()) >> 31) == 1).to_string()),
        field("versionGroupId", format!("0x{:08x}", u32::from_le_bytes(group.try_into().unwrap())), format!("0x{:08x}", u32::from_le_bytes(group.try_into().unwrap()))),
    ];
    if explicit {
        cur.take(12)?;
        header_fields.push(field("consensusBranchId", branch_hex(branch), format!("{} ({})", branch_hex(branch), upgrade.clone().unwrap_or_default())));
        header_fields.push(field("lockTime", tx.lock_time().to_string(), tx.lock_time().to_string()));
        header_fields.push(field("expiryHeight", u32::from(tx.expiry_height()).to_string(), u32::from(tx.expiry_height()).to_string()));
    }
    let header_node = b.push("header", Some("tx"), "HEADER", header_label(number, upgrade.as_deref()), offset, header_fields);
    b.close(header_node, cur.pos);

    trace_transparent(&tx, net, &mut cur, &mut b)?;

    match version {
        TxVersion::V4 => {
            let (offset, _) = cur.take(8)?;
            let n = b.push(
                "locktime",
                Some("tx"),
                "HEADER",
                "lockTime · expiryHeight",
                offset,
                vec![
                    field("lockTime", tx.lock_time().to_string(), tx.lock_time().to_string()),
                    field("expiryHeight", u32::from(tx.expiry_height()).to_string(), u32::from(tx.expiry_height()).to_string()),
                ],
            );
            b.close(n, cur.pos);
            trace_sapling_v4(&tx, &mut cur, &mut b)?;
            let joinsplits = tx.sprout_bundle().map_or(0, |s| s.joinsplits.len());
            if joinsplits > 0 {
                return Err(CoreError::new("trace-unsupported", "Sprout JoinSplits are not traced"));
            }
            let (offset, _) = cur.take(1)?;
            let n = b.push("joinsplits", Some("tx"), "JOINSPLITS", "empty", offset, vec![]);
            b.close(n, cur.pos);
            if let Some(s) = tx.sapling_bundle()
                && !(s.shielded_spends().is_empty() && s.shielded_outputs().is_empty())
            {
                let (offset, sig) = cur.take(SIG_BYTES)?;
                let n = b.push("sapling-binding", Some("tx"), "BINDING SIG", "bindingSigSapling", offset, vec![size_field("bindingSig", sig)]);
                b.close(n, cur.pos);
            }
        }
        TxVersion::V5 => {
            trace_sapling_v5(&tx, &mut cur, &mut b)?;
            trace_orchard_like("orchard", "ORCHARD", tx.orchard_bundle(), &mut cur, &mut b)?;
        }
        _ => {
            trace_sapling_v5(&tx, &mut cur, &mut b)?;
            trace_orchard_like("orchard", "ORCHARD", tx.orchard_bundle(), &mut cur, &mut b)?;
            trace_orchard_like("ironwood", "IRONWOOD", tx.ironwood_bundle(), &mut cur, &mut b)?;
        }
    }

    if cur.pos != bytes.len() {
        return Err(CoreError::new("trace-failed", format!("trace stopped at byte {} of {}", cur.pos, bytes.len())));
    }
    b.close(root, cur.pos);
    Ok(b.nodes)
}

fn header_label(number: u32, upgrade: Option<&str>) -> String {
    match upgrade {
        Some(u) => format!("v{number} · {u}"),
        None => format!("v{number}"),
    }
}
