import type { LuoraZCore } from "@contract/types";

export type CoreState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; core: LuoraZCore };

type LoaderResult = { status: "ready"; core: LuoraZCore } | { status: "error"; message: string };

declare global {
  interface Window {
    __luoraZCore?: LoaderResult;
  }
}

const CORE_MODULE_URL = "/wasm/luora_z_core.js";
const LOADER_URL = "/core-loader.mjs";

let pendingLoad: Promise<CoreState> | null = null;

function waitForLoader(): Promise<LoaderResult> {
  return new Promise((resolve) => {
    if (window.__luoraZCore) return resolve(window.__luoraZCore);
    window.addEventListener("luora-z-core", () => resolve(window.__luoraZCore!), { once: true });
    if (!document.querySelector(`script[src="${LOADER_URL}"]`)) {
      const script = document.createElement("script");
      script.type = "module";
      script.src = LOADER_URL;
      document.head.appendChild(script);
    }
  });
}

async function loadOnce(): Promise<CoreState> {
  const probe = await fetch(CORE_MODULE_URL, { method: "HEAD", cache: "no-store" }).catch(() => null);
  if (!probe || !probe.ok) return { status: "missing" };
  const result = await waitForLoader();
  return result;
}

export function loadCore(): Promise<CoreState> {
  pendingLoad ??= loadOnce();
  return pendingLoad;
}

export function coreErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const shaped = error as { code?: unknown; message?: unknown };
    if (typeof shaped.message === "string") {
      return typeof shaped.code === "string" ? `${shaped.code}: ${shaped.message}` : shaped.message;
    }
  }
  if (typeof error === "string") return error;
  return "The decoder failed without a message.";
}
