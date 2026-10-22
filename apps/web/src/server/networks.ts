import type { Network } from "../../../../contract/types";
import { ApiError } from "./api-error";

export interface IndexerEndpoint {
  network: Network;
  target: string;
  tls: boolean;
  label: string;
}

const DEFAULT_TARGETS: Record<Network, string | undefined> = {
  main: "zec.rocks:443",
  test: "testnet.zec.rocks:443",
  regtest: undefined,
};

const ENV_OVERRIDES: Record<Network, string> = {
  main: "INDEXER_MAIN",
  test: "INDEXER_TEST",
  regtest: "INDEXER_REGTEST",
};

export function regtestAllowed(): boolean {
  return process.env.ALLOW_REGTEST === "1";
}

export function parseNetwork(value: string | null): Network {
  const network = value ?? "main";
  if (network === "main" || network === "test") return network;
  if (network === "regtest") {
    if (regtestAllowed()) return network;
    throw new ApiError("network_disabled", "regtest is only available locally with ALLOW_REGTEST=1");
  }
  throw new ApiError("bad_request", "network must be main or test");
}

export function endpointFromSetting(network: Network, setting: string): IndexerEndpoint {
  const plaintext = setting.startsWith("http://");
  const target = setting.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return { network, target, tls: !plaintext, label: target };
}

export function indexerEndpoint(network: Network): IndexerEndpoint {
  const setting = process.env[ENV_OVERRIDES[network]] || DEFAULT_TARGETS[network];
  if (!setting) {
    throw new ApiError("network_disabled", `no indexer configured for ${network}; set ${ENV_OVERRIDES[network]}`);
  }
  return endpointFromSetting(network, setting);
}

const COMPARE_TARGETS: Record<"main" | "test", [string, string][]> = {
  main: [
    ["zec.rocks:443", "zec.rocks"],
    ["na.zec.rocks:443", "zec.rocks NA"],
    ["eu.zec.rocks:443", "zec.rocks EU"],
    ["sa.zec.rocks:443", "zec.rocks SA"],
    ["ap.zec.rocks:443", "zec.rocks AP"],
    ["eu.zec.stardust.rest:443", "stardust EU"],
    ["us.zec.stardust.rest:443", "stardust US"],
    ["lightwalletd.mainnet.cipherscan.app:443", "CipherScan"],
    ["mainnet.zainod.zingolabs.dev:443", "Zingo Labs Zaino"],
    ["mainnet.lightwalletd-rs-beta.zecdev.org:443", "ZecDev lightwalletd-rs"],
    ["zcash.mysideoftheweb.com:9067", "mysideoftheweb"],
  ],
  test: [
    ["testnet.zec.rocks:443", "zec.rocks testnet"],
    ["testnet.lightwalletd-rs-beta.zecdev.org:443", "ZecDev lightwalletd-rs testnet"],
  ],
};

export function compareEndpoints(network: Network): IndexerEndpoint[] {
  if (network === "regtest") throw new ApiError("network_disabled", "the backend comparison covers main and test only");
  return COMPARE_TARGETS[network].map(([target, label]) => ({ network, target, tls: true, label }));
}
