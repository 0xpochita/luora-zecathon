import type { Check, DecodedTx } from "@contract/types";
import { poolFlows, POOL_IDS } from "./anatomy";
import { formatInt, formatZec } from "./format";
import type { Tone } from "@/components/ui";

type PoolId = (typeof POOL_IDS)[number];

export const POOL_PLAIN: Record<PoolId, string> = {
  transparent: "transparent (public)",
  sapling: "Sapling (shielded)",
  orchard: "Orchard (shielded)",
  ironwood: "Ironwood (new shielded pool)",
};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function usedPools(tx: DecodedTx): PoolId[] {
  return POOL_IDS.filter((id) => {
    if (id === "transparent") return tx.transparent.inputs.length + tx.transparent.outputs.length > 0;
    if (id === "sapling") return !!tx.sapling && tx.sapling.spends + tx.sapling.outputs > 0;
    const bundle = id === "orchard" ? tx.orchard : tx.ironwood;
    return !!bundle && bundle.actions > 0;
  });
}

export function describeMovement(tx: DecodedTx, inputValues: (number | null)[] | null, inputsPending: boolean): string {
  const outputsZat = tx.transparent.outputs.reduce((sum, output) => sum + output.valueZat, 0);
  if (tx.transparent.inputs.some((input) => input.isCoinbase)) {
    const outputs = tx.transparent.outputs.length;
    return `Coinbase: the block reward, ${formatZec(outputsZat)} paid to ${formatInt(outputs)} transparent output${outputs === 1 ? "" : "s"}.`;
  }
  const flows = poolFlows(tx, inputValues, null, inputsPending).filter((flow): flow is typeof flow & { id: PoolId } => flow.id !== "fee");
  const leaving = flows.filter((flow) => (flow.valueZat ?? 0) > 0).map((flow) => flow.id);
  const entering = flows.filter((flow) => (flow.valueZat ?? 0) < 0);
  const unknown = flows.some((flow) => flow.valueZat === null);
  if (entering.length > 0 && (leaving.length > 0 || unknown)) {
    const moved = entering.reduce((sum, flow) => sum - (flow.valueZat as number), 0);
    const from = leaving.length > 0 ? leaving.map((id) => POOL_PLAIN[id]) : ["transparent (public)"];
    return `Moved ${formatZec(moved)} from ${joinNames(from)} into ${joinNames(entering.map((flow) => POOL_PLAIN[flow.id]))}.`;
  }
  const pools = usedPools(tx);
  if (pools.length === 1 && pools[0] === "transparent") {
    const outputs = tx.transparent.outputs.length;
    return `Public transfer: ${formatZec(outputsZat)} to ${formatInt(outputs)} transparent output${outputs === 1 ? "" : "s"}.`;
  }
  if (pools.length === 0) return "No inputs or outputs in any pool.";
  return `Shielded transfer inside ${joinNames(pools.map((id) => POOL_PLAIN[id]))}; amounts and addresses stay encrypted.`;
}

export interface RulesSummary {
  tone: Tone;
  text: string;
  failing: Check[];
  warnings: Check[];
}

export function summarizeRules(checks: Check[], heightLabel: string): RulesSummary {
  const counted = checks.filter((check) => check.status !== "na");
  const failing = counted.filter((check) => check.status === "fail");
  const warnings = counted.filter((check) => check.status === "warn");
  const passed = counted.length - failing.length - warnings.length;
  if (failing.length > 0) {
    return {
      tone: "bad",
      text: `Invalid ${heightLabel}: ${failing.length} of ${counted.length} rules fail (${failing.map((check) => check.title).join(", ")}).`,
      failing,
      warnings,
    };
  }
  if (warnings.length > 0) {
    return {
      tone: "warn",
      text: `Valid ${heightLabel} with ${warnings.length} warning${warnings.length === 1 ? "" : "s"} (${passed} of ${counted.length} rules pass).`,
      failing,
      warnings,
    };
  }
  return { tone: "ok", text: `Valid ${heightLabel} (${passed} of ${counted.length} rules pass).`, failing, warnings };
}
