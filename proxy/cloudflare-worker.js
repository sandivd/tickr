/**
 * Tickr CORS relay — Cloudflare Worker (paste-and-deploy, zero tooling).
 *
 * Purpose: forward Tickr's browser requests to an AI gateway that does not
 * allow direct browser connections (CORS), e.g. OpenCode Console's chat API.
 * It performs a dumb, secure relay:
 *   - forwards your Authorization header untouched (your key stays yours)
 *   - streams the response body straight through (SSE works)
 *   - adds CORS headers for the origins you allow
 *   - can only talk to ONE fixed upstream (set below) — it cannot be abused
 *     as a general-purpose proxy
 *
 * ─── Quick deploy (Cloudflare dashboard) ────────────────────────────────────
 * 1. dash.cloudflare.com → Compute (Workers) → Create → Worker → name e.g. "tickr-relay" → Deploy → Edit code
 * 2. Paste this whole file → Deploy.
 * 3. Optional hardening (Settings → Variables):
 *      UPSTREAM_BASE   = https://opencode.ai/inference/openai      (default; no need to set)
 *      ALLOWED_ORIGINS = https://sandivd.github.io,http://localhost:5173   ← strongly recommended
 *      PATH_PREFIX     = (leave empty)
 * 4. In Tickr settings (OpenCode provider) set
 *      Endpoint base URL = https://tickr-relay.<your-subdomain>.workers.dev/v1
 * 5. analyze. (Wrangler alternative: npx wrangler deploy proxy/cloudflare-worker.js)
 *
 * Security notes:
 *   - No keys are stored or logged here; the browser's Bearer header is relayed as-is.
 *   - ALWAYS set ALLOWED_ORIGINS once your worker is public, otherwise any site could
 *     relay through your worker (burning YOUR gateway quota, not your keys — but still).
 */

const DEFAULT_UPSTREAM = "https://opencode.ai/inference/openai";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_CHART2 = "https://query2.finance.yahoo.com/v8/finance/chart/";

// Non-"simple" requests (Authorization header, JSON body) require a preflight.
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env?.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);

  let allowOrigin = "";
  if (allowed.length === 0) {
    allowOrigin = origin || ""; // unset = permissive during setup; lock down ASAP
  } else if (origin) {
    allowOrigin = allowed.includes(origin) ? origin : "";
  }

  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, HTTP-Referer, X-Title",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
    if (origin) headers["Access-Control-Allow-Credentials"] = "false";
  }
  return headers;
}

// Map "< /path?query" → upstream path. Optional PATH_PREFIX mounts the relay
// under a sub-path (e.g. /opencode → https://x.workers.dev/opencode/v1/...).
function resolveTargetPath(url, env) {
  let pathname = url.pathname;
  const prefix = String(env?.PATH_PREFIX || "").replace(/^\/|\/$/g, "");
  if (prefix) {
    const withSlash = "/" + prefix;
    if (pathname === withSlash) return "/"; // bare prefix → upstream root
    if (pathname.startsWith(withSlash + "/")) pathname = pathname.slice(withSlash.length);
    else return null; // unknown path for this mount
  }
  if (pathname.includes("..")) return null;
  return pathname || "/";
}

// Shared, hardened Yahoo chart fetch for all public data routes:
// edge-caches the raw payload (30 min) so repeated runs skip Yahoo entirely,
// sends a deliberately browser-like request (a worker's default identity is
// refused outright), and alternates query1/query2 with two passes and backoff.
// Yahoo rate-limits cloud-egress IPs — observed upstream 429 from Cloudflare
// workers while residential IPs get clean data.
const YAHOO_BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.8",
  "Referer": "https://finance.yahoo.com/",
};

async function fetchYahooChartCached(symbol, range, interval, ttlSeconds = 1800) {
  const yahooUrl = (host) => host + encodeURIComponent(symbol) + `?range=${range}&interval=${interval}`;
  const cacheKey = new Request(yahooUrl(YAHOO_CHART), { method: "GET" });
  let j = null;
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit?.ok) j = await hit.json();
  } catch {
    /* dev runtime without edge cache */
  }
  if (j) return j;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4 && !j; attempt++) {
    const host = attempt % 2 === 0 ? YAHOO_CHART : YAHOO_CHART2;
    try {
      const y = await fetch(yahooUrl(host), { headers: YAHOO_BROWSER_HEADERS });
      if (y.ok) {
        j = await y.json();
        try {
          await caches.default.put(
            cacheKey,
            new Response(JSON.stringify(j), {
              headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttlSeconds}` },
            })
          );
        } catch {
          /* cache unavailable — run continues */
        }
      } else {
        lastStatus = y.status;
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  if (!j) throw new Error(`upstream ${lastStatus || "unreachable"}`);
  return j;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const headers = (extra = {}, status = 200) =>
      new Response(null, { status, headers: { ...cors, ...extra } });

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    // ── Public price-history route ──────────────────────────────────────────
    // GET /prices?symbol=RKLB&months=6 → month-end closes from Yahoo's public
    // chart API. Historical monthly closes are not text-searchable, so the
    // app fetches them here and feeds them to the model as authoritative
    // chart data. Public market data only — no keys, nothing stored, symbol
    // strictly validated. Scoped to the root mount: disabled when PATH_PREFIX
    // is in use (prefix deployments proxy AI chat only).
    if (request.method === "GET" && !String(env?.PATH_PREFIX || "")) {
      const u = new URL(request.url);
      if (u.pathname === "/prices" || u.pathname === "/v1/prices") {
        const raw = (u.searchParams.get("symbol") || "").trim();
        if (!/^[A-Za-z0-9._-]{1,15}$/.test(raw)) {
          return new Response(JSON.stringify({ error: "Bad symbol" }), {
            status: 400,
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
        const outHeaders = { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=900" };
        const months = Math.min(12, Math.max(1, Number(u.searchParams.get("months")) || 6));
        const symbol = raw.toUpperCase().replace(/\./g, "-");
        let j = null;
        try {
          j = await fetchYahooChartCached(symbol, "1y", "1mo");
        } catch (e) {
          return new Response(JSON.stringify({ error: `Price fetch failed: ${e?.message || e}` }), {
            status: 502,
            headers: outHeaders,
          });
        }
        try {
          const r = j?.chart?.result?.[0];
          const ts = r?.timestamp || [];
          const closesRaw = r?.indicators?.quote?.[0]?.close || [];
          if (!ts.length || !closesRaw.length) throw new Error("empty chart");
          // Yahoo stamps monthly bars at month start; a trailing duplicate of
          // the latest trading day may exist. Map overwrite keeps the newest
          // close per month regardless.
          const byMonth = new Map();
          ts.forEach((t, i) => {
            const c = closesRaw[i];
            if (typeof c !== "number" || !Number.isFinite(c)) return;
            byMonth.set(new Date(t * 1000).toISOString().slice(0, 7), c);
          });
          if (byMonth.size === 0) throw new Error("no closes");
          const closes = Array.from(byMonth, ([month, price]) => ({ month, price }));
          const asOf = new Date((r.meta?.regularMarketTime || ts[ts.length - 1]) * 1000).toISOString().slice(0, 10);
          return new Response(JSON.stringify({ symbol, as_of: asOf, closes: closes.slice(-months) }), {
            status: 200,
            headers: outHeaders,
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: `Price fetch failed: ${e?.message || e}` }), {
            status: 502,
            headers: outHeaders,
          });
        }
      }
    }

    // ── Public market-snapshot route ────────────────────────────────────────
    // GET /market?symbol=RKLB → current-level stats computed by the worker
    // from Yahoo's daily chart series (latest/previous close, YTD vs the
    // previous year's final close, 52-week high/low, 50-day average, latest
    // volume). Deterministic time-series math is exactly what text search
    // cannot do reliably (models derive YTD from mismatched article quotes).
    // Same guarantees as /prices: public data only, no keys, nothing stored,
    // symbol validated, disabled under PATH_PREFIX (prefix mounts proxy AI
    // chat only).
    if (request.method === "GET" && !String(env?.PATH_PREFIX || "")) {
      const u = new URL(request.url);
      if (u.pathname === "/market" || u.pathname === "/v1/market") {
        const raw = (u.searchParams.get("symbol") || "").trim();
        if (!/^[A-Za-z0-9._-]{1,15}$/.test(raw)) {
          return new Response(JSON.stringify({ error: "Bad symbol" }), {
            status: 400,
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
        // Tape freshness: the browser re-polls every minute, so it must be
        // allowed to — a long max-age here makes the tape re-read the same
        // cached body (up to 45 min stale stacked with the edge cache).
        const outHeaders = { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" };
        const symbol = raw.toUpperCase().replace(/\./g, "-");
        try {
          const j = await fetchYahooChartCached(symbol, "2y", "1d", 60);
          const r = j?.chart?.result?.[0];
          const ts = r?.timestamp || [];
          const q = r?.indicators?.quote?.[0] || {};
          const closes = ts
            .map((t, i) => ({ t, c: q.close?.[i] }))
            .filter((x) => Number.isFinite(x.c));
          if (closes.length < 2) throw new Error("empty chart");
          const last = closes[closes.length - 1];
          const asOf = new Date((r.meta?.regularMarketTime || last.t) * 1000).toISOString().slice(0, 10);
          const previousClose = closes[closes.length - 2].c;
          // YTD: change vs the previous calendar year's final close.
          const jan1 = Date.UTC(Number(asOf.slice(0, 4)), 0, 1) / 1000;
          let baseClose = null;
          for (const x of closes) {
            if (x.t < jan1) baseClose = x.c;
            else break;
          }
          const ytdPct = baseClose ? Math.round((last.c / baseClose - 1) * 1000) / 10 : null;
          // 52-week band across the last ~252 trading closes; 50-day average.
          const window52 = closes.slice(-252);
          const high = Math.round(Math.max(...window52.map((x) => x.c)) * 100) / 100;
          const low = Math.round(Math.min(...window52.map((x) => x.c)) * 100) / 100;
          const avg50 = Math.round(
            (closes.slice(-50).reduce((s, x) => s + x.c, 0) / Math.min(50, closes.length)) * 100
          ) / 100;
          const volArr = q.volume || [];
          let volume = null;
          for (let i = volArr.length - 1; i >= 0; i--) {
            if (Number.isFinite(volArr[i])) {
              volume = Math.round(volArr[i]);
              break;
            }
          }
          return new Response(
            JSON.stringify({
              symbol,
              source: "yahoo-finance-chart",
              currency: r.meta?.currency || "USD",
              as_of: asOf,
              latest_close: Math.round(last.c * 100) / 100,
              previous_close: Math.round(previousClose * 100) / 100,
              ytd_pct: ytdPct,
              fifty_two_high: high,
              fifty_two_low: low,
              fifty_day_avg: avg50,
              volume,
            }),
            { status: 200, headers: outHeaders }
          );
        } catch (e) {
          return new Response(JSON.stringify({ error: `Market fetch failed: ${e?.message || e}` }), {
            status: 502,
            headers: outHeaders,
          });
        }
      }
    }

    const upstreamBase = (env?.UPSTREAM_BASE || DEFAULT_UPSTREAM).toString().replace(/\/$/, "");
    if (!/^https:\/\/[^/]+/.test(upstreamBase)) {
      return new Response("Misconfigured UPSTREAM_BASE", { status: 500, headers: cors });
    }

    const reqUrl = new URL(request.url);
    const targetPath = resolveTargetPath(reqUrl, env);
    if (targetPath === null) {
      return new Response("Bucket path not allowed", { status: 404, headers: cors });
    }

    const target = new URL(upstreamBase);
    target.pathname = (target.pathname.replace(/\/$/, "") || "") + targetPath;
    target.search = reqUrl.search;

    // Relay, preserving method/headers/body; recompute host via the new URL.
    const relay = new Request(target.toString(), request);
    const upstream = await fetch(relay);

    const outHeaders = new Headers(upstream.headers);
    // Body was transparently decompressed by fetch(); stale headers would lie.
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");
    for (const [k, v] of Object.entries(cors)) if (v) outHeaders.set(k, v);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  },
};
