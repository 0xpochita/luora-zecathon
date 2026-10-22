"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Warning } from "@phosphor-icons/react";
import type { Check, DecodedTx, Network, Nu7Run, PcztView as PcztData, Sample, TraceNode } from "@contract/types";
import { api, ApiError, errorText, type ChainInfo } from "@/lib/api";
import { coreErrorMessage, loadCore, type CoreState } from "@/lib/core";
import { failingNodes, type NodeId } from "@/lib/anatomy";
import { failingRows, traceRows } from "@/lib/trace";
import { classifyInput, isTxid } from "@/lib/input";
import { formatInt, formatZec, NETWORK_LABEL } from "@/lib/format";
import { describeMovement, summarizeRules } from "@/lib/summary";
import { FEE_UNAVAILABLE, withHonestFee } from "@/lib/fee";
import { expiryText, feeText, mempoolStatus, stuckReason } from "@/lib/mempool";
import { readShareFragment } from "@/lib/share-link";
import { CopyIssue } from "./copy-issue";
import { AnatomyView } from "./anatomy-view";
import { TraceDetails, TraceSkeleton, TraceView } from "./trace-view";
import { CheckAtControl, ChecksView, RulesSkeleton, type CheckAt } from "./checks-view";
import { MigrationCard } from "./migration-card";
import { nu7Option } from "@/lib/nu7";
import { InspectBox, type Endpoints, type LookupState, type SamplesState } from "./input-panel";
import { NodeInspector } from "./node-inspector";
import { PcztPanel } from "./pczt-view";
import { TopBar, type ChainState } from "./top-bar";
import { Drawer, EmptyState, Hint, LoadingLine, Panel, Select, Tabs, type TabOption } from "./ui";
import { VerdictCard, VerdictSkeleton, type RulesLine } from "./verdict-card";
import { WhyView, type CatalogState } from "./why-view";
import { AiStatusButton, AskPanel, useAskAi } from "./ask-ai";
import { ConnectAiDialog } from "./connect-ai";
import { checkSubject, nodeSubject, pcztActionSubject, traceRowSubject, zebraSubject, type AskEnv, type AskSubject } from "@/lib/ai/subject";
import { matchZebraError } from "@/lib/zebra-match";

type Mode = "tx" | "pczt" | "error";
type ViewId = "overview" | "rules";
type OverviewMode = "trace" | "graph";

const OVERVIEW_OPTIONS: TabOption<OverviewMode>[] = [
  { value: "trace", label: "Trace" },
  { value: "graph", label: "Graph" },
];

export interface LoadedTx {
  hex: string;
  origin: "pasted" | "lookup";
  txid: string | null;
  endpoint: string | null;
  minedHeight: number | null;
  networkNote: string | null;
  mempool?: boolean;
}

type PrevoutState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; values: (number | null)[] }
  | { status: "error"; message: string };

const NODE_TITLE: Record<NodeId, string> = {
  tx: "Transaction",
  header: "Header",
  transparent: "Transparent (public)",
  sapling: "Sapling (shielded)",
  orchard: "Orchard (shielded)",
  ironwood: "Ironwood (new shielded pool)",
  fee: "Fee",
};

const AUTO_NETWORKS: Network[] = ["main", "test"];

function autoNote(index: number): string {
  return index === 0 ? "found by txid" : "auto-detected";
}

function endpointLabel(endpoints: Endpoints, network: Network): string {
  return endpoints[network === "test" ? "test" : "main"] ?? `the ${NETWORK_LABEL[network]} indexer`;
}

function stagger(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

function parseNetwork(value: string | null): Network | null {
  return value === "test" ? "test" : value === "main" ? "main" : null;
}

function parseHeight(text: string): number | null {
  const digits = text.replace(/[\s,_.]/g, "");
  if (!/^\d{1,9}$/.test(digits)) return null;
  return Number(digits);
}

function replaceUrl(txid: string | null, network: Network) {
  const params = new URLSearchParams();
  if (txid) {
    params.set("tx", txid);
    params.set("net", network);
  }
  const query = params.toString();
  window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
}

export function InspectorApp() {
  const searchParams = useSearchParams();
  const [initial] = useState(() => {
    const txid = searchParams.get("tx")?.toLowerCase() ?? null;
    return isTxid(txid) ? { txid, network: parseNetwork(searchParams.get("net")) } : null;
  });
  const [network, setNetwork] = useState<Network>(initial?.network ?? "main");
  const [coreState, setCoreState] = useState<CoreState>({ status: "loading" });
  const [chains, setChains] = useState<Partial<Record<Network, ChainState>>>({});
  const [input, setInput] = useState(initial?.txid ?? "");
  const [inputError, setInputError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [loaded, setLoaded] = useState<LoadedTx | null>(null);
  const [lookup, setLookup] = useState<LookupState>(() =>
    initial ? { status: "loading", txid: initial.txid, endpoint: `the ${NETWORK_LABEL[initial.network ?? "main"]} indexer` } : { status: "idle" },
  );
  const [prevouts, setPrevouts] = useState<PrevoutState>({ status: "idle" });
  const [pcztInput, setPcztInput] = useState<string | null>(null);
  const [errorInput, setErrorInput] = useState("");
  const [samples, setSamples] = useState<SamplesState>({ status: "loading" });
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [view, setView] = useState<ViewId>("overview");
  const [selectedNode, setSelectedNode] = useState<NodeId | null>(null);
  const [overviewMode, setOverviewMode] = useState<OverviewMode>("trace");
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);
  const [openTraceId, setOpenTraceId] = useState<string | null>(null);
  const [checkAtChoice, setCheckAtChoice] = useState<CheckAt | null>(null);
  const [heightText, setHeightText] = useState("");
  const [focusCheck, setFocusCheck] = useState<string | null>(null);
  const [resultId, setResultId] = useState(0);
  const lookupAbort = useRef<AbortController | null>(null);
  const endpointsRef = useRef<Endpoints>({ main: null, test: null });

  useEffect(() => {
    loadCore().then(setCoreState);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .samples(controller.signal)
      .then((entries) => setSamples({ status: "ready", entries }))
      .catch((error) => controller.signal.aborted || setSamples({ status: "error", message: errorText(error) }));
    api
      .zebraErrors(controller.signal)
      .then((entries) => setCatalog({ status: "ready", entries }))
      .catch((error) => controller.signal.aborted || setCatalog({ status: "error", message: errorText(error) }));
    for (const net of ["main", "test"] as const) {
      api
        .chain(net, controller.signal)
        .then((data: ChainInfo) => setChains((current) => ({ ...current, [net]: { status: "ready", data } })))
        .catch((error) => controller.signal.aborted || setChains((current) => ({ ...current, [net]: { status: "error", message: errorText(error) } })));
    }
    return () => controller.abort();
  }, []);

  const endpoints: Endpoints = {
    main: chains.main?.status === "ready" ? chains.main.data.endpoint : null,
    test: chains.test?.status === "ready" ? chains.test.data.endpoint : null,
  };
  useEffect(() => {
    endpointsRef.current = endpoints;
  });

  const fetchPrevouts = useCallback((txid: string, net: Network) => {
    setPrevouts({ status: "loading" });
    api
      .prevouts(txid, net)
      .then((body) => setPrevouts({ status: "ready", values: body.values }))
      .catch((error) => setPrevouts({ status: "error", message: errorText(error) }));
  }, []);

  const showResult = useCallback((next: Mode) => {
    setMode(next);
    setResultId((current) => current + 1);
    setView("overview");
    setSelectedNode(null);
    setActiveTraceId(null);
    setOpenTraceId(null);
    setCheckAtChoice(null);
    setHeightText("");
  }, []);

  const runLookup = useCallback(
    (txid: string, nets: Network[], noteFor: (index: number) => string | null) => {
      lookupAbort.current?.abort();
      const controller = new AbortController();
      lookupAbort.current = controller;
      const attempt = (index: number) => {
        const net = nets[index];
        if (index > 0) setLookup({ status: "loading", txid, endpoint: endpointLabel(endpointsRef.current, net) });
        api
          .tx(txid, net, controller.signal)
          .then((body) => {
            setLookup({ status: "idle" });
            setNetwork(net);
            setLoaded({
              hex: body.hex.toLowerCase(),
              origin: "lookup",
              txid: body.txid,
              endpoint: body.endpoint,
              minedHeight: body.height,
              networkNote: noteFor(index),
              mempool: body.mempool === true,
            });
            showResult("tx");
            replaceUrl(body.txid, net);
            fetchPrevouts(body.txid, net);
          })
          .catch((error) => {
            if (controller.signal.aborted) return;
            const notFound = error instanceof ApiError && error.status === 404;
            if (notFound && index + 1 < nets.length) return attempt(index + 1);
            setLookup({
              status: "error",
              txid,
              message: notFound && nets.length > 1 ? `not found on ${nets.map((item) => NETWORK_LABEL[item]).join(" or ")}.` : errorText(error),
            });
          });
      };
      attempt(0);
    },
    [fetchPrevouts, showResult],
  );

  const startLookup = useCallback(
    (txid: string, nets: Network[], noteFor: (index: number) => string | null) => {
      setLookup({ status: "loading", txid, endpoint: endpointLabel(endpointsRef.current, nets[0]) });
      setPrevouts({ status: "idle" });
      runLookup(txid, nets, noteFor);
    },
    [runLookup],
  );

  useEffect(() => {
    const shared = initial ? null : readShareFragment(window.location.hash);
    if (!shared) return;
    queueMicrotask(() => {
      setInput(shared.data);
      setNetwork(shared.network);
      if (shared.kind === "pczt") setPcztInput(shared.data);
      else setLoaded({ hex: shared.data, origin: "pasted", txid: null, endpoint: null, minedHeight: null, networkNote: "from the link" });
      showResult(shared.kind === "pczt" ? "pczt" : "tx");
    });
  }, [initial, showResult]);

  useEffect(() => {
    if (!initial) return;
    runLookup(initial.txid, initial.network ? [initial.network] : AUTO_NETWORKS, initial.network ? () => "from the link" : autoNote);
  }, [initial, runLookup]);

  const inspect = useCallback(() => {
    const kind = classifyInput(input);
    setInputError(null);
    switch (kind.kind) {
      case "empty":
        setInputError("Paste something first, or pick one of the examples below.");
        return;
      case "invalid":
        setInputError(kind.reason);
        return;
      case "txid":
        startLookup(kind.txid, AUTO_NETWORKS, autoNote);
        return;
      case "hex":
        lookupAbort.current?.abort();
        setLookup({ status: "idle" });
        setLoaded({ hex: kind.hex, origin: "pasted", txid: null, endpoint: null, minedHeight: null, networkNote: null });
        setPrevouts({ status: "idle" });
        showResult("tx");
        replaceUrl(null, network);
        return;
      case "pczt":
        setPcztInput(kind.data);
        showResult("pczt");
        replaceUrl(null, network);
        return;
      case "error":
        setErrorInput(kind.text);
        showResult("error");
        replaceUrl(null, network);
        return;
    }
  }, [input, network, startLookup, showResult]);

  const pickSample = useCallback(
    (sample: Sample) => {
      setInput(sample.txid);
      setInputError(null);
      const net: Network = sample.network === "test" ? "test" : "main";
      startLookup(sample.txid, [net], () => "sample");
    },
    [startLookup],
  );

  const pickError = useCallback(
    (text: string) => {
      setInput(text);
      setInputError(null);
      setErrorInput(text);
      showResult("error");
      replaceUrl(null, network);
    },
    [network, showResult],
  );

  const goHome = useCallback(() => {
    lookupAbort.current?.abort();
    setMode(null);
    setLoaded(null);
    setLookup({ status: "idle" });
    setInput("");
    setInputError(null);
    setSelectedNode(null);
    setNetwork("main");
    replaceUrl(null, "main");
  }, []);

  const chain: ChainState = chains[network] ?? { status: "loading" };
  const core = coreState.status === "ready" ? coreState.core : null;
  const liveHeight = chain.status === "ready" ? chain.data.height : null;
  const minedHeight = loaded?.minedHeight ?? null;
  const checkAt: CheckAt = checkAtChoice ?? (minedHeight !== null ? "mined" : "tip");
  const customHeight = parseHeight(heightText);
  const heightInvalid = checkAt === "custom" && heightText.trim() !== "" && customHeight === null;
  const nextBlock = loaded?.mempool && liveHeight !== null ? liveHeight + 1 : null;

  const decoded = useMemo((): { tx: DecodedTx } | { error: string } | null => {
    if (!core || !loaded) return null;
    try {
      return { tx: core.decode_tx(loaded.hex, network) };
    } catch (error) {
      return { error: coreErrorMessage(error) };
    }
  }, [core, loaded, network]);

  const tx = decoded && "tx" in decoded ? decoded.tx : null;

  const inputValues = useMemo((): (number | null)[] | null => {
    if (!tx) return null;
    if (tx.transparent.inputs.length === 0) return [];
    if (prevouts.status === "ready" && prevouts.values.length === tx.transparent.inputs.length) return prevouts.values;
    return tx.transparent.inputs.map(() => null);
  }, [tx, prevouts]);

  const nu7Run = useMemo((): { run: Nu7Run } | { error: string } | null => {
    if (!core || !loaded || !inputValues || (network === "main" && liveHeight === null)) return null;
    try {
      return { run: core.check_tx_at_nu7(loaded.hex, network, liveHeight ?? 0, inputValues) };
    } catch (error) {
      return { error: coreErrorMessage(error) };
    }
  }, [core, loaded, network, liveHeight, inputValues]);
  const nu7 = nu7Run && "run" in nu7Run ? nu7Run.run : null;
  const chosenHeight = checkAt === "mined" ? minedHeight : checkAt === "tip" ? (nextBlock ?? liveHeight) : checkAt === "nu7" ? nu7?.height ?? null : customHeight;

  const upgradeAtHeight = useMemo(() => {
    if (checkAt === "nu7") return nu7?.upgrade ?? null;
    if (!core || chosenHeight === null) return null;
    try {
      return core.upgrade_at(network, chosenHeight);
    } catch {
      return null;
    }
  }, [core, network, chosenHeight, checkAt, nu7]);

  const feeZat = useMemo(() => {
    if (!core || !loaded || !tx || !inputValues) return null;
    try {
      return core.fee_zat(loaded.hex, inputValues);
    } catch {
      return null;
    }
  }, [core, loaded, tx, inputValues]);

  const checks = useMemo((): { list: Check[] } | { error: string } | null => {
    if (checkAt === "nu7") return nu7Run && "error" in nu7Run ? { error: nu7Run.error } : nu7 ? { list: withHonestFee(nu7.checks, feeZat) } : null;
    if (!core || !loaded || !tx || !inputValues || chosenHeight === null) return null;
    try {
      return { list: withHonestFee(core.check_tx(loaded.hex, network, chosenHeight, inputValues), feeZat) };
    } catch (error) {
      return { error: coreErrorMessage(error) };
    }
  }, [core, loaded, tx, inputValues, network, chosenHeight, checkAt, nu7Run, nu7, feeZat]);

  const mempool = useMemo(() => {
    if (!core || !loaded || !tx || !inputValues || nextBlock === null) return null;
    try {
      return mempoolStatus(tx, nextBlock - 1, feeZat, withHonestFee(core.check_tx(loaded.hex, network, nextBlock, inputValues), feeZat));
    } catch {
      return null;
    }
  }, [core, loaded, tx, inputValues, network, nextBlock, feeZat]);

  const checkList = checks && "list" in checks ? checks.list : null;
  const failing = useMemo(() => failingNodes(checkList), [checkList]);
  const failingTrace = useMemo(() => failingRows(checkList), [checkList]);

  const trace = useMemo((): { nodes: TraceNode[] } | { error: string } | null => {
    if (!core || !loaded || !tx) return null;
    try {
      return { nodes: core.trace_tx(loaded.hex, network) };
    } catch (error) {
      return { error: coreErrorMessage(error) };
    }
  }, [core, loaded, tx, network]);

  const pczt = useMemo((): { view: PcztData } | { error: string } | null => {
    if (!core || !pcztInput) return null;
    try {
      return { view: core.inspect_pczt(pcztInput, network) };
    } catch (error) {
      return { error: coreErrorMessage(error) };
    }
  }, [core, pcztInput, network]);

  const inputsPending = prevouts.status === "loading";
  const needsPrevoutLookup =
    tx !== null &&
    tx.transparent.inputs.some((item) => !item.isCoinbase) &&
    (loaded?.origin === "pasted" ? prevouts.status !== "ready" : prevouts.status === "error");

  const heightLabel =
    chosenHeight === null
      ? ""
      : checkAt === "nu7"
        ? nu7?.hypothetical
          ? `at a hypothetical NU7 from the next block (${formatInt(chosenHeight)})`
          : `at NU7 activation (${formatInt(chosenHeight)})`
      : checkAt === "mined"
        ? `when mined at ${formatInt(chosenHeight)}`
        : checkAt === "tip"
          ? nextBlock !== null
            ? `in the next block (${formatInt(chosenHeight)})`
            : `at the current tip (${formatInt(chosenHeight)})`
          : `at height ${formatInt(chosenHeight)}`;

  const rulesLine: RulesLine =
    checks && "error" in checks
      ? { status: "error", text: `Rules could not run: ${checks.error}` }
      : checkList
        ? { status: "ready", summary: summarizeRules(checkList, heightLabel) }
        : chosenHeight === null
          ? { status: "pending", text: checkAt === "custom" ? "Type a height in Rules to check it." : chain.status === "error" ? "Live height not available; pick a height in Rules." : "Waiting for the live chain height…" }
          : { status: "pending", text: "Running the rules…" };

  const coreBlocker = (() => {
    if (coreState.status === "loading") return <LoadingLine>Loading the decoder…</LoadingLine>;
    if (coreState.status === "missing")
      return (
        <EmptyState icon={<Warning />} title="Decoder not built yet">
          The librustzcash WASM decoder (<span className="font-mono text-xs">public/wasm/luora_z_core.js</span>) is not in this
          build, so nothing can be decoded. Luora never shows a fake decode; build <span className="font-mono text-xs">crates/core</span>{" "}
          to enable it.
        </EmptyState>
      );
    if (coreState.status === "error")
      return (
        <EmptyState icon={<Warning />} title="Decoder failed to start">
          {coreState.message}
        </EmptyState>
      );
    return null;
  })();

  const networkSelect = (
    <Select aria-label="Network" value={network} onChange={(event) => setNetwork(event.target.value === "test" ? "test" : "main")} className="h-7">
      <option value="main">Mainnet</option>
      <option value="test">Testnet</option>
    </Select>
  );

  const looking = lookup.status === "loading";
  const txSkeleton = (
    <>
      <div className="enter" style={stagger(0)}>
        <VerdictSkeleton />
      </div>
      <div className="enter flex gap-1.5" style={stagger(1)} aria-hidden>
        <span className="skeleton h-9 w-24 rounded-tile" />
        <span className="skeleton h-9 w-20 rounded-tile" />
      </div>
      <div className="enter" style={stagger(2)}>
        <TraceSkeleton />
      </div>
    </>
  );

  const traceRowList = useMemo(
    () => (trace && "nodes" in trace ? traceRows(trace.nodes, inputValues, feeZat, inputsPending) : null),
    [trace, inputValues, feeZat, inputsPending],
  );
  const openTraceRow = openTraceId ? traceRowList?.find((row) => row.id === openTraceId) ?? null : null;
  const pcztView = pczt && "view" in pczt ? pczt.view : null;
  const zebraMatches = useMemo(
    () => (mode === "error" && catalog.status === "ready" ? matchZebraError(errorInput, catalog.entries) : []),
    [mode, catalog, errorInput],
  );

  const tipUpgrade = chain.status === "ready" ? chain.data.upgrade : null;
  const zebraCatalog = catalog.status === "ready" ? (catalog.entries[0]?.zebraVersion ?? null) : null;
  const askEnv = useMemo((): AskEnv | null => {
    if (mode === "tx" && tx && loaded)
      return {
        network,
        height: chosenHeight,
        heightLabel,
        upgrade: upgradeAtHeight?.name ?? tx.upgrade,
        version: tx.version,
        txid: tx.txid,
        hex: loaded.hex,
      };
    if (mode === "pczt" || mode === "error") return { network, height: liveHeight, heightLabel: liveHeight !== null ? `at the current tip (${formatInt(liveHeight)})` : "", upgrade: tipUpgrade, version: null, txid: null, hex: null };
    return null;
  }, [mode, tx, loaded, network, chosenHeight, heightLabel, upgradeAtHeight, liveHeight, tipUpgrade]);

  const knownRefs = useMemo(
    () => ({
      offsets: new Set((traceRowList ?? []).flatMap((row) => (row.offset !== null ? [row.offset] : []))),
      checks: new Set([...(checkList ?? []), ...(pcztView?.checks ?? [])].map((check) => check.id)),
    }),
    [traceRowList, checkList, pcztView],
  );

  const currentSubject = useCallback((): AskSubject | null => {
    if (mode === "tx" && tx) {
      if (view === "rules") {
        const first = checkList?.find((check) => check.status === "fail") ?? checkList?.find((check) => check.status === "warn");
        return first ? checkSubject(first, tx.version) : null;
      }
      if (overviewMode === "graph") return nodeSubject(selectedNode ?? "tx", tx, feeZat, checkList);
      const row = traceRowList?.find((item) => item.id === (activeTraceId ?? "tx"));
      return row && traceRowList ? traceRowSubject(row, traceRowList, checkList, tx.version) : null;
    }
    if (mode === "error" && zebraMatches[0]) return zebraSubject(zebraMatches[0].entry, zebraMatches[0].reason);
    if (mode === "pczt" && pcztView?.actions[0]) return pcztActionSubject(pcztView.actions[0], pcztView);
    return null;
  }, [mode, tx, view, checkList, overviewMode, selectedNode, feeZat, traceRowList, activeTraceId, zebraMatches, pcztView]);

  const ai = useAskAi({ env: askEnv, known: knownRefs, current: currentSubject });

  const selectOffset = useCallback(
    (offset: number) => {
      const row = [...(traceRowList ?? [])].reverse().find((item) => item.offset !== null && item.offset <= offset && offset < item.offset + Math.max(item.length ?? 1, 1));
      if (!row) return;
      setView("overview");
      setOverviewMode("trace");
      setActiveTraceId(row.id);
      requestAnimationFrame(() => document.getElementById(`trace-row-${row.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    },
    [traceRowList],
  );

  const selectCheck = useCallback(
    (id: string) => {
      if (mode === "tx") setView("rules");
      setFocusCheck(id);
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`check-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })));
    },
    [mode],
  );

  let result: ReactNode = null;
  if (looking || (mode === "tx" && coreState.status === "loading")) {
    result = txSkeleton;
  } else if (mode === "tx") {
    if (coreBlocker) result = coreBlocker;
    else if (decoded && "error" in decoded)
      result = (
        <EmptyState icon={<Warning />} title="Could not decode this transaction">
          <span className="font-mono text-xs break-all">{decoded.error}</span>
        </EmptyState>
      );
    else if (tx && loaded) {
      const failCount = checkList?.filter((check) => check.status === "fail").length ?? 0;
      const viewOptions: TabOption<ViewId>[] = [
        { value: "overview", label: "Overview" },
        { value: "rules", label: failCount > 0 ? `Rules · ${failCount} failing` : "Rules" },
      ];
      result = (
        <>
          {inputsPending ? (
            <div className="enter" style={stagger(0)}>
              <VerdictSkeleton />
            </div>
          ) : (
          <div className="enter" style={stagger(0)}>
          <VerdictCard
            tx={tx}
            movement={describeMovement(tx, inputValues, inputsPending)}
            feeZat={feeZat}
            inputsPending={inputsPending}
            rules={rulesLine}
            network={network}
            networkNote={loaded.networkNote}
            onNetworkChange={loaded.origin === "pasted" ? setNetwork : null}
            minedHeight={loaded.minedHeight}
            origin={loaded.origin}
            prevoutNotice={
              needsPrevoutLookup
                ? {
                    status: prevouts.status,
                    message: prevouts.status === "error" ? prevouts.message : null,
                    endpoint: endpointLabel(endpoints, network),
                    onFetch: () => fetchPrevouts(tx.txid, network),
                  }
                : null
            }
            mempool={mempool}
            actions={
              <CopyIssue
                network={network}
                zebraCatalog={zebraCatalog}
                share={loaded.origin === "lookup" && loaded.txid ? { kind: "txid", txid: loaded.txid, network } : { kind: "hex", data: loaded.hex, network }}
                subject={() =>
                  checkList && {
                    kind: "tx",
                    txid: tx.txid,
                    source: loaded.origin === "pasted" ? "pasted" : loaded.mempool ? "mempool" : loaded.minedHeight !== null ? "mined" : "side-chain",
                    minedHeight: loaded.minedHeight,
                    checkedAt: chosenHeight,
                    heightLabel,
                    verdict: [
                      loaded.mempool ? "In the mempool, not mined yet." : "",
                      describeMovement(tx, inputValues, inputsPending),
                      feeZat !== null ? `Fee ${formatZec(feeZat)}.` : tx.transparent.inputs.some((input) => input.isCoinbase) ? "" : `Fee: ${FEE_UNAVAILABLE}.`,
                      rulesLine.status === "ready" ? rulesLine.summary.text : rulesLine.text,
                    ].filter(Boolean).join(" "),
                    checks: checkList,
                    mempool: mempool ? [expiryText(mempool), feeText(mempool), stuckReason(mempool)] : [],
                  }
                }
              />
            }
            onShowRules={() => setView("rules")}
            onShowDetails={() => setSelectedNode("tx")}
          />
          </div>
          )}
          {core && <MigrationCard core={core} hex={loaded.hex} network={network} height={minedHeight ?? liveHeight} onAsk={(check) => ai.ask(checkSubject(check, tx.version))} />}
          <div className="enter" style={stagger(1)}>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs label="Views" idPrefix="view" value={view} options={viewOptions} onChange={setView} />
              {view === "overview" && (
                <Tabs label="Overview style" value={overviewMode} options={OVERVIEW_OPTIONS} onChange={setOverviewMode} size="sm" className="ml-auto" />
              )}
            </div>
          </div>
          <div role="tabpanel" id={`view-panel-${view}`} aria-labelledby={`view-tab-${view}`} className="enter" style={stagger(2)}>
            {view === "overview" && overviewMode === "trace" ? (
              trace && "nodes" in trace ? (
                <TraceView
                  rows={traceRowList!}
                  failing={failingTrace}
                  activeId={activeTraceId}
                  onActiveChange={setActiveTraceId}
                  onOpen={setOpenTraceId}
                  onAsk={(row) => {
                    setActiveTraceId(row.id);
                    ai.ask(traceRowSubject(row, traceRowList!, checkList, tx.version));
                  }}
                  aside={`v${tx.version} · ${formatInt(tx.sizeBytes)} bytes`}
                />
              ) : (
                <EmptyState icon={<Warning />} title="Trace not available for this transaction">
                  <span className="font-mono text-xs break-all">{trace && "error" in trace ? trace.error : "Decoding…"}</span>
                  <span className="mt-1 block">The Graph view still shows its structure.</span>
                </EmptyState>
              )
            ) : view === "overview" ? (
              <AnatomyView
                tx={tx}
                feeZat={feeZat}
                inputValues={inputValues}
                inputsPending={inputsPending}
                failing={failing}
                selected={selectedNode}
                onSelect={setSelectedNode}
                onAsk={(node) => ai.ask(nodeSubject(node, tx, feeZat, checkList))}
              />
            ) : (
              <Panel label="Rules" aside={upgradeAtHeight ? `${NETWORK_LABEL[network]} · ${upgradeAtHeight.name}` : NETWORK_LABEL[network]} bodyClassName="gap-3 px-4 pb-4">
                <CheckAtControl
                  value={checkAt}
                  onChange={setCheckAtChoice}
                  minedHeight={minedHeight}
                  tipHeight={liveHeight}
                  heightText={heightText}
                  onHeightChange={setHeightText}
                  heightInvalid={heightInvalid}
                  upgradeName={upgradeAtHeight?.name ?? null}
                  nu7={nu7Option(network, liveHeight, nu7Run)}
                />
                {checks && "error" in checks ? (
                  <EmptyState icon={<Warning />} title="Rules failed to run">
                    <span className="font-mono text-xs break-all">{checks.error}</span>
                  </EmptyState>
                ) : chosenHeight === null ? (
                  <Hint>{rulesLine.status === "pending" ? rulesLine.text : "Pick a height to run the rules."}</Hint>
                ) : checkList && !inputsPending ? (
                  <ChecksView checks={checkList} focusId={focusCheck} onAsk={(check) => ai.ask(checkSubject(check, tx.version))} onShowOffset={selectOffset} />
                ) : (
                  <RulesSkeleton />
                )}
              </Panel>
            )}
          </div>
        </>
      );
    } else result = txSkeleton;
  } else if (mode === "pczt") {
    const done = pczt && "view" in pczt ? pczt.view.roles.filter((role) => role.done).length : 0;
    result = (
      <Panel
        label="Partially created transaction (PCZT)"
        aside={
          <>
            {pcztView && pcztInput && (
              <CopyIssue
                network={network}
                zebraCatalog={zebraCatalog}
                share={{ kind: "pczt", data: pcztInput, network }}
                subject={() => ({ kind: "pczt", view: pcztView, checkedAt: liveHeight })}
              />
            )}
            {networkSelect}
          </>
        }
        bodyClassName="gap-3 px-4 pb-4"
      >
        {coreBlocker ??
          (pczt && "error" in pczt ? (
            <EmptyState icon={<Warning />} title="Could not read this PCZT">
              <span className="font-mono text-xs break-all">{pczt.error}</span>
            </EmptyState>
          ) : pczt ? (
            <>
              <p className="text-[15px] text-fg">
                {done} of {pczt.view.roles.length} signing roles done
                {pczt.view.checks.some((check) => check.status === "fail")
                  ? "; a signer check fails."
                  : pczt.view.checks.some((check) => check.status === "warn")
                    ? "; a signer check warns."
                    : "; signer checks pass."}
              </p>
              <PcztPanel
                pczt={pczt.view}
                onAsk={(action) => ai.ask(pcztActionSubject(action, pczt.view))}
                onAskCheck={(check) => ai.ask(checkSubject(check, null))}
              />
            </>
          ) : (
            <LoadingLine>Reading the PCZT…</LoadingLine>
          ))}
      </Panel>
    );
  } else if (mode === "error") {
    result = (
      <Panel
        label="Why Zebra rejected it"
        aside={
          catalog.status === "ready" && (
            <CopyIssue
              network={network}
              zebraCatalog={zebraCatalog}
              share={{ kind: "none" }}
              subject={() => ({ kind: "error", text: errorInput, matches: zebraMatches, checkedAt: liveHeight })}
            />
          )
        }
        bodyClassName="gap-3 px-4 pb-4"
      >
        <WhyView catalog={catalog} text={errorInput} onAsk={(match) => ai.ask(zebraSubject(match.entry, match.reason))} />
      </Panel>
    );
  }

  return (
    <div className={`flex min-h-dvh flex-col font-sans text-[13px] text-fg dot-grid ${ai.open ? "xl:pr-[424px]" : ""}`}>
      <TopBar network={network} chain={chain} onHome={goHome} aside={<AiStatusButton ai={ai} />} />
      {mode === null && !looking ? (
        <main className="flex flex-1 flex-col items-center justify-center px-4 pt-6 pb-16">
          <div className="flex w-full max-w-2xl flex-col gap-5">
            <div className="enter flex flex-col gap-1.5 px-1 text-center" style={stagger(0)}>
              <h1 className="text-ui-display font-medium">Inspect a Zcash transaction</h1>
              <p className="text-[14px] text-muted">See what it moves, which rules it passes, and why a node rejected it.</p>
            </div>
            <div className="enter" style={stagger(1)}>
              <InspectBox
                input={input}
                onInputChange={(value) => {
                  setInput(value);
                  setInputError(null);
                }}
                onInspect={inspect}
                inputError={inputError}
                lookup={lookup}
                endpoints={endpoints}
                samples={samples}
                onPickSample={pickSample}
                onPickError={pickError}
                compact={false}
              />
            </div>
          </div>
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 pb-10">
          <InspectBox
            input={input}
            onInputChange={(value) => {
              setInput(value);
              setInputError(null);
            }}
            onInspect={inspect}
            inputError={inputError}
            lookup={lookup}
            endpoints={endpoints}
            samples={samples}
            onPickSample={pickSample}
            onPickError={pickError}
            compact
          />
          <div key={resultId} className="contents">
            {result}
          </div>
        </main>
      )}
      <AskPanel ai={ai} onOffset={selectOffset} onCheck={selectCheck} />
      {ai.connectOpen && <ConnectAiDialog ai={ai} />}
      {tx && (
        <Drawer
          open={selectedNode !== null || openTraceRow !== null}
          onClose={() => {
            setSelectedNode(null);
            setOpenTraceId(null);
          }}
          title={openTraceRow ? `${openTraceRow.kind} ${openTraceRow.label}` : selectedNode ? NODE_TITLE[selectedNode] : ""}
        >
          {openTraceRow ? (
            <TraceDetails row={openTraceRow} failing={failingTrace.get(openTraceRow.id)} />
          ) : (
            selectedNode && <NodeInspector node={selectedNode} tx={tx} feeZat={feeZat} />
          )}
        </Drawer>
      )}
    </div>
  );
}
