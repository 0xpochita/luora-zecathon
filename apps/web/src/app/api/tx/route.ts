import { jsonError, jsonOk } from "../../../server/api-error";
import { endpointLabel, getTransaction } from "../../../server/indexer";
import { readTxRequest } from "../../../server/txid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { txid, network } = await readTxRequest(request);
    const { raw, height } = await getTransaction(network, txid);
    return jsonOk({ txid, hex: raw.toString("hex"), height, endpoint: endpointLabel(network) });
  } catch (error) {
    return jsonError(error);
  }
}
