const ZATOSHI_PER_ZEC = 100_000_000n;

export function formatZec(zat: number, signed = false): string {
  const value = BigInt(Math.trunc(zat));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / ZATOSHI_PER_ZEC;
  const fraction = (abs % ZATOSHI_PER_ZEC).toString().padStart(8, "0").replace(/0+$/, "");
  const body = `${whole.toLocaleString("en-US")}${fraction ? "." + fraction : ""}`;
  const sign = negative ? "−" : signed && value > 0n ? "+" : "";
  return `${sign}${body} ZEC`;
}

export function formatZat(zat: number): string {
  return `${zat.toLocaleString("en-US")} zat`;
}

export function formatInt(value: number): string {
  return value.toLocaleString("en-US");
}

export function shortHash(hash: string, head = 8, tail = 6): string {
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export const NETWORK_LABEL = { main: "Mainnet", test: "Testnet", regtest: "Regtest" } as const;

export function zipUrl(zipNumber: number): string {
  return `https://zips.z.cash/zip-${String(zipNumber).padStart(4, "0")}`;
}
