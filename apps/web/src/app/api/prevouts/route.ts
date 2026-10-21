import { ApiError, jsonError, jsonOk } from "../../../server/api-error";
import { getTransaction } from "../../../server/indexer";
import { prevoutValues } from "../../../server/prevouts";
import { readTxRequest } from "../../../server/txid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { txid, network } = await readTxRequest(request);
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
