"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, CaretRight, Sparkle, Stop, X } from "@phosphor-icons/react";
import { builtinAnswer, QUICK_PROMPTS, type QuickPrompt } from "@/lib/ai/builtin";
import { buildPayload, NO_OPT_INS, type ChatTurn, type OptIns } from "@/lib/ai/payload";
import { DEFAULT_SETTINGS, modelFor, PROVIDER_HOST, ProviderError, streamAnswer, type AiSettings, type ProviderId } from "@/lib/ai/providers";
import { parseAnswer, type KnownRefs } from "@/lib/ai/refs";
import { readRememberedKeys, readSettings, writeRememberedKeys, writeSettings, type KeyStore } from "@/lib/ai/settings";
import type { AskEnv, AskSubject } from "@/lib/ai/subject";
import { loadZipDocuments, pickExcerpts, type ZipDocument } from "@/lib/ai/zips";
import { zipUrl } from "@/lib/format";
import { Button, Dot, Hint, IconButton, Textarea } from "./ui";

export interface AskTurn {
  role: "user" | "assistant";
  content: string;
  provider: ProviderId;
  error?: string;
  streaming?: boolean;
  stopped?: boolean;
}

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  none: "Built-in",
  "claude-code": "Your Claude Code",
  local: "Local model",
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

const OPT_IN_LABEL: { key: keyof OptIns; label: string }[] = [
  { key: "txid", label: "Transaction ids (this txid and spent prevouts)" },
  { key: "addresses", label: "Transparent addresses and scripts" },
  { key: "hashes", label: "Exact hashes (nullifiers, commitments, keys, anchors)" },
  { key: "hex", label: "The raw transaction hex" },
];

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

export function keyFor(settings: AiSettings, keys: KeyStore): string {
  const provider = settings.provider;
  if (provider === "anthropic" || provider === "openai" || provider === "openrouter" || provider === "local") return keys[provider] ?? "";
  return "";
}

function zipQuery(subject: AskSubject, question: string) {
  return {
    zips: subject.zips.map((zip) => zip.number),
    clauses: subject.zips.flatMap((zip) => (zip.clause ? [zip.clause] : [])),
    keywords: [...subject.keywords, question],
  };
}

export function useAskAi({ env, known, current }: { env: AskEnv | null; known: KnownRefs; current: () => AskSubject | null }) {
  const [settings, setSettingsState] = useState<AiSettings>(DEFAULT_SETTINGS);
  const [keys, setKeysState] = useState<KeyStore>({});
  const [rememberKeys, setRememberKeys] = useState(false);
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [subject, setSubject] = useState<AskSubject | null>(null);
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [optIns, setOptIns] = useState<OptIns>(NO_OPT_INS);
  const [consented, setConsented] = useState<Set<ProviderId>>(() => new Set(["none"]));
  const [pending, setPending] = useState<{ question: string; prompt: QuickPrompt | null } | null>(null);
  const [docs, setDocs] = useState<ZipDocument[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);

  useEffect(() => {
    Promise.resolve().then(() => {
      setSettingsState(readSettings());
      const remembered = readRememberedKeys();
      setKeysState(remembered);
      setRememberKeys(Object.keys(remembered).length > 0);
    });
  }, []);

  useEffect(() => {
    if (!open || docs) return;
    loadZipDocuments().then(setDocs).catch(() => setDocs([]));
  }, [open, docs]);

  const setSettings = useCallback((next: AiSettings) => {
    setSettingsState(next);
    writeSettings(next);
  }, []);

  const setKeys = useCallback(
    (next: KeyStore, remember: boolean) => {
      setKeysState(next);
      setRememberKeys(remember);
      writeRememberedKeys(remember ? next : null);
    },
    [],
  );

  const run = useCallback(
    async (question: string, prompt: QuickPrompt | null, about: AskSubject, history: AskTurn[]) => {
      if (!env) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const runId = ++runRef.current;
      const provider = settings.provider;
      const loaded = docs ?? (await loadZipDocuments().catch(() => [] as ZipDocument[]));
      if (!docs) setDocs(loaded);
      if (runRef.current !== runId) return;
      const excerpts = pickExcerpts(loaded, zipQuery(about, question));
      setTurns((list) => [...list, { role: "user", content: question, provider }, { role: "assistant", content: "", provider, streaming: true }]);
      const patchLast = (patch: (turn: AskTurn) => AskTurn) => {
        if (runRef.current !== runId) return;
        setTurns((list) => (list.length ? [...list.slice(0, -1), patch(list[list.length - 1])] : list));
      };
      if (provider === "none") {
        const text = builtinAnswer(prompt, question, about, env, excerpts);
        patchLast((turn) => ({ ...turn, content: text, streaming: false }));
        return;
      }
      const chat: ChatTurn[] = history.filter((turn) => !turn.error && turn.content).map((turn) => ({ role: turn.role, content: turn.content }));
      const payload = buildPayload(about, env, excerpts, optIns, question, chat);
      try {
        await streamAnswer({
          provider,
          model: modelFor(settings),
          key: keyFor(settings, keys),
          endpoint: settings.endpoint,
          system: payload.system,
          messages: payload.messages,
          signal: controller.signal,
          onText: (text) => patchLast((turn) => ({ ...turn, content: turn.content + text })),
        });
        patchLast((turn) => ({ ...turn, streaming: false, error: turn.content ? undefined : "The model returned an empty answer." }));
      } catch (error) {
        if ((error as Error).name === "AbortError") patchLast((turn) => ({ ...turn, streaming: false, stopped: true }));
        else patchLast((turn) => ({ ...turn, streaming: false, error: error instanceof ProviderError ? error.message : `Something went wrong: ${(error as Error).message}` }));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [env, settings, keys, docs, optIns],
  );

  const submit = useCallback(
    (question: string, prompt: QuickPrompt | null, about: AskSubject | null = subject, history: AskTurn[] = turns) => {
      if (!about || !question.trim()) return;
      if (!consented.has(settings.provider)) {
        setPending({ question, prompt });
        return;
      }
      setPending(null);
      void run(question.trim(), prompt, about, history);
    },
    [subject, turns, consented, settings.provider, run],
  );

  const ask = useCallback(
    (about: AskSubject, prompt: QuickPrompt | null = null) => {
      runRef.current += 1;
      abortRef.current?.abort();
      setSubject(about);
      setTurns([]);
      setPending(null);
      setOpen(true);
      if (prompt) submit(QUICK_PROMPTS.find((item) => item.id === prompt)!.label, prompt, about, []);
    },
    [submit],
  );

  const approve = useCallback(() => {
    if (!pending || !subject) return;
    setConsented((set) => new Set(set).add(settings.provider));
    setPending(null);
    void run(pending.question.trim(), pending.prompt, subject, turns);
  }, [pending, subject, settings.provider, run, turns]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const close = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    setOpen(false);
    setPending(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "a" && event.key !== "A") return;
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector("dialog[open]")) return;
      const about = current();
      if (!about) return;
      event.preventDefault();
      ask(about, "explain");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask, current]);

  const preview = useMemo(() => {
    if (!subject || !env || !docs) return null;
    const question = pending?.question ?? "<your question>";
    const excerpts = pickExcerpts(docs, zipQuery(subject, question));
    const chat: ChatTurn[] = pending ? turns.filter((turn) => !turn.error && turn.content).map((turn) => ({ role: turn.role, content: turn.content })) : [];
    return { payload: buildPayload(subject, env, excerpts, optIns, question, chat), excerpts };
  }, [subject, env, docs, pending, turns, optIns]);

  return {
    settings,
    setSettings,
    keys,
    rememberKeys,
    setKeys,
    open,
    close,
    connectOpen,
    setConnectOpen,
    subject,
    turns,
    optIns,
    setOptIns,
    pending,
    cancelPending: () => setPending(null),
    approve,
    ask,
    submit,
    stop,
    preview,
    known,
    streaming: turns.some((turn) => turn.streaming),
  };
}

export type AskAi = ReturnType<typeof useAskAi>;

export function AskButton({ onAsk, label = "Ask AI", className = "", size = "xs" }: { onAsk: () => void; label?: string; className?: string; size?: "xs" | "sm" }) {
  return (
    <IconButton
      size={size}
      label={label}
      onClick={(event) => {
        event.stopPropagation();
        onAsk();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={className}
    >
      <Sparkle weight="fill" />
    </IconButton>
  );
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={index} className="rounded-[4px] bg-raised px-1 font-mono text-[12px] text-text">
            {part.slice(1, -1)}
          </code>
        ) : part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={index} className="font-medium text-fg">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function RichLine({ text, known, onOffset, onCheck }: { text: string; known: KnownRefs; onOffset: (offset: number) => void; onCheck: (id: string) => void }) {
  return (
    <>
      {parseAnswer(text, known).map((segment, index) => {
        if (segment.type === "text") return <InlineText key={index} text={segment.text} />;
        if (segment.type === "zip")
          return (
            <a key={index} href={zipUrl(segment.zip)} target="_blank" rel="noopener noreferrer" className="link">
              {segment.text}
            </a>
          );
        return (
          <button
            key={index}
            type="button"
            onClick={() => (segment.type === "offset" ? onOffset(segment.offset) : onCheck(segment.id))}
            title={segment.type === "offset" ? `Select the trace row at byte ${segment.offset}` : `Show the rule ${segment.id}`}
            className="mx-0.5 inline-flex h-[20px] items-center rounded-[6px] bg-raised px-1.5 align-[1px] font-mono text-[11.5px] text-text outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25"
          >
            {segment.text}
          </button>
        );
      })}
    </>
  );
}

export function AnswerText({ text, known, onOffset, onCheck }: { text: string; known: KnownRefs; onOffset: (offset: number) => void; onCheck: (id: string) => void }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-body">
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter((line) => line.trim());
        const items = lines.filter((line) => /^\s*([-*•]|\d+\.)\s+/.test(line));
        if (items.length && items.length === lines.length - (/^\s*([-*•]|\d+\.)\s+/.test(lines[0]) ? 0 : 1)) {
          const lead = /^\s*([-*•]|\d+\.)\s+/.test(lines[0]) ? null : lines[0];
          return (
            <div key={index} className="flex flex-col gap-1">
              {lead && (
                <p>
                  <RichLine text={lead.replace(/^#+\s*/, "")} known={known} onOffset={onOffset} onCheck={onCheck} />
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {items.map((item, itemIndex) => (
                  <li key={itemIndex} className="flex gap-2">
                    <span aria-hidden className="mt-[9px] size-1 flex-none rounded-full bg-dim" />
                    <span className="min-w-0 break-words">
                      <RichLine text={item.replace(/^\s*([-*•]|\d+\.)\s+/, "")} known={known} onOffset={onOffset} onCheck={onCheck} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        return (
          <p key={index} className="break-words whitespace-pre-line">
            <RichLine text={block.replace(/^#+\s*/gm, "")} known={known} onOffset={onOffset} onCheck={onCheck} />
          </p>
        );
      })}
    </div>
  );
}

function PayloadPreview({ ai, destination }: { ai: AskAi; destination: string }) {
  if (!ai.preview) return <Hint>Loading the ZIP excerpts…</Hint>;
  const { payload } = ai.preview;
  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[12.5px] text-muted">Also send (off by default)</legend>
        {OPT_IN_LABEL.map((option) => (
          <label key={option.key} className="flex items-start gap-2 text-[12.5px] text-text">
            <input
              type="checkbox"
              checked={ai.optIns[option.key]}
              onChange={(event) => ai.setOptIns({ ...ai.optIns, [option.key]: event.target.checked })}
              className="mt-[3px] size-3.5 flex-none accent-[#f4f4f5]"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <Hint>
        An AI provider that sees a txid, an address or a nullifier learns which transaction you care about. Field values,
        sizes, the network, the height and the rule results are enough to explain the structure.
      </Hint>
      <p className="text-[12.5px] text-muted">
        Exact text sent to <span className="text-text">{destination}</span>:
      </p>
      <pre className="max-h-64 overflow-auto rounded-inner border border-border bg-field p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-port">
        {`[system]\n${payload.system}\n\n${payload.messages.map((message) => `[${message.role}]\n${message.content}`).join("\n\n")}`}
      </pre>
    </div>
  );
}

function destinationOf(ai: AskAi): string {
  const provider = ai.settings.provider;
  if (provider === "none") return "nowhere";
  if (provider === "local") return ai.settings.endpoint;
  return PROVIDER_HOST[provider];
}

export function AskPanel({ ai, onOffset, onCheck }: { ai: AskAi; onOffset: (offset: number) => void; onCheck: (id: string) => void }) {
  const [draft, setDraft] = useState("");
  const [showPayload, setShowPayload] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const last = ai.turns[ai.turns.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [ai.turns.length, last?.content, ai.pending]);
  if (!ai.open || !ai.subject) return null;
  const provider = ai.settings.provider;
  const destination = destinationOf(ai);
  const send = (text: string, prompt: QuickPrompt | null) => {
    if (ai.streaming || !text.trim()) return;
    ai.submit(text, prompt);
    setDraft("");
  };
  const model = modelFor(ai.settings);
  return (
    <aside
      aria-label="Ask AI"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[72dvh] flex-col rounded-t-card border border-border bg-card-grad text-fg shadow-float sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-3 sm:h-auto sm:w-[400px] sm:rounded-card"
    >
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-[14px]">
        <Sparkle weight="fill" className="flex-none text-[14px] text-fg" />
        <h2 className="font-medium">Ask AI</h2>
        <button
          type="button"
          onClick={() => ai.setConnectOpen(true)}
          className="ml-auto inline-flex h-7 max-w-[200px] items-center gap-1.5 truncate rounded-chip bg-raised px-2.5 text-[12.5px] text-muted outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25"
          title="Connect AI"
        >
          <Dot tone={provider === "none" ? "neutral" : "ok"} />
          {PROVIDER_LABEL[provider]}
          {provider !== "none" && model ? <span className="truncate font-mono text-[11px] text-dim">{model}</span> : null}
        </button>
        <IconButton label="Close Ask AI" size="sm" onClick={ai.close}>
          <X />
        </IconButton>
      </header>
      <div className="mx-4 mb-2 flex min-w-0 flex-col gap-0.5 rounded-inner border border-border bg-inner-grad px-3 py-2">
        <span className="text-[12px] text-dim">About</span>
        <span className="flex min-w-0 items-center gap-2 text-[13px] text-fg">
          <span className="truncate font-mono text-[12.5px]">{ai.subject.title}</span>
          {ai.subject.offset !== null && <span className="flex-none font-mono text-[11.5px] text-dim">@{ai.subject.offset}</span>}
        </span>
        {ai.subject.parents.length > 0 && <span className="truncate text-[12px] text-dim">in {ai.subject.parents.join(" › ")}</span>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3" aria-live="polite">
        {ai.turns.length === 0 && !ai.pending && (
          <div className="flex flex-col gap-1.5">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt.id}
                type="button"
                onClick={() => send(prompt.label, prompt.id)}
                className="flex h-9 items-center gap-2 rounded-tile bg-raised px-3 text-left text-[13px] text-text outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25"
              >
                {prompt.label}
                <CaretRight className="ml-auto flex-none text-muted" />
              </button>
            ))}
          </div>
        )}
        {ai.turns.map((turn, index) =>
          turn.role === "user" ? (
            <p key={index} className="self-end rounded-tile bg-raised px-3 py-2 text-[13px] text-text">
              {turn.content}
            </p>
          ) : (
            <div key={index} className="flex flex-col gap-1.5">
              {turn.content ? (
                <AnswerText text={turn.content} known={ai.known} onOffset={onOffset} onCheck={onCheck} />
              ) : turn.streaming ? (
                <p className="loading-pulse flex items-center gap-2 text-[12.5px] text-dim" role="status">
                  <Dot /> Thinking…
                </p>
              ) : null}
              {turn.error && (
                <p className="flex items-start gap-2 rounded-tile bg-raised px-3 py-2 text-[12.5px] text-text" role="alert">
                  <Dot tone="bad" className="mt-[6px]" />
                  {turn.error}
                </p>
              )}
              {turn.stopped && <span className="text-[12px] text-dim">Stopped.</span>}
              {!turn.streaming && !turn.error && turn.content && (
                <span className="text-[12px] text-dim">{turn.provider === "none" ? "Built-in answer from this transaction's fields and the ZIP text. Nothing left this tab." : `Answer by ${PROVIDER_LABEL[turn.provider]}. Check it against the cited ZIPs.`}</span>
              )}
            </div>
          ),
        )}
        {ai.pending && (
          <div className="flex flex-col gap-2.5 rounded-inner border border-border bg-inner-grad p-3">
            <p className="text-[13px] text-text">
              First question to {PROVIDER_LABEL[provider]}. This is exactly what will leave this tab, to <span className="font-mono text-[12px]">{destination}</span>:
            </p>
            <PayloadPreview ai={ai} destination={destination} />
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={ai.approve}>
                Send
              </Button>
              <Button variant="ghost" size="sm" onClick={ai.cancelPending}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex flex-col gap-2 border-t border-border px-4 pt-2.5 pb-3">
        {ai.turns.length > 0 && !ai.streaming && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt.id}
                type="button"
                onClick={() => send(prompt.label, prompt.id)}
                className="h-7 flex-none rounded-chip bg-raised px-2.5 text-[12px] text-muted outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25"
              >
                {prompt.label}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft, null);
          }}
        >
          <Textarea
            aria-label="Ask a question"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(draft, null);
              }
            }}
            rows={1}
            placeholder={ai.turns.length ? "Ask a follow-up" : "Ask about this part"}
            className="max-h-32 min-h-9 flex-1 resize-none py-[7px]"
          />
          {ai.streaming ? (
            <IconButton label="Stop" size="md" onClick={ai.stop}>
              <Stop weight="fill" />
            </IconButton>
          ) : (
            <IconButton label="Send" size="md" active type="submit" disabled={!draft.trim()}>
              <ArrowUp />
            </IconButton>
          )}
        </form>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] text-dim">
            {provider === "none" ? "Built-in: nothing leaves this tab." : `Sends to ${destination}. Not sent: ${["txid", "addresses", "hashes", "hex"].filter((key) => !ai.optIns[key as keyof OptIns]).join(", ") || "nothing withheld"}.`}
          </span>
          <button type="button" onClick={() => setShowPayload((value) => !value)} aria-expanded={showPayload} className="flex-none text-[12px] text-muted underline decoration-white/20 underline-offset-2 hover:text-fg">
            What will be sent
          </button>
        </div>
        {showPayload && (
          <div className="max-h-[40dvh] overflow-y-auto">
            {provider === "none" ? (
              <Hint>Nothing. Built-in answers are assembled in this tab from the fields you see, the rule results and the vendored ZIP text. With an AI connected, this shows the exact text before it is sent:</Hint>
            ) : null}
            <PayloadPreview ai={ai} destination={destination} />
          </div>
        )}
      </div>
    </aside>
  );
}

export function AiStatusButton({ ai }: { ai: AskAi }): ReactNode {
  const provider = ai.settings.provider;
  return (
    <button
      type="button"
      onClick={() => ai.setConnectOpen(true)}
      className="inline-flex h-6 items-center gap-1.5 rounded-chip bg-raised px-2 text-[12.5px] whitespace-nowrap text-muted outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25"
      title={`Connect AI · ${provider === "none" ? "None" : PROVIDER_LABEL[provider]}`}
      aria-label={`Connect AI, now ${provider === "none" ? "None" : PROVIDER_LABEL[provider]}`}
    >
      <Sparkle weight="fill" className="text-[12px]" />
      AI<span className="hidden sm:inline"> · {provider === "none" ? "None" : PROVIDER_LABEL[provider]}</span>
    </button>
  );
}
