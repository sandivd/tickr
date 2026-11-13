/**
 * Adapter for Google Gemini, called directly from the browser with the
 * user's AI Studio API key (the same pattern the original TICKR used, minus
 * the server). Uses native google_search grounding: Google executes the
 * searches server-side and streams grounding metadata alongside model text.
 *
 * The search queries and cited sources are surfaced to the timeline as
 * tool_call / tool_result events.
 *
 * Tool budget: Google executes grounding searches server-side and offers no
 * server-side cap (unlike Anthropic's max_uses), so the adapter counts
 * distinct search queries client-side and cuts the stream the moment the
 * model searches one past the budget; a follow-up tool-less request then
 * forces the final report from the material gathered before the cut
 * (mirrors the OpenAI-compatible adapter's forced-synthesis final round).
 */

import type { AgentEvent, ProviderPreset, ProviderConfig } from "../types";
import { resilientFetch, isAbort, composeAbort, StreamWatchdog, STREAM_IDLE_MS } from "../net";

/** Ceiling shared with the OpenAI-compatible adapter (openaiCompatible.ts). */
const MAX_TOOL_ROUNDS = 16;

/**
 * Appended to the interrupted transcript on the synthesis request: the model
 * gets one last chance with the search tool removed to produce the report
 * from what it already gathered — a degraded-but-successful report beats a
 * dead run.
 */
const BUDGET_SYNTHESIS_NOTE =
  "TOOL BUDGET REACHED. The run's search budget is exhausted and no further web searches are possible in this request. Using ONLY the interrupted-analysis transcript above (narration, search queries, sources) plus your own knowledge, output the final report NOW: a single ```json block matching the exact report schema from the system prompt.";

export async function* runGemini(
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
    yield { type: "done" };
    return;
  }

  // Search budget (same clamp as the OpenAI-compatible adapter). Gemini has
  // no server-side search cap, so the adapter enforces it client-side below.
  const budget = Math.max(1, Math.min(MAX_TOOL_ROUNDS, Math.round(Number(roundBudget) || MAX_TOOL_ROUNDS)));

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
  let useThinking = true; // the 400-retry below flips this off; synthesis reuses the known-good config
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
    useThinking = false; // thinkingConfig rejected — keep synthesis consistent
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

  // Budget enforcement state: narration + queries/sources feed the
  // forced-synthesis request if the model searches past the budget.
  let narrationText = "";
  const searches: Array<{ query: string }> = [];
  let budgetExhausted = false;

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
        narrationText += part.text;
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
          if (callCounter > budget) {
            // Budget enforcement: one search too many — cut the stream after
            // this payload and force synthesis below (the excess query's
            // step is suppressed from the timeline).
            budgetExhausted = true;
            continue;
          }
          searches.push({ query: q });
          out.push({ type: "tool_call", name: "google_search", arguments: { query: q }, callId: lastCallId });
        }
      }
      for (const chunk of grounding.groundingChunks ?? []) {
        const web = chunk?.web;
        if (web?.uri) pendingSources.push({ title: web.title || web.uri, uri: web.uri });
      }
      if (pendingSources.length > 0 && !budgetExhausted) {
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
      if (sawError || budgetExhausted) { done = true; break; }
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
    // The model searched past the budget. Surface the cut on the timeline
    // (tool_result only — a pseudo tool_call would inflate the header's tool
    // counter past the budget), then re-ask WITHOUT the googleSearch tool,
    // flattening everything gathered so far into the prompt.
    yield {
      type: "tool_result",
      name: "budget_guard",
      result: `Tool budget reached (${budget}/${budget} searches) — stream cut; synthesizing the report from gathered context.`,
      callId: "budget_guard",
    };

    const phase1Tokens = totalTokens;
    const transcript = [
      narrationText.trim()
        ? `Narration captured before the cut:\n${narrationText.trim()}`
        : "No narration text was captured before the cut.",
      searches.length > 0
        ? `Search queries performed (${searches.length}):\n${searches.map((s, i) => `${i + 1}. ${s.query}`).join("\n")}` +
          (pendingSources.length > 0
            ? `\n\nSources retrieved (${pendingSources.length}):\n${pendingSources
                .map((s, i) => `[${i + 1}] ${s.title}\n    ${s.uri}`)
                .join("\n")}`
            : "")
        : "No search queries were captured before the cut.",
    ].join("\n\n");
    const synthesisUserText =
      `${userText}\n\n---\n\n` +
      `[INTERRUPTED ANALYSIS — the run's search budget (${budget}) was reached mid-analysis. ` +
      `Everything gathered before the cut follows.]\n\n${transcript}\n\n---\n\n${BUDGET_SYNTHESIS_NOTE}`;

    let resp2: Response;
    const localCtrl2 = new AbortController();
    const effSignal2 = composeAbort(signal, localCtrl2.signal);
    const watchdog2 = new StreamWatchdog(() => localCtrl2.abort());
    try {
      watchdog2.reset();
      resp2 = await attempt(url, {
        contents: [{ role: "user", parts: [{ text: synthesisUserText }] }],
        systemInstruction: { parts: [{ text: systemText }] },
        // No googleSearch tool: the budget is spent — synthesis runs on
        // gathered material only.
        ...(useThinking ? { generationConfig: { thinkingConfig: { includeThoughts: true } } } : {}),
      }, effSignal2, "Gemini streamGenerateContent");
      watchdog2.cancel();
    } catch (e) {
      watchdog2.cancel();
      if (isAbort(e)) {
        if (watchdog2.fired) {
          yield { type: "error", message: stallMsg("accepted the synthesis request but sent") };
          yield { type: "done" };
          return;
        }
        return; // user-initiated stop
      }
      yield { type: "error", message: e instanceof Error ? e.message : String(e) };
      yield { type: "done" };
      return;
    }

    if (!resp2.ok || !resp2.body) {
      const errText = await resp2.text().catch(() => "");
      yield { type: "error", message: summarizeGeminiError(errText, resp2.status) };
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
          yield { type: "error", message: stallMsg("streamed") + " The synthesis stream was abandoned." };
          yield { type: "done" };
          return;
        }
        if (isAbort(e)) return; // user-initiated stop
        yield { type: "error", message: e instanceof Error ? e.message : String(e) };
        yield { type: "done" };
        return;
      }
      watchdog2.reset(); // bytes arrived — re-arm
      const { done: synthDone, value } = readRes;
      if (synthDone) break;
      buffer2 += decoder.decode(value, { stream: true });
      let nl2: number;
      while ((nl2 = buffer2.indexOf("\n")) !== -1) {
        const line = buffer2.slice(0, nl2).trim();
        buffer2 = buffer2.slice(nl2 + 1);
        if (!line.startsWith("data:")) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;
        let payload2: any;
        try {
          payload2 = JSON.parse(dataStr);
        } catch {
          continue;
        }
        const events = handlePayload(payload2);
        for (const e of events) {
          if (e.type === "error") sawError = true;
          yield e;
        }
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

    yield { type: "complete", interaction: { usage: { total_tokens: phase1Tokens + totalTokens } } };
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
