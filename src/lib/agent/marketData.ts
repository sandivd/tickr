/**
 * Exact month-end stock closes from Yahoo Finance's public chart API,
 * fetched through TICKR's shared relay (Yahoo blocks direct browser calls).
 *
 * Why this exists: the report's "past four months" price chart is a
 * deterministic time series that text search cannot retrieve — finance
 * history lives in interactive JS tables, not snippets — which is how free
 * model runs ended up fabricating historical prices. The app itself fetches
 * the real closes (agent/marketData → relay /prices → Yahoo) and the model
 * must transcribe them. Only public market data flows through /prices; no
 * keys, nothing stored.
 */

import { PRESETS } from "./presets";
import { composeAbort } from "./net";

export interface MonthlyClose {
  /** "YYYY-MM" — the close is that month's last trading day's close. */
  month: string;
  price: number;
}

export interface PriceHistory {
  /** ISO date of the latest trading session behind the last close. */
  asOf: string;
  /** Ascending by month; the final entry is the current (in-progress) month. */
  closes: MonthlyClose[];
}

const PRICE_TIMEOUT_MS = 10_000;
const PRICE_RELAY_KEY = "tickr.priceRelay"; // e2e/debug override

/** Relay base for the /prices route (no /v1). `tickr.priceRelay` overrides. */
export function resolvePriceRelayBase(): string {
  try {
    const override = globalThis.localStorage?.getItem?.(PRICE_RELAY_KEY);
    if (override && /^https?:\/\//.test(override)) return override.replace(/\/$/, "");
  } catch {
    /* non-browser context */
  }
  const v1Base = PRESETS.opencode?.baseUrl || "https://tickr-relay.sandiv-d2000.workers.dev/v1";
  return v1Base.replace(/\/v1\/?$/, "");
}

/**
 * Fetches month-end closes for a ticker via the relay. Returns null on any
 * failure (relay not deployed, route missing, network, timeout) so callers
 * degrade gracefully to the search-based path.
 */
export async function fetchMonthlyCloses(ticker: string, signal?: AbortSignal): Promise<PriceHistory | null> {
  const base = resolvePriceRelayBase();
  if (!base || !ticker) return null;
  const timeoutSignal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(PRICE_TIMEOUT_MS) : undefined;
  try {
    const resp = await fetch(`${base}/prices?symbol=${encodeURIComponent(ticker)}&months=6`, {
      method: "GET",
      signal: composeAbort(signal, timeoutSignal),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { as_of?: string; closes?: Array<{ month?: string; price?: number }> };
    const closes = (data.closes || [])
      .map((c) => ({ month: String(c?.month || ""), price: Number(c?.price) }))
      .filter((c) => /^\d{4}-\d{2}$/.test(c.month) && Number.isFinite(c.price));
    if (!data.as_of || !/^\d{4}-\d{2}-\d{2}$/.test(data.as_of) || closes.length < 3) return null;
    return { asOf: data.as_of, closes };
  } catch {
    return null;
  }
}

/**
 * Deterministic current-level stats (latest/previous close, YTD, 52-week
 * band, 50-day average, latest volume) computed by the relay from Yahoo's
 * daily series. Same rationale as the month-end closes: deriving these in a
 * model from mismatched article quotes is a fabrication class of its own —
 * "down X% YTD" and 52-week positioning must come from real series math.
 * Returns null on any failure so callers degrade gracefully.
 */
export interface MarketSnapshot {
  symbol: string;
  currency: string;
  /** ISO date of the latest session behind latestClose. */
  asOf: string;
  latestClose: number;
  previousClose: number | null;
  /** % change vs the previous calendar year's final close; null when unknown. */
  ytdPct: number | null;
  fiftyTwoHigh: number | null;
  fiftyTwoLow: number | null;
  fiftyDayAvg: number | null;
  volume: number | null;
}

function finiteOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function fetchMarketSnapshot(ticker: string, signal?: AbortSignal): Promise<MarketSnapshot | null> {
  const base = resolvePriceRelayBase();
  if (!base || !ticker) return null;
  const timeoutSignal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(PRICE_TIMEOUT_MS) : undefined;
  try {
    const resp = await fetch(`${base}/market?symbol=${encodeURIComponent(ticker)}`, {
      method: "GET",
      signal: composeAbort(signal, timeoutSignal),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      symbol?: string;
      currency?: string;
      as_of?: string;
      latest_close?: number;
      previous_close?: number;
      ytd_pct?: number;
      fifty_two_high?: number;
      fifty_two_low?: number;
      fifty_day_avg?: number;
      volume?: number;
    };
    const latestClose = finiteOrNull(data.latest_close);
    if (!data.as_of || !/^\d{4}-\d{2}-\d{2}$/.test(data.as_of) || latestClose === null) return null;
    return {
      symbol: String(data.symbol || ticker).toUpperCase(),
      currency: String(data.currency || "USD"),
      asOf: data.as_of,
      latestClose,
      previousClose: finiteOrNull(data.previous_close),
      ytdPct: finiteOrNull(data.ytd_pct),
      fiftyTwoHigh: finiteOrNull(data.fifty_two_high),
      fiftyTwoLow: finiteOrNull(data.fifty_two_low),
      fiftyDayAvg: finiteOrNull(data.fifty_day_avg),
      volume: finiteOrNull(data.volume),
    };
  } catch {
    return null;
  }
}
