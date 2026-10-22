import type { Network } from "../../../../contract/types";
import { ApiError } from "./api-error";
import { compactTxid, getBlock, getTreeStateByHash, type CompactBlock } from "./indexer";
import { parseNetwork } from "./networks";
import { internalBytesToDisplayTxid } from "./txid";

export type BlockRef = { height: number } | { hash: string };

export interface BlockTxSummary {
  index: number;
  txid: string;
  coinbase: boolean;
  transparentInputs: number;
  transparentOutputs: number;
  saplingSpends: number;
  saplingOutputs: number;
  orchardActions: number;
  ironwoodActions: number;
}

export interface BlockView {
  network: Network;
  height: number;
  hash: string;
  prevHash: string | null;
  time: number | null;
  txs: BlockTxSummary[];
}

export interface BlockFetchers {
  block: (network: Network, height: number) => Promise<CompactBlock>;
  hashHeight: (network: Network, hash: string) => Promise<number>;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const HEIGHT_PATTERN = /^[1-9]\d{0,9}$/;

export function parseBlockRef(value: string): BlockRef | null {
  const lower = value.toLowerCase();
  if (HASH_PATTERN.test(lower)) return { hash: lower };
  if (!HEIGHT_PATTERN.test(value)) return null;
  const height = Number(value);
  return Number.isSafeInteger(height) && height <= 0xffffffff ? { height } : null;
}

export async function readBlockRequest(request: Request): Promise<{ ref: BlockRef; network: Network }> {
  const body: unknown = await request.json().catch(() => null);
  const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const ref = typeof fields.block === "string" ? parseBlockRef(fields.block) : null;
  if (!ref) throw new ApiError("bad_request", "block must be a 64-hex block hash or a height from 1");
  const network = parseNetwork(typeof fields.network === "string" ? fields.network : null);
  return { ref, network };
}

function displayHash(bytes: Uint8Array): string | null {
  return bytes.length === 32 ? internalBytesToDisplayTxid(bytes) : null;
}

export function summarizeBlock(block: CompactBlock, network: Network): BlockView {
  return {
    network,
    height: Number(block.height),
    hash: displayHash(block.hash) ?? "",
    prevHash: displayHash(block.prevHash),
    time: block.time > 0 ? block.time : null,
    txs: block.vtx.map((tx) => ({
      index: Number(tx.index),
      txid: compactTxid(tx),
      coinbase: Number(tx.index) === 0,
      transparentInputs: tx.vin.length,
      transparentOutputs: tx.vout.length,
      saplingSpends: tx.spends.length,
      saplingOutputs: tx.outputs.length,
      orchardActions: tx.actions.length,
      ironwoodActions: tx.ironwoodActions.length,
    })),
  };
}

const NOT_FOUND = "no block with this hash or height on this network";

const liveFetchers: BlockFetchers = {
  block: getBlock,
  hashHeight: async (network, hash) => Number((await getTreeStateByHash(network, hash)).height),
};

export async function lookupBlock(network: Network, ref: BlockRef, fetchers: BlockFetchers = liveFetchers): Promise<BlockView> {
  try {
    const height = "height" in ref ? ref.height : await fetchers.hashHeight(network, ref.hash);
    if (!Number.isSafeInteger(height) || height <= 0) throw new ApiError("not_found", NOT_FOUND);
    const view = summarizeBlock(await fetchers.block(network, height), network);
    if (view.height !== height || ("hash" in ref && view.hash !== ref.hash)) throw new ApiError("not_found", NOT_FOUND);
    return view;
  } catch (error) {
    if (error instanceof ApiError && error.code === "bad_request") throw new ApiError("not_found", NOT_FOUND);
    throw error;
  }
}
