import type { Check } from "@contract/types";
import { formatZec } from "./format";

export const FEE_UNAVAILABLE = "input values unavailable";

export const FEE_UNAVAILABLE_WHY =
  "The fee is the value of the spent transparent outputs minus what this transaction pays out. Those input values are not inside the transaction, and the indexer did not return them (Zebra's built-in lightwalletd server omits transparent vin/vout, Zebra #11238), so Luora shows no number rather than a wrong one.";

export const FEE_PENDING = "fetching input values…";

export const ZIP2009_MARGINAL_FEE_ZAT = 1_000;
export const ZIP317_GRACE_ACTIONS = 2;

export interface FeeLabel {
  text: string;
  known: boolean;
  why: string | null;
}

export function feeLabel(feeZat: number | null, inputsPending: boolean, coinbase = false): FeeLabel {
  if (coinbase) return { text: "none (coinbase)", known: true, why: null };
  if (feeZat !== null) return { text: formatZec(feeZat), known: true, why: null };
  if (inputsPending) return { text: FEE_PENDING, known: false, why: null };
  return { text: FEE_UNAVAILABLE, known: false, why: FEE_UNAVAILABLE_WHY };
}

export function zip2009FeeZat(logicalActions: number): number {
  return ZIP2009_MARGINAL_FEE_ZAT * Math.max(ZIP317_GRACE_ACTIONS, logicalActions);
}

export function withHonestFee(checks: Check[], feeZat: number | null): Check[] {
  if (feeZat !== null) return checks;
  return checks.map((check) =>
    check.id === "zip317-fee" && check.status === "na" && !/coinbase/i.test(check.detail)
      ? { ...check, title: `${check.title} (${FEE_UNAVAILABLE})`, detail: `${check.detail} ${FEE_UNAVAILABLE_WHY}` }
      : check,
  );
}
