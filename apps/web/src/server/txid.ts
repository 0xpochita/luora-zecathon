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
