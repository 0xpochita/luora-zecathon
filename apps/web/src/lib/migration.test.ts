import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { LuoraZCore } from "../../../../contract/types";
import { migrationCheck, migrationVerdict } from "./migration";

const wasmDir = path.join(__dirname, "../../public/wasm");
const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(__dirname, `../../../../crates/core/tests/fixtures/${name}.json`), "utf8")) as {
    txid: string;
    height: number;
    hex: string;
  };

let core: LuoraZCore;

beforeAll(async () => {
  const wasm = await import(path.join(wasmDir, "luora_z_core.js"));
  await wasm.default({ module_or_path: readFileSync(path.join(wasmDir, "luora_z_core_bg.wasm")) });
  core = wasm as unknown as LuoraZCore;
});

describe("ZIP 318 labels on real mainnet transactions", () => {
  it("labels the 10 ZEC crossing at height 3,526,196 as Blends in", () => {
    const fx = fixture("v6-zip318-transfer");
    const view = core.zip318_tx(fx.hex, "main", fx.height);
    expect(view.classification).toBe("transfer");
    expect(migrationVerdict(view)?.label).toBe("Blends in");
    expect(migrationCheck(view)?.status).toBe("pass");
  });

  it("labels the 0.09775 ZEC crossing at height 3,524,451 as Fingerprintable", () => {
    const fx = fixture("v6-zip318-odd-amount");
    const view = core.zip318_tx(fx.hex, "main", fx.height);
    expect(migrationVerdict(view)).toMatchObject({ label: "Fingerprintable", tone: "bad" });
    const value = view.reasons.find((reason) => reason.field === "sole-destination-value");
    expect(value?.ok).toBe(false);
    expect(value?.detail).toContain("0.09775 ZEC");
  });

  it("leaves the 16-action preparation transaction at height 3,524,246 Unknown", () => {
    const fx = fixture("v6-zip318-preparation");
    expect(migrationVerdict(core.zip318_tx(fx.hex, "main", fx.height))?.label).toBe("Unknown");
  });

  it("shows no label for a transparent to Ironwood shielding", () => {
    const fx = fixture("v6-ironwood");
    const view = core.zip318_tx(fx.hex, "main", fx.height);
    expect(migrationVerdict(view)).toBeNull();
    expect(migrationCheck(view)).toBeNull();
  });
});

describe("NU7 readiness on real transactions", () => {
  it("fails the v4 transaction from height 1,000,000 at a hypothetical Mainnet NU7", () => {
    const fx = JSON.parse(readFileSync(path.join(__dirname, "../../../../crates/core/tests/fixtures/v4-transparent.json"), "utf8"));
    const run = core.check_tx_at_nu7(fx.hex, "main", 3_526_660, fx.transparentInputValuesZat);
    expect(run.hypothetical).toBe(true);
    expect(run.upgrade.name).toBe("NU7");
    expect(run.checks.find((check) => check.id === "version")?.status).toBe("fail");
  });
});
