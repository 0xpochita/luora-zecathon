import { writeFileSync } from "node:fs";
import { getTransaction, endpointLabel } from "../apps/web/src/server/indexer";
import { readTransparentBundle } from "../apps/web/src/server/transparent";
import { repoPath } from "./source-checkout";

const ROOT_TXIDS = ["30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c"];

async function main() {
  const fixtures: Record<string, { height: number | null; hex: string }> = {};
  const queue = [...ROOT_TXIDS];
  for (const [depth, txid] of queue.entries()) {
    const { raw, height } = await getTransaction("main", txid);
    fixtures[txid] = { height, hex: raw.toString("hex") };
    if (depth < ROOT_TXIDS.length) {
      for (const input of readTransparentBundle(raw).inputs) {
        if (!input.isCoinbase && !queue.includes(input.prevTxid)) queue.push(input.prevTxid);
      }
    }
  }
  const output = { network: "main", endpoint: endpointLabel("main"), fetchedAt: new Date().toISOString(), transactions: fixtures };
  writeFileSync(repoPath("apps/web/src/server/fixtures/mainnet-transactions.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(Object.entries(fixtures).map(([txid, tx]) => `${txid} h=${tx.height} v=${readTransparentBundle(Buffer.from(tx.hex, "hex")).version}`).join("\n"));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
