import { writeFileSync } from "node:fs";
import type { Network, Sample } from "../contract/types";
import {
  type CompactBlock,
  type CompactTx,
  compactTxid,
  endpointLabel,
  getBlock,
  getBlockRange,
  getLightdInfo,
  getTransaction,
} from "../apps/web/src/server/indexer";
import { upgradeAtHeight } from "../apps/web/src/server/upgrades";
import { repoPath } from "./source-checkout";

const KNOWN_IRONWOOD_TXID = "30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c";
const KNOWN_IRONWOOD_HEIGHT = 3_495_600;
const BLOCKS_TO_SCAN = Number(process.env.SAMPLE_BLOCKS ?? 400);
const BATCH = 40;
const NU6_3_MAINNET_HEIGHT = 3_428_143;
const PRE_IRONWOOD_BLOCKS = 120;
const MAX_HEADER_LOOKUPS = 60;

interface Candidate {
  network: Network;
  height: number;
  tx: CompactTx;
  txid: string;
  pools: string[];
  size: number;
}

interface Header {
  version: number;
  branchId: string | null;
}

function pools(tx: CompactTx): string[] {
  const found: string[] = [];
  if (tx.vin.length > 0 || tx.vout.length > 0 || Number(tx.index) === 0) found.push("transparent");
  if (tx.spends.length > 0 || tx.outputs.length > 0) found.push("sapling");
  if (tx.actions.length > 0) found.push("orchard");
  if (tx.ironwoodActions.length > 0) found.push("ironwood");
  return found;
}

function shape(tx: CompactTx): number {
  return tx.vin.length + tx.vout.length + tx.spends.length + tx.outputs.length + tx.actions.length + tx.ironwoodActions.length;
}

function readHeader(raw: Buffer): Header {
  const header = raw.readUInt32LE(0);
  const version = header & 0x7fffffff;
  const branchId = version >= 5 ? `0x${raw.readUInt32LE(8).toString(16).padStart(8, "0")}` : null;
  return { version, branchId };
}

async function scan(network: Network, tip: number, blocks: number): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (let end = tip; end > tip - blocks; end -= BATCH) {
    const start = Math.max(end - BATCH + 1, tip - blocks + 1);
    const range: CompactBlock[] = await getBlockRange(network, start, end);
    for (const block of range) {
      for (const tx of block.vtx) {
        candidates.push({ network, height: Number(block.height), tx, txid: compactTxid(tx), pools: pools(tx), size: shape(tx) });
      }
    }
  }
  return candidates;
}

function pick(candidates: Candidate[], test: (candidate: Candidate) => boolean): Candidate | undefined {
  return candidates
    .filter(test)
    .sort((left, right) => left.size - right.size || right.height - left.height)[0];
}

function only(candidate: Candidate, ...wanted: string[]): boolean {
  return candidate.pools.length === wanted.length && wanted.every((pool) => candidate.pools.includes(pool));
}

async function describe(candidate: Candidate, label: string, why: (header: Header, tx: CompactTx) => string): Promise<Sample> {
  const { raw, height } = await getTransaction(candidate.network, candidate.txid);
  const header = readHeader(raw);
  if (height !== candidate.height) throw new Error(`${candidate.txid}: indexer says height ${height}, block scan says ${candidate.height}`);
  const upgrade = upgradeAtHeight(candidate.network, candidate.height);
  if (header.branchId && upgrade?.branchId && header.branchId !== upgrade.branchId) {
    throw new Error(`${candidate.txid}: branch ${header.branchId} differs from ${upgrade.name} ${upgrade.branchId}`);
  }
  return {
    label,
    network: candidate.network,
    txid: candidate.txid,
    height: candidate.height,
    why: why(header, candidate.tx),
    pools: candidate.pools,
  };
}

async function findVersion(candidates: Candidate[], version: number): Promise<Candidate | undefined> {
  const ordered = candidates
    .filter((candidate) => Number(candidate.tx.index) !== 0)
    .sort((left, right) => left.size - right.size || right.height - left.height)
    .slice(0, MAX_HEADER_LOOKUPS);
  for (const candidate of ordered) {
    const { raw } = await getTransaction(candidate.network, candidate.txid);
    if (readHeader(raw).version === version) return candidate;
  }
  return undefined;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

async function main() {
  const samples: Sample[] = [];
  const missing: string[] = [];

  const knownBlock = await getBlock("main", KNOWN_IRONWOOD_HEIGHT);
  const knownTx = knownBlock.vtx.find((tx) => compactTxid(tx) === KNOWN_IRONWOOD_TXID);
  if (!knownTx) throw new Error("the known Ironwood transaction is not in its block");
  samples.push(
    await describe(
      { network: "main", height: KNOWN_IRONWOOD_HEIGHT, tx: knownTx, txid: KNOWN_IRONWOOD_TXID, pools: pools(knownTx), size: shape(knownTx) },
      "v6 Ironwood transfer",
      (header, tx) =>
        `Version ${header.version} transaction (ZIP 229) with ${count(tx.ironwoodActions.length, "Ironwood action")} and ${count(tx.vin.length, "transparent input")}; tools written before NU6.3 show transfers like this as 0.0 ZEC (lifinance/data-types #281).`,
    ),
  );

  const mainTip = Number((await getLightdInfo("main")).blockHeight);
  const main = await scan("main", mainTip, BLOCKS_TO_SCAN);
  const mainNonCoinbase = main.filter((candidate) => Number(candidate.tx.index) !== 0);

  const migration = pick(mainNonCoinbase, (candidate) => candidate.pools.includes("orchard") && candidate.pools.includes("ironwood"));
  if (migration) {
    samples.push(
      await describe(migration, "Orchard and Ironwood in one transaction", (header, tx) =>
        `Version ${header.version} transaction with ${count(tx.actions.length, "Orchard action")} and ${count(tx.ironwoodActions.length, "Ironwood action")}, the shape a move from Orchard to Ironwood takes; from NU6.3 value may leave Orchard but not enter it, so valueBalanceOrchard must be zero or positive (ZIP 258).`,
      ),
    );
  } else missing.push("Orchard and Ironwood in one transaction");

  const orchardOut = pick(mainNonCoinbase, (candidate) => only(candidate, "orchard", "transparent") || only(candidate, "orchard"));
  if (orchardOut) {
    samples.push(
      await describe(orchardOut, "Orchard after NU6.3", (header, tx) =>
        `Version ${header.version} transaction with ${count(tx.actions.length, "Orchard action")} and ${count(tx.vout.length, "transparent output")}; after NU6.3 Orchard may only send value out through the turnstile, never receive new value.`,
      ),
    );
  } else missing.push("Orchard after NU6.3");

  const sapling = pick(mainNonCoinbase, (candidate) => only(candidate, "sapling"));
  if (sapling) {
    samples.push(
      await describe(sapling, "Sapling shielded transfer", (header, tx) =>
        `Version ${header.version} transaction that only uses the Sapling pool (${count(tx.spends.length, "spend")}, ${count(tx.outputs.length, "output")}); amounts and addresses stay encrypted, only nullifiers, commitments and the value balance are public.`,
      ),
    );
  } else missing.push("Sapling shielded transfer");

  const transparent = pick(mainNonCoinbase, (candidate) => only(candidate, "transparent") && candidate.tx.vin.length > 0);
  if (transparent) {
    samples.push(
      await describe(transparent, "Transparent only", (header, tx) =>
        `Version ${header.version} transaction with ${count(tx.vin.length, "transparent input")} and ${count(tx.vout.length, "output")} and no shielded data; the fee needs the spent output values, which the inspector fetches as prevouts.`,
      ),
    );
  } else missing.push("Transparent only");

  const coinbase = pick(main, (candidate) => Number(candidate.tx.index) === 0);
  if (coinbase) {
    samples.push(
      await describe(coinbase, "Coinbase", (header, tx) =>
        `Version ${header.version} coinbase transaction with ${count(tx.vout.length, "transparent output")}${tx.ironwoodActions.length ? ` and ${count(tx.ironwoodActions.length, "Ironwood action")}` : ""}; it has no real inputs, and from NU6.3 it must not contain Orchard actions.`,
      ),
    );
  } else missing.push("Coinbase");

  const beforeIronwood = await scan("main", NU6_3_MAINNET_HEIGHT - 1, PRE_IRONWOOD_BLOCKS);
  const v5Sapling = await findVersion(beforeIronwood.filter((candidate) => only(candidate, "sapling")), 5);
  if (v5Sapling) {
    samples.push(
      await describe(v5Sapling, "v5 Sapling before Ironwood", (header, tx) =>
        `Version ${header.version} Sapling transaction (ZIP 225) from the last blocks of NU6.2, branch ID ${header.branchId}; ${count(tx.spends.length, "spend")}, ${count(tx.outputs.length, "output")}. Checking it at a height after 3,428,143 shows why a branch ID must match the upgrade.`,
      ),
    );
  } else missing.push("v5 Sapling before Ironwood");

  const v5Orchard = await findVersion(beforeIronwood.filter((candidate) => candidate.pools.includes("orchard")), 5);
  if (v5Orchard) {
    samples.push(
      await describe(v5Orchard, "v5 Orchard before Ironwood", (header, tx) =>
        `Version ${header.version} transaction with ${count(tx.actions.length, "Orchard action")} from the last blocks of NU6.2 (branch ID ${header.branchId}), mined just before NU6.3; compare its Orchard rules with the post-NU6.3 Orchard sample.`,
      ),
    );
  } else missing.push("v5 Orchard before Ironwood");

  const testTip = Number((await getLightdInfo("test")).blockHeight);
  const test = await scan("test", testTip, Math.min(BLOCKS_TO_SCAN, 400));
  const testUpgrade = upgradeAtHeight("test", testTip);
  const testShielded = pick(
    test.filter((candidate) => Number(candidate.tx.index) !== 0),
    (candidate) => candidate.pools.some((pool) => pool !== "transparent"),
  ) ?? pick(test.filter((candidate) => Number(candidate.tx.index) !== 0), () => true);
  if (testShielded && testUpgrade?.name === "NU7") {
    samples.push(
      await describe(testShielded, "Testnet after NU7", (header, tx) =>
        `Version ${header.version} testnet transaction mined after NU7 activated at 4,465,026, so it carries branch ID ${header.branchId} (ZIP 259); pools used: ${pools(tx).join(", ")}.`,
      ),
    );
  } else missing.push("Testnet after NU7");

  writeFileSync(repoPath("data", "samples.json"), `${JSON.stringify(samples, null, 2)}\n`);
  console.log(
    `wrote ${samples.length} samples from ${endpointLabel("main")} (tip ${mainTip}, ${BLOCKS_TO_SCAN} blocks) and ${endpointLabel("test")} (tip ${testTip})`,
  );
  if (missing.length > 0) console.log(`no transaction found for: ${missing.join(", ")}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
