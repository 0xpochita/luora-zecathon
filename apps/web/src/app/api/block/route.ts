import { jsonError, jsonOk } from "../../../server/api-error";
import { lookupBlock, readBlockRequest } from "../../../server/block";
import { endpointLabel } from "../../../server/indexer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { ref, network } = await readBlockRequest(request);
    const block = await lookupBlock(network, ref);
    return jsonOk({ ...block, endpoint: endpointLabel(network) });
  } catch (error) {
    return jsonError(error);
  }
}
