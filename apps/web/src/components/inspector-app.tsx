"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Info, ListChecks, Signature, TreeStructure, Warning, WarningOctagon } from "@phosphor-icons/react";
import type { Check, DecodedTx, Network, PcztView as PcztData, Sample } from "@contract/types";
import { api, errorText, type ChainInfo } from "@/lib/api";
import { coreErrorMessage, loadCore, type CoreState } from "@/lib/core";
import { failingNodes, type NodeId } from "@/lib/anatomy";
import { classifyInput, isTxid } from "@/lib/input";
import { formatInt } from "@/lib/format";
import { AnatomyView } from "./anatomy-view";
import { ChecksView } from "./checks-view";
import { InputPanel, type LookupState, type SamplesState } from "./input-panel";
import { NodeInspector } from "./node-inspector";
import { PcztEmpty, PcztPanel } from "./pczt-view";
import { TopBar, type ChainState } from "./top-bar";
import { EmptyState, Hint, LoadingLine, Panel, Tabs, type TabOption } from "./ui";
import { WhyView, type CatalogState } from "./why-view";

type ViewId = "anatomy" | "checks" | "why" | "pczt";

const VIEW_OPTIONS: TabOption<ViewId>[] = [
  { value: "anatomy", label: "Anatomy", icon: <TreeStructure /> },
  { value: "checks", label: "Checks", icon: <ListChecks /> },
  { value: "why", label: "Why rejected", icon: <WarningOctagon /> },
  { value: "pczt", label: "PCZT", icon: <Signature /> },
];

export interface LoadedTx {
  hex: string;
  origin: "pasted" | "lookup";
  txid: string | null;
  endpoint: string | null;
  minedHeight: number | null;
}

type PrevoutState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; values: (number | null)[] }
  | { status: "error"; message: string };

function parseNetwork(value: string | null): Network {
  return value === "test" ? "test" : "main";
}

function parseHeight(text: string): number | null {
  const digits = text.replace(/[\s,_]/g, "");
  if (!/^\d{1,9}$/.test(digits)) return null;
  return Number(digits);
}

function replaceUrl(txid: string | null, network: Network) {
  const params = new URLSearchParams();
  if (txid) params.set("tx", txid);
  if (txid || network !== "main") params.set("net", network);
  const query = params.toString();
  window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
}

export function InspectorApp() {
  const searchParams = useSearchParams();
  const initialTxid = useRef(searchParams.get("tx")?.toLowerCase() ?? null);
  const [network, setNetwork] = useState<Network>(() => parseNetwork(searchParams.get("net")));
  const [coreState, setCoreState] = useState<CoreState>({ status: "loading" });
  const [chain, setChain] = useState<ChainState>({ status: "loading" });
  const [heightText, setHeightText] = useState("");
  const [input, setInput] = useState(() => (isTxid(initialTxid.current) ? initialTxid.current! : ""));
  const [inputError, setInputError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedTx | null>(null);
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const [prevouts, setPrevouts] = useState<PrevoutState>({ status: "idle" });
  const [pcztInput, setPcztInput] = useState<string | null>(null);
  const [samples, setSamples] = useState<SamplesState>({ status: "loading" });
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [view, setView] = useState<ViewId>("anatomy");
  const [selectedNode, setSelectedNode] = useState<NodeId>("tx");
  const lookupAbort = useRef<AbortController | null>(null);

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
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setChain({ status: "loading" });
    api
      .chain(network, controller.signal)
      .then((data: ChainInfo) => setChain({ status: "ready", data }))
      .catch((error) => controller.signal.aborted || setChain({ status: "error", message: errorText(error) }));
    return () => controller.abort();
  }, [network]);

  const fetchPrevouts = useCallback((txid: string, net: Network) => {
    setPrevouts({ status: "loading" });
    api
      .prevouts(txid, net)
      .then((body) => setPrevouts({ status: "ready", values: body.values }))
      .catch((error) => setPrevouts({ status: "error", message: errorText(error) }));
  }, []);

  const lookupTxid = useCallback(
    (txid: string, net: Network) => {
      lookupAbort.current?.abort();
      const controller = new AbortController();
      lookupAbort.current = controller;
      setLookup({ status: "loading", txid });
      setPrevouts({ status: "idle" });
      api
        .tx(txid, net, controller.signal)
        .then((body) => {
          setLookup({ status: "idle" });
          setLoaded({ hex: body.hex.toLowerCase(), origin: "lookup", txid: body.txid, endpoint: body.endpoint, minedHeight: body.height });
          setSelectedNode("tx");
          setView((current) => (current === "pczt" ? "anatomy" : current));
          replaceUrl(body.txid, net);
          fetchPrevouts(body.txid, net);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setLookup({ status: "error", txid, message: errorText(error) });
        });
    },
    [fetchPrevouts],
  );

  useEffect(() => {
    const txid = initialTxid.current;
    if (isTxid(txid)) lookupTxid(txid, parseNetwork(new URLSearchParams(window.location.search).get("net")));
  }, [lookupTxid]);

  const inspect = useCallback(() => {
    const kind = classifyInput(input);
    setInputError(null);
    switch (kind.kind) {
      case "empty":
        setInputError("Paste raw transaction hex, a txid or a PCZT first.");
        return;
      case "invalid":
        setInputError(kind.reason);
        return;
      case "txid":
        lookupTxid(kind.txid, network);
        return;
      case "hex":
        lookupAbort.current?.abort();
        setLookup({ status: "idle" });
        setLoaded({ hex: kind.hex, origin: "pasted", txid: null, endpoint: null, minedHeight: null });
        setPrevouts({ status: "idle" });
        setSelectedNode("tx");
        setView((current) => (current === "pczt" ? "anatomy" : current));
        replaceUrl(null, network);
        return;
      case "pczt":
        setPcztInput(kind.data);
        setView("pczt");
        return;
    }
  }, [input, network, lookupTxid]);

  const changeNetwork = useCallback(
    (next: Network) => {
      setNetwork(next);
      setHeightText("");
      replaceUrl(loaded?.origin === "lookup" ? loaded.txid : null, next);
    },
    [loaded],
  );

  const pickSample = useCallback(
    (sample: Sample) => {
      setInput(sample.txid);
      setInputError(null);
      setNetwork(sample.network === "test" ? "test" : "main");
      setHeightText("");
      lookupTxid(sample.txid, sample.network === "test" ? "test" : "main");
    },
    [lookupTxid],
  );

  const core = coreState.status === "ready" ? coreState.core : null;
  const liveHeight = chain.status === "ready" ? chain.data.height : null;
  const chosenHeight = parseHeight(heightText) ?? liveHeight;
  const heightInvalid = heightText.trim() !== "" && parseHeight(heightText) === null;

  const upgradeAtHeight = useMemo(() => {
    if (!core || chosenHeight === null) return null;
    try {
      return core.upgrade_at(network, chosenHeight);
    } catch {
      return null;
    }
  }, [core, network, chosenHeight]);

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

  const feeZat = useMemo(() => {
    if (!core || !loaded || !tx || !inputValues) return null;
    try {
      return core.fee_zat(loaded.hex, inputValues);
    } catch {
      return null;
    }
  }, [core, loaded, tx, inputValues]);

  const checks = useMemo((): { list: Check[] } | { error: string } | null => {
    if (!core || !loaded || !tx || !inputValues || chosenHeight === null) return null;
    try {
      return { list: core.check_tx(loaded.hex, network, chosenHeight, inputValues) };
    } catch (error) {
      return { error: coreErrorMessage(error) };
    }
  }, [core, loaded, tx, inputValues, network, chosenHeight]);

  const checkList = checks && "list" in checks ? checks.list : null;
  const failing = useMemo(() => failingNodes(checkList), [checkList]);

  const pczt = useMemo((): { view: PcztData } | { error: string } | null => {
    if (!core || !pcztInput) return null;
    try {
      return { view: core.inspect_pczt(pcztInput, network) };
    } catch (error) {
      return { error: coreErrorMessage(error) };
    }
  }, [core, pcztInput, network]);

  const endpoint = chain.status === "ready" ? chain.data.endpoint : null;
  const needsPrevoutLookup =
    tx !== null &&
    loaded?.origin === "pasted" &&
    tx.transparent.inputs.some((item) => !item.isCoinbase) &&
    prevouts.status !== "ready";

  const coreBlocker = (() => {
    if (coreState.status === "loading") return <LoadingLine>Loading the WASM decoder…</LoadingLine>;
    if (coreState.status === "missing")
      return (
        <EmptyState icon={<Warning />} title="Decoder not built yet">
          The librustzcash WASM decoder (<span className="font-mono text-xs">public/wasm/luora_z_core.js</span>) is not in
          this build, so nothing can be decoded. luora z never shows a fake decode; build <span className="font-mono text-xs">crates/core</span> to
          enable this view.
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

  const txBlocker = (() => {
    if (coreBlocker) return coreBlocker;
    if (lookup.status === "loading") return <LoadingLine>Fetching the transaction from the indexer…</LoadingLine>;
    if (!loaded)
      return (
        <EmptyState icon={<Info />} title="Nothing inspected yet">
          Paste raw transaction hex or a txid on the left, or pick a sample. Hex is decoded right here in this tab.
        </EmptyState>
      );
    if (decoded && "error" in decoded)
      return (
        <EmptyState icon={<Warning />} title="Could not decode this transaction">
          <span className="font-mono text-xs break-all">{decoded.error}</span>
        </EmptyState>
      );
    return null;
  })();

  let centre: ReactNode;
  if (view === "anatomy") {
    centre = txBlocker ?? (tx && <AnatomyView tx={tx} feeZat={feeZat} inputValues={inputValues} failing={failing} selected={selectedNode} onSelect={setSelectedNode} />);
  } else if (view === "checks") {
    centre =
      txBlocker ??
      (chosenHeight === null ? (
        chain.status === "loading" ? (
          <LoadingLine>Waiting for the live chain height…</LoadingLine>
        ) : (
          <EmptyState icon={<Warning />} title="No height to check against">
            The live height is not available; type a height in the top bar to run the checks.
          </EmptyState>
        )
      ) : checks && "error" in checks ? (
        <EmptyState icon={<Warning />} title="Checks failed to run">
          <span className="font-mono text-xs break-all">{checks.error}</span>
        </EmptyState>
      ) : (
        checkList && <ChecksView checks={checkList} network={network} height={chosenHeight} />
      ));
  } else if (view === "why") {
    centre = <WhyView catalog={catalog} failingChecks={(checkList ?? []).filter((check) => check.status === "fail")} hasTx={!!checkList} />;
  } else {
    centre = !pcztInput ? (
      <PcztEmpty />
    ) : (
      coreBlocker ??
      (pczt && "error" in pczt ? (
        <EmptyState icon={<Warning />} title="Could not read this PCZT">
          <span className="font-mono text-xs break-all">{pczt.error}</span>
        </EmptyState>
      ) : (
        pczt && <PcztPanel pczt={pczt.view} />
      ))
    );
  }

  const viewTitle = VIEW_OPTIONS.find((option) => option.value === view)!.label;

  return (
    <div className="flex min-h-dvh flex-col font-sans text-[13px] text-fg dot-grid">
      <TopBar
        network={network}
        onNetworkChange={changeNetwork}
        heightText={heightText}
        onHeightChange={setHeightText}
        heightInvalid={heightInvalid}
        chain={chain}
        chosenHeight={chosenHeight}
        upgradeName={upgradeAtHeight?.name ?? (chosenHeight !== null && chosenHeight === liveHeight && chain.status === "ready" ? chain.data.upgrade : null)}
      />
      <main className="grid flex-1 grid-cols-1 gap-4 px-4 pb-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_340px]">
        <InputPanel
          input={input}
          onInputChange={(value) => {
            setInput(value);
            setInputError(null);
          }}
          onInspect={inspect}
          inputError={inputError}
          lookup={lookup}
          endpoint={endpoint}
          network={network}
          samples={samples}
          onPickSample={pickSample}
          loaded={loaded}
          prevoutNotice={
            needsPrevoutLookup && tx
              ? {
                  status: prevouts.status,
                  message: prevouts.status === "error" ? prevouts.message : null,
                  onFetch: () => fetchPrevouts(tx.txid, network),
                }
              : null
          }
        />
        <section className="flex min-w-0 flex-col gap-3">
          <Tabs label="Views" idPrefix="view" value={view} options={VIEW_OPTIONS} onChange={setView} className="flex-wrap" />
          <Panel
            label={viewTitle}
            aside={
              view === "anatomy" && tx
                ? `v${tx.version} · ${formatInt(tx.sizeBytes)} bytes`
                : view === "checks" && chosenHeight !== null
                  ? `height ${formatInt(chosenHeight)}`
                  : undefined
            }
            className="min-h-[520px]"
            bodyClassName="px-4 pb-4"
          >
            <div role="tabpanel" id={`view-panel-${view}`} aria-labelledby={`view-tab-${view}`} className="animate-rise">
              {centre}
            </div>
          </Panel>
        </section>
        <Panel label="Inspector" aside={tx ? "click a node" : undefined} className="lg:col-span-2 xl:col-span-1" bodyClassName="px-4 pb-4">
          {tx && view === "anatomy" ? (
            <NodeInspector node={selectedNode} tx={tx} feeZat={feeZat} />
          ) : tx ? (
            <NodeInspector node="tx" tx={tx} feeZat={feeZat} />
          ) : (
            <Hint>Fields of the selected node show up here once a transaction is decoded.</Hint>
          )}
        </Panel>
      </main>
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-4 text-[12.5px] text-dim">
        <span>No analytics, no cookies, no viewing keys.</span>
        <Link href="/about" className="link">
          About luora z
        </Link>
      </footer>
    </div>
  );
}
