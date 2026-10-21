import { ApiError, jsonError, jsonOk } from "../../../server/api-error";
import { endpointLabel, getLightdInfo } from "../../../server/indexer";
import { parseNetwork } from "../../../server/networks";
import { upgradeAtHeight } from "../../../server/upgrades";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const network = parseNetwork(new URL(request.url).searchParams.get("network"));
    const info = await getLightdInfo(network);
    const height = Number(info.blockHeight);
    if (!Number.isSafeInteger(height) || height <= 0) {
      throw new ApiError("indexer_error", "the indexer reported no chain height");
    }
    return jsonOk(
      {
        network,
        height,
        branchId: `0x${info.consensusBranchId.toLowerCase()}`,
        upgrade: upgradeAtHeight(network, height)?.name ?? null,
        endpoint: endpointLabel(network),
        fetchedAt: new Date().toISOString(),
      },
      { "Cache-Control": "public, max-age=30, s-maxage=30" },
    );
  } catch (error) {
    return jsonError(error);
  }
}
