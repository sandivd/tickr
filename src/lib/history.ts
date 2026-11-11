/**
 * Saved-report history — the app's longitudinal memory, stored entirely in
 * localStorage (same rule as keys: nothing leaves the browser).
 *
 * Each entry keeps the FULL report JSON so a past report can be reopened
 * exactly as it was produced (documents, charts, insights), plus the run's
 * metadata (provider, model, credit cost, staleness anchors) powering the
 * history shelf and per-ticker conviction trend.
 */

import type { ReportData } from "../App";
import type { MarketSnapshot } from "./agent/marketData";

export interface HistoryEntry {
  /** Stable unique id (timestamp + random suffix). */
  id: string;
  ticker: string;
  /** ISO instant when the run completed. */
  savedAt: string;
  providerId: string;
  providerLabel: string;
  model: string;
  conviction: number | null;
  summary: string;
  priceAsOf?: string;
  financialsAsOf?: string;
  /** Tavily searches consumed by this run (1 credit each, estimate). */
  tavilyCredits: number;
  tokens: number;
  seconds: number;
  runs: number;
  snapshot: MarketSnapshot | null;
  report: ReportData;
}

const KEY = "tickr.history.v1";
const MAX_ENTRIES = 30;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem?.(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HistoryEntry =>
        !!e &&
        typeof (e as HistoryEntry).id === "string" &&
        typeof (e as HistoryEntry).ticker === "string" &&
        typeof (e as HistoryEntry).savedAt === "string" &&
        !!(e as HistoryEntry).report
    );
  } catch {
    return [];
  }
}

/** Appends an entry (newest first) and persists a FIFO-capped list. */
export function appendHistory(prev: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...prev].slice(0, MAX_ENTRIES);
  try {
    globalThis.localStorage?.setItem?.(KEY, JSON.stringify(next));
  } catch {
    // Full quota (large stored reports): drop the deepest entries and retry
    // once rather than losing the freshest run.
    try {
      const trimmed = [entry, ...prev.slice(Math.max(0, next.length - 2))].slice(0, Math.max(4, next.length - 10));
      globalThis.localStorage?.setItem?.(KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  }
  return next;
}

export function removeHistory(prev: HistoryEntry[], id: string): HistoryEntry[] {
  const next = prev.filter((e) => e.id !== id);
  try {
    globalThis.localStorage?.setItem?.(KEY, JSON.stringify(next));
  } catch {
    /* keep in-memory state even if persistence fails */
  }
  return next;
}

export function clearHistory(): void {
  try {
    globalThis.localStorage?.removeItem?.(KEY);
  } catch {
    /* nothing to do */
  }
}
