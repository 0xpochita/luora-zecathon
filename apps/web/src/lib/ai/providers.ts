import type { ChatTurn } from "./payload";

export type ProviderId = "none" | "claude-code" | "local" | "anthropic" | "openai" | "openrouter";
export type KeyProvider = "anthropic" | "openai" | "openrouter" | "local";

export interface AiSettings {
  provider: ProviderId;
  endpoint: string;
  models: Partial<Record<ProviderId, string>>;
}

export const DEFAULT_ENDPOINT = "http://localhost:11434";

export const DEFAULT_MODELS: Record<Exclude<ProviderId, "none">, string> = {
  "claude-code": "",
  local: "llama3.1",
  anthropic: "claude-sonnet-5",
  openai: "gpt-5",
  openrouter: "anthropic/claude-sonnet-5",
};

export const MODEL_CHOICES: Partial<Record<ProviderId, { value: string; label: string }[]>> = {
  anthropic: [
    { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
  ],
  "claude-code": [
    { value: "", label: "Claude Code default" },
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
    { value: "haiku", label: "Haiku" },
  ],
};

export const PROVIDER_HOST: Record<Exclude<ProviderId, "none">, string> = {
  "claude-code": "the claude program on this laptop",
  local: "your local endpoint",
  anthropic: "api.anthropic.com",
  openai: "api.openai.com",
  openrouter: "openrouter.ai",
};

export const DEFAULT_SETTINGS: AiSettings = { provider: "none", endpoint: DEFAULT_ENDPOINT, models: {} };

export function modelFor(settings: AiSettings, provider: ProviderId = settings.provider): string {
  if (provider === "none") return "";
  return settings.models[provider] ?? DEFAULT_MODELS[provider];
}

export function openAiBase(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export class ProviderError extends Error {}

export interface StreamRequest {
  provider: Exclude<ProviderId, "none">;
  model: string;
  key: string;
  endpoint: string;
  system: string;
  messages: ChatTurn[];
  signal: AbortSignal;
  onText: (text: string) => void;
}

async function* sseData(response: Response): AsyncGenerator<string> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.startsWith("data:")) yield line.slice(5).trim();
  }
  if (buffer.startsWith("data:")) yield buffer.slice(5).trim();
}

async function failure(response: Response, provider: StreamRequest["provider"]): Promise<ProviderError> {
  const body = await response.text().catch(() => "");
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? detail;
  } catch {}
  if (response.status === 401 || response.status === 403) {
    if (provider === "claude-code") return new ProviderError(`Your Claude Code is only reachable when Luora runs on this laptop at localhost. ${detail}`.trim());
    return new ProviderError(`${PROVIDER_HOST[provider]} refused the key (HTTP ${response.status}). Check the key and try again.`);
  }
  if (response.status === 404 && provider === "claude-code") return new ProviderError("Your Claude Code is not available on a hosted Luora. Run Luora locally, or use a local model or your own key.");
  if (response.status === 404 && provider === "local") return new ProviderError(`The endpoint answered 404. Check the URL and that the model name is pulled. ${detail}`.trim());
  return new ProviderError(`${PROVIDER_HOST[provider]} answered HTTP ${response.status}: ${String(detail) || response.statusText}`);
}

function unreachable(request: StreamRequest): ProviderError {
  if (request.provider === "local") {
    const origin = typeof window === "undefined" ? "this page's origin" : window.location.origin;
    return new ProviderError(
      `Could not reach ${request.endpoint}. Check that the server runs. For Ollama on another origin, allow this page with OLLAMA_ORIGINS="${origin}" and restart it. Luora's page only allows localhost and 127.0.0.1 endpoints.`,
    );
  }
  if (request.provider === "claude-code") return new ProviderError("Luora's local route could not be reached.");
  return new ProviderError(`Could not reach ${PROVIDER_HOST[request.provider]}. Check your connection.`);
}

async function post(url: string, request: StreamRequest, headers: Record<string, string>, body: unknown): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: request.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw unreachable(request);
  }
  if (!response.ok) throw await failure(response, request.provider);
  if (!response.body) throw new ProviderError("The answer had no body.");
  return response;
}

async function streamAnthropic(request: StreamRequest) {
  const response = await post(
    "https://api.anthropic.com/v1/messages",
    request,
    { "x-api-key": request.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    { model: request.model, max_tokens: 1200, system: request.system, messages: request.messages, stream: true },
  );
  for await (const data of sseData(response)) {
    const event = JSON.parse(data);
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") request.onText(event.delta.text);
    else if (event.type === "error") throw new ProviderError(event.error?.message ?? "Anthropic returned an error.");
  }
}

async function streamOpenAi(request: StreamRequest, base: string) {
  const headers: Record<string, string> = request.key ? { Authorization: `Bearer ${request.key}` } : {};
  const response = await post(`${base}/chat/completions`, request, headers, {
    model: request.model,
    stream: true,
    messages: [{ role: "system", content: request.system }, ...request.messages],
  });
  for await (const data of sseData(response)) {
    if (data === "[DONE]") break;
    const event = JSON.parse(data);
    if (event.error) throw new ProviderError(event.error.message ?? String(event.error));
    const text = event.choices?.[0]?.delta?.content;
    if (typeof text === "string") request.onText(text);
  }
}

async function streamClaudeCode(request: StreamRequest) {
  const response = await post("/api/ai/claude", request, {}, { model: request.model, messages: request.messages });
  for await (const data of sseData(response)) {
    const event = JSON.parse(data);
    if (typeof event.error === "string") throw new ProviderError(event.error);
    if (typeof event.text === "string") request.onText(event.text);
  }
}

export async function streamAnswer(request: StreamRequest): Promise<void> {
  switch (request.provider) {
    case "anthropic":
      return streamAnthropic(request);
    case "openai":
      return streamOpenAi(request, "https://api.openai.com/v1");
    case "openrouter":
      return streamOpenAi(request, "https://openrouter.ai/api/v1");
    case "local":
      return streamOpenAi(request, openAiBase(request.endpoint));
    case "claude-code":
      return streamClaudeCode(request);
  }
}
