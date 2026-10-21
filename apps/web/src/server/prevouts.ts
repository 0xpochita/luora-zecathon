import type { Network } from "../../../../contract/types";
import { getTransaction } from "./indexer";
import { readTransparentBundle } from "./transparent";

export const MAX_PREVOUT_TRANSACTIONS = 100;
const PARALLEL_LOOKUPS = 6;

type TransactionFetcher = (network: Network, txid: string) => Promise<{ raw: Buffer }>;

async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function prevoutValues(
  network: Network,
  raw: Uint8Array,
  fetchTransaction: TransactionFetcher = getTransaction,
): Promise<(number | null)[]> {
  const { inputs } = readTransparentBundle(raw);
  const parentTxids = [...new Set(inputs.filter((input) => !input.isCoinbase).map((input) => input.prevTxid))].slice(
    0,
    MAX_PREVOUT_TRANSACTIONS,
  );

  const parentOutputs = new Map<string, number[] | null>();
  await mapLimited(parentTxids, PARALLEL_LOOKUPS, async (txid) => {
    try {
      const parent = await fetchTransaction(network, txid);
      parentOutputs.set(txid, readTransparentBundle(parent.raw).outputs.map((output) => output.valueZat));
    } catch {
      parentOutputs.set(txid, null);
    }
  });

  return inputs.map((input) => {
    if (input.isCoinbase) return null;
    return parentOutputs.get(input.prevTxid)?.[input.prevIndex] ?? null;
  });
}
