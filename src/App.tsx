import { LandingView } from './LandingView';
import type { BgNotice } from './LandingView';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Settings as SettingsIcon, Download, History as HistoryIcon, X } from 'lucide-react';
import { TickerInput } from './components/TickerInput';
import { DisclaimerRow } from './components/DisclaimerRow';
import wallstreetBg from './assets/wallstreet-bg.jpg';
import frankfurtBg from './assets/exchange-frankfurt-bg.jpg';
import canaryWharfBg from './assets/exchange-canarywharf-bg.jpg';
import tradingRoomBg from './assets/trading_room_recreation_4k.jpg';
import wallStreetSignBg from './assets/wall_street_recreation_4k.jpg';
import chargingBullBg from './assets/charging_bull_recreation_4k.jpg';
import ReportTemplate from "./ReportTemplate";
import { AgentTimeline } from './components/AgentTimeline';
import type { TimelineEvent } from './components/AgentTimeline';
import { SettingsModal } from './components/SettingsModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { loadSettings, saveSettings, isConfigured, normalizeBudget } from './lib/settings';
import { loadHistory, appendHistory, removeHistory, clearHistory } from './lib/history';
import { initBorderGlow } from './lib/motion';
import { TickerTape } from './components/TickerTape';
import type { HistoryEntry } from './lib/history';
import { getMonthlyUsage } from './lib/usage';
import { runAgentEventStream, PRESETS, extractReportJson } from './lib/agent';
import type { AgentEvent, Settings as SettingsState } from './lib/agent';
import type { MarketSnapshot } from './lib/agent/marketData';

export interface DocumentFinding {
  documentType?: string;
  document_type?: string;
  keyInsights?: string[];
  key_insights?: string[];
  date?: string;
  sourceUrl?: string;
  source_url?: string;
}

export interface DeepInsight {
  category: string;
  title: string;
  description: string;
  impact_score: number;
}

export interface ReportData {
  verdict?: {
    summary: string;
    conviction_score: number;
    key_takeaways: string[];
  };
  deep_insights?: DeepInsight[];
  findings?: DocumentFinding[];
  financial_charts?: {
    stock_price_as_of?: string;
    financials_as_of?: string;
    stock_price_4m: { date: string; price: number }[];
    financial_performance_4q: { quarter: string; revenue?: number; net_income?: number; distributions?: number }[];
  };
  /** DCF-lite sanity inputs (optional schema extension; omitted when unconfirmed). */
  valuation?: {
    market_cap_b?: number;
    forward_revenue_guidance_b?: number;
    guidance_period_label?: string;
  };
}

/**
 * Terminal backdrop: faint green grid + depth gradients over a rotating
 * carousel of exchange/finance shots (Wikimedia Commons photos plus locally
 * supplied recreations — see README Credits). A left-heavy overlay keeps
 * hero/timeline text legible over any of them. Every layer stays mounted so
 * all images load up front and the 20s auto-switch is a slow crossfade, not
 * a reload.
 */
const BACKDROPS: Array<{ src: string; position: string; label: string }> = [
  { src: wallstreetBg, position: 'center 8%', label: 'new-york-stock-exchange' },
  { src: tradingRoomBg, position: 'center 45%', label: 'trading-floor-screens' },
  { src: frankfurtBg, position: 'center 30%', label: 'boerse-frankfurt' },
  { src: wallStreetSignBg, position: 'center 32%', label: 'wall-street-sign' },
  { src: canaryWharfBg, position: 'center 30%', label: 'canary-wharf' },
  { src: chargingBullBg, position: '60% 40%', label: 'charging-bull' },
];

/** How often the backdrop auto-advances (one full fade between shots). */
const BACKDROP_INTERVAL_MS = 20_000;
/** Crossfade length between the outgoing and incoming photo. */
const BACKDROP_FADE_MS = 2_500;

function Backdrop() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setActive((i) => (i + 1) % BACKDROPS.length), BACKDROP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <div aria-hidden className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      {BACKDROPS.map((b, i) => (
        <img
          key={b.label}
          src={b.src}
          alt=""
          data-backdrop={b.label}
          className="absolute inset-0 w-full h-full object-cover transition-opacity ease-in-out"
          style={{
            objectPosition: b.position,
            opacity: i === active ? 1 : 0,
            transitionDuration: `${BACKDROP_FADE_MS}ms`,
          }}
        />
      ))}
      {/* Global charcoal wash + left-heavy darkening: hero text lives on
          near-black, the photo breathes (dimly) on the right. */}
      <div className="absolute inset-0 bg-[#0A0C0B]/38" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0A0C0B] via-[#0A0C0B]/75 to-[#0A0C0B]/45" />
      {/* Faint green terminal grid. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(74,222,128,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(74,222,128,0.04) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#0A0C0B] via-[#0A0C0B]/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#0A0C0B] to-transparent" />
    </div>
  );
}

export default function App() {
  useEffect(() => initBorderGlow(), []);
  const [settings, setSettings] = useState<SettingsState>(() => loadSettings());
  // Never auto-open on load — the landing should be immediately viewable.
  // Unconfigured users are prompted contextually when they hit Analyze.
  const [settingsOpen, setSettingsOpen] = useState<'first-run' | 'manual' | false>(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  // Explicit home-screen flag: the logo can send the user home while a run
  // keeps going in the background, so "landing" can no longer be derived
  // from run state alone.
  const [atHome, setAtHome] = useState(false);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const [barNotice, setBarNotice] = useState<string | null>(null);
  const [bgNotice, setBgNotice] = useState<BgNotice | null>(null);

  const [ticker, setTicker] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [tokenCount, setTokenCount] = useState<number>(0);
  const [toolRuns, setToolRuns] = useState<number>(0);
  const [durationSecs, setDurationSecs] = useState<number>(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [histories, setHistories] = useState<HistoryEntry[]>(() => loadHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [tavilyUsed, setTavilyUsed] = useState(() => getMonthlyUsage().credits);
  const roundBudget = normalizeBudget(settings.agentRoundBudget);

  const abortRef = useRef<AbortController | null>(null);
  const stoppedByUserRef = useRef(false);
  const eventIdRef = useRef(0);
  const accumulatedTextRef = useRef('');
  // Mid-stream report extraction is the hot path of every run: the
  // accumulated text grows to tens/hundreds of KB, so a full sweep per
  // streamed token is quadratic — and once the JSON parses, re-parsing +
  // setReportData on every remaining chunk re-renders the whole app per
  // token (the RAM spike + lag). Throttled to 4 Hz and stopped on first
  // hit; the authoritative extract runs once at stream end (below).
  const lastExtractRef = useRef(0);
  const midStreamReportRef = useRef(false);
  const rawEventsRef = useRef<AgentEvent[]>([]);
  const activeTickerRef = useRef('');
  const snapshotRef = useRef<MarketSnapshot | null>(null);
  const atHomeRef = useRef(false);
  const barNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (running && startTime) {
      interval = setInterval(() => {
        setDurationSecs(Math.round((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [running, startTime]);

  // Keep the home flag readable from the async run loop (stale-closure safe).
  useEffect(() => {
    atHomeRef.current = atHome;
  }, [atHome]);

  const pushEvent = useCallback(
    (kind: TimelineEvent['kind'], label: string, detail?: string, toolName?: string, callId?: string) => {
      // Details render into the DOM and live in state for the whole run — a
      // single search result can be tens of KB, and the card clips at
      // max-h-40 anyway. Keep a readable prefix here; the full text stays in
      // rawEventsRef so the exported run log keeps full fidelity.
      const MAX_DETAIL_CHARS = 2000;
      // Marker we append when a detail is clipped; stripping it (never the
      // model's own text) before a merge keeps repeated appends lossless and
      // deterministic.
      const TRUNCATION_MARKER = '\n… [truncated';
      const truncateDetail = (raw: string) =>
        raw.length > MAX_DETAIL_CHARS
          ? `${raw.slice(0, MAX_DETAIL_CHARS)}${TRUNCATION_MARKER} ${(raw.length - MAX_DETAIL_CHARS).toLocaleString()} chars — full text in Export log]`
          : raw;
      // Reasoning models stream their thinking as many small deltas — one
      // event per chunk. Rendering each as its own timeline card builds a
      // wall of hundreds of blurred cards, which is what makes closing an
      // opened report stall for seconds while the timeline remounts. Merge
      // consecutive still-open thinking deltas into a single card that keeps
      // ticking (endTime stays undefined) until the next non-thinking event;
      // rawEventsRef above keeps every delta for export fidelity.
      const now = Date.now();
      setEvents((prev) => {
        const lastIndex = prev.length - 1;
        const last = lastIndex >= 0 ? prev[lastIndex] : null;
        if (last && kind === 'thinking' && last.kind === 'thinking' && last.label === label && !last.endTime) {
          const merged = [...prev];
          const rawPrev =
            last.detail && last.detail.includes(TRUNCATION_MARKER)
              ? last.detail.slice(0, last.detail.lastIndexOf(TRUNCATION_MARKER))
              : last.detail ?? '';
          merged[lastIndex] = { ...last, detail: truncateDetail(`${rawPrev}${detail ?? ''}`) };
          return merged;
        }
        const newEvents = [...prev];
        if (last) {
          newEvents[lastIndex] = { ...last, endTime: now };
        }
        newEvents.push({
          id: eventIdRef.current++,
          kind,
          label,
          detail: detail ? truncateDetail(detail) : detail,
          toolName,
          startTime: now,
          callId,
        });
        return newEvents;
      });
    },
    []
  );

  // Stable props for the memoized AgentTimeline: without these, every App
  // re-render (including the per-run state churn) would hand the memo fresh
  // function/object identities and defeat it.
  const openReport = useCallback(() => setIsReportOpen(true), []);
  const timelineMetrics = useMemo(
    () =>
      reportData
        ? {
            durationSecs,
            tokenCount,
            documentCount: reportData.findings?.length || 0,
          }
        : undefined,
    [reportData, durationSecs, tokenCount]
  );

  const exportRunLog = () => {
    const providerCfg = settings.providers[settings.activeProvider];
    const payload = {
      ticker: activeTickerRef.current,
      exported_at: new Date().toISOString(),
      // Provider/model diagnostics only — never the API key itself.
      provider: {
        id: settings.activeProvider,
        label: PRESETS[settings.activeProvider].label,
        model: providerCfg?.model || PRESETS[settings.activeProvider].defaultModel,
        tavilyConfigured: !!settings.tavilyKey,
        // Diagnostics only — did the (billed) OpenRouter plugin take part?
        webPluginOn: !!providerCfg?.webPluginOn,
      },
      events: rawEventsRef.current,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tickr_run_${activeTickerRef.current || 'report'}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleSaveSettings = (next: SettingsState) => {
    // Seed empty model names with preset defaults.
    for (const id of Object.keys(next.providers) as (keyof typeof next.providers)[]) {
      next.providers[id].model = next.providers[id].model || PRESETS[id].defaultModel;
    }
    next.agentRoundBudget = normalizeBudget(next.agentRoundBudget);
    setSettings(next);
    saveSettings(next);
    setSettingsOpen(false);
  };

  // Transient one-at-a-time message above the entry row (auto-clears).
  const showBarNotice = (msg: string) => {
    setBarNotice(msg);
    if (barNoticeTimerRef.current) clearTimeout(barNoticeTimerRef.current);
    barNoticeTimerRef.current = setTimeout(() => setBarNotice(null), 8000);
  };

  const runAnalysis = async (explicitTicker?: string) => {
    // Tickers are canonical uppercase everywhere they surface (agent screen,
    // notices, modal, guard message) — the entry field only displays
    // uppercase via CSS, so normalize at the source.
    const activeTicker = (explicitTicker ?? ticker).trim().toUpperCase();
    // Re-runs launched from history target the archived ticker even if the
    // input field says something else — keep the input in sync with it.
    if (explicitTicker) setTicker(activeTicker);
    const preset = PRESETS[settings.activeProvider];
    const providerConfig = settings.providers[settings.activeProvider];
    if (!activeTicker) return;
    if (running) {
      // Only one run at a time — tell the user instead of silently ignoring.
      showBarNotice(
        `One analysis is still running (${activeTickerRef.current || 'previous ticker'}) — stop it first or wait for it to finish.`
      );
      return;
    }
    if (!providerConfig?.apiKey) {
      // Unconfigured: open the modal in its onboarding flavor ("Connect your
      // AI provider" / "Skip for now") — contextually, not on page load.
      setSettingsOpen('first-run');
      return;
    }
    // Merge preset fallbacks (built-in endpoint URL / default model) under the
    // user's stored per-provider config.
    const provider = { baseUrl: preset.baseUrl, model: preset.defaultModel, ...providerConfig };

    setRunning(true);
    setError(null);
    setReportData(null);
    setIsReportOpen(false);
    setEvents([]);
    setBarNotice(null);
    if (barNoticeTimerRef.current) clearTimeout(barNoticeTimerRef.current);
    setBgNotice(null);
    atHomeRef.current = false;
    setAtHome(false);
    setToolRuns(0);
    setTokenCount(0);
    setDurationSecs(0);
    setStartTime(Date.now());
    eventIdRef.current = 0;
    accumulatedTextRef.current = '';
    lastExtractRef.current = 0;
    midStreamReportRef.current = false;
    rawEventsRef.current = [];
    activeTickerRef.current = activeTicker;
    stoppedByUserRef.current = false;
    snapshotRef.current = null;
    setSnapshot(null);
    // Resync the meter from storage each run (handles month rollover etc.)
    // and remember the baseline — the entry's credit cost is the delta over
    // this run.
    const tavilyStart = getMonthlyUsage().credits;
    setTavilyUsed(tavilyStart);

    const controller = new AbortController();
    abortRef.current = controller;
    const startTimestamp = Date.now();
    let currentToolRuns = 0;
    let runTokens = 0;
    let finalData: ReportData | null = null;
    let lastErrorMsg: string | null = null;

    try {
      for await (const evt of runAgentEventStream({
        preset,
        provider,
        tavilyKey: settings.tavilyKey,
        ticker: activeTicker,
        roundBudget,
        signal: controller.signal,
      })) {
        rawEventsRef.current.push(evt);

        if (evt.type === 'text' && evt.text) {
          accumulatedTextRef.current += evt.text;
          if (!midStreamReportRef.current && Date.now() - lastExtractRef.current >= 250) {
            lastExtractRef.current = Date.now();
            const found = extractReportJson(accumulatedTextRef.current);
            if (found) {
              midStreamReportRef.current = true;
              setReportData(found as never as ReportData);
            }
          }
        } else if (evt.type === 'market_snapshot') {
          snapshotRef.current = evt.data;
          setSnapshot(evt.data);
        } else if (evt.type === 'tool_call') {
          currentToolRuns += 1;
          setToolRuns(currentToolRuns);
          const name = evt.name || 'tool';
          const args = evt.arguments as { query?: string } | undefined;
          const label = /search/i.test(name)
            ? `Searching web: ${args?.query || ''}`
            : `Using tool: ${name}`;
          pushEvent('tool_call', label, args?.query || JSON.stringify(evt.arguments ?? {}, null, 2), name, evt.callId);
        } else if (evt.type === 'tool_result') {
          pushEvent('tool_result', 'Analysis retrieved', evt.result, undefined, evt.callId);
        } else if (evt.type === 'thinking') {
          pushEvent('thinking', 'Analyzing...', evt.text);
        } else if (evt.type === 'complete') {
          runTokens = evt.interaction?.usage?.total_tokens || 0;
          if (runTokens > 0) setTokenCount(runTokens);
        } else if (evt.type === 'error') {
          lastErrorMsg = evt.message;
          setError(evt.message);
        }
      }

      // Full text is available now — redo extraction once, end-state.
      finalData = extractReportJson(accumulatedTextRef.current) as never as ReportData;
      if (finalData) setReportData(finalData);
      const ranSecs = Math.round((Date.now() - startTimestamp) / 1000);
      setDurationSecs(ranSecs);
      // Credits actually consumed by this run (fetch attempts issued via
      // searchTavily; skipped searches and native search never count).
      const tavilyCredits = getMonthlyUsage().credits - tavilyStart;
      setTavilyUsed(getMonthlyUsage().credits);
      // Archive the completed run to the local history shelf (FIFO cap 30).
      // A user-stopped run has no analysis result — never archived.
      if (finalData && !stoppedByUserRef.current) {
        const out = finalData as never as ReportData;
        const entry: HistoryEntry = {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          ticker: activeTicker,
          savedAt: new Date().toISOString(),
          providerId: settings.activeProvider,
          providerLabel: PRESETS[settings.activeProvider].label,
          model: provider.model,
          conviction:
            typeof out.verdict?.conviction_score === 'number' ? out.verdict.conviction_score : null,
          summary: out.verdict?.summary || '',
          priceAsOf: out.financial_charts?.stock_price_as_of,
          financialsAsOf: out.financial_charts?.financials_as_of,
          tavilyCredits,
          tokens: runTokens,
          seconds: ranSecs,
          runs: currentToolRuns,
          snapshot: snapshotRef.current,
          report: out,
        };
        setHistories((prev) => appendHistory(prev, entry));
      }
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err?.name !== 'AbortError') {
        lastErrorMsg = err?.message || 'Unknown error';
        setError(lastErrorMsg);
      }
      setDurationSecs(Math.round((Date.now() - startTimestamp) / 1000));
    } finally {
      setRunning(false);
    }

    // User-initiated stop: close the timeline with an explicit marker so the
    // run never ends in an ambiguous half-state.
    if (stoppedByUserRef.current) {
      pushEvent('info', 'Run stopped', 'You stopped this run. Press Analyze when ready.');
      setDurationSecs(Math.round((Date.now() - startTimestamp) / 1000));
      return;
    }

    // The user went home while this run was still going — surface the
    // outcome as a notice on the landing screen instead of finishing
    // silently behind their back.
    if (atHomeRef.current) {
      if (finalData) setBgNotice({ ticker: activeTicker, kind: 'ready' });
      else if (lastErrorMsg) setBgNotice({ ticker: activeTicker, kind: 'error', message: lastErrorMsg });
    }
  };

  // Reopen an archived report exactly as it was produced, with its own
  // metrics and snapshot restored (tool server data comes from the entry).
  const openHistoryReport = (entry: HistoryEntry) => {
    setHistoryOpen(false);
    setError(null);
    setTicker(entry.ticker);
    activeTickerRef.current = entry.ticker;
    setReportData(entry.report);
    setSnapshot(entry.snapshot);
    setTokenCount(entry.tokens);
    setDurationSecs(entry.seconds);
    setToolRuns(entry.runs);
    setEvents([]);
    rawEventsRef.current = [];
    atHomeRef.current = false;
    setAtHome(false);
    setIsReportOpen(true);
  };

  const rerunHistoryReport = (entry: HistoryEntry) => {
    setHistoryOpen(false);
    setTicker(entry.ticker);
    void runAnalysis(entry.ticker);
  };

  const activeProvider = settings.providers[settings.activeProvider];
  const configured = isConfigured(settings);
  // Landing state: explicit home navigation wins (the logo can send the user
  // home mid-run), otherwise the idle intro view as before.
  const onLanding = atHome || (!running && !reportData && events.length === 0);

  // Logo → home. With a run in flight, ask: cancel it, or let it finish in
  // the background (the landing shows a completion notice when it's done).
  const goHome = () => {
    if (onLanding) return;
    if (running) {
      setLeavePromptOpen(true);
      return;
    }
    atHomeRef.current = true;
    setAtHome(true);
    if (reportData) setBgNotice({ ticker: activeTickerRef.current || ticker, kind: 'ready' });
  };

  const leaveCancelRun = () => {
    stoppedByUserRef.current = true;
    abortRef.current?.abort();
    setLeavePromptOpen(false);
    atHomeRef.current = true;
    setAtHome(true);
  };

  const leaveInBackground = () => {
    setLeavePromptOpen(false);
    atHomeRef.current = true;
    setAtHome(true);
    if (reportData) setBgNotice({ ticker: activeTickerRef.current || ticker, kind: 'ready' });
  };

  const openBgNotice = () => {
    const notice = bgNotice;
    setBgNotice(null);
    atHomeRef.current = false;
    setAtHome(false);
    if (notice?.kind === 'ready') setIsReportOpen(true);
  };

  if (isReportOpen && reportData) {
    return (
      <div className="w-full h-screen print-full">
        <ReportTemplate
          data={reportData}
          ticker={activeTickerRef.current || ticker}
          onClose={() => setIsReportOpen(false)}
          durationSecs={durationSecs}
          toolRuns={toolRuns}
          tokenCount={tokenCount}
          documentCount={reportData.findings?.length || 0}
          snapshot={snapshot}
        />
      </div>
    );
  }

  return (
    <div className="relative h-screen bg-[#0A0C0B] overflow-hidden font-sans text-stone-100 flex flex-col">
      <Backdrop />

      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-6 md:px-10 py-3 border-b border-white/10 bg-black/20 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            onClick={goHome}
            aria-label="TICKR home"
            title={onLanding ? undefined : 'Back to home'}
            className={`font-mono font-bold text-xl tracking-widest text-stone-100 ${onLanding ? 'cursor-default' : 'cursor-pointer hover:text-white'} transition-colors`}
          >
            TICKR<span className="text-green-400 tickr-blink">_</span>
          </button>
        </div>
        <div className="flex items-center gap-3">
          {rawEventsRef.current.length > 0 && (
            <button
              onClick={exportRunLog}
              className="flex items-center gap-1.5 text-xs text-green-300/70 hover:text-green-200 border border-green-500/20 hover:border-green-500/40 bg-green-500/[0.04] rounded-lg px-2.5 py-1.5 transition-colors"
              title="Export this run's event log as JSON"
            >
              <Download className="w-3.5 h-3.5" /> Export log
            </button>
          )}
          {histories.length > 0 && (
            <button
              onClick={() => setHistoryOpen(true)}
              className="flex items-center gap-1.5 text-xs text-green-300/70 hover:text-green-200 border border-green-500/20 hover:border-green-500/40 bg-green-500/[0.04] rounded-lg px-2.5 py-1.5 transition-colors"
              title="Saved reports from this browser"
            >
              <HistoryIcon className="w-3.5 h-3.5" /> History
            </button>
          )}
          <button
            onClick={() => setSettingsOpen('manual')}
            className="flex items-center gap-2 text-xs text-green-300/80 hover:text-green-200 border border-green-500/25 hover:border-green-500/45 bg-green-500/[0.05] rounded-lg px-2.5 py-1.5 transition-colors"
            title="Provider settings"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            <span className="font-mono hidden sm:inline">{PRESETS[settings.activeProvider].label}</span>
            {activeProvider?.model && (
              <span className="font-mono hidden md:inline text-stone-500">· {activeProvider.model}</span>
            )}
          </button>
        </div>
      </header>
      {onLanding && <TickerTape />}

      <main className="relative z-10 flex-1 flex flex-col pt-8 min-h-0">
        {onLanding ? (
          <LandingView
            ticker={ticker}
            onTickerChange={setTicker}
            onAnalyze={() => runAnalysis()}
            error={error}
            configured={configured}
            onOpenSettings={() => setSettingsOpen('manual')}
            tavilyUsed={tavilyUsed}
            tavilyKeySet={!!settings.tavilyKey}
            barNotice={barNotice}
            backgroundRun={running ? activeTickerRef.current || ticker : null}
            bgNotice={bgNotice}
            onOpenNotice={openBgNotice}
            onDismissNotice={() => setBgNotice(null)}
            onViewBackground={() => {
              atHomeRef.current = false;
              setAtHome(false);
            }}
          />
        ) : (
          <div className="flex-1 flex flex-row overflow-hidden pb-32 gap-4 px-4 min-h-0 w-full max-w-4xl mx-auto">
            <div className="flex-1 flex flex-col bg-[#0d1210]/70 rounded-xl border border-green-500/15 overflow-hidden min-h-0">
              <div className="p-3 bg-black/30 border-b border-green-500/10 font-bold text-stone-200 text-sm flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="font-mono uppercase text-sm tracking-widest text-green-400">Tickr Agent</span>
                  <span className="text-[10px] text-stone-400 font-mono">{PRESETS[settings.activeProvider].label}</span>
                  <span
                    className="text-[10px] text-stone-500 font-mono"
                    title={
                      `Each round = one model turn plus its searches (${roundBudget} rounds max). ` +
                      "OpenAI-compatible providers hard-cap turns; Anthropic/Gemini cap server-side searches, then the report is synthesized from gathered context. " +
                      "Free models commonly take 10–20 min per run." +
                      (roundBudget <= 8 ? " Lean budget: smaller filing sweep + slimmer search payloads." : "")
                    }
                  >
                    Tool calls: {toolRuns} · budget {roundBudget}
                    {roundBudget <= 8 ? " (lean)" : ""}
                  </span>
                </div>
                {running && (
                  <button
                    onClick={() => {
                      stoppedByUserRef.current = true;
                      abortRef.current?.abort();
                    }}
                    className="text-[11px] text-red-300 hover:text-white border border-red-500/30 rounded-md px-2 py-1 transition-colors"
                  >
                    Stop
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto no-scrollbar">
                <AgentTimeline
                  events={events}
                  running={running}
                  hasReport={!!reportData && !isReportOpen}
                  onViewReport={openReport}
                  metrics={timelineMetrics}
                />
              </div>
            </div>
          </div>
        )}

        {/* Input bar (run state only — the landing renders its own inline row) */}
        {!onLanding && (
          <div className="mt-auto px-6 pb-8 pt-4 bg-gradient-to-t from-[#0A0C0B] via-[#0A0C0B]/95 to-transparent w-full fixed bottom-0 z-20">
            <div className="max-w-4xl mx-auto w-full">
              {error && (
                <div className="mb-4 bg-red-500/10 border border-red-500/50 text-red-200 px-4 py-3 rounded text-sm font-mono">
                  {error}
                </div>
              )}
              <TickerInput value={ticker} onChange={setTicker} onSubmit={() => runAnalysis()} disabled={running} />
              <div className="mt-4 flex justify-center">
                <DisclaimerRow tavilyUsed={tavilyUsed} tavilyKeySet={!!settings.tavilyKey} />
              </div>
            </div>
          </div>
        )}
      </main>

      <SettingsModal
        open={settingsOpen !== false}
        firstRun={settingsOpen === 'first-run'}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />

      {/* Mid-run logo click: cancel the run, or leave it going in the
          background and get a landing-screen notice when it finishes. */}
      {leavePromptOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setLeavePromptOpen(false);
          }}
        >
          <div className="w-full max-w-md bg-[#0d1210]/95 backdrop-blur-md border border-green-500/25 rounded-xl shadow-2xl p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-mono font-medium text-base tracking-wide text-stone-100">
                <span className="text-green-400 mr-2">&gt;</span>Analysis in progress
              </h2>
              <button
                onClick={() => setLeavePromptOpen(false)}
                className="text-stone-500 hover:text-stone-200 p-1"
                title="Stay on this screen"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-stone-400 mt-3 leading-relaxed">
              <span className="font-mono text-stone-200">{activeTickerRef.current || ticker}</span> is still being
              analyzed. You can cancel the run, or go back home and let it finish in the background — we&apos;ll notify
              you here when the report is ready.
            </p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={leaveCancelRun}
                className="px-3 py-2 rounded-md font-mono text-sm transition-colors border border-red-500/30 text-red-300 hover:border-red-500/50 hover:text-red-200"
              >
                Cancel analysis
              </button>
              <button
                onClick={leaveInBackground}
                className="px-3 py-2 rounded-md font-mono text-sm transition-colors border border-green-500/50 text-green-300 hover:bg-green-500/10"
              >
                Run in background
              </button>
            </div>
          </div>
        </div>
      )}

      <HistoryDrawer
        open={historyOpen}
        entries={histories}
        onClose={() => setHistoryOpen(false)}
        onOpenEntry={openHistoryReport}
        onRerunEntry={rerunHistoryReport}
        onDeleteEntry={(id) => setHistories((prev) => removeHistory(prev, id))}
        onClearAll={() => {
          clearHistory();
          setHistories([]);
        }}
      />
    </div>
  );
}
