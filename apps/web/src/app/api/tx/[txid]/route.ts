import { ApiError, jsonError, jsonOk } from "../../../../server/api-error";
import { endpointLabel, getTransaction } from "../../../../server/indexer";
import { parseNetwork } from "../../../../server/networks";
import { isTxid } from "../../../../server/txid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ txid: string }> }) {
  try {
    const { txid } = await context.params;
    if (!isTxid(txid)) throw new ApiError("bad_request", "txid must be 64 hex characters");
    const network = parseNetwork(new URL(request.url).searchParams.get("network"));
    const { raw, height } = await getTransaction(network, txid);
    return jsonOk({ txid: txid.toLowerCase(), hex: raw.toString("hex"), height, endpoint: endpointLabel(network) });
  } catch (error) {
    return jsonError(error);
  }
}
