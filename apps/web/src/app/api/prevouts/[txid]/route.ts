import { ApiError, jsonError, jsonOk } from "../../../../server/api-error";
import { getTransaction } from "../../../../server/indexer";
import { parseNetwork } from "../../../../server/networks";
import { prevoutValues } from "../../../../server/prevouts";
import { isTxid } from "../../../../server/txid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ txid: string }> }) {
  try {
    const { txid } = await context.params;
    if (!isTxid(txid)) throw new ApiError("bad_request", "txid must be 64 hex characters");
    const network = parseNetwork(new URL(request.url).searchParams.get("network"));
    const { raw } = await getTransaction(network, txid);
    let values: (number | null)[];
    try {
      values = await prevoutValues(network, raw);
    } catch {
      throw new ApiError("parse_error", "the transaction's transparent inputs could not be read");
    }
    return jsonOk({ values });
  } catch (error) {
    return jsonError(error);
  }
}
