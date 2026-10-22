import { describe, expect, it } from "vitest";
import { classifyInput } from "./input";
import { STALL_CHIPS } from "./samples";
import { diagnoseStall, looksLikeNodeOutput } from "./stall";

const SPAN = '{zebrad="c76a867" net="Main"}';

function log(time: string, level: string, message: string): string {
  return `2026-10-20T${time}.123456Z ${level.padStart(5)} ${SPAN}: zebrad::components::sync: ${message}`;
}

function progress(time: string, height: number, percent = "99.753"): string {
  return log(
    time,
    "INFO",
    `estimated progress to chain tip sync_percent=${percent}% current_height=Height(${height}) network_upgrade=Nu6_1 remaining_sync_blocks=10928 time_since_last_state_block=2m 35s`,
  );
}

function status(text: string, id: string) {
  return diagnoseStall(text).checks.find((check) => check.id === id)?.status;
}

describe("Stall Doctor routing", () => {
  it("sends multi-line logs, metrics and getblockchaininfo to the Stall Doctor", () => {
    expect(classifyInput([progress("10:00:00", 1), progress("10:05:00", 2)].join("\n")).kind).toBe("stall");
    expect(classifyInput("# TYPE zcash_net_peers gauge\nzcash_net_peers 3").kind).toBe("stall");
    expect(classifyInput('{"result":{"chain":"main","blocks":3524180,"bestblockhash":"00"},"id":1}').kind).toBe("stall");
    expect(classifyInput(["Oct 20 10:00:00 host zebrad[42]: " + progress("10:00:00", 1), "Oct 20 10:05:00 host zebrad[42]: " + progress("10:05:00", 2)].join("\n")).kind).toBe("stall");
    for (const chip of STALL_CHIPS) expect(classifyInput(chip.text).kind).toBe("stall");
  });

  it("keeps a single error sentence or log line in the Why-rejected catalog", () => {
    expect(classifyInput("state must contain parent block to do contextual validation").kind).toBe("error");
    expect(classifyInput(log("10:00:00", "WARN", "error downloading and verifying block")).kind).toBe("error");
    expect(looksLikeNodeOutput("transaction uses an incorrect consensus branch id\nsecond line")).toBe(false);
  });
});

describe("diagnoseStall", () => {
  it("builds the height timeline with restart, timeout and warning markers", () => {
    const report = diagnoseStall(
      [
        progress("10:00:00", 4417801),
        log("10:01:00", "WARN", "error downloading and verifying block e=ValidationRequestError { error: Elapsed(()) }"),
        "2026-10-20T10:02:00.000Z  INFO zebrad::commands::start: Starting zebrad",
        log("10:03:00", "WARN", "something else"),
        log("10:03:30", "ERROR", "boom"),
        progress("10:04:00", 4417933),
      ].join("\n"),
    );
    expect(report.points.map((point) => point.height)).toEqual([4417801, 4417933]);
    expect(report.points[0]).toMatchObject({ percent: 99.753, remaining: 10928, sinceLastBlock: "2m 35s" });
    expect(report.points[1].at! - report.points[0].at!).toBe(4 * 60 * 1000);
    expect(report.markers.map((marker) => marker.kind)).toEqual(["timeout", "restart", "warn", "error"]);
  });

  it("flags repeated parent-block refusals and a full fork set (#11133)", () => {
    const line = log("10:00:00", "WARN", "state must contain parent block to do contextual validation");
    expect(status([line, line].join("\n"), "parent-missing")).toBe("warn");
    expect(status([line, line, line].join("\n"), "parent-missing")).toBe("fail");
    expect(status([line, "state_memory_chain_count 10"].join("\n"), "parent-missing")).toBe("fail");
    expect(status("NotReadyToBeCommitted\nNotReadyToBeCommitted\nNotReadyToBeCommitted", "parent-missing")).toBe("fail");
    expect(status(progress("10:00:00", 1), "parent-missing")).toBe("pass");
  });

  it("flags hashes queued behind the tip after a verify timeout (#11509)", () => {
    const timeout = log("10:00:00", "WARN", "error downloading and verifying block e=Elapsed(())");
    const behind = log("10:01:00", "INFO", "temporary error obtaining tips: queued download of hash behind our chain tip");
    expect(status([timeout, behind].join("\n"), "behind-tip")).toBe("fail");
    expect(status([behind, timeout].join("\n"), "behind-tip")).toBe("warn");
  });

  it("flags verify timeouts with refused requests near the tip (#11610)", () => {
    const timeout = log("10:00:00", "WARN", "error downloading and verifying block e=ValidationRequestError { error: Elapsed(()) }");
    const refused = log("09:59:00", "DEBUG", "no peer that might have the inventory can take the request, failing request");
    expect(status([refused, timeout].join("\n"), "verify-timeout-near-tip")).toBe("fail");
    expect(status([timeout, "zcash_net_peer_set_inventory_refusal_total 4"].join("\n"), "verify-timeout-near-tip")).toBe("fail");
    expect(status([timeout, timeout].join("\n"), "verify-timeout-near-tip")).toBe("warn");
    expect(status(refused + "\n" + refused, "verify-timeout-near-tip")).toBe("pass");
  });

  it("flags a timeout misreported as an invalid transaction (#10630)", () => {
    const line = log(
      "10:00:00",
      "WARN",
      'block failed consensus validation: InternalDowncastError("downcast to known transaction error type failed, original error: Elapsed(())")',
    );
    expect(status([line, line].join("\n"), "downcast-elapsed")).toBe("fail");
  });

  it("flags the generic stall warning and a flat height over 10 minutes", () => {
    const warning = log("10:10:00", "WARN", "chain updates have stalled, state height has not increased for 10 minutes. Hint: check your network connection");
    expect(status([progress("10:00:00", 5), warning].join("\n"), "chain-stalled")).toBe("fail");
    expect(status([progress("10:00:00", 5), progress("10:11:00", 5)].join("\n"), "chain-stalled")).toBe("warn");
    expect(status([progress("10:00:00", 5), progress("10:11:00", 6)].join("\n"), "chain-stalled")).toBe("pass");
  });

  it("flags the Linux TCP slow-start warning", () => {
    const line = log("10:00:00", "WARN", 'TCP slow-start-after-idle is enabled setting="net.ipv4.tcp_slow_start_after_idle"');
    expect(status([line, line].join("\n"), "tcp-slow-start")).toBe("warn");
  });

  it("reads checkpoint gap and peer count from Prometheus text", () => {
    const metrics = (queued: number, verified: number, peers: number) =>
      [
        "# TYPE checkpoint_queued_continuous_height gauge",
        `checkpoint_queued_continuous_height ${queued}`,
        `checkpoint_verified_height ${verified}`,
        `zcash_net_peers{network="Mainnet"} ${peers}`,
      ].join("\n");
    expect(status(metrics(2412000, 2398400, 3), "checkpoint-gap")).toBe("warn");
    expect(status(metrics(2412000, 2398400, 3), "low-peers")).toBe("warn");
    expect(status(metrics(2412000, 2411900, 25), "checkpoint-gap")).toBe("pass");
    expect(status(metrics(2412000, 2411900, 0), "low-peers")).toBe("fail");
    expect(status(progress("10:00:00", 1), "checkpoint-gap")).toBe("na");
    expect(status(progress("10:00:00", 1), "low-peers")).toBe("na");
  });

  it("finds the expected signatures in each sample", () => {
    const hits = STALL_CHIPS.map((chip) =>
      diagnoseStall(chip.text)
        .checks.filter((check) => check.status === "fail" || check.status === "warn")
        .map((check) => check.id),
    );
    expect(hits[0]).toEqual(expect.arrayContaining(["parent-missing", "chain-stalled"]));
    expect(hits[1]).toEqual(expect.arrayContaining(["verify-timeout-near-tip", "behind-tip", "chain-stalled", "tcp-slow-start"]));
    expect(hits[2]).toEqual(expect.arrayContaining(["checkpoint-gap", "low-peers"]));
    expect(diagnoseStall(STALL_CHIPS[1].text).markers.some((marker) => marker.kind === "restart")).toBe(true);
  });
});
