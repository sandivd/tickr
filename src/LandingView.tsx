import { Activity, ShieldAlert, FileText, CheckCircle2, Info, AlertCircle, X } from 'lucide-react';
import { TickerInput } from './components/TickerInput';
import { DisclaimerRow } from './components/DisclaimerRow';
import { DecodeText } from './components/DecodeText';

export interface BgNotice {
  ticker: string;
  kind: 'ready' | 'error';
  message?: string;
}

export interface LandingViewProps {
  ticker: string;
  onTickerChange: (v: string) => void;
  onAnalyze: () => void;
  error: string | null;
  configured: boolean;
  onOpenSettings: () => void;
  tavilyUsed: number;
  tavilyKeySet: boolean;
  /** Yellow one-at-a-time message (e.g. a second ticker submitted mid-run). */
  barNotice: string | null;
  /** Ticker currently analyzing behind the landing screen, if any. */
  backgroundRun: string | null;
  /** Completed-in-background outcome surfaced on the landing. */
  bgNotice: BgNotice | null;
  onOpenNotice: () => void;
  onDismissNotice: () => void;
  onViewBackground: () => void;
}

/**
 * Terminal-styled landing: mono hero with a green chevron, outlined ticker
 * entry, thin green-bordered coverage panels, and a slim footer. Content is
 * identical to the previous landing — this is the visual reskin.
 */
export function LandingView({
  ticker,
  onTickerChange,
  onAnalyze,
  error,
  configured,
  onOpenSettings,
  tavilyUsed,
  tavilyKeySet,
  barNotice,
  backgroundRun,
  bgNotice,
  onOpenNotice,
  onDismissNotice,
  onViewBackground,
}: LandingViewProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
      <div className="w-full px-6 md:px-10 pt-5 md:pt-7 pb-4 [@media(max-height:800px)]:pt-4 [@media(max-height:800px)]:pb-2 flex flex-col min-h-full">
        {/* Hero */}
        <div className="max-w-3xl">
          <h1 className="font-mono font-medium text-[clamp(1.6rem,4.8vh,2.9rem)] tracking-tight text-stone-100 leading-[1.25]">
            <span className="text-green-400 mr-3">&gt;</span>
            <DecodeText text="Tickr, your intelligent financial document analyzer" accent="financial document" />
          </h1>
          <div className="tickr-draw w-16 h-0.5 bg-green-400/70 mt-4 [@media(max-height:800px)]:mt-3" style={{ animationDelay: '700ms' }} />
          <p className="font-mono text-sm md:text-base text-stone-400 mt-4 [@media(max-height:800px)]:mt-3">
            Automatically finds and synthesizes recent SEC filings and public disclosures.
          </p>
        </div>

        {/* Search + disclaimers */}
        <div className="mt-5 md:mt-7 w-full max-w-[64rem] [@media(max-height:800px)]:mt-5">
          {bgNotice && (
            <div className="mb-4 bg-[#0e1311]/90 backdrop-blur-md border border-green-500/40 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 font-mono text-sm min-w-0">
                {bgNotice.kind === 'ready' ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                )}
                <span className="text-stone-200 truncate" title={bgNotice.message}>
                  {bgNotice.kind === 'ready' ? (
                    <>
                      <span className="text-green-400 mr-2">&gt;</span>
                      {bgNotice.ticker} report is ready.
                    </>
                  ) : (
                    <>
                      <span className="text-red-400 mr-2">&gt;</span>
                      {bgNotice.ticker} run failed{bgNotice.message ? `: ${bgNotice.message}` : '.'}
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={onOpenNotice}
                  className="text-xs text-green-300 hover:text-green-200 border border-green-500/40 hover:border-green-500/60 rounded-md px-3 py-1.5 font-mono transition-colors"
                >
                  {bgNotice.kind === 'ready' ? 'Open report' : 'View details'}
                </button>
                <button onClick={onDismissNotice} title="Dismiss" className="text-stone-500 hover:text-stone-200 p-1.5">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          {barNotice && (
            <div className="mb-4 bg-yellow-500/10 border border-yellow-500/40 text-yellow-200 px-4 py-3 rounded font-mono text-sm">
              {barNotice}
            </div>
          )}
          {backgroundRun && (
            <div className="mb-3 flex items-center gap-2.5 font-mono text-xs text-green-300/80 animate-pulse drop-shadow-[0_0_8px_rgba(74,222,128,0.45)]">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
              <span>Analyzing {backgroundRun} in the background —</span>
              <button
                onClick={onViewBackground}
                className="underline underline-offset-2 decoration-green-500/40 hover:text-green-200 transition-colors"
              >
                View Progress
              </button>
            </div>
          )}
          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/50 text-red-200 px-4 py-3 rounded text-sm font-mono">
              {error}
            </div>
          )}
          {!configured && (
            <button
              onClick={onOpenSettings}
              className="mb-4 w-full bg-[#0e1311]/80 backdrop-blur-md border border-yellow-500/40 text-yellow-200 px-4 py-3 rounded font-mono text-sm text-left hover:bg-[#0e1311] transition-colors"
            >
              No AI provider connected yet — click here to set up your API key.
            </button>
          )}
          {/* The landing input stays live during a background run — a second
              submit is caught by App's one-run-at-a-time guard message. */}
          <TickerInput value={ticker} onChange={onTickerChange} onSubmit={onAnalyze} />
          <div className="mt-3 flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-stone-600 shrink-0" />
            <DisclaimerRow tavilyUsed={tavilyUsed} tavilyKeySet={tavilyKeySet} />
          </div>
        </div>

        {/* Panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 w-full mt-6 md:mt-9 [@media(max-height:800px)]:mt-6">
          {/* Card 1: Documents */}
          <section data-glow className="glow-card border border-green-500/25 bg-[#0d1210]/70 backdrop-blur-md rounded-lg p-5 [@media(max-height:800px)]:p-4 flex flex-col hover:border-green-500/40 transition-colors">
            <h3 className="font-mono text-base md:text-lg text-stone-200">
              <span className="text-green-400 mr-2">&gt;</span>
              <DecodeText text="Comprehensive SEC document coverage." delay={150} />
            </h3>
            <div className="tickr-draw w-14 h-0.5 bg-green-400/50 mt-2.5 mb-4 [@media(max-height:800px)]:mt-2 [@media(max-height:800px)]:mb-3" style={{ animationDelay: '850ms' }} />
            <div className="flex-1 flex flex-col gap-3 [@media(max-height:800px)]:gap-2.5">
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-md bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-400 shrink-0 [@media(max-height:800px)]:w-8 [@media(max-height:800px)]:h-8">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="font-mono text-sm text-stone-200">Form 10-K & 10-Q</div>
                  <div className="text-xs text-stone-500 mt-0.5">Annual and Quarterly Reports</div>
                </div>
              </div>
              <div className="h-px bg-white/5" />
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-md bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-400 shrink-0 [@media(max-height:800px)]:w-8 [@media(max-height:800px)]:h-8">
                  <Activity className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="font-mono text-sm text-stone-200">Form 8-K</div>
                  <div className="text-xs text-stone-500 mt-0.5">Current / Material Events</div>
                </div>
              </div>
              <div className="h-px bg-white/5" />
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-md bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-400 shrink-0 [@media(max-height:800px)]:w-8 [@media(max-height:800px)]:h-8">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="font-mono text-sm text-stone-200">Forms 3, 4, 5 & 13F</div>
                  <div className="text-xs text-stone-500 mt-0.5">Insider & Institutional Holdings</div>
                </div>
              </div>
            </div>
          </section>

          {/* Card 2: Analysis */}
          <section data-glow className="glow-card border border-green-500/25 bg-[#0d1210]/70 backdrop-blur-md rounded-lg p-5 [@media(max-height:800px)]:p-4 flex flex-col hover:border-green-500/40 transition-colors">
            <h3 className="font-mono text-base md:text-lg text-stone-200">
              <span className="text-green-400 mr-2">&gt;</span>
              <DecodeText text="Deep insights pulled directly from the source." delay={300} />
            </h3>
            <div className="tickr-draw w-14 h-0.5 bg-green-400/50 mt-2.5 mb-4 [@media(max-height:800px)]:mt-2 [@media(max-height:800px)]:mb-3" style={{ animationDelay: '1000ms' }} />
            <div className="flex-1 flex flex-col gap-3.5 justify-center [@media(max-height:800px)]:gap-3">
              <div className="flex items-center gap-3.5">
                <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                <div className="font-mono text-sm text-stone-300">Identify key takeaways and risks</div>
              </div>
              <div className="h-px bg-white/5" />
              <div className="flex items-center gap-3.5">
                <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                <div className="font-mono text-sm text-stone-300">Extract management commentary</div>
              </div>
              <div className="h-px bg-white/5" />
              <div className="flex items-center gap-3.5">
                <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                <div className="font-mono text-sm text-stone-300">Synthesize multiple filings into one report</div>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-auto pt-5 pb-2 [@media(max-height:800px)]:pt-3 flex items-center justify-between font-mono text-[11px] text-stone-600">
          <div className="flex items-center gap-3">
            <span className="text-stone-300 tracking-widest">
              TICKR<span className="text-green-400 tickr-blink">_</span>
            </span>
            <span className="text-stone-700">|</span>
            <span className="tracking-wider">Analyze. Understand. Act.</span>
          </div>
          <span className="tracking-wider">Made for informed investors.</span>
        </div>
      </div>
    </div>
  );
}
