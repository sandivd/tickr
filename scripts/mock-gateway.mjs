/**
 * Local mock of an OpenAI-compatible gateway for developing/verifying Tickr
 * without real API keys or internet access.
 *
 *   node scripts/mock-gateway.mjs
 *   → http://localhost:8787/v1     (any string works as the API key)
 *
 * It speaks exactly the OpenAI chat-completions SSE dialect that Tickr's
 * openaiCompatible adapter parses:
 *   - GET  /v1/models            → a small model catalog (obj list)
 *   - GET  /v1/prices, /v1/market → the relay's public data routes (canned
 *     RKLB-like series/snapshot; PRICES_FAIL=1 fails both to e2e the
 *     "never estimate" fallbacks)
 *   - POST /v1/chat/completions  → SSE: reasoning deltas (`delta.reasoning`),
 *     content deltas ending in a ```json CHART fixture, then a final chunk
 *     with finish_reason "stop" + usage.total_tokens, then `data: [DONE]`
 *   - POST /anthropic/v1/messages → Anthropic Messages SSE (message_start /
 *     content_block_* deltas) for e2e-testing runAnthropic's tool-budget
 *     enforcement: phase 1 narrates + runs SIX web_search cycles (the adapter
 *     must cut at budget+1 attempts), the follow-up tool-less synthesis
 *     request streams the report fixture
 *   - POST /v1beta/models/*:streamGenerateContent → Gemini SSE
 *     (candidates/groundingMetadata) for runGemini's budget enforcement,
 *     same runaway-then-synthesize pattern
 *   - CORS: echoes the request Origin so browser tab runs preflight cleanly
 *
 * The fixture report has verdict/deep_insights/looks-like-report keys, so
 * Tickr's parser should lift it, mark the run complete and open the report.
 * It intentionally never emits tool_calls — the full run stays offline.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8787);

const MODEL_ID = "mock/rklb-fixture";

const REPORT = {
  verdict: {
    summary:
      "Mock gateway fixture. Rocket Lab's launch cadence and Space Systems backlog tilt the balance positive, with Neutron first-flight timing as the main counterweight.",
    conviction_score: 68,
    key_takeaways: [
      "Electron launch cadence keeps revenue growth intact",
      "Neutron first-flight timing is the central schedule risk",
      "Path to profitability rides on Neutron revenue ramping",
    ],
  },
  deep_insights: [
    {
      category: "Risk Assessment",
      title: "Neutron schedule slippage",
      description:
        "First-flight timing has shifted before; each slip defers the flagship revenue ramp the thesis leans on.",
      impact_score: 8,
    },
    {
      category: "Growth Catalyst",
      title: "Space Systems backlog expansion",
      description:
        "Constellation contracts support multi-year visibility for the non-launch side of the business.",
      impact_score: 7,
    },
  ],
  findings: [
    {
      documentType: "Form 10-K",
      keyInsights: ["Backlog grew year over year", "Launch services margins are expanding"],
      date: "2026-02-28",
      sourceUrl: "https://example.com/mock/rklb-10k.pdf",
    },
    {
      documentType: "Form 8-K",
      keyInsights: ["Neutron contract award announced"],
      date: "2026-07-14",
      sourceUrl: "https://example.com/mock/rklb-8k.pdf",
    },
  ],
  financial_charts: {
    stock_price_as_of: "2026-10-30",
    financials_as_of: "2026-09-30",
    stock_price_4m: [
      { date: "Jul '26", price: 42.1 },
      { date: "Aug '26", price: 45.9 },
      { date: "Sep '26", price: 41.2 },
      { date: "Oct '26", price: 47.8 },
    ],
    financial_performance_4q: [
      { quarter: "Q4 2025", revenue: 0.089, net_income: -0.06 },
      { quarter: "Q1 2026", revenue: 0.123, net_income: -0.05 },
      { quarter: "Q2 2026", revenue: 0.144, net_income: -0.042 },
      { quarter: "Q3 2026", revenue: 0.158, net_income: -0.035 },
    ],
  },
  // DCF-lite sanity panel inputs: TTM revenue = $0.514B → P/S(TTM) ≈ 65×,
  // TTM net margin ≈ −36%, P/S(fwd) vs FY guidance ≈ 54×. Kept consistent
  // with the quarterly chart above on purpose (the panel derives from it).
  valuation: {
    market_cap_b: 33.5,
    forward_revenue_guidance_b: 0.62,
    guidance_period_label: "FY 2026 revenue guidance midpoint",
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function corsHeaders(req, extra = {}) {
  const origin = req.headers.origin || "";
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, HTTP-Referer, X-Title, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access",
    "Access-Control-Max-Age": "86400",
    ...extra,
  };
}

function sseLine(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function chunk(delta, extra = {}) {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: null }],
    ...extra,
  };
}

/** Streams reasoning, then the fenced-JSON report text, then usage + [DONE]. */
async function streamChatCompletion(req, res, body) {
  // A "runaway agent" simulation: until the adapter's forced-synthesis note
  // appears in the history, every round emits a tavily_search tool_call.
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m?.role === "user");
  const forced = typeof lastUser?.content === "string" && /TOOL BUDGET REACHED/.test(lastUser.content);

  res.writeHead(200, {
    ...corsHeaders(req),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // "stall" in the model name → stream one chunk, then go silent forever.
  // Verifies Tickr's idle watchdog: the adapter should surface a loud
  // "Connection stalled" error (and the app should stay responsive) instead
  // of hanging on read() forever. Set localStorage tickr.debugIdleMs in dev.
  const stalled = typeof body?.model === "string" && /stall/.test(body.model);
  if (stalled) {
    res.write(sseLine(chunk({ reasoning: "mock: one chunk, then the connection goes silent" })));
    console.log("[mock-gateway] stall mode engaged — holding the stream open silently");
    req.on("close", () => console.log("[mock-gateway] stall mode: client disconnected (watchdog abort or stop)"));
    return; // res is intentionally never ended
  }

  const reasoningPieces = forced
    ? ["Tool budget exhausted; synthesizing the report from gathered context."]
    : [
        "The user wants a document analysis. ",
        "I will keep searching filings (mock runaway loop). ",
      ];

  if (!forced) {
    res.write(sseLine(chunk({ reasoning: reasoningPieces[0] })));
    // HEAVY=1: real reasoning models stream their thinking in many small
    // deltas — emit ~40 per round so the app's per-delta timeline handling
    // (one card per delta unless merged) is exercised at realistic volume.
    if (process.env.HEAVY === "1") {
      for (let d = 0; d < 40; d++) {
        res.write(sseLine(chunk({ reasoning: `d${d} thinking fragment ` })));
        await sleep(5);
      }
    }
    res.write(
      sseLine(
        chunk({
          tool_calls: [
            {
              index: 0,
              id: "call_mock_tavily",
              type: "function",
              function: {
                name: "tavily_search",
                // First model round exercises the quarterly-figure path
                // (page-extract gating); later rounds keep the filings loop.
                arguments:
                  messages.length <= 3
                    ? '{"query":"RKLB latest quarterly results revenue net income earnings press release"}'
                    : '{"query":"RKLB recent SEC filings 10-K 10-Q mock"}',
              },
            },
          ],
        })
      )
    );
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  for (const piece of reasoningPieces) {
    res.write(sseLine(chunk({ reasoning: piece })));
    await sleep(30);
  }

  const finalText = [
    "I scanned the filings and market data (mock fixture — no real documents were consulted).\n\n```json\n",
    JSON.stringify(REPORT, null, 2),
    "\n```\n\nReport complete.",
  ].join("");

  // HEAVY=1: profiling mode for memory/lag measurement sessions. Pads the
  // synthesis with filler prose on both sides of the fenced report so the
  // app's per-chunk extraction runs against a realistically large, growing
  // stream (~150 KB total, ~40 s of streaming): filler *before* the fence
  // exercises the partial-JSON parse-and-throw phase, filler *after* it
  // exercises the re-parse + re-render storm once the report is detectable.
  // Default behavior (no env var) is unchanged.
  const streamText =
    process.env.HEAVY === "1"
      ? "Scanning gathered context. " +
        "filler ".repeat(6000) +
        "\n\n" +
        finalText +
        "\n" +
        "post ".repeat(22000)
      : finalText;

  // Stream text in small deltas to exercise the incremental renderer.
  const SIZE = 48;
  for (let i = 0; i < streamText.length; i += SIZE) {
    res.write(sseLine(chunk({ content: streamText.slice(i, i + SIZE) })));
    await sleep(12);
  }

  res.write(
    sseLine(
      {
        id: "chatcmpl-mock",
        object: "chat.completion.chunk",
        model: MODEL_ID,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { total_tokens: 1832 },
      }
    )
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/v1/models") {
    res.writeHead(200, { ...corsHeaders(req), "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: MODEL_ID, object: "model" }] }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/prices") {
    // PRICES_FAIL=1 simulates an old/broken relay (Yahoo 429 upstream) so the
    // degraded "never estimate" fallback path can be e2e-tested locally.
    if (process.env.PRICES_FAIL === "1") {
      console.log(`[mock-gateway] prices route FAIL mode (PRICES_FAIL=1): ${url.searchParams.get("symbol")}`);
      res.writeHead(502, { ...corsHeaders(req), "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Price fetch failed: upstream 429" }));
      return;
    }
    console.log(`[mock-gateway] prices route hit: ${url.searchParams.get("symbol")}`);
    res.writeHead(200, { ...corsHeaders(req), "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        symbol: (url.searchParams.get("symbol") || "MOCK").toUpperCase(),
        as_of: "2026-10-30",
        // Mirrors the relay's /prices shape (Yahoo monthly closes, respelled).
        closes: [
          { month: "2026-06", price: 61.42 },
          { month: "2026-07", price: 64.95 },
          { month: "2026-08", price: 63.92 },
          { month: "2026-09", price: 69.68 },
          { month: "2026-10", price: 54.73 },
          { month: "2026-11", price: 54.9 },
        ],
      })
    );
    return;
  }

  if (req.method === "GET" && (url.pathname === "/v1/market" || url.pathname === "/market")) {
    // PRICES_FAIL=1 also blots out the market route: it simulates an old relay
    // that predates all data routes, so every deterministic injection degrades
    // to "search-only, never estimate".
    if (process.env.PRICES_FAIL === "1") {
      console.log(`[mock-gateway] market route FAIL mode (PRICES_FAIL=1): ${url.searchParams.get("symbol")}`);
      res.writeHead(502, { ...corsHeaders(req), "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Market fetch failed: upstream 429" }));
      return;
    }
    console.log(`[mock-gateway] market route hit: ${url.searchParams.get("symbol")}`);
    res.writeHead(200, { ...corsHeaders(req), "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        symbol: (url.searchParams.get("symbol") || "MOCK").toUpperCase(),
        // Mirrors the relay's /market shape (worker-computed daily-series
        // stats). Reference values consistent with the /prices fixture's Oct
        // close, per the real RKLB ground truth this fixture mirrors.
        source: "yahoo-finance-chart",
        currency: "USD",
        as_of: "2026-10-30",
        latest_close: 54.73,
        previous_close: 59.1,
        ytd_pct: -17.1,
        fifty_two_high: 151.0,
        fifty_two_low: 37.57,
        fifty_day_avg: 64.23,
        volume: 31500000,
      })
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) {
      res.writeHead(401, { ...corsHeaders(req), "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Missing Bearer key (mock gateway)" } }));
      return;
    }
    let raw = "";
    for await (const part of req) raw += part;
    console.log(`[mock-gateway] request body (${raw.length} bytes): ${raw.slice(0, 300)}`);
    let parsedBody = {};
    try { parsedBody = JSON.parse(raw || "{}"); } catch { parsedBody = {}; }
    console.log(
      `[mock-gateway] flags: model=${parsedBody?.model} ` +
      `tools=${Array.isArray(parsedBody?.tools) && parsedBody.tools.length ? parsedBody.tools.map((t) => t?.function?.name).join(",") : "none"} ` +
      `plugins=${parsedBody?.plugins ? JSON.stringify(parsedBody.plugins) : "none"} ` +
      `msgs=${Array.isArray(parsedBody?.messages) ? parsedBody.messages.length : "?"} ` +
      `msg2=${String(parsedBody?.messages?.[1]?.content || "").slice(0, 500).replace(/\n/g, " ")}`
    );
    await streamChatCompletion(req, res, parsedBody);
    console.log(`[mock-gateway] ${new Date().toLocaleTimeString()} served a chat completion`);
    return;
  }

  if (req.method === "POST" && url.pathname === "/anthropic/v1/messages") {
    if (!req.headers["x-api-key"]) {
      res.writeHead(401, { ...corsHeaders(req), "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Missing x-api-key (mock gateway)" } }));
      return;
    }
    let raw = "";
    for await (const part of req) raw += part;
    let parsedBody = {};
    try { parsedBody = JSON.parse(raw || "{}"); } catch { parsedBody = {}; }
    await streamAnthropicMessages(req, res, parsedBody);
    return;
  }

  if (
    req.method === "POST" &&
    url.pathname.startsWith("/v1beta/models/") &&
    url.pathname.includes(":streamGenerateContent")
  ) {
    let raw = "";
    for await (const part of req) raw += part;
    let parsedBody = {};
    try { parsedBody = JSON.parse(raw || "{}"); } catch { parsedBody = {}; }
    await streamGemini(req, res, parsedBody);
    return;
  }

  res.writeHead(404, { ...corsHeaders(req), "Content-Type": "text/plain" });
  res.end("Mock gateway: unknown route (use /v1/models, /v1/prices, /v1/market, /v1/chat/completions, /anthropic/v1/messages or /v1beta/models/*:streamGenerateContent)");
});

// ---------------------------------------------------------------------------
// Anthropic Messages API dialect (POST /anthropic/v1/messages) — exercises the
// runAnthropic adapter's tool-budget enforcement locally. Phase 1 narrates +
// runs SIX web_search cycles (the adapter must cut at budget+1 attempts and
// never see the tail); the follow-up tool-less synthesis request (detected by
// the forced-synthesis note) streams the report fixture.
// ---------------------------------------------------------------------------

const noop = () => {};

async function streamAnthropicMessages(req, res, body) {
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const isSynthesis =
    typeof body?.messages?.[0]?.content === "string" && /TOOL BUDGET REACHED/.test(body.messages[0].content);
  console.log(
    `[mock-gateway] anthropic messages: synthesis=${isSynthesis} ` +
      `tools=${tools.length ? `web_search(max_uses=${tools[0]?.max_uses})` : "none"} ` +
      `msgs=${body?.messages?.length}`
  );

  req.on("error", noop);
  res.on("error", noop);
  res.writeHead(200, {
    ...corsHeaders(req),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  // Client cuts the connection at the budget (reader.cancel) — drop writes.
  const write = (obj) => {
    if (!res.destroyed) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  if (isSynthesis) {
    write({ type: "message_start", message: { usage: { input_tokens: 200 } } });
    write({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    const finalText =
      "Synthesized from the interrupted transcript (mock fixture — no real documents were consulted).\n\n```json\n" +
      JSON.stringify(REPORT, null, 2) +
      "\n```";
    for (let i = 0; i < finalText.length; i += 48) {
      write({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: finalText.slice(i, i + 48) } });
      await sleep(10);
    }
    write({ type: "content_block_stop", index: 0 });
    write({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 300 } });
    res.end();
    return;
  }

  // Phase 1: input 100 tokens, narration, then SIX search cycles — with the
  // e2e budget of 4 the adapter must cut at attempt #5, so output_tokens
  // (sent only at the very end) never reach it.
  write({ type: "message_start", message: { usage: { input_tokens: 100 } } });
  write({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  const intro = "Starting the mock analysis of the requested ticker. I will interleave narration with web searches.";
  for (let i = 0; i < intro.length; i += 40) {
    write({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: intro.slice(i, i + 40) } });
    await sleep(8);
  }
  for (let k = 1; k <= 6; k++) {
    write({
      type: "content_block_start",
      index: k * 2 - 1,
      content_block: { type: "server_tool_use", id: `srvtoolu_${k}`, name: "web_search", input: { query: `mock search query ${k}` } },
    });
    await sleep(25);
    // HEAVY=1: pad the result title to ~84 KB so the app's tool_result
    // timeline details carry realistically huge payloads (profiling mode for
    // the detail-truncation path; default unchanged).
    const resultTitle =
      process.env.HEAVY === "1"
        ? `TRUNCATION-MARKER-${k} ` + "filler ".repeat(12000)
        : `Mock result ${k}`;
    write({
      type: "content_block_start",
      index: k * 2,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: `srvtoolu_${k}`,
        content: [{ type: "web_search_result", url: `https://example.com/mock/result-${k}`, title: resultTitle }],
      },
    });
    await sleep(25);
    write({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ` Search ${k} done. ` } });
    await sleep(10);
  }
  // Never seen by the adapter when the budget is < 6:
  write({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " (mock runaway tail — must have been cut)" } });
  write({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 50 } });
  res.end();
}

// ---------------------------------------------------------------------------
// Gemini streamGenerateContent dialect (POST /v1beta/models/*:streamGenerate…
// with alt=sse) — exercises runGemini's client-side budget enforcement: phase
// 1 grounds SIX distinct queries (adapter must cut at budget+1), the follow-up
// tool-less synthesis request streams the report fixture.
// ---------------------------------------------------------------------------

async function streamGemini(req, res, body) {
  const isSynthesis =
    typeof body?.contents?.[0]?.parts?.[0]?.text === "string" &&
    /TOOL BUDGET REACHED/.test(body.contents[0].parts[0].text);
  const hasSearchTool = Array.isArray(body?.tools) && body.tools.some((t) => t?.googleSearch);
  console.log(
    `[mock-gateway] gemini streamGenerateContent: synthesis=${isSynthesis} ` +
      `googleSearch=${hasSearchTool} contents=${body?.contents?.length}`
  );

  req.on("error", noop);
  res.on("error", noop);
  res.writeHead(200, {
    ...corsHeaders(req),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const write = (obj) => {
    if (!res.destroyed) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  const payload = (parts, grounding, usage) =>
    write({
      candidates: [{ content: { parts }, ...(grounding ? { groundingMetadata: grounding } : {}) }],
      ...(usage ? { usageMetadata: { totalTokenCount: usage } } : {}),
    });

  if (isSynthesis) {
    const finalText =
      "Synthesized from the interrupted transcript (mock fixture — no real documents were consulted).\n\n```json\n" +
      JSON.stringify(REPORT, null, 2) +
      "\n```";
    for (let i = 0; i < finalText.length; i += 48) {
      payload([{ text: finalText.slice(i, i + 48) }], null, null);
      await sleep(10);
    }
    payload([{ text: " Report complete." }], null, 400);
    res.end();
    return;
  }

  // Phase 1: narration + SIX grounding cycles, then a runaway tail the
  // adapter must never read when the budget is < 6.
  const intro = "Starting the mock analysis. I will ground every step with google_search.";
  for (let i = 0; i < intro.length; i += 40) {
    payload([{ text: intro.slice(i, i + 40) }], null, null);
    await sleep(8);
  }
  for (let k = 1; k <= 6; k++) {
    payload(
      [{ text: ` Search ${k} narrated. ` }],
      {
        webSearchQueries: [`mock gemini query ${k}`],
        groundingChunks: [{ web: { uri: `https://example.com/mock/gem-${k}`, title: `Mock Gemini source ${k}` } }],
      },
      null
    );
    await sleep(30);
  }
  payload([{ text: " (mock runaway tail — must have been cut)" }], null, 150);
  res.end();
}

server.listen(PORT, () => {
  console.log(`[mock-gateway] http://localhost:${PORT}/v1 — any Bearer key accepted`);
});
