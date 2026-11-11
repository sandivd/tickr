/**
 * Adapter for Anthropic's Messages API (Claude), called directly from the
 * browser. Anthropic officially supports CORS from browsers when the
 * `anthropic-dangerous-direct-browser-access: true` header is present.
 *
 * Uses Anthropic's server-side `web_search` tool: search requests execute on
 * Anthropic's infrastructure mid-generation, and the stream interleaves
 * server_tool_use / web_search_tool_result blocks alongside text — no
 * client-side tool loop is needed.
 */

import type { AgentEvent, ProviderPreset, ProviderConfig } from "../types";
import { resilientFetch, isAbort, composeAbort, StreamWatchdog, STREAM_IDLE_MS } from "../net";

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 16384;

export async function* runAnthropic(
  _preset: ProviderPreset,
  provider: ProviderConfig,
  systemText: string,
  userText: string,
  _tavilyKey: string | undefined,
  signal: AbortSignal
): AsyncGenerator<AgentEvent> {
  if (!provider.apiKey) {
    yield { type: "error", message: "No API key configured for this provider." };
    return;
  }

  let resp: Response;
  const localCtrl = new AbortController();
  const effSignal = composeAbort(signal, localCtrl.signal);
  const watchdog = new StreamWatchdog(() => localCtrl.abort());
  try {
    watchdog.reset();
    resp = await resilientFetch(API_URL, {
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
            max_uses: 12,
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
          return {
            type: "tool_call",
            name: block.name || "web_search",
            arguments: { provider: "anthropic server-side tool" },
            callId: block.id || `anth_tool_${++callCounter}`,
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
          return {
            type: "tool_result",
            name: "web_search",
            result: sources.length > 0 ? sources.join("\n") : "(no results returned)",
            callId: block.tool_use_id || undefined,
          };
        }
        return null;
      }
      case "content_block_delta": {
        const d = evt.delta;
        if (d?.type === "text_delta" && d.text) return { type: "text", text: d.text };
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

  yield {
    type: "complete",
    interaction: { usage: { total_tokens: inputTokens + outputTokens } },
  };
  yield { type: "done" };
}
