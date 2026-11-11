/**
 * TICKR agent core types.
 *
 * The agent runs entirely in the browser: it talks directly to the AI
 * provider the user configured (BYOK). Each provider adapter normalizes
 * its own streaming format into the small event vocabulary below, which
 * the UI timeline consumes.
 */

export type AgentEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_call"; name?: string; arguments?: Record<string, unknown>; callId?: string }
  | { type: "tool_result"; name?: string; result?: string; callId?: string }
  /** Deterministic current-level stats fetched by the app (relay /market). */
  | { type: "market_snapshot"; data: import("./marketData").MarketSnapshot }
  | { type: "complete"; interaction: { usage?: { total_tokens: number } | null } }
  | { type: "error"; message: string }
  | { type: "done" };

export type ProviderKind = "openai-compatible" | "anthropic" | "gemini";

/** How the adapter authenticates against its API. */
export type AuthStyle = "bearer" | "x-api-key" | "query";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  /** Short marketing blurb shown in the settings modal. */
  description: string;
  kind: ProviderKind;
  /** Default chat-completions/messages base URL (custom providers let the user set it). */
  baseUrl?: string;
  defaultModel: string;
  /** Public or authenticated models-list endpoint used for the model dropdown + key test. */
  modelsUrl?: string;
  authStyle: AuthStyle;
  /** Where the user can create an API key. */
  keySignupUrl: string;
  /** OpenRouter-only: whether the NATIVE web search plugin CAN be enabled (billed per search — see webPluginNote). */
  webPlugin?: boolean;
  /** OpenRouter-only: display copy next to the plugin opt-in toggle. */
  webPluginNote?: string;
  /** Whether stream_options: {include_usage} is understood (OpenAI-world endpoints). */
  streamUsageOptions?: boolean;
  /** OpenRouter-specific usage tuner. */
  usageBodyParam?: boolean;
  /**
   * Known browser-CORS status, surfaced in Settings and runtime errors.
   * Verified empirically via CORS preflight probes on 2026-10-31.
   */
  browserAccess?: { tone: "ok" | "warn"; text: string };
}

export type ProviderId = "openrouter" | "opencode" | "anthropic" | "google" | "custom";

/** Per-provider credentials persisted (while remaining provider-sandboxed) by the user. */
export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /**
   * OpenRouter only: opt-in for OpenRouter's server-side web-search plugin.
   * Default OFF — the plugin bills ~$0.007 per search to OpenRouter credits
   * even on free models, which can drop a $0-balance account into a frozen
   * negative balance (seen in the wild: -0.23 USD). Off = Tickr searches via
   * the user's own Tavily key instead.
   */
  webPluginOn?: boolean;
}

export interface Settings {
  version: 1;
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  /** Optional universal web-search fallback (tavily.com). */
  tavilyKey?: string;
  /**
   * Agent tool-round budget (4–16, default 16). One round = one model turn
   * plus that round's searches. Free-tier models commonly take 10–20 min per
   * run at 16; budgets of ≤8 go "lean" (smaller mandatory filing sweep +
   * slimmer search payloads). The app-injected price/market data is
   * unaffected by the budget.
   */
  agentRoundBudget?: number;
}

export interface RunOptions {
  ticker: string;
  instruction?: string;
  signal?: AbortSignal;
  /** Resolved at call-time by App using settings + presets. */
  preset: ProviderPreset;
  provider: ProviderConfig;
  tavilyKey?: string;
}
