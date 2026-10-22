import type { ChatTurn } from "./payload";

export interface GuardInput {
  method: string;
  host: string | null;
  origin: string | null;
  fetchSite: string | null;
  hosted: boolean;
}

export interface ClaudeRequest {
  model: string;
  messages: ChatTurn[];
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const MODEL = /^[a-z0-9][a-z0-9.\-]{0,47}$/;
const MAX_TURNS = 24;
const MAX_CHARS = 60_000;

export function isHosted(env: Record<string, string | undefined>): boolean {
  return Boolean(env.VERCEL || env.LUORA_HOSTED);
}

export function refuseClaude(input: GuardInput): { status: number; reason: string } | null {
  if (input.hosted) return { status: 404, reason: "Not found." };
  if (input.method !== "POST" && input.method !== "GET") return { status: 405, reason: "Only GET and POST are allowed." };
  const host = input.host?.trim().toLowerCase() ?? "";
  if (!LOOPBACK_HOST.test(host)) return { status: 403, reason: "Your Claude Code answers only on localhost or 127.0.0.1." };
  if (!input.origin) {
    if (input.method === "GET" && input.fetchSite === "same-origin") return null;
    return { status: 403, reason: "Missing Origin header." };
  }
  let origin: URL;
  try {
    origin = new URL(input.origin);
  } catch {
    return { status: 403, reason: "Bad Origin header." };
  }
  if (origin.protocol !== "http:" || origin.host.toLowerCase() !== host) return { status: 403, reason: "Only Luora's own page on this laptop may use your Claude Code." };
  if (input.fetchSite && input.fetchSite !== "same-origin") return { status: 403, reason: "Only same-origin requests are allowed." };
  return null;
}

export function parseClaudeRequest(body: unknown): ClaudeRequest | string {
  if (!body || typeof body !== "object") return "Send a JSON body with messages.";
  const { model = "", messages } = body as { model?: unknown; messages?: unknown };
  if (typeof model !== "string" || (model !== "" && !MODEL.test(model))) return "Unknown model name.";
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_TURNS) return `Send 1 to ${MAX_TURNS} messages.`;
  let total = 0;
  const turns: ChatTurn[] = [];
  for (const message of messages) {
    const { role, content } = (message ?? {}) as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return "Each message needs a role (user or assistant) and text content.";
    total += content.length;
    turns.push({ role, content });
  }
  if (total > MAX_CHARS) return "The question is too long.";
  if (turns[turns.length - 1].role !== "user") return "The last message must be the user's.";
  return { model, messages: turns };
}

export function transcript(messages: ChatTurn[]): string {
  if (messages.length === 1) return messages[0].content;
  return messages.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n\n");
}

export function claudeArgs(system: string, model: string): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--system-prompt",
    system,
  ];
  if (model) args.push("--model", model);
  return args;
}

export function claudeEvent(line: string): { text: string } | { error: string } | null {
  if (!line.trim()) return null;
  let event: { type?: string; event?: { type?: string; delta?: { type?: string; text?: string } }; is_error?: boolean; result?: unknown };
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (event.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta") {
    return { text: event.event.delta.text ?? "" };
  }
  if (event.type === "result" && event.is_error) return { error: typeof event.result === "string" ? event.result : "Claude Code returned an error." };
  return null;
}
