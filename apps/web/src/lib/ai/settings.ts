import { DEFAULT_SETTINGS, type AiSettings, type KeyProvider, type ProviderId } from "./providers";

const SETTINGS_KEY = "luora.ai.settings";
const KEYS_KEY = "luora.ai.keys";
const PROVIDERS: ProviderId[] = ["none", "claude-code", "local", "anthropic", "openai", "openrouter"];

export type KeyStore = Partial<Record<KeyProvider, string>>;

export function readSettings(): AiSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    if (!parsed || !PROVIDERS.includes(parsed.provider)) return DEFAULT_SETTINGS;
    return {
      provider: parsed.provider,
      endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : DEFAULT_SETTINGS.endpoint,
      models: parsed.models && typeof parsed.models === "object" ? parsed.models : {},
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: AiSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ provider: settings.provider, endpoint: settings.endpoint, models: settings.models }));
  } catch {}
}

export function readRememberedKeys(): KeyStore {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEYS_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeRememberedKeys(keys: KeyStore | null) {
  try {
    if (keys && Object.keys(keys).length) sessionStorage.setItem(KEYS_KEY, JSON.stringify(keys));
    else sessionStorage.removeItem(KEYS_KEY);
  } catch {}
}

export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}
