import { formatInt } from "./format";

export interface BackendInfo {
  vendor: string;
  version: string;
  build: string;
  subversion: string;
  chain: string;
}

export interface BackendSource {
  label: string;
  info(): Promise<BackendInfo>;
  tip(): Promise<{ height: number; hash: string }>;
  hashAt(height: number): Promise<string>;
}

export type BackendStatus = "agree" | "lagging" | "diverged" | "unreachable";

export interface Fork {
  lastCommon: number | null;
  height: number;
  exact: boolean;
  referenceHash: string;
  hash: string;
}

export interface BackendReport {
  label: string;
  reference: boolean;
  status: BackendStatus;
  info: BackendInfo | null;
  tipHeight: number | null;
  tipHash: string | null;
  lag: number | null;
  latencyMs: number | null;
  fork: Fork | null;
  calls: number;
  error: string | null;
}

export interface Comparison {
  reference: string | null;
  tipHeight: number | null;
  window: number;
  backends: BackendReport[];
}

export interface CompareOptions {
  chain: string;
  window?: number;
  maxCalls?: number;
  now?: () => number;
}

interface Probe {
  source: BackendSource;
  info: BackendInfo;
  tip: { height: number; hash: string };
  latencyMs: number;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function probe(source: BackendSource, chain: string, now: () => number): Promise<Probe | BackendReport> {
  const started = now();
  try {
    const [info, tip] = await Promise.all([source.info(), source.tip()]);
    const latencyMs = now() - started;
    if (info.chain !== chain) {
      return { ...emptyReport(source.label), info, latencyMs, error: `serves the ${info.chain || "unknown"} chain, not ${chain}` };
    }
    if (!Number.isSafeInteger(tip.height) || tip.height <= 0) {
      return { ...emptyReport(source.label), info, latencyMs, error: "reported no chain height" };
    }
    return { source, info, tip, latencyMs };
  } catch (error) {
    return { ...emptyReport(source.label), latencyMs: now() - started, error: message(error) };
  }
}

function emptyReport(label: string): BackendReport {
  return {
    label,
    reference: false,
    status: "unreachable",
    info: null,
    tipHeight: null,
    tipHash: null,
    lag: null,
    latencyMs: null,
    fork: null,
    calls: 0,
    error: null,
  };
}

class Budget {
  calls = 0;
  constructor(readonly max: number) {}
  get left() {
    return this.max - this.calls;
  }
}

function hashReader(probe: Probe, cache: Map<number, Promise<string>>) {
  return (height: number, budget: Budget): Promise<string> => {
    if (height === probe.tip.height) return Promise.resolve(probe.tip.hash);
    budget.calls += 1;
    let pending = cache.get(height);
    if (!pending) {
      pending = probe.source.hashAt(height);
      cache.set(height, pending);
    }
    return pending;
  };
}

async function findFork(
  readReference: ReturnType<typeof hashReader>,
  readOther: ReturnType<typeof hashReader>,
  common: number,
  window: number,
  budget: Budget,
): Promise<Fork | null> {
  const pair = (height: number) => Promise.all([readReference(height, budget), readOther(height, budget)]);
  const [topReference, top] = await pair(common);
  if (topReference === top) return null;
  let differing = { height: common, referenceHash: topReference, hash: top };
  const floor = Math.max(1, common - window);
  if (floor === common) return { lastCommon: floor - 1, ...differing, exact: false };
  const [floorReference, floorOther] = await pair(floor);
  if (floorReference !== floorOther) {
    return { lastCommon: null, height: floor, referenceHash: floorReference, hash: floorOther, exact: false };
  }
  let low = floor;
  let high = common;
  while (high - low > 1 && budget.left >= 2) {
    const middle = Math.floor((low + high) / 2);
    const [middleReference, middleOther] = await pair(middle);
    if (middleReference === middleOther) {
      low = middle;
    } else {
      high = middle;
      differing = { height: middle, referenceHash: middleReference, hash: middleOther };
    }
  }
  return { lastCommon: low, ...differing, exact: high - low === 1 };
}

export async function compareBackends(sources: BackendSource[], options: CompareOptions): Promise<Comparison> {
  const window = options.window ?? 1000;
  const maxCalls = options.maxCalls ?? 40;
  const now = options.now ?? Date.now;
  const probes = await Promise.all(sources.map((source) => probe(source, options.chain, now)));
  const reachable = probes.filter((each): each is Probe => "source" in each);
  const reference = reachable[0];
  if (!reference) return { reference: null, tipHeight: null, window, backends: probes as BackendReport[] };

  const caches = new Map<BackendSource, Map<number, Promise<string>>>(reachable.map((each) => [each.source, new Map()]));
  const readerFor = (each: Probe) => hashReader(each, caches.get(each.source)!);
  const readReference = readerFor(reference);

  const reports = await Promise.all(
    probes.map(async (each): Promise<BackendReport> => {
      if (!("source" in each)) return each;
      const report: BackendReport = {
        ...emptyReport(each.source.label),
        reference: each === reference,
        status: "agree",
        info: each.info,
        tipHeight: each.tip.height,
        tipHash: each.tip.hash,
        latencyMs: each.latencyMs,
      };
      if (each === reference) return report;
      const budget = new Budget(maxCalls);
      const common = Math.min(reference.tip.height, each.tip.height);
      try {
        report.fork = await findFork(readReference, readerFor(each), common, window, budget);
        if (report.fork) report.status = "diverged";
      } catch (error) {
        report.status = "unreachable";
        report.error = `block lookup failed: ${message(error)}`;
      }
      report.calls = budget.calls;
      return report;
    }),
  );

  const onChain = reports.filter((each) => each.reference || each.status === "agree");
  const tipHeight = Math.max(...onChain.map((each) => each.tipHeight!));
  for (const report of reports) {
    if (report.tipHeight === null) continue;
    report.lag = tipHeight - report.tipHeight;
    if (report.status === "agree" && report.lag > 0) report.status = "lagging";
  }
  return { reference: reference.source.label, tipHeight, window, backends: reports };
}

export function statusText(report: BackendReport): string {
  if (report.status === "lagging") return `lagging ${formatInt(report.lag!)} block${report.lag === 1 ? "" : "s"}`;
  if (report.status !== "diverged" || !report.fork) return report.status;
  const { fork } = report;
  if (fork.exact) return `diverged at ${formatInt(fork.height)}`;
  if (fork.lastCommon === null) return `diverged at or below ${formatInt(fork.height)}`;
  return `diverged between ${formatInt(fork.lastCommon + 1)} and ${formatInt(fork.height)}`;
}

export function nodeName(info: BackendInfo): string | null {
  const name = info.subversion.replace(/^\/+|\/+$/g, "").replace(":", " ");
  return name || null;
}
