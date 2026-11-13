import type { ProviderPreset, ProviderId } from "./types";

/**
 * Provider presets. All entries in v1 work purely from the browser:
 * the user's API key goes only from the user's browser to the chosen
 * provider — TICKR has no server and never sees it.
 *
 * `opencode` is the one exception to "direct browser → provider": OpenCode's
 * chat gateway has no CORS, so chat runs are relayed through a one-paste
 * Cloudflare Worker (proxy/cloudflare-worker.js). The shared relay below maps
 * to OpenCode's gateway via the worker's UPSTREAM_BASE default; model lists
 * always come straight from OpenCode's public catalog endpoint.
 */

export const PRESETS: Record<ProviderId, ProviderPreset> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    description: "Hundreds of models behind one key (Claude, GPT, GLM, Kimi, Gemini...). 'openrouter/free' routes to whichever free models are up — no credits needed. Web search defaults to your own Tavily key (free tier); OpenRouter's native plugin is optional below and billed per search.",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/free",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    authStyle: "bearer",
    keySignupUrl: "https://openrouter.ai/settings/keys",
    webPlugin: true,
    webPluginNote: "OpenRouter's server-side web plugin (Exa) bills ~$0.007 per search to your OpenRouter credits — including on free models — and can push a $0-balance account into a frozen negative balance. Leave off for strict $0 usage: Tickr will search via your own Tavily key instead.",
    usageBodyParam: true,
  },
  opencode: {
    id: "opencode",
    label: "OpenCode Console",
    description: "OpenCode's model gateway (opencode.ai/console), relayed so it works from the browser. Use your Console API key.",
    kind: "openai-compatible",
    // Shared relay (Cloudflare Worker, proxy/cloudflare-worker.js). It forwards
    // /v1/* onto https://opencode.ai/inference/openai and adds browser CORS.
    // Users can point the endpoint field at their own relay if they prefer.
    baseUrl: "https://tickr-relay.sandiv-d2000.workers.dev/v1",
    defaultModel: "glm-5.3-flash-free",
    modelsUrl: "https://opencode.ai/inference/v1/models",
    authStyle: "bearer",
    keySignupUrl: "https://opencode.ai/console",
    browserAccess: {
      tone: "ok",
      text: "OpenCode's chat API doesn't allow direct browser calls, so chat runs route through TICKR's shared relay (tickr-relay.sandiv-d2000.workers.dev) by default. Your key travels browser → relay → OpenCode; the relay stores and logs nothing. Prefer your own? Deploy proxy/cloudflare-worker.js (README) and point the endpoint field at it.",
    },
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    description: "Claude models with Anthropic's server-side web_search tool. Official CORS access from the browser.",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-opus-5-5",
    modelsUrl: "https://api.anthropic.com/v1/models",
    authStyle: "x-api-key",
    keySignupUrl: "https://console.anthropic.com/settings/keys",
  },
  google: {
    id: "google",
    label: "Google (Gemini)",
    description: "Gemini models with native google_search grounding. Works from the browser with an AI Studio key.",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.5-flash",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    authStyle: "query",
    keySignupUrl: "https://aistudio.google.com/apikey",
  },
  custom: {
    id: "custom",
    label: "Custom / any OpenAI-compatible API",
    description: "Any endpoint that speaks the OpenAI chat-completions format: OpenAI (behind a proxy), Groq, LM Studio, vLLM, your own gateway...",
    kind: "openai-compatible",
    baseUrl: "",
    defaultModel: "",
    modelsUrl: "",
    authStyle: "bearer",
    keySignupUrl: "",
    browserAccess: {
      tone: "warn",
      text: "Custom endpoints work only if they send CORS headers for browser origins. api.openai.com itself blocks browser calls — use OpenRouter for OpenAI models, or put your endpoint behind a proxy with CORS.",
    },
  },
};

export const PROVIDER_ORDER: ProviderId[] = ["openrouter", "opencode", "anthropic", "google", "custom"];

/** Search tool name used for timeline labels of native search integrations. */
export const NATIVE_SEARCH_NAME = "web_search";
