import type { ProviderId, ProviderConfig, Settings } from "./agent/types";
import { PRESETS } from "./agent/presets";

/**
 * Settings are stored exclusively in this browser's localStorage.
 * TICKR is a fully static app: keys are sent only to the AI provider the
 * user selected, never to any server we control (there is none).
 */

const STORAGE_KEY = "tickr.settings.v1";

export const defaultSettings = (): Settings => ({
  version: 1,
  activeProvider: "openrouter",
  providers: {
    openrouter: {},
    opencode: {},
    anthropic: {},
    google: {},
    custom: {},
  },
  tavilyKey: "",
});

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw) as Settings;
    if (!parsed || parsed.version !== 1 || !parsed.providers) return defaultSettings();
    // Merge over defaults so newly introduced providers exist.
    const merged = defaultSettings();
    for (const id of Object.keys(merged.providers) as ProviderId[]) {
      merged.providers[id] = { ...merged.providers[id], ...(parsed.providers[id] || {}) };
    }
    merged.activeProvider = parsed.activeProvider || "openrouter";
    merged.tavilyKey = parsed.tavilyKey || "";
    merged.agentRoundBudget = normalizeBudget(parsed.agentRoundBudget);
    return merged;
  } catch {
    return defaultSettings();
  }
}

/** Tool-round budget sanitizer: clamps to 4–16; blank/invalid → default 16. */
export function normalizeBudget(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 4 && n <= 16 ? n : 16;
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function maskKey(key?: string): string {
  if (!key) return "";
  if (key.length <= 10) return "•".repeat(key.length);
  return `${key.slice(0, 5)}${"•".repeat(Math.min(12, key.length - 10))}${key.slice(-4)}`;
}

export function providerConfig(settings: Settings, id: ProviderId): ProviderConfig {
  return settings.providers[id] || PRESETS[id] ? settings.providers[id] || {} : {};
}

/** Is the active provider ready to run? */
export function isConfigured(settings: Settings): boolean {
  const c = settings.providers[settings.activeProvider];
  if (!c) return false;
  if (settings.activeProvider === "custom") return !!(c.apiKey && c.baseUrl && c.model);
  return !!c.apiKey;
}
