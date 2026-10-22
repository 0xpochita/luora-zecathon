import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { claudeArgs, claudeEvent, isHosted, parseClaudeRequest, refuseClaude, transcript } from "@/lib/ai/claude-guard";
import { SYSTEM_PROMPT } from "@/lib/ai/payload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEOUT_MS = 180_000;
const MAX_RUNNING = 2;
let running = 0;

function refusal(request: Request): Response | null {
  const refused = refuseClaude({
    method: request.method,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    fetchSite: request.headers.get("sec-fetch-site"),
    hosted: isHosted(process.env),
  });
  return refused ? Response.json({ error: refused.reason }, { status: refused.status, headers: { "Cache-Control": "no-store" } }) : null;
}

export async function GET(request: Request) {
  const refused = refusal(request);
  if (refused) return refused;
  const version = await new Promise<string | null>((resolve) =>
    execFile("claude", ["--version"], { timeout: 10_000 }, (error, stdout) => resolve(error ? null : stdout.trim())),
  );
  return Response.json(
    version ? { available: true, version } : { available: false, error: "Claude Code is not installed here (no claude on PATH)." },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const refused = refusal(request);
  if (refused) return refused;
  const parsed = parseClaudeRequest(await request.json().catch(() => null));
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400 });
  if (running >= MAX_RUNNING) return Response.json({ error: "Your Claude Code is already answering twice. Wait or press Stop." }, { status: 429 });

  running += 1;
  const workdir = await mkdtemp(path.join(tmpdir(), "luora-ask-"));
  const child = spawn("claude", claudeArgs(SYSTEM_PROMPT, parsed.model), { cwd: workdir, stdio: ["pipe", "pipe", "pipe"] });
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    running -= 1;
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    rm(workdir, { recursive: true, force: true }).catch(() => {});
  };
  const timer = setTimeout(finish, TIMEOUT_MS);
  request.signal.addEventListener("abort", finish);
  child.stdin.on("error", () => {});
  child.stdin.end(transcript(parsed.messages));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buffer = "";
      let stderr = "";
      let answered = false;
      let closed = false;
      const send = (event: { text: string } | { error: string }) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
        finish();
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const event = claudeEvent(line);
          if (!event) continue;
          if ("text" in event) answered = true;
          send(event);
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-1500);
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        send({ error: error.code === "ENOENT" ? "Claude Code is not installed here (no claude on PATH). Install it and run claude once to sign in." : error.message });
        close();
      });
      child.on("close", (code) => {
        if (code && !answered) send({ error: stderr.trim().split("\n").at(-1) || `Claude Code stopped with exit code ${code}.` });
        close();
      });
    },
    cancel: finish,
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}
