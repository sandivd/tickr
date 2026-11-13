/**
 * Adapter for Anthropic's Messages API (Claude), called directly from the
 * browser. Anthropic officially supports CORS from browsers when the
 * `anthropic-dangerous-direct-browser-access: true` header is present.
 *
 * Uses Anthropic's server-side `web_search` tool: search requests execute on
 * Anthropic's infrastructure mid-generation, and the stream interleaves
 * server_tool_use / web_search_tool_result blocks alongside text — no
 * client-side tool loop is needed.
 *
 * Tool budget: the Settings slider maps onto web_search's native `max_uses`
 * ceiling, and the stream is cut the moment the model attempts one more
 * search than the budget allows; a follow-up tool-less request then forces
 * the final report from the material gathered before the cut (mirrors the
 * OpenAI-compatible adapter's forced-synthesis final round). A
 * `provider.baseUrl` override points at an Anthropic-compatible endpoint;
 * it defaults to the official API.
 */

import type { AgentEvent, ProviderPreset, ProviderConfig } from "../types";
import { resilientFetch, isAbort, composeAbort, StreamWatchdog, STREAM_IDLE_MS } from "../net";

const API_BASE = "https://api.anthropic.com/v1";
const MAX_TOKENS = 16384;
/** Ceiling shared with the OpenAI-compatible adapter (openaiCompatible.ts). */
const MAX_TOOL_ROUNDS = 16;

/**
 * Appended to the interrupted transcript on the synthesis request: the model
 * gets one last chance with the search tool removed to produce the report
 * from what it already gathered — a degraded-but-successful report beats a
 * dead run.
 */
const BUDGET_SYNTHESIS_NOTE =
  "TOOL BUDGET REACHED. The run's search budget is exhausted and no further web searches are possible in this request. Using ONLY the interrupted-analysis transcript above (narration, searches, sources) plus your own knowledge, output the final report NOW: a single ```json block matching the exact report schema from the system prompt.";

export async function* runAnthropic(
  preset: ProviderPreset,
  provider: ProviderConfig,
  systemText: string,
  userText: string,
  _tavilyKey: string | undefined,
  signal: AbortSignal,
  roundBudget?: number
): AsyncGenerator<AgentEvent> {
  if (!provider.apiKey) {
    yield { type: "error", message: "No API key configured for this provider." };
    return;
  }

  // Search budget (same clamp as the OpenAI-compatible adapter): maps onto
  // web_search's max_uses, so Anthropic itself stops executing searches at
  // the ceiling — searches are billed per use, making this the meaningful
  // unit on this provider.
  const budget = Math.max(1, Math.min(MAX_TOOL_ROUNDS, Math.round(Number(roundBudget) || MAX_TOOL_ROUNDS)));

  const apiUrl = (provider.baseUrl || preset.baseUrl || API_BASE).replace(/\/$/, "") + "/messages";

  let resp: Response;
  const localCtrl = new AbortController();
  const effSignal = composeAbort(signal, localCtrl.signal);
  const watchdog = new StreamWatchdog(() => localCtrl.abort());
  try {
    watchdog.reset();
    resp = await resilientFetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: MAX_TOKENS,
        system: systemText,
        messages: [{ role: "user", content: userText }],
        stream: true,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: budget,
          },
        ],
      }),
      signal: effSignal,
    }, "Anthropic messages endpoint");
    watchdog.cancel();
  } catch (e: any) {
    watchdog.cancel();
    if (isAbort(e)) {
      if (watchdog.fired) {
        yield { type: "error", message: `Connection stalled — Anthropic sent nothing for ${STREAM_IDLE_MS / 1000}s. Try again.` };
        yield { type: "done" };
        return;
      }
      return; // user stop
    }
    if (e instanceof Error && e.name === "RichFetchError") {
      yield { type: "error", message: e.message };
      yield { type: "done" };
      return;
    }
    yield { type: "error", message: `Network error calling Anthropic: ${e?.message || String(e)}` };
    yield { type: "done" };
    return;
  }

  if (!resp.ok || !resp.body) {
    const errorText = await resp.text().catch(() => "");
    let message = `Anthropic request failed (${resp.status}): ${errorText.slice(0, 300) || resp.statusText}`;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed?.error?.message) message = `Anthropic error: ${parsed.error.message}`;
    } catch { /* keep raw text */ }
    yield { type: "error", message };
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let callCounter = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let sawError = false;

  // Budget enforcement state: narration + per-search material feeds the
  // forced-synthesis request if the model tries to search past the budget.
  let narrationText = "";
  const searches: Array<{ id?: string; query?: string; sources?: string }> = [];
  let searchCount = 0;
  let budgetExhausted = false;

  const handleLine = (line: string): AgentEvent | null => {
    if (!line.startsWith("data:")) return null;
    const dataStr = line.slice(5).trim();
    if (!dataStr) return null;
    let evt: any;
    try {
      evt = JSON.parse(dataStr);
    } catch {
      return null;
    }

    switch (evt.type) {
      case "message_start":
        inputTokens = evt.message?.usage?.input_tokens || 0;
        return null;
      case "content_block_start": {
        const block = evt.content_block;
        if (block?.type === "server_tool_use") {
          searchCount++;
          if (searchCount > budget) {
            // Budget enforcement: one search too many — cut the stream here
            // (that search's result never arrives) and force synthesis below.
            budgetExhausted = true;
            return null;
          }
          const callId = block.id || `anth_tool_${++callCounter}`;
          const query = typeof block.input?.query === "string" ? block.input.query : undefined;
          searches.push({ id: callId, query });
          return {
            type: "tool_call",
            name: block.name || "web_search",
            arguments: { provider: "anthropic server-side tool", ...(query ? { query } : {}) },
            callId,
          };
        }
        if (block?.type === "web_search_tool_result") {
          const sources: string[] = [];
          const content = Array.isArray(block.content) ? block.content : [];
          for (const c of content) {
            if (c?.type === "web_search_result") {
              sources.push(`• ${c.title || c.url}\n  ${c.url}`);
            } else if (c?.type === "web_search_tool_result_error") {
              sources.push(`(search error: ${String(c.error_code || "unknown")})`);
            }
          }
          const callId = block.tool_use_id || undefined;
          const entry = searches.find((s) => s.id === callId) ?? searches[searches.length - 1];
          if (entry) entry.sources = sources.length > 0 ? sources.join("\n") : "(no results returned)";
          return {
            type: "tool_result",
            name: "web_search",
            result: sources.length > 0 ? sources.join("\n") : "(no results returned)",
            callId,
          };
        }
        return null;
      }
      case "content_block_delta": {
        const d = evt.delta;
        if (d?.type === "text_delta" && d.text) {
          narrationText += d.text;
          return { type: "text", text: d.text };
        }
        if (d?.type === "thinking_delta" && d.thinking) return { type: "thinking", text: d.thinking };
        return null;
      }
      case "content_block_stop": {
        return null;
      }
      case "message_delta": {
        if (evt.usage?.output_tokens) outputTokens = Math.max(outputTokens, evt.usage.output_tokens);
        return null;
      }
      case "error": {
        sawError = true;
        return { type: "error", message: `Anthropic stream error: ${evt.error?.message || JSON.stringify(evt.error)}` };
      }
      default:
        return null;
    }
  };

  let streamDone = false;
  watchdog.reset(); // wait for the first SSE byte
  while (!streamDone) {
    let readRes: ReadableStreamReadResult<Uint8Array>;
    try {
      readRes = await reader.read();
    } catch (e) {
      watchdog.cancel();
      if (watchdog.fired) {
        yield { type: "error", message: `Connection stalled — Anthropic streamed nothing for ${STREAM_IDLE_MS / 1000}s mid-run. Retry the run.` };
        yield { type: "done" };
        return;
      }
      if (isAbort(e)) return; // user stop
      throw e;
    }
    watchdog.reset(); // bytes arrived — re-arm
    const { done, value } = readRes;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      if (line.startsWith("event:")) continue;
      const event = handleLine(line);
      if (event) yield event;
      if (event?.type === "error") { streamDone = true; break; }
      if (budgetExhausted) { streamDone = true; break; }
    }
  }
  watchdog.cancel();
  try {
    await reader.cancel();
  } catch { /* already closed */ }

  if (sawError) {
    yield { type: "done" };
    return;
  }

  if (budgetExhausted) {
    // ---- Forced synthesis phase -------------------------------------------
    // The model tried to search past the budget. Surface the cut on the
    // timeline (tool_result only — a pseudo tool_call would inflate the
    // header's tool counter past the budget), then re-ask WITHOUT the search
    // tool, flattening everything gathered so far into the prompt.
    yield {
      type: "tool_result",
      name: "budget_guard",
      result: `Tool budget reached (${budget}/${budget} searches) — stream cut; synthesizing the report from gathered context.`,
      callId: "budget_guard",
    };

    const phase1Tokens = inputTokens + outputTokens;
    const transcript = [
      narrationText.trim()
        ? `Narration captured before the cut:\n${narrationText.trim()}`
        : "No narration text was captured before the cut.",
      searches.length > 0
        ? `Searches performed (${searches.length}):\n` +
          searches
            .map(
              (s, i) =>
                `${i + 1}. ${s.query || "(query not captured)"}` +
                (s.sources ? `\n   sources:\n   ${s.sources.replace(/\n/g, "\n   ")}` : "\n   (no sources captured)")
            )
            .join("\n")
        : "No search results were captured before the cut.",
    ].join("\n\n");
    const synthesisUserText =
      `${userText}\n\n---\n\n` +
      `[INTERRUPTED ANALYSIS — the run's search budget (${budget}) was reached mid-analysis. ` +
      `Everything gathered before the cut follows.]\n\n${transcript}\n\n---\n\n${BUDGET_SYNTHESIS_NOTE}`;

    let resp2: Response;
    const ctrl2 = new AbortController();
    const eff2 = composeAbort(signal, ctrl2.signal);
    const watchdog2 = new StreamWatchdog(() => ctrl2.abort());
    try {
      watchdog2.reset();
      resp2 = await resilientFetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": provider.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: MAX_TOKENS,
          system: systemText,
          messages: [{ role: "user", content: synthesisUserText }],
          stream: true,
          // No tools: the budget is spent — synthesis runs on gathered
          // material only.
        }),
        signal: eff2,
      }, "Anthropic messages endpoint");
      watchdog2.cancel();
    } catch (e: any) {
      watchdog2.cancel();
      if (isAbort(e)) {
        if (watchdog2.fired) {
          yield { type: "error", message: `Connection stalled — Anthropic sent nothing for ${STREAM_IDLE_MS / 1000}s during synthesis. Try again.` };
          yield { type: "done" };
          return;
        }
        return; // user stop
      }
      if (e instanceof Error && e.name === "RichFetchError") {
        yield { type: "error", message: e.message };
        yield { type: "done" };
        return;
      }
      yield { type: "error", message: `Network error calling Anthropic (synthesis): ${e?.message || String(e)}` };
      yield { type: "done" };
      return;
    }

    if (!resp2.ok || !resp2.body) {
      const errorText = await resp2.text().catch(() => "");
      let message = `Anthropic synthesis request failed (${resp2.status}): ${errorText.slice(0, 300) || resp2.statusText}`;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed?.error?.message) message = `Anthropic error: ${parsed.error.message}`;
      } catch { /* keep raw text */ }
      yield { type: "error", message };
      yield { type: "done" };
      return;
    }

    const reader2 = resp2.body.getReader();
    let buffer2 = "";
    watchdog2.reset(); // wait for the first SSE byte
    while (true) {
      let readRes: ReadableStreamReadResult<Uint8Array>;
      try {
        readRes = await reader2.read();
      } catch (e) {
        watchdog2.cancel();
        if (watchdog2.fired) {
          yield { type: "error", message: `Connection stalled — Anthropic streamed nothing for ${STREAM_IDLE_MS / 1000}s during synthesis. Retry the run.` };
          yield { type: "done" };
          return;
        }
        if (isAbort(e)) return; // user stop
        throw e;
      }
      watchdog2.reset(); // bytes arrived — re-arm
      const { done: synthDone, value } = readRes;
      if (synthDone) break;
      buffer2 += decoder.decode(value, { stream: true });
      let nl2: number;
      while ((nl2 = buffer2.indexOf("\n")) !== -1) {
        const line = buffer2.slice(0, nl2).trim();
        buffer2 = buffer2.slice(nl2 + 1);
        if (!line) continue;
        if (line.startsWith("event:")) continue;
        const event = handleLine(line);
        if (event) yield event;
        if (event?.type === "error") sawError = true;
      }
    }
    watchdog2.cancel();
    try {
      await reader2.cancel();
    } catch { /* already closed */ }

    if (sawError) {
      yield { type: "done" };
      return;
    }

    yield {
      type: "complete",
      interaction: { usage: { total_tokens: phase1Tokens + inputTokens + outputTokens } },
    };
    yield { type: "done" };
    return;
  }

  yield {
    type: "complete",
    interaction: { usage: { total_tokens: inputTokens + outputTokens } },
  };
  yield { type: "done" };
}
