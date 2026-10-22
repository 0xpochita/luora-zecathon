import type { Network, Nu7Run } from "@contract/types";
import { formatInt } from "./format";

export function nu7Option(network: Network, tipHeight: number | null, result: { run: Nu7Run } | { error: string } | null) {
  if (network === "main" && tipHeight === null) return { label: "", disabledReason: "at NU7 (waiting for the live tip)", note: null };
  if (!result || "error" in result) return { label: "", disabledReason: "at NU7 (not scheduled on this network)", note: null };
  const { run } = result;
  if (!run.hypothetical) return { label: `at NU7 activation (${formatInt(run.height)})`, disabledReason: null, note: null };
  return {
    label: "at NU7 (no Mainnet height yet)",
    disabledReason: null,
    note: `NU7 has no Mainnet activation height yet (librustzcash #3171). These rules run as if NU7 activated at the next block, height ${formatInt(run.height)}, with the NU7 rules from zcash_protocol (branch ID ${run.upgrade.branchId}). Testnet runs NU7 from height 4,465,026.`,
  };
}
