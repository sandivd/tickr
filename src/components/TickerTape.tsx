import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchMarketSnapshot } from '../lib/agent/marketData';

/** Well-known symbols for the marquee. */
const SYMBOLS = [
  'AAPL', 'MSFT', 'NVDA', 'AMD', 'AMZN', 'GOOGL', 'META', 'NFLX', 'DIS', 'BRK.B',
  'JPM', 'BAC', 'GS', 'V', 'XOM', 'WMT', 'KO', 'PEP', 'MCD', 'TSLA',
  'IBM', 'CRM', 'ORCL', 'SPY', 'QQQ',
];

const REFRESH_MS = 60_000;
/** Scroll pace in px/s — the animation duration is derived from the tape's
 * measured width, so the strip scrolls at this speed whether it is showing
 * priced quotes or has fallen back to bare symbols. */
const TAPE_SPEED_PX_S = 54;

interface TapeQuote {
  price: number;
  /** Day change vs previous close, in %. */
  pct: number | null;
  asOf: string;
}

/**
 * Marquee under the header. Quotes come from the shared relay's /market route
 * (public data only, no keys) — the real latest close and the real day change,
 * green up / red down. A symbol that fails falls back to its bare symbol; the
 * relay being down entirely shows the symbols-only strip. Nothing is ever
 * fabricated: no quote, no number.
 */
export function TickerTape() {
  const [quotes, setQuotes] = useState<Record<string, TapeQuote> | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    let cancelled = false;
    const load = async () => {
      const entries = await Promise.all(
        SYMBOLS.map(async (symbol): Promise<[string, TapeQuote | null]> => {
          const snap = await fetchMarketSnapshot(symbol, abort.signal);
          if (!snap) return [symbol, null];
          const pct = snap.previousClose
            ? ((snap.latestClose - snap.previousClose) / snap.previousClose) * 100
            : null;
          return [symbol, { price: snap.latestClose, pct, asOf: snap.asOf }];
        })
      );
      if (!cancelled) setQuotes(Object.fromEntries(entries) as Record<string, TapeQuote>);
    };
    load();
    const id = window.setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      abort.abort();
      window.clearInterval(id);
    };
  }, []);

  // Keep the scroll pace constant as the tape's width changes (priced items
  // are wider than bare symbols), and re-measure once fonts settle.
  useLayoutEffect(() => {
    const size = () => {
      const track = trackRef.current;
      const copy = track?.firstElementChild as HTMLElement | null;
      if (!track || !copy) return;
      const width = copy.getBoundingClientRect().width;
      if (width > 0) track.style.animationDuration = `${(width / TAPE_SPEED_PX_S).toFixed(1)}s`;
    };
    size();
    document.fonts.ready.then(size).catch(() => {});
  }, [quotes]);

  return (
    <div
      aria-hidden
      className="tickr-tape relative z-20 overflow-hidden border-b border-white/10 bg-black/25 backdrop-blur-md py-1.5 font-mono text-[11px] tracking-widest text-stone-400/80"
    >
      <div ref={trackRef} className="tickr-tape-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="tickr-tape-copy flex shrink-0 items-center gap-8 pr-8">
            {SYMBOLS.map((symbol) => {
              const q = quotes?.[symbol];
              const tone =
                q?.pct == null
                  ? 'text-stone-500'
                  : q.pct > 0.05
                    ? 'text-green-400'
                    : q.pct < -0.05
                      ? 'text-red-400'
                      : 'text-stone-500';
              const arrow = q?.pct == null ? '' : q.pct > 0.05 ? '▲' : q.pct < -0.05 ? '▼' : '→';
              return (
                <span key={symbol} className="flex items-center">
                  {q ? (
                    <span className="flex items-baseline gap-2" title={`Close ${q.asOf}`}>
                      {symbol}
                      <span className="text-stone-500">{q.price.toFixed(2)}</span>
                      <span className={tone}>
                        {arrow} {q.pct == null ? '' : Math.abs(q.pct).toFixed(1)}%
                      </span>
                    </span>
                  ) : (
                    symbol
                  )}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
