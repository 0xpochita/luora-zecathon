import type { Check, DecodedTx } from "@contract/types";
import { formatInt, formatZec } from "./format";
import { FEE_UNAVAILABLE, zip2009FeeZat } from "./fee";

export type MempoolFee = "meets-zip317" | "meets-zip2009-only" | "below-zip2009" | "unavailable";

export interface MempoolStatus {
  tip: number;
  nextBlock: number;
  expiryHeight: number;
  blocksLeft: number | null;
  expired: boolean;
  feeZat: number | null;
  zip317FeeZat: number;
  zip2009FeeZat: number;
  fee: MempoolFee;
  blockers: Check[];
}

export function mempoolStatus(tx: DecodedTx, tip: number, feeZat: number | null, checks: Check[]): MempoolStatus {
  const blocksLeft = tx.expiryHeight === 0 ? null : tx.expiryHeight - tip;
  const zip317 = tx.zip317.conventionalFeeZat;
  const zip2009 = zip2009FeeZat(tx.zip317.logicalActions);
  const fee: MempoolFee =
    feeZat === null ? "unavailable" : feeZat >= zip317 ? "meets-zip317" : feeZat >= zip2009 ? "meets-zip2009-only" : "below-zip2009";
  const order = { fail: 0, warn: 1, pass: 2, na: 3 } as const;
  return {
    tip,
    nextBlock: tip + 1,
    expiryHeight: tx.expiryHeight,
    blocksLeft,
    expired: blocksLeft !== null && blocksLeft < 1,
    feeZat,
    zip317FeeZat: zip317,
    zip2009FeeZat: zip2009,
    fee,
    blockers: checks.filter((check) => check.status === "fail" || check.status === "warn").sort((a, b) => order[a.status] - order[b.status]),
  };
}

export function expiryText(status: MempoolStatus): string {
  if (status.blocksLeft === null) return "Never expires (nExpiryHeight is 0).";
  if (status.expired)
    return `Expired: nExpiryHeight ${formatInt(status.expiryHeight)} is not above the tip ${formatInt(status.tip)}, so block ${formatInt(status.nextBlock)} is too late and nodes drop it.`;
  return `Expires in ${formatInt(status.blocksLeft)} block${status.blocksLeft === 1 ? "" : "s"}: it must be mined by block ${formatInt(status.expiryHeight)} (tip ${formatInt(status.tip)}).`;
}

export function feeText(status: MempoolStatus): string {
  const zip317 = formatZec(status.zip317FeeZat);
  const zip2009 = formatZec(status.zip2009FeeZat);
  if (status.feeZat === null) return `Fee: ${FEE_UNAVAILABLE}. ZIP 317 conventional fee ${zip317}, ZIP 2009 fee ${zip2009}.`;
  const paid = formatZec(status.feeZat);
  if (status.fee === "meets-zip317") return `Fee ${paid} meets the ZIP 317 conventional fee of ${zip317}.`;
  if (status.fee === "meets-zip2009-only")
    return `Fee ${paid} is below the ZIP 317 conventional fee of ${zip317} but meets the ZIP 2009 fee of ${zip2009}; Zebra 6.4 and later relay it, nodes still on the ZIP 317 rate (Zebra 6.3) may refuse it.`;
  return `Fee ${paid} is below even the ZIP 2009 fee of ${zip2009}; Zebra relays no transaction with unpaid actions (block_unpaid_action_limit is 0).`;
}

export function stuckReason(status: MempoolStatus): string {
  if (status.expired) return "It has expired and will not be mined.";
  const failing = status.blockers.filter((check) => check.status === "fail");
  if (failing.length > 0) return `A block at ${formatInt(status.nextBlock)} would reject it: ${failing.map((check) => check.title).join(", ")}.`;
  if (status.fee === "below-zip2009") return "The fee is too low for miners to pick it up.";
  if (status.fee === "meets-zip2009-only") return "The fee only meets the newer ZIP 2009 rate; nodes still on the ZIP 317 rate (Zebra 6.3) may refuse it.";
  return `Nothing in the rules keeps it out of block ${formatInt(status.nextBlock)}; it is waiting for a miner.`;
}
