import type { Network } from "@contract/types";
import { compareBackends, type Comparison } from "../../../../lib/diverge";
import { jsonError, jsonOk } from "../../../../server/api-error";
import { backendSource } from "../../../../server/indexer";
import { compareEndpoints, parseNetwork } from "../../../../server/networks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEOUT_MS = 5_000;
const REUSE_MS = 20_000;

const recent = new Map<Network, { at: number; result: Promise<Comparison & { fetchedAt: string }> }>();

function compare(network: Network) {
  const cached = recent.get(network);
  if (cached && Date.now() - cached.at < REUSE_MS) return cached.result;
  const sources = compareEndpoints(network).map((endpoint) => backendSource(endpoint, TIMEOUT_MS));
  const result = compareBackends(sources, { chain: network }).then((comparison) => ({
    ...comparison,
    fetchedAt: new Date().toISOString(),
  }));
  recent.set(network, { at: Date.now(), result });
  result.catch(() => recent.delete(network));
  return result;
}

export async function GET(request: Request) {
  try {
    const network = parseNetwork(new URL(request.url).searchParams.get("network"));
    const comparison = await compare(network);
    return jsonOk(
      { network, ...comparison, targets: Object.fromEntries(compareEndpoints(network).map((each) => [each.label, each.target])) },
      { "Cache-Control": "public, max-age=15, s-maxage=20" },
    );
  } catch (error) {
    return jsonError(error);
  }
}
