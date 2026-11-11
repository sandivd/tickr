/**
 * TICKR agent entry point. Resolves the user's provider choice and runs
 * the matching adapter, producing the normalized AgentEvent stream the UI
 * consumes. Everything runs in the browser (BYOK).
 */

import type { AgentEvent, ProviderPreset, ProviderConfig, ProviderId } from "./types";
import { PRESETS } from "./presets";
import { buildSystemText, buildTickerPrompt } from "./prompt";
import { runOpenAICompatible } from "./providers/openaiCompatible";
import { runAnthropic } from "./providers/anthropic";
import { runGemini } from "./providers/gemini";

export * from "./types";
export { PRESETS, PROVIDER_ORDER, NATIVE_SEARCH_NAME } from "./presets";
export { extractReportJson } from "./parser";
export { TICKR_SYSTEM_INSTRUCTIONS, buildSystemText, buildTickerPrompt } from "./prompt";

export async function* runAgentEventStream(opts: {
  preset: ProviderPreset;
  provider: ProviderConfig;
  tavilyKey?: string;
  ticker: string;
  instruction?: string;
  /** Tool-round budget (4–16, default 16); ≤8 puts the run in lean mode. */
  roundBudget?: number;
  signal: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  const { preset, provider, tavilyKey, ticker, instruction, roundBudget, signal } = opts;
  // Date anchor + freshness hardening (models don't know what "now" is).
  // The budget also shapes the sweep size: lean budgets de-scope the
  // mandatory filing hunt so a small budget isn't spent before synthesis.
  const rounds = roundBudget ?? 16;
  const systemText = buildSystemText(new Date().toISOString().slice(0, 10), { rounds });
  const userText = buildTickerPrompt(ticker, instruction);

  try {
    switch (preset.kind) {
      case "openai-compatible":
        yield* runOpenAICompatible(preset, provider, systemText, userText, tavilyKey, ticker, signal, rounds);
        return;
      case "anthropic":
        yield* runAnthropic(preset, provider, systemText, userText, tavilyKey, signal);
        return;
      case "gemini":
        yield* runGemini(preset, provider, systemText, userText, tavilyKey, signal);
        return;
    }
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (err?.name === "AbortError") {
      yield { type: "done" };
      return;
    }
    yield {
      type: "error",
      message: err?.message ? `Agent error: ${err.message}` : "Unexpected error while running the agent.",
    };
    return;
  }
}

/** Convenience resolution of the active provider's pieces. */
export function resolveActiveProvider(
  activeProvider: ProviderId,
  providers: Record<ProviderId, ProviderConfig>
): { preset: ProviderPreset; provider: ProviderConfig } {
  const preset = PRESETS[activeProvider];
  return { preset, provider: providers[activeProvider] || {} };
}
