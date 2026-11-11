/**
 * Rich diagnostics for browser fetch failures.
 *
 * A raw TypeError "Failed to fetch" says nothing about cause. This helper
 * re-throws with an actionable message naming the sanitized target URL
 * (path only — query strings are dropped because some providers — e.g.
 * Gemini — carry the API key there).
 */

export class RichFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RichFetchError";
  }
}

export function isAbort(err: unknown): boolean {
  return (err as { name?: string })?.name === "AbortError";
}

/**
 * Composes several AbortSignals into one, degrading gracefully on old
 * browsers (falls back piecewise instead of failing the run).
 */
export function composeAbort(...signals: (AbortSignal | undefined | null)[]): AbortSignal | undefined {
  const list = signals.filter((s): s is AbortSignal => !!s);
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  try {
    return AbortSignal.any(list);
  } catch {
    return list[0];
  }
}

/**
 * Stream-idle watchdog: providers occasionally open a connection and then
 * send nothing (mid-failover routers, drained free pools, flaky networks).
 * The adapters arm/re-arm this between reads; when it fires, the local
 * controller aborts and the run surfaces a clear "stalled" error instead of
 * hanging forever in a silent UI.
 *
 * `tickr.debugIdleMs` in localStorage overrides the threshold (dev/e2e only).
 */
export const STREAM_IDLE_MS = (() => {
  try {
    const v = Number(globalThis.localStorage?.getItem?.("tickr.debugIdleMs") ?? "");
    if (Number.isFinite(v) && v >= 500) return v;
  } catch {
    /* not a browser context */
  }
  return 45_000;
})();

export const TAVILY_TIMEOUT_MS = 20_000;

export class StreamWatchdog {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private _fired = false;

  constructor(private readonly onTimeout: () => void) {}

  /** Arm / re-arm between fetches and between SSE reads. */
  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this._fired = true;
      this.onTimeout();
    }, STREAM_IDLE_MS);
  }

  /** Disarm — between rounds or when the run completes. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  get fired(): boolean {
    return this._fired;
  }
}

function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "(invalid URL — check the endpoint in Settings)";
  }
}

function describeFetchFailure(err: unknown, url: string, providerLabel: string): string {
  const raw = err instanceof Error ? `${err.message}` : String(err);
  const networkLevel = /failed to fetch|networkerror|load failed/i.test(raw);
  if (networkLevel) {
    return [
      `Could not reach ${providerLabel} at ${sanitizeUrl(url)}. The request never completed — the usual causes:`,
      "1) The provider blocks direct browser calls (CORS) — OpenRouter, Anthropic and Google allow them; OpenAI's own API and some gateways do not.",
      "2) No internet / VPN / firewall / ad-blocker extension interfering.",
      "3) A wrong endpoint URL in Settings (custom providers must point at the /v1 chat-completions root).",
      "4) Opening the app directly from disk (file://) — host it with `npm run dev` or on GitHub Pages instead.",
    ].join(" ");
  }
  return raw;
}

export async function resilientFetch(url: string, init: RequestInit, providerLabel: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new RichFetchError(describeFetchFailure(err, url, providerLabel));
  }
}
