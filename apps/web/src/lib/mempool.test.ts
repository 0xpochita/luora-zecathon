import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { LuoraZCore } from "../../../../contract/types";
import { expiryText, feeText, mempoolStatus, stuckReason } from "./mempool";
import { FEE_UNAVAILABLE, withHonestFee, zip2009FeeZat } from "./fee";

const wasmDir = path.join(__dirname, "../../public/wasm");
const observed = JSON.parse(readFileSync(path.join(__dirname, "fixtures/mempool-observed.json"), "utf8"));
const ironwood = "da9faafcd45c4876ab7cc17530892b31e446544efea834c0e7bda0570f17e3e5";
const transparent = "0b92afbc88df7b92f09095406c368b142e3e9cf1bf35c1a3997126394181e193";

let core: LuoraZCore;

beforeAll(async () => {
  const wasm = await import(path.join(wasmDir, "luora_z_core.js"));
  await wasm.default({ module_or_path: readFileSync(path.join(wasmDir, "luora_z_core_bg.wasm")) });
  core = wasm as unknown as LuoraZCore;
});

function statusFor(txid: string, tip: number, values: (number | null)[] = observed.transactions[txid].inputValuesZat) {
  const { hex } = observed.transactions[txid];
  const tx = core.decode_tx(hex, "main");
  const fee = core.fee_zat(hex, values);
  return mempoolStatus(tx, tip, fee, core.check_tx(hex, "main", tip + 1, values));
}

describe("mempool status of transactions seen in the zec.rocks mempool at tip 3,526,665", () => {
  it("counts the blocks left before the real expiry height and checks at tip + 1", () => {
    const status = statusFor(ironwood, observed.tip);
    expect(status).toMatchObject({ tip: 3_526_665, nextBlock: 3_526_666, expiryHeight: 3_526_706, blocksLeft: 41, expired: false });
    expect(expiryText(status)).toBe("Expires in 41 blocks: it must be mined by block 3,526,706 (tip 3,526,665).");
  });

  it("compares the fee with ZIP 317 and ZIP 2009", () => {
    const status = statusFor(ironwood, observed.tip);
    expect(status).toMatchObject({ feeZat: 10_000, zip317FeeZat: 10_000, zip2009FeeZat: 2_000, fee: "meets-zip317" });
    expect(feeText(status)).toBe("Fee 0.0001 ZEC meets the ZIP 317 conventional fee of 0.0001 ZEC.");
    expect(status.blockers).toEqual([]);
    expect(stuckReason(status)).toBe("Nothing in the rules keeps it out of block 3,526,666; it is waiting for a miner.");
  });

  it("is expired once the tip reaches nExpiryHeight (ZIP 203: block N + 1 is too late)", () => {
    expect(statusFor(ironwood, 3_526_705)).toMatchObject({ blocksLeft: 1, expired: false });
    const status = statusFor(ironwood, 3_526_706);
    expect(status).toMatchObject({ blocksLeft: 0, expired: true });
    expect(status.blockers.map((check) => [check.id, check.status])).toContainEqual(["expiry", "fail"]);
    expect(stuckReason(status)).toBe("It has expired and will not be mined.");
  });

  it("never expires with nExpiryHeight 0 and pays far above the conventional fee", () => {
    const status = statusFor(transparent, observed.tip);
    expect(status).toMatchObject({ expiryHeight: 0, blocksLeft: null, expired: false, feeZat: 280_000, zip317FeeZat: 20_000 });
    expect(expiryText(status)).toBe("Never expires (nExpiryHeight is 0).");
  });

  it("says input values unavailable instead of a fee when a prevout value is missing", () => {
    const values = [102705811284, null, 29406909968, 280000];
    const status = statusFor(transparent, observed.tip, values);
    expect(status).toMatchObject({ feeZat: null, fee: "unavailable" });
    expect(feeText(status)).toBe(`Fee: ${FEE_UNAVAILABLE}. ZIP 317 conventional fee 0.0002 ZEC, ZIP 2009 fee 0.00004 ZEC.`);
    const { hex } = observed.transactions[transparent];
    const fee = withHonestFee(core.check_tx(hex, "main", observed.tip + 1, values), null).find((check) => check.id === "zip317-fee")!;
    expect(fee.status).toBe("na");
    expect(fee.title).toContain(FEE_UNAVAILABLE);
    expect(fee.detail).toContain("Zebra #11238");
    expect(fee.detail).not.toMatch(/Fee paid is/);
  });

  it("uses a 1,000-zatoshi marginal fee with two grace actions for ZIP 2009", () => {
    expect(zip2009FeeZat(1)).toBe(2_000);
    expect(zip2009FeeZat(4)).toBe(4_000);
  });
});
