/**
 * Adapter for Google Gemini, called directly from the browser with the
 * user's AI Studio API key (the same pattern the original TICKR used, minus
 * the server). Uses native google_search grounding: Google executes the
 * searches server-side and streams grounding metadata alongside model text.
 *
 * The search queries and cited sources are surfaced to the timeline as
 * tool_call / tool_result events.
 */

import type { AgentEvent, ProviderPreset, ProviderConfig } from "../types";
import { resilientFetch, isAbort, composeAbort, StreamWatchdog, STREAM_IDLE_MS } from "../net";

export async function* runGemini(
  preset: ProviderPreset,
  provider: ProviderConfig,
  systemText: string,
  userText: string,
  _tavilyKey: string | undefined,
  signal: AbortSignal
): AsyncGenerator<AgentEvent> {
  if (!provider.apiKey) {
    yield { type: "error", message: "No API key configured for this provider." };
    yield { type: "done" };
    return;
  }
  const baseUrl = (provider.baseUrl || preset.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const model = provider.model || preset.defaultModel;
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(provider.apiKey)}`;

  const makeBody = (includeThoughts: boolean) => ({
    contents: [{ role: "user", parts: [{ text: userText }] }],
    systemInstruction: { parts: [{ text: systemText }] },
    tools: [{ googleSearch: {} }],
    ...(includeThoughts ? { generationConfig: { thinkingConfig: { includeThoughts: true } } } : {}),
  });

  // Stall watchdog: armed around each fetch and around every stream read. The
  // local controller is composed over the app's stop signal; when it fires it
  // kills the connection and the adapter reports a loud, retryable error
  // instead of letting the run hang silently.
  const localCtrl = new AbortController();
  const effSignal = composeAbort(signal, localCtrl.signal);
  const watchdog = new StreamWatchdog(() => localCtrl.abort());
  const stallMsg = (what: string) =>
    `Connection stalled — Gemini ${what} nothing for ${STREAM_IDLE_MS / 1000}s. The free tier can queue or drop requests silently; check your network and quota, then retry the run.`;

  let resp: Response;
  try {
    watchdog.reset();
    resp = await attempt(url, makeBody(true), effSignal, "Gemini streamGenerateContent");
    watchdog.cancel();
  } catch (e) {
    watchdog.cancel();
    if (isAbort(e)) {
      if (watchdog.fired) {
        yield { type: "error", message: stallMsg("accepted the request but sent") };
        yield { type: "done" };
        return;
      }
      return; // user-initiated stop
    }
    yield { type: "error", message: e instanceof Error ? e.message : String(e) };
    yield { type: "done" };
    return;
  }

  // Some models reject thinkingConfig; transparently retry without it.
  if (resp.status === 400) {
    const probe = await resp.text().catch(() => "");
    try {
      watchdog.reset();
      resp = await attempt(url, makeBody(false), effSignal, "Gemini streamGenerateContent");
      watchdog.cancel();
    } catch (e) {
      watchdog.cancel();
      if (isAbort(e)) {
        if (watchdog.fired) {
          yield { type: "error", message: stallMsg("accepted the request but sent") };
          yield { type: "done" };
          return;
        }
        return; // user-initiated stop
      }
      yield { type: "error", message: e instanceof Error ? e.message : String(e) };
      yield { type: "done" };
      return;
    }
    if (!resp.ok) {
      yield { type: "error", message: summarizeGeminiError(probe, resp.status) };
      yield { type: "done" };
      return;
    }
  }

  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => "");
    yield { type: "error", message: summarizeGeminiError(errText, resp.status) };
    yield { type: "done" };
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalTokens = 0;
  let sawError = false;
  let callCounter = 0;
  let lastCallId = "";

  const seenQueries = new Set<string>();
  let lastSourcesLine = "";
  let pendingSources: Array<{ title: string; uri: string }> = [];

  const handlePayload = (payload: any): AgentEvent[] => {
    const out: AgentEvent[] = [];
    const candidate = payload.candidates?.[0];

    const parts = candidate?.content?.parts ?? [];
    for (const part of parts) {
      if (typeof part?.text !== "string" || !part.text) continue;
      if (part.thought) {
        out.push({ type: "thinking", text: part.text });
      } else {
        out.push({ type: "text", text: part.text });
      }
    }

    const grounding = candidate?.groundingMetadata;
    if (grounding) {
      for (const q of grounding.webSearchQueries ?? []) {
        if (!seenQueries.has(q)) {
          seenQueries.add(q);
          callCounter++;
          lastCallId = `gsearch_${callCounter}`;
          out.push({ type: "tool_call", name: "google_search", arguments: { query: q }, callId: lastCallId });
        }
      }
      for (const chunk of grounding.groundingChunks ?? []) {
        const web = chunk?.web;
        if (web?.uri) pendingSources.push({ title: web.title || web.uri, uri: web.uri });
      }
      if (pendingSources.length > 0) {
        const resultLine = pendingSources.map((s, i) => `[${i + 1}] ${s.title}\n    ${s.uri}`).join("\n");
        if (resultLine !== lastSourcesLine) {
          lastSourcesLine = resultLine;
          out.push({ type: "tool_result", name: "google_search", result: resultLine, callId: lastCallId || `gsearch_0` });
        }
      }
    }

    if (payload.usageMetadata?.totalTokenCount) totalTokens = payload.usageMetadata.totalTokenCount;
    if (payload.promptFeedback?.blockReason) {
      sawError = true;
      out.push({ type: "error", message: `Gemini blocked the request (${payload.promptFeedback.blockReason}).` });
    }
    return out;
  };

  let done = false;
  watchdog.reset(); // wait for the first SSE byte
  while (!done) {
    let readRes: ReadableStreamReadResult<Uint8Array>;
    try {
      readRes = await reader.read();
    } catch (e) {
      watchdog.cancel();
      if (watchdog.fired) {
        yield { type: "error", message: stallMsg("streamed") + " The partial stream was abandoned." };
        yield { type: "done" };
        return;
      }
      if (isAbort(e)) return; // user-initiated stop
      yield { type: "error", message: e instanceof Error ? e.message : String(e) };
      yield { type: "done" };
      return;
    }
    watchdog.reset(); // bytes arrived — re-arm for the next gap
    const { done: streamDone, value } = readRes;
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr || dataStr === "[DONE]") continue;
      let payload: any;
      try {
        payload = JSON.parse(dataStr);
      } catch {
        continue;
      }
      const events = handlePayload(payload);
      for (const e of events) {
        if (e.type === "error") sawError = true;
        yield e;
      }
      if (sawError) { done = true; break; }
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

  yield { type: "complete", interaction: { usage: { total_tokens: totalTokens } } };
  yield { type: "done" };
}

function attempt(url: string, body: unknown, signal: AbortSignal, providerLabel: string): Promise<Response> {
  return resilientFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }, providerLabel);
}

function summarizeGeminiError(raw: string, status: number): string {
  let message = `Gemini request failed (${status})`;
  try {
    const parsed = JSON.parse(raw);
    const detail = parsed?.[0]?.error?.message || parsed?.error?.message;
    if (detail) message += `: ${detail}`;
  } catch {
    if (raw) message += `: ${raw.slice(0, 200)}`;
  }
  if (status === 401 || status === 403) message += " — check your API key in Settings.";
  if (status === 429) message += " — rate limit reached, wait a moment and retry.";
  return message;
}
