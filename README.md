# TICKR

**Your AI document analyst for stocks and ETFs.** Type a ticker — TICKR sends an agent that hunts down recent SEC filings (10-K, 10-Q, 8-K, DEF 14A, Forms 3/4/5, or fund prospectus/N-CSR/N-PORT filings for ETFs), cross-checks live web data, and synthesizes everything into a single structured report: executive verdict, conviction score, deep insights, charts, and a findings grid with source links.

Everything runs **entirely in your browser** — there's no backend and no account. You bring the API key, TICKR brings the analyst.

> **Disclaimer:** AI can make mistakes. TICKR output is research assistance, not financial advice.

## Features

- 🏛️ **SEC-first agent workflow** — document hunts mandate `filetype:pdf` search grounding, accurate form labeling (never mangles N-CSR vs. derivative reports), and at least 10 candidate filings per run.
- 🧭 **Live agent timeline** — watch every search query, retrieved source, and reasoning step as it happens.
- 📄 **Structured report** — executive verdict + deterministic conviction-score rubric (50 base, +growth, +commentary, −risk), quantitative charts (4 months of prices, 4 quarters of revenue/net income — or distributions for ETFs), deep insights with impact scores, and per-document findings with dates and URLs.
- ⏱️ **Fresh-data floor** — before the model starts, TICKR pre-runs three recency-filtered Tavily searches (today's price, latest quarterly results, recent filings) and injects them as context, so even tool-shy free models can't serve stale training-data charts. Chart data carries an `as_of` date and a visible chip flags anything older than ~45 days (prices) / ~8 months (quarters).
- 🎚️ **Agent tool budget** — a settings slider (4–16 rounds, default 16) caps how many search rounds the agent may spend before it must synthesize. At ≤8 the run goes **lean**: a smaller mandatory filing sweep (~6 instead of ~10), slimmer search payloads, and a much shorter final report turn — free-tier models that took 15–20 min finish in a fraction of that. The app-injected price/market data is exact at any budget; a lower budget narrows document *breadth*, never factual grounding.
- 🔀 **Bring your own key (BYOK), any provider** — first open asks for a provider + API key and stores it locally. Supported out of the box:

| Provider | Web search |
| --- | --- |
| **OpenRouter** (any model behind one key) | Via your own Tavily key; OpenRouter's own plugin is opt-in in Settings (billed per search) |
| **OpenCode Console** (`opencode.ai/console` models) | Via optional Tavily fallback |
| **Anthropic (Claude)** | Anthropic's server-side `web_search` tool |
| **Google (Gemini)** | Native `google_search` grounding |
| **Custom** (any OpenAI-compatible endpoint: Groq, LM Studio, vLLM, your own gateway...) | Via optional Tavily fallback |

[Tavily](https://tavily.com) is the default search channel for OpenRouter, OpenCode and custom gateways — add a free-tier `tvly-...` key in Settings and every model gains grounded search. OpenRouter's native web plugin stays **off by default**: OpenRouter bills it per search (~$0.007, even on free models) straight to your credits, and a $0-balance account that goes negative freezes entirely. It's a consent checkbox in Settings for those who want it. For a strict-$0 run: `openrouter/free` (or any `:free` model) + your own Tavily key.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173, connect your provider in the settings modal, and analyze your first ticker.

## Deploying (GitHub Pages)

The `deploy` workflow builds the static bundle and publishes it via GitHub Pages on every push to `main`. Enable **Settings → Pages → Source: GitHub Actions**, then push. No server, no secrets — visitors connect their own keys in their own browsers.

## Using the OpenCode Console key

OpenCode's chat gateway does not accept direct browser connections (no CORS on `/chat/completions`), so chat runs are relayed through a one-paste Cloudflare Worker ([`proxy/cloudflare-worker.js`](proxy/cloudflare-worker.js)): it stores nothing, logs nothing, and streams responses straight through — your key travels from your browser to OpenCode and nowhere else. **For visitors this is invisible**: select OpenCode, paste a Console key from [opencode.ai/console](https://opencode.ai/console), analyze. The model list and "Test connection" always use OpenCode's public catalog endpoint directly; only chat traffic goes through the relay.

The bundled default relay (`tickr-relay.sandiv-d2000.workers.dev`) is maintained by the site owner and locked to its deployed origins via Cloudflare variables. Prefer running your own pipe? ~2 minutes:

1. `dash.cloudflare.com` → **Compute (Workers) → Create → Worker**, name it (e.g. `tickr-relay`) → Deploy → **Edit code**.
2. Paste the whole file → **Deploy**.
3. **Settings → Variables & Secrets**: set `ALLOWED_ORIGINS` to `https://<your-user>.github.io,http://localhost:5173`.
4. In TICKR's settings → OpenCode → **Endpoint base URL**: `https://<your-worker>.<your-subdomain>.workers.dev/v1`.

> **Note (Nov 2026):** the relay gained two public data routes — `/prices`, which feeds the app exact Yahoo month-end closes for the stock-price chart, and `/market`, which computes the current-level market snapshot (latest/previous close, YTD vs prior year-end, 52-week range, 50-day average, volume) from Yahoo's daily series. Search engines can't retrieve this math, so models used to fabricate it. Re-deploy the current `proxy/cloudflare-worker.js` if your worker predates these routes — otherwise everything still works, but the price chart and market snapshot fall back to search-only with the strict "never estimate" rule. The default relay already serves both.

(Wrangler users: `npx wrangler deploy proxy/cloudflare-worker.js`.)

## Where are my keys stored?

In your browser's `localStorage`, under one namespaced entry (`tickr.settings.v1`). TICKR is a static app: keys are sent only to the provider you chose, and never to any server the author controls (there is no such server). You can wipe everything with the "Clear stored data" button in settings.

## Project structure

```
src/
  App.tsx                  # main app: run flow, timeline, settings wiring
  LandingView.tsx          # landing / marketing view
  ReportTemplate.tsx       # report dashboard (verdict, charts, findings)
  components/
    AgentTimeline.tsx      # live event timeline
    HistoryDrawer.tsx      # saved-report shelf (per-ticker conviction trends)
    SettingsModal.tsx      # provider/key configuration (first-run + manual)
    PulsatingDots.tsx      # animated canvas background
  lib/
    settings.ts            # localStorage settings store
    history.ts             # saved-report history store (localStorage)
    usage.ts               # local Tavily credit meter (localStorage)
    agent/
      prompt.ts            # TICKR analyst instructions + report JSON schema
      parser.ts            # robust extraction of the report JSON from model text
      tavily.ts            # optional universal web-search fallback tool
      presets.ts           # provider presets & auth styles
      providers/
        openaiCompatible.ts # OpenRouter / OpenCode Console / custom gateways
        anthropic.ts        # Claude + server-side web_search
        gemini.ts           # Gemini + google_search grounding
proxy/
  cloudflare-worker.js    # optional 1-paste CORS relay for OpenCode Console
scripts/
  mock-gateway.mjs        # local offline mock gateway (dev/e2e, zero deps)
```

Each provider adapter normalizes its streaming API into a common event stream (`thinking`, `tool_call`, `tool_result`, `text`, `complete`) that the timeline renders — adding a provider means adding one adapter file plus a preset entry.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production bundle in `dist/` |
| `npm run preview` | Preview the built bundle |
| `npm run lint` | TypeScript type checking (`tsc --noEmit`) |
