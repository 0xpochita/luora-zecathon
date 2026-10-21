import type { Check, DecodedTx } from "@contract/types";
import { formatInt, formatZec, shortHash } from "./format";

export type NodeId = "tx" | "header" | "transparent" | "sapling" | "orchard" | "ironwood" | "fee";

export interface AnatomyNode {
  id: NodeId;
  title: string;
  subtitle: string;
  empty: boolean;
  failing: boolean;
}

export const BUNDLE_IDS = ["header", "transparent", "sapling", "orchard", "ironwood"] as const;
export const POOL_IDS = ["transparent", "sapling", "orchard", "ironwood"] as const;

const NODE_KEYWORDS: Record<NodeId, string[]> = {
  tx: ["txid", "size"],
  header: ["branch", "version", "expiry", "lock", "upgrade", "header", "group"],
  transparent: ["transparent", "coinbase", "script"],
  sapling: ["sapling", "groth"],
  orchard: ["orchard", "turnstile", "cross"],
  ironwood: ["ironwood"],
  fee: ["fee", "zip317", "zip-317", "balance"],
};

function plural(count: number, noun: string): string {
  return `${formatInt(count)} ${noun}${count === 1 ? "" : "s"}`;
}

export function nodeForCheck(check: Check): NodeId | null {
  const id = check.id.toLowerCase();
  for (const node of ["ironwood", "orchard", "sapling", "transparent", "fee", "header", "tx"] as NodeId[]) {
    if (NODE_KEYWORDS[node].some((keyword) => id.includes(keyword))) return node;
  }
  return null;
}

export function failingNodes(checks: Check[] | null): Set<NodeId> {
  const nodes = new Set<NodeId>();
  for (const check of checks ?? []) {
    if (check.status !== "fail") continue;
    const node = nodeForCheck(check);
    if (node) nodes.add(node);
  }
  return nodes;
}

export function buildNodes(tx: DecodedTx, feeZat: number | null, failing: Set<NodeId>, inputsPending: boolean): AnatomyNode[] {
  const transparentEmpty = tx.transparent.inputs.length === 0 && tx.transparent.outputs.length === 0;
  const saplingEmpty = !tx.sapling || (tx.sapling.spends === 0 && tx.sapling.outputs === 0);
  return [
    { id: "tx", title: "Transaction", subtitle: shortHash(tx.txid), empty: false, failing: failing.has("tx") },
    {
      id: "header",
      title: "Header",
      subtitle: `v${tx.version}${tx.upgrade ? " · " + tx.upgrade : ""}`,
      empty: false,
      failing: failing.has("header"),
    },
    {
      id: "transparent",
      title: "Transparent",
      subtitle: transparentEmpty ? "empty" : `${tx.transparent.inputs.length} in · ${tx.transparent.outputs.length} out`,
      empty: transparentEmpty,
      failing: failing.has("transparent"),
    },
    {
      id: "sapling",
      title: "Sapling",
      subtitle: saplingEmpty || !tx.sapling ? "empty" : `${plural(tx.sapling.spends, "spend")} · ${plural(tx.sapling.outputs, "output")}`,
      empty: saplingEmpty,
      failing: failing.has("sapling"),
    },
    {
      id: "orchard",
      title: "Orchard",
      subtitle: tx.orchard && tx.orchard.actions > 0 ? plural(tx.orchard.actions, "action") : "empty",
      empty: !tx.orchard || tx.orchard.actions === 0,
      failing: failing.has("orchard"),
    },
    {
      id: "ironwood",
      title: "Ironwood",
      subtitle: tx.ironwood && tx.ironwood.actions > 0 ? plural(tx.ironwood.actions, "action") : tx.version >= 6 ? "empty" : "v6 only",
      empty: !tx.ironwood || tx.ironwood.actions === 0,
      failing: failing.has("ironwood"),
    },
    {
      id: "fee",
      title: "Fee",
      subtitle: feeZat !== null ? formatZec(feeZat) : inputsPending ? "fetching input values…" : "needs input values",
      empty: false,
      failing: failing.has("fee"),
    },
  ];
}

export interface PoolFlow {
  id: (typeof POOL_IDS)[number] | "fee";
  label: string;
  field: string;
  valueZat: number | null;
  note: string;
}

export function poolFlows(tx: DecodedTx, inputValues: (number | null)[] | null, feeZat: number | null, inputsPending: boolean): PoolFlow[] {
  const outputsZat = tx.transparent.outputs.reduce((sum, output) => sum + output.valueZat, 0);
  const knownInputs = inputValues && inputValues.length === tx.transparent.inputs.length && inputValues.every((value) => value !== null);
  const inputsZat = knownInputs ? (inputValues as number[]).reduce((sum, value) => sum + value, 0) : null;
  const transparentBalance = tx.transparent.inputs.length === 0 ? -outputsZat : inputsZat === null ? null : inputsZat - outputsZat;
  return [
    {
      id: "transparent",
      label: "Transparent (public)",
      field: "transparent inputs − outputs",
      valueZat: transparentBalance,
      note:
        transparentBalance === null
          ? inputsPending
            ? "fetching input values…"
            : `outputs ${formatZec(outputsZat)}, input values unknown`
          : "no net change",
    },
    { id: "sapling", label: "Sapling (shielded)", field: "valueBalanceSapling", valueZat: tx.sapling?.valueBalanceZat ?? 0, note: "no net change" },
    { id: "orchard", label: "Orchard (shielded)", field: "valueBalanceOrchard", valueZat: tx.orchard?.valueBalanceZat ?? 0, note: "no net change" },
    { id: "ironwood", label: "Ironwood (new pool)", field: "valueBalanceIronwood", valueZat: tx.ironwood?.valueBalanceZat ?? 0, note: "no net change" },
    {
      id: "fee",
      label: "Fee",
      field: "sum of all pool balances",
      valueZat: feeZat,
      note: feeZat !== null ? "paid to the miner" : inputsPending ? "fetching input values…" : "needs transparent input values",
    },
  ];
}

export function describeFlags(flags: { spendsEnabled: boolean; outputsEnabled: boolean; crossAddressEnabled: boolean | null; reservedBitsZero: boolean }) {
  const parts = [
    `spends ${flags.spendsEnabled ? "on" : "off"}`,
    `outputs ${flags.outputsEnabled ? "on" : "off"}`,
  ];
  if (flags.crossAddressEnabled !== null) parts.push(`cross-address ${flags.crossAddressEnabled ? "on" : "off"}`);
  parts.push(flags.reservedBitsZero ? "reserved bits zero" : "reserved bits set");
  return parts.join(" · ");
}

export function proofSummary(proofBytes: number, canonical: number) {
  return `${formatInt(proofBytes)} B (canonical ${formatInt(canonical)} B)`;
}
