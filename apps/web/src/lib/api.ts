import type { Network, Sample, ZebraErrorEntry } from "@contract/types";

export interface ChainInfo {
  network: Network;
  height: number;
  branchId: string;
  upgrade: string;
  endpoint: string;
  fetchedAt: string;
}

export interface TxLookup {
  txid: string;
  hex: string;
  height: number | null;
  endpoint: string;
}

export interface PrevoutValues {
  values: (number | null)[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { signal, cache: "no-store" });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("Network error: the server route could not be reached.", 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body && typeof body.error === "string" ? body.error : body && typeof body.message === "string" ? body.message : null;
    throw new ApiError(detail ?? (response.status === 404 ? "Not found." : `Request failed with HTTP ${response.status}.`), response.status);
  }
  return response.json() as Promise<T>;
}

function listFrom<T>(body: unknown, key: string): T[] {
  if (Array.isArray(body)) return body as T[];
  const nested = body && typeof body === "object" ? (body as Record<string, unknown>)[key] : null;
  if (Array.isArray(nested)) return nested as T[];
  throw new ApiError(`Unexpected response shape: expected a list of ${key}.`, 200);
}

export const api = {
  chain: (network: Network, signal?: AbortSignal) => getJson<ChainInfo>(`/api/chain?network=${network}`, signal),
  tx: (txid: string, network: Network, signal?: AbortSignal) => getJson<TxLookup>(`/api/tx/${txid}?network=${network}`, signal),
  prevouts: (txid: string, network: Network, signal?: AbortSignal) =>
    getJson<PrevoutValues>(`/api/prevouts/${txid}?network=${network}`, signal),
  samples: (signal?: AbortSignal) => getJson<unknown>("/api/samples", signal).then((body) => listFrom<Sample>(body, "samples")),
  zebraErrors: (signal?: AbortSignal) =>
    getJson<unknown>("/api/zebra-errors", signal).then((body) => listFrom<ZebraErrorEntry>(body, "errors")),
};

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
