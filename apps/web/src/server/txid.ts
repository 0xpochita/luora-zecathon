import type { Network } from "../../../../contract/types";
import { ApiError } from "./api-error";
import { parseNetwork } from "./networks";

const TXID_PATTERN = /^[0-9a-fA-F]{64}$/;

export function isTxid(value: string): boolean {
  return TXID_PATTERN.test(value);
}

export function displayTxidToInternalBytes(txid: string): Buffer {
  if (!isTxid(txid)) throw new Error("txid must be 64 hex characters");
  return Buffer.from(txid, "hex").reverse();
}

export function internalBytesToDisplayTxid(bytes: Uint8Array): string {
  return Buffer.from(bytes).reverse().toString("hex");
}

export async function readTxRequest(request: Request): Promise<{ txid: string; network: Network }> {
  const body: unknown = await request.json().catch(() => null);
  const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const txid = typeof fields.txid === "string" ? fields.txid : "";
  if (!isTxid(txid)) throw new ApiError("bad_request", "txid must be 64 hex characters");
  const network = parseNetwork(typeof fields.network === "string" ? fields.network : null);
  return { txid: txid.toLowerCase(), network };
}
