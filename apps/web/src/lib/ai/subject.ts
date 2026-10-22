import type { Check, DecodedTx, Network, OrchardLikeBundle, PcztView, ZebraErrorEntry } from "@contract/types";
import { describeFlags, nodeForCheck, type NodeId } from "../anatomy";
import { formatInt, formatZec } from "../format";
import type { TraceRow } from "../trace";

export type FieldPrivacy = "public" | "size" | "txid" | "address" | "hash";

export interface AskField {
  name: string;
  value: string;
  display: string;
  privacy: FieldPrivacy;
}

export type AskKind = "trace" | "node" | "check" | "zebra" | "pczt";

export interface AskSubject {
  kind: AskKind;
  key: string;
  title: string;
  parents: string[];
  offset: number | null;
  length: number | null;
  fields: AskField[];
  checks: Check[];
  zips: { number: number; clause?: string }[];
  keywords: string[];
  notes: string[];
}

export interface AskEnv {
  network: Network;
  height: number | null;
  heightLabel: string;
  upgrade: string | null;
  version: number | null;
  txid: string | null;
  hex: string | null;
}

const TXID_FIELDS = new Set(["txid", "prevout"]);
const ADDRESS_FIELDS = new Set(["address", "scriptPubKey", "recipient", "userAddress"]);
const HASH_FIELDS = new Set(["anchor", "anchorSapling", "cmu", "cmx", "cv", "ephemeralKey", "nullifier", "rk", "nullifiers", "commitments"]);

const KIND_HINTS: Record<string, string[]> = {
  HEADER: ["header_digest", "consensus_branch_id", "nExpiryHeight"],
  VIN: ["prevouts_digest", "sequence_digest"],
  VOUT: ["outputs_digest"],
  SPEND: ["sapling_spends_digest", "nullifier"],
  OUTPUT: ["sapling_outputs_digest", "cmu"],
  ACTION: ["orchard_actions_compact_digest", "cmx"],
  BALANCE: ["valueBalance"],
  PROOF: ["proofs"],
  FEE: ["Fee calculation"],
};

const BUNDLE_ZIPS: Record<NodeId, number[]> = {
  tx: [244, 225],
  header: [225, 244, 203],
  transparent: [244],
  sapling: [225, 244],
  orchard: [225, 244, 257],
  ironwood: [229, 244, 258],
  fee: [317, 2009],
};

export function fieldPrivacy(name: string, value: string, display: string, encrypted = false): FieldPrivacy {
  if (value === "not set" || value === "") return "public";
  if (TXID_FIELDS.has(name)) return "txid";
  if (ADDRESS_FIELDS.has(name)) return "address";
  if (encrypted || /^[\d,]+ B(, encrypted)?$/.test(display)) return "size";
  if (HASH_FIELDS.has(name)) return "hash";
  return "public";
}

function askField(name: string, value: string, display = value, encrypted = false): AskField {
  return { name, value, display, privacy: fieldPrivacy(name, value, display, encrypted) };
}

function relevantChecks(checks: Check[] | null, node: NodeId | null): Check[] {
  if (!checks) return [];
  if (node === null || node === "tx") return checks.filter((check) => check.status === "fail" || check.status === "warn");
  return checks.filter((check) => nodeForCheck(check) === node || (node === "header" && nodeForCheck(check) === "tx"));
}

function zipsFor(node: NodeId | null, checks: Check[], version: number | null): AskSubject["zips"] {
  const base = node ? BUNDLE_ZIPS[node] : [244];
  const list: AskSubject["zips"] = checks.flatMap((check) => (check.zip ? [{ number: check.zip.number, clause: check.zip.clause }] : []));
  for (const number of base) list.push({ number });
  if (version === 6 && node !== "fee") list.push({ number: 229 });
  const seen = new Set<string>();
  return list.filter((zip) => {
    const key = `${zip.number}:${zip.clause ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function bundleOf(row: TraceRow, byId: Map<string, TraceRow>): NodeId | null {
  let current: TraceRow | undefined = row;
  while (current && current.depth > 1) current = current.parentId ? byId.get(current.parentId) : undefined;
  const id = current?.id ?? null;
  if (id === "tx" || id === "header" || id === "transparent" || id === "sapling" || id === "orchard" || id === "ironwood" || id === "fee") return id;
  if (id === "locktime") return "header";
  return null;
}

export function traceRowSubject(row: TraceRow, rows: TraceRow[], checks: Check[] | null, version: number | null): AskSubject {
  const byId = new Map(rows.map((item) => [item.id, item]));
  const parents: string[] = [];
  let parent = row.parentId ? byId.get(row.parentId) : undefined;
  while (parent) {
    parents.unshift(`${parent.kind} ${parent.label}`);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  const node = bundleOf(row, byId);
  const related = relevantChecks(checks, node);
  return {
    kind: "trace",
    key: row.offset !== null ? `@${row.offset}` : `@${row.id}`,
    title: `${row.kind} ${row.label}`,
    parents,
    offset: row.offset,
    length: row.length,
    fields: row.fields.map((field) => askField(field.name, field.value, field.display, field.encrypted)),
    checks: related,
    zips: zipsFor(node, related, version),
    keywords: [row.kind, ...(KIND_HINTS[row.kind] ?? []), ...row.fields.map((field) => field.name)],
    notes: row.offset === null ? ["This row is computed by Luora, it is not stored in the transaction bytes."] : [],
  };
}

function orchardLikeFields(bundle: OrchardLikeBundle | null): AskField[] {
  if (!bundle) return [askField("present", "no")];
  return [
    askField("actions", String(bundle.actions)),
    askField("flags", describeFlags(bundle.flags)),
    askField("valueBalance", String(bundle.valueBalanceZat), formatZec(bundle.valueBalanceZat, true)),
    askField("proofBytes", String(bundle.proofBytes), `${formatInt(bundle.proofBytes)} B`),
    askField("canonicalProofBytes", String(bundle.canonicalProofBytes), `${formatInt(bundle.canonicalProofBytes)} B (2720 + 2272 × actions)`),
    askField("anchor", bundle.anchor, bundle.anchor.slice(0, 12)),
    askField("nullifiers", bundle.nullifiers.join(","), `${bundle.nullifiers.length} × 32 B`),
    askField("commitments", bundle.commitments.join(","), `${bundle.commitments.length} × 32 B`),
  ];
}

const NODE_LABEL: Record<NodeId, string> = {
  tx: "Transaction",
  header: "Header",
  transparent: "Transparent bundle",
  sapling: "Sapling bundle",
  orchard: "Orchard bundle",
  ironwood: "Ironwood bundle",
  fee: "Fee",
};

export function nodeSubject(node: NodeId, tx: DecodedTx, feeZat: number | null, checks: Check[] | null): AskSubject {
  const fields: AskField[] = [];
  if (node === "tx") {
    fields.push(askField("txid", tx.txid), askField("version", String(tx.version)), askField("size", String(tx.sizeBytes), `${formatInt(tx.sizeBytes)} B`));
  } else if (node === "header") {
    fields.push(
      askField("version", String(tx.version)),
      askField("versionGroupId", tx.versionGroupId),
      askField("consensusBranchId", tx.consensusBranchId ?? "not in v4 header"),
      askField("upgrade", tx.upgrade ?? "unknown"),
      askField("lockTime", String(tx.lockTime)),
      askField("expiryHeight", String(tx.expiryHeight)),
    );
  } else if (node === "transparent") {
    fields.push(askField("inputs", String(tx.transparent.inputs.length)), askField("outputs", String(tx.transparent.outputs.length)));
    tx.transparent.inputs.forEach((input, index) => {
      fields.push(input.isCoinbase ? askField(`vin${index}.coinbase`, "yes") : askField("prevout", `${input.prevTxid}:${input.prevIndex}`));
    });
    tx.transparent.outputs.forEach((output, index) => {
      fields.push(askField(`vout${index}.value`, String(output.valueZat), formatZec(output.valueZat)));
      if (output.address) fields.push(askField("address", output.address));
    });
  } else if (node === "sapling") {
    const sapling = tx.sapling;
    if (!sapling) fields.push(askField("present", "no"));
    else
      fields.push(
        askField("spends", String(sapling.spends)),
        askField("outputs", String(sapling.outputs)),
        askField("valueBalance", String(sapling.valueBalanceZat), formatZec(sapling.valueBalanceZat, true)),
        askField("proofBytesEach", String(sapling.proofBytesEach), `${sapling.proofBytesEach} B (Groth16)`),
        askField("nullifiers", sapling.nullifiers.join(","), `${sapling.nullifiers.length} × 32 B`),
        askField("commitments", sapling.commitments.join(","), `${sapling.commitments.length} × 32 B`),
      );
  } else if (node === "orchard") {
    fields.push(...orchardLikeFields(tx.orchard));
  } else if (node === "ironwood") {
    fields.push(...orchardLikeFields(tx.ironwood));
    if (tx.version < 6) fields.push(askField("note", "Ironwood exists only in v6 transactions (ZIP 229)"));
  } else {
    fields.push(
      askField("fee", feeZat === null ? "input values unavailable (the spent output values are not known)" : String(feeZat), feeZat === null ? "input values unavailable" : formatZec(feeZat)),
      askField("logicalActions", String(tx.zip317.logicalActions)),
      askField("conventionalFee", String(tx.zip317.conventionalFeeZat), formatZec(tx.zip317.conventionalFeeZat)),
    );
  }
  const related = relevantChecks(checks, node);
  return {
    kind: "node",
    key: `node:${node}`,
    title: NODE_LABEL[node],
    parents: node === "tx" ? [] : [`Transaction v${tx.version}`],
    offset: null,
    length: null,
    fields,
    checks: related,
    zips: zipsFor(node, related, tx.version),
    keywords: [node, ...fields.map((field) => field.name)],
    notes: [],
  };
}

export function checkSubject(check: Check, version: number | null): AskSubject {
  const node = nodeForCheck(check);
  return {
    kind: "check",
    key: `#${check.id}`,
    title: check.title,
    parents: ["Rules"],
    offset: null,
    length: null,
    fields: [askField("status", check.status), askField("detail", check.detail), ...(check.source ? [askField("source", check.source)] : [])],
    checks: [check],
    zips: zipsFor(node, [check], version),
    keywords: [check.id, check.title],
    notes: [],
  };
}

export function zebraSubject(entry: ZebraErrorEntry, reason: string): AskSubject {
  return {
    kind: "zebra",
    key: entry.variant,
    title: entry.variant,
    parents: ["Why rejected"],
    offset: null,
    length: null,
    fields: [
      askField("message", entry.message),
      askField("stage", entry.stage),
      askField("source", `${entry.file.startsWith(`${entry.crate}/`) ? entry.file : `${entry.crate}/${entry.file}`}:${entry.line}`),
      askField("zebraVersion", entry.zebraVersion),
      askField("matchedBy", reason),
    ],
    checks: [],
    zips: entry.zips.map((number) => ({ number })),
    keywords: [entry.variant.split("::").pop() ?? entry.variant, entry.message],
    notes: [`Luora's catalog note: ${entry.plain}`],
  };
}

export function pcztActionSubject(action: PcztView["actions"][number], pczt: PcztView): AskSubject {
  return {
    kind: "pczt",
    key: `${action.pool}#${action.index}`,
    title: `PCZT ${action.pool} action #${action.index}`,
    parents: ["PCZT", `${pczt.roles.filter((role) => role.done).map((role) => role.name).join(", ") || "no roles"} done`],
    offset: null,
    length: null,
    fields: [
      askField("pool", action.pool),
      askField("value", action.valueZat === null ? "not set" : String(action.valueZat), action.valueZat === null ? "not set" : formatZec(action.valueZat)),
      askField("recipient", action.recipient ?? "not set"),
      askField("userAddress", action.userAddress ?? "not set"),
      askField("recipientMatchesUserAddress", action.recipient && action.userAddress ? String(action.recipient === action.userAddress) : "unknown"),
      askField("proof", action.proof ? "present" : "missing"),
      askField("signature", action.signature ? "present" : "missing"),
    ],
    checks: pczt.checks,
    zips: [{ number: 374 }, ...pczt.checks.flatMap((check) => (check.zip ? [{ number: check.zip.number, clause: check.zip.clause }] : []))],
    keywords: ["signer", "user_address", action.pool, "proof", "signature"],
    notes: [],
  };
}
