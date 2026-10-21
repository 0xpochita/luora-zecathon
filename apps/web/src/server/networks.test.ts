import { afterEach, describe, expect, it, vi } from "vitest";
import { endpointFromSetting, indexerEndpoint, parseNetwork } from "./networks";

afterEach(() => vi.unstubAllEnvs());

describe("network parameter", () => {
  it("defaults to main and accepts main and test", () => {
    expect(parseNetwork(null)).toBe("main");
    expect(parseNetwork("main")).toBe("main");
    expect(parseNetwork("test")).toBe("test");
  });

  it("rejects anything else, including URLs", () => {
    expect(() => parseNetwork("mainnet")).toThrow();
    expect(() => parseNetwork("https://example.invalid")).toThrow();
    expect(() => parseNetwork("")).toThrow();
  });

  it("allows regtest only with ALLOW_REGTEST=1", () => {
    vi.stubEnv("ALLOW_REGTEST", "");
    expect(() => parseNetwork("regtest")).toThrow(/ALLOW_REGTEST/);
    vi.stubEnv("ALLOW_REGTEST", "1");
    expect(parseNetwork("regtest")).toBe("regtest");
  });
});

describe("indexer endpoints", () => {
  it("uses the public zec.rocks endpoints over TLS by default", () => {
    vi.stubEnv("INDEXER_MAIN", "");
    vi.stubEnv("INDEXER_TEST", "");
    expect(indexerEndpoint("main")).toEqual({ network: "main", target: "zec.rocks:443", tls: true, label: "zec.rocks:443" });
    expect(indexerEndpoint("test").target).toBe("testnet.zec.rocks:443");
  });

  it("takes overrides only from the environment, plaintext only with http://", () => {
    vi.stubEnv("INDEXER_TEST", "http://localhost:8137");
    expect(indexerEndpoint("test")).toMatchObject({ target: "localhost:8137", tls: false });
    expect(endpointFromSetting("main", "https://zec.rocks:443/")).toMatchObject({ target: "zec.rocks:443", tls: true });
  });

  it("has no regtest endpoint unless one is configured", () => {
    vi.stubEnv("INDEXER_REGTEST", "");
    expect(() => indexerEndpoint("regtest")).toThrow(/INDEXER_REGTEST/);
  });
});
