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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, HTTP-Referer, X-Title",
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
                arguments: '{"query":"RKLB recent SEC filings 10-K 10-Q mock"}',
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

  // Stream text in small deltas to exercise the incremental renderer.
  const SIZE = 48;
  for (let i = 0; i < finalText.length; i += SIZE) {
    res.write(sseLine(chunk({ content: finalText.slice(i, i + SIZE) })));
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

  res.writeHead(404, { ...corsHeaders(req), "Content-Type": "text/plain" });
  res.end("Mock gateway: unknown route (use /v1/models, /v1/prices, /v1/market or /v1/chat/completions)");
});

server.listen(PORT, () => {
  console.log(`[mock-gateway] http://localhost:${PORT}/v1 — any Bearer key accepted`);
});
