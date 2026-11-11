/**
 * Tavily credit meter — local estimate of the app's only metered resource.
 * Every tavily_search call costs 1 credit; Tavily's free tier grants about
 * 1,000 credits per month. The number counts searches this browser actually
 * issued (this app's runs); it can't see other apps on the same key.
 */

const KEY = "tickr.usage.v1";

interface UsageRecord {
  month: string;
  credits: number;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function read(): UsageRecord | null {
  try {
    const raw = globalThis.localStorage?.getItem?.(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UsageRecord;
    if (parsed && /^\d{4}-\d{2}$/.test(String(parsed.month)) && Number.isFinite(parsed.credits)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function write(rec: UsageRecord): void {
  try {
    globalThis.localStorage?.setItem?.(KEY, JSON.stringify(rec));
  } catch {
    /* metering must never break a run */
  }
}

/** Records n Tavily credits (attribute to the current calendar month). */
export function recordTavilyCredits(count = 1): void {
  if (count <= 0) return;
  const month = currentMonth();
  const prev = read();
  const credits = prev && prev.month === month ? prev.credits + count : count;
  write({ month, credits });
}

/** This browser's estimated Tavily usage for the current calendar month. */
export function getMonthlyUsage(): { month: string; credits: number } {
  const month = currentMonth();
  const prev = read();
  return prev && prev.month === month ? { month, credits: prev.credits } : { month, credits: 0 };
}
