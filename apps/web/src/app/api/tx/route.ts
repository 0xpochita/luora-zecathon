import { jsonError, jsonOk } from "../../../server/api-error";
import { endpointLabel, getTransaction } from "../../../server/indexer";
import { readTxRequest } from "../../../server/txid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { txid, network } = await readTxRequest(request);
    const { raw, height, mempool } = await getTransaction(network, txid);
    return jsonOk({ txid, hex: raw.toString("hex"), height, mempool, endpoint: endpointLabel(network) });
  } catch (error) {
    return jsonError(error);
  }
}
