"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { DEFAULT_ENDPOINT, DEFAULT_MODELS, MODEL_CHOICES, PROVIDER_HOST, ProviderError, streamAnswer, type AiSettings, type ProviderId } from "@/lib/ai/providers";
import { isLoopbackEndpoint, type KeyStore } from "@/lib/ai/settings";
import type { AskAi } from "./ask-ai";
import { Button, Dot, Hint, IconButton, Input, Select } from "./ui";

type Choice = "none" | "claude-code" | "local" | "key";
type KeyedProvider = "anthropic" | "openai" | "openrouter";

const CHOICES: { id: Choice; title: string; who: string; leaves: string }[] = [
  { id: "none", title: "None", who: "Luora's built-in explanation from the row's real fields, the rule results and the ZIP text.", leaves: "Nothing leaves this tab." },
  {
    id: "claude-code",
    title: "Your Claude Code",
    who: "The claude program on this laptop, signed in with your own Claude plan.",
    leaves: "The prompt goes to Luora's local route and on to your claude process. Only works when Luora runs on localhost.",
  },
  { id: "local", title: "Local model", who: "Ollama, LM Studio or any OpenAI-compatible server you run.", leaves: "The prompt goes from this tab straight to the endpoint you type." },
  {
    id: "key",
    title: "Own API key",
    who: "Anthropic, OpenAI or OpenRouter with your key.",
    leaves: "The prompt and your key go from this tab straight to the provider. Luora's server never sees either.",
  },
];

function choiceOf(provider: ProviderId): Choice {
  return provider === "anthropic" || provider === "openai" || provider === "openrouter" ? "key" : provider;
}

type TestState = { status: "idle" } | { status: "running" } | { status: "ok"; text: string } | { status: "error"; message: string };
type ClaudeStatus = { status: "checking" } | { status: "ready"; version: string } | { status: "missing"; message: string };

export function ConnectAiDialog({ ai }: { ai: AskAi }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState<Choice>(choiceOf(ai.settings.provider));
  const [keyed, setKeyed] = useState<KeyedProvider>(ai.settings.provider === "openai" || ai.settings.provider === "openrouter" ? ai.settings.provider : "anthropic");
  const [endpoint, setEndpoint] = useState(ai.settings.endpoint || DEFAULT_ENDPOINT);
  const [models, setModels] = useState<AiSettings["models"]>(ai.settings.models);
  const [keys, setKeys] = useState<KeyStore>(ai.keys);
  const [remember, setRemember] = useState(ai.rememberKeys);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [claude, setClaude] = useState<ClaudeStatus>({ status: "checking" });

  const open = ai.connectOpen;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const provider: Exclude<ProviderId, "none"> | null = choice === "none" ? null : choice === "key" ? keyed : choice;

  useEffect(() => {
    if (!open || choice !== "claude-code") return;
    const controller = new AbortController();
    fetch("/api/ai/claude", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 404) setClaude({ status: "missing", message: "Not available on a hosted Luora: your Claude Code lives on your laptop. Run Luora locally (pnpm dev) and open it at localhost." });
        else if (!response.ok) setClaude({ status: "missing", message: body.error ?? `HTTP ${response.status}` });
        else if (body.available) setClaude({ status: "ready", version: body.version });
        else setClaude({ status: "missing", message: body.error ?? "Claude Code was not found." });
      })
      .catch(() => controller.signal.aborted || setClaude({ status: "missing", message: "Luora's local route could not be reached." }));
    return () => controller.abort();
  }, [open, choice]);

  const model = provider ? (models[provider] ?? DEFAULT_MODELS[provider]) : "";
  const keyName = provider === "local" ? "local" : provider === "anthropic" || provider === "openai" || provider === "openrouter" ? provider : null;
  const localBlocked = choice === "local" && !isLoopbackEndpoint(endpoint);

  const save = () => {
    ai.setSettings({ provider: provider ?? "none", endpoint: endpoint.trim() || DEFAULT_ENDPOINT, models });
    ai.setKeys(keys, remember);
    ai.setConnectOpen(false);
  };

  const runTest = async () => {
    if (!provider) return;
    setTest({ status: "running" });
    let text = "";
    try {
      await streamAnswer({
        provider,
        model,
        key: keyName ? (keys[keyName] ?? "") : "",
        endpoint,
        system: "Reply with the single word ok.",
        messages: [{ role: "user", content: "Reply with ok." }],
        signal: AbortSignal.timeout(60_000),
        onText: (chunk) => {
          text += chunk;
        },
      });
      setTest(text.trim() ? { status: "ok", text: text.trim().slice(0, 80) } : { status: "error", message: "Connected, but the model returned no text." });
    } catch (error) {
      setTest({ status: "error", message: error instanceof ProviderError ? error.message : (error as Error).name === "TimeoutError" ? "No answer within 60 seconds." : (error as Error).message });
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={() => ai.setConnectOpen(false)}
      onClick={(event) => event.target === event.currentTarget && ai.setConnectOpen(false)}
      aria-labelledby="connect-ai-title"
      className="m-auto max-h-[92dvh] w-[min(560px,calc(100vw-24px))] overflow-hidden rounded-card border border-border bg-card-grad p-0 text-fg shadow-float backdrop:bg-[rgba(5,5,6,.55)]"
    >
      <div className="flex max-h-[92dvh] flex-col">
        <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 text-[14px]">
          <span className="size-1.5 flex-none rounded-full bg-fg" />
          <h2 id="connect-ai-title" className="font-medium">
            Connect AI
          </h2>
          <IconButton label="Close" size="sm" onClick={() => ai.setConnectOpen(false)} className="ml-auto">
            <X />
          </IconButton>
        </header>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pb-4 text-[13px]">
          <Hint>Luora hosts no AI. Pick who answers Ask AI; the choice is remembered in this browser, keys are not unless you tick it.</Hint>
          <div role="radiogroup" aria-label="Who answers" className="grid gap-1.5 sm:grid-cols-2">
            {CHOICES.map((item) => {
              const active = item.id === choice;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setChoice(item.id);
                    setTest({ status: "idle" });
                  }}
                  className={`flex flex-col gap-1 rounded-inner border px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
                    active ? "border-white/25 bg-hover" : "border-border bg-inner-grad hover:border-border-strong"
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium text-fg">
                    <Dot tone={active ? "solid" : "neutral"} />
                    {item.title}
                  </span>
                  <span className="text-[12.5px] leading-snug text-body">{item.who}</span>
                  <span className="text-[12px] leading-snug text-dim">{item.leaves}</span>
                </button>
              );
            })}
          </div>

          {choice === "claude-code" && (
            <div className="flex flex-col gap-2 rounded-inner border border-border bg-inner-grad p-3">
              <p className="flex items-start gap-2 text-text">
                <Dot tone={claude.status === "ready" ? "ok" : claude.status === "checking" ? "neutral" : "warn"} className="mt-[6px]" />
                {claude.status === "ready" ? `Claude Code ${claude.version} found on this laptop.` : claude.status === "checking" ? "Looking for Claude Code…" : claude.message}
              </p>
              <label className="flex items-center gap-2 text-muted">
                Model
                <Select value={models["claude-code"] ?? ""} onChange={(event) => setModels({ ...models, "claude-code": event.target.value })} className="h-8">
                  {MODEL_CHOICES["claude-code"]!.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
              <Hint>
                Luora runs <span className="font-mono">claude -p</span> in an empty temporary folder with no tools, no MCP servers and no settings, so
                it can only answer. Each question uses your plan like any Claude Code prompt.
              </Hint>
            </div>
          )}

          {choice === "local" && (
            <div className="flex flex-col gap-2 rounded-inner border border-border bg-inner-grad p-3">
              <label className="flex flex-col gap-1 text-muted">
                Endpoint
                <Input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} spellCheck={false} className="font-mono text-xs" placeholder={DEFAULT_ENDPOINT} />
              </label>
              {localBlocked && (
                <p className="flex items-start gap-2 text-[12.5px] text-text">
                  <Dot tone="warn" className="mt-[6px]" />
                  Use an http://localhost or http://127.0.0.1 address. Luora&apos;s page does not allow other hosts, so a pasted txid never reaches a
                  machine you did not pick.
                </p>
              )}
              <label className="flex flex-col gap-1 text-muted">
                Model
                <Input value={model} onChange={(event) => setModels({ ...models, local: event.target.value })} spellCheck={false} className="font-mono text-xs" />
              </label>
              <label className="flex flex-col gap-1 text-muted">
                Key (optional, sent as Bearer)
                <Input type="password" autoComplete="off" value={keys.local ?? ""} onChange={(event) => setKeys({ ...keys, local: event.target.value })} className="font-mono text-xs" />
              </label>
              <Hint>
                Ollama serves an OpenAI-compatible API at {DEFAULT_ENDPOINT}/v1 and allows localhost pages by default. If Luora runs on another origin,
                start Ollama with <span className="font-mono">OLLAMA_ORIGINS=&quot;{typeof window === "undefined" ? "" : window.location.origin}&quot;</span>. LM Studio: turn on
                Enable CORS and use http://localhost:1234.
              </Hint>
            </div>
          )}

          {choice === "key" && (
            <div className="flex flex-col gap-2 rounded-inner border border-border bg-inner-grad p-3">
              <label className="flex items-center gap-2 text-muted">
                Provider
                <Select
                  value={keyed}
                  onChange={(event) => {
                    setKeyed(event.target.value as KeyedProvider);
                    setTest({ status: "idle" });
                  }}
                  className="h-8"
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-muted">
                API key
                <Input
                  type="password"
                  autoComplete="off"
                  value={keys[keyed] ?? ""}
                  onChange={(event) => setKeys({ ...keys, [keyed]: event.target.value })}
                  placeholder={keyed === "anthropic" ? "sk-ant-…" : "sk-…"}
                  className="font-mono text-xs"
                />
              </label>
              <label className="flex flex-col gap-1 text-muted">
                Model
                {MODEL_CHOICES[keyed] ? (
                  <Select value={model} onChange={(event) => setModels({ ...models, [keyed]: event.target.value })} className="h-9">
                    {MODEL_CHOICES[keyed]!.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input value={model} onChange={(event) => setModels({ ...models, [keyed]: event.target.value })} spellCheck={false} className="font-mono text-xs" />
                )}
              </label>
              <label className="flex items-start gap-2 text-[12.5px] text-text">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="mt-[3px] size-3.5 accent-[#f4f4f5]" />
                Remember keys in this browser tab session (sessionStorage, gone when the tab closes)
              </label>
              <Hint>
                The key stays in this tab&apos;s memory and goes only to {PROVIDER_HOST[keyed]}. Use a key you can revoke, with a spend limit.
              </Hint>
            </div>
          )}

          {test.status !== "idle" && (
            <p className="flex items-start gap-2 text-[12.5px] text-text" role="status">
              <Dot tone={test.status === "ok" ? "ok" : test.status === "error" ? "bad" : "neutral"} className="mt-[6px]" />
              {test.status === "running" ? "Testing…" : test.status === "ok" ? `Connected. Reply: “${test.text}”` : test.message}
            </p>
          )}
        </div>
        <footer className="flex items-center gap-2 border-t border-border px-4 py-3">
          {provider && (
            <Button size="sm" onClick={runTest} disabled={test.status === "running" || localBlocked || (choice === "claude-code" && claude.status !== "ready")}>
              Test connection
            </Button>
          )}
          {Object.values(keys).some(Boolean) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setKeys({});
                ai.setKeys({}, false);
                setRemember(false);
              }}
            >
              Forget keys
            </Button>
          )}
          <Button variant="primary" size="sm" className="ml-auto" onClick={save} disabled={localBlocked}>
            Save
          </Button>
        </footer>
      </div>
    </dialog>
  );
}
