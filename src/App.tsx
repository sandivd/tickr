import { LandingView } from './LandingView';
import { useState, useRef, useEffect, useCallback } from 'react';
import { PulsatingDotsBackground } from './components/PulsatingDots';
import { Search, Settings as SettingsIcon, Download, History as HistoryIcon } from 'lucide-react';
import ReportTemplate from "./ReportTemplate";
import { AgentTimeline } from './components/AgentTimeline';
import type { TimelineEvent } from './components/AgentTimeline';
import { SettingsModal } from './components/SettingsModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { loadSettings, saveSettings, isConfigured, normalizeBudget } from './lib/settings';
import { loadHistory, appendHistory, removeHistory, clearHistory } from './lib/history';
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

export default function App() {
  const [settings, setSettings] = useState<SettingsState>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState<'first-run' | 'manual' | false>(() =>
    isConfigured(loadSettings()) ? false : 'first-run'
  );
  const [isReportOpen, setIsReportOpen] = useState(false);

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
  const rawEventsRef = useRef<AgentEvent[]>([]);
  const activeTickerRef = useRef('');
  const snapshotRef = useRef<MarketSnapshot | null>(null);

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

  const pushEvent = useCallback(
    (kind: TimelineEvent['kind'], label: string, detail?: string, toolName?: string, callId?: string) => {
      const now = Date.now();
      setEvents((prev) => {
        const newEvents = [...prev];
        const lastIndex = newEvents.length - 1;
        if (lastIndex >= 0 && !newEvents[lastIndex].endTime) {
          newEvents[lastIndex] = { ...newEvents[lastIndex], endTime: now };
        }
        newEvents.push({ id: eventIdRef.current++, kind, label, detail, toolName, startTime: now, callId });
        return newEvents;
      });
    },
    []
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

  const runAnalysis = async (explicitTicker?: string) => {
    const activeTicker = (explicitTicker ?? ticker).trim();
    // Re-runs launched from history target the archived ticker even if the
    // input field says something else — keep the input in sync with it.
    if (explicitTicker) setTicker(activeTicker);
    const preset = PRESETS[settings.activeProvider];
    const providerConfig = settings.providers[settings.activeProvider];
    if (!activeTicker || running) return;
    if (!providerConfig?.apiKey) {
      setSettingsOpen('manual');
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
    setToolRuns(0);
    setTokenCount(0);
    setDurationSecs(0);
    setStartTime(Date.now());
    eventIdRef.current = 0;
    accumulatedTextRef.current = '';
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
          const found = extractReportJson(accumulatedTextRef.current);
          if (found) setReportData(found as never as ReportData);
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
          setError(evt.message);
        }
      }

      // Full text is available now — redo extraction once, end-state.
      const finalData = extractReportJson(accumulatedTextRef.current);
      if (finalData) setReportData(finalData as never as ReportData);
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
      if (err?.name !== 'AbortError') setError(err?.message || 'Unknown error');
      setDurationSecs(Math.round((Date.now() - startTimestamp) / 1000));
    } finally {
      setRunning(false);
    }

    // User-initiated stop: close the timeline with an explicit marker so the
    // run never ends in an ambiguous half-state.
    if (stoppedByUserRef.current) {
      pushEvent('info', 'Run stopped', 'You stopped this run. Press Analyze when ready.');
      setDurationSecs(Math.round((Date.now() - startTimestamp) / 1000));
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
    setIsReportOpen(true);
  };

  const rerunHistoryReport = (entry: HistoryEntry) => {
    setHistoryOpen(false);
    setTicker(entry.ticker);
    void runAnalysis(entry.ticker);
  };

  const activeProvider = settings.providers[settings.activeProvider];
  const configured = isConfigured(settings);

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
    <div className="relative h-screen bg-stone-900 overflow-hidden font-sans text-stone-100 flex flex-col">
      <PulsatingDotsBackground />

      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-xl tracking-wider uppercase text-white">Tickr</span>
        </div>
        <div className="flex items-center gap-3">
          {rawEventsRef.current.length > 0 && (
            <button
              onClick={exportRunLog}
              className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-white border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors"
              title="Export this run's event log as JSON"
            >
              <Download className="w-3.5 h-3.5" /> Export log
            </button>
          )}
          {histories.length > 0 && (
            <button
              onClick={() => setHistoryOpen(true)}
              className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-white border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors"
              title="Saved reports from this browser"
            >
              <HistoryIcon className="w-3.5 h-3.5" /> History
            </button>
          )}
          <button
            onClick={() => setSettingsOpen('manual')}
            className="flex items-center gap-2 text-xs text-stone-300 hover:text-white border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors"
            title="Provider settings"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            <span className="font-mono hidden sm:inline">
              {PRESETS[settings.activeProvider].label}
              {activeProvider?.model ? ` · ${activeProvider.model}` : ''}
            </span>
          </button>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col pt-8 min-h-0">
        {!running && !reportData && events.length === 0 ? (
          <LandingView />
        ) : (
          <div className="flex-1 flex flex-row overflow-hidden pb-32 gap-4 px-4 min-h-0 w-full max-w-4xl mx-auto">
            <div className="flex-1 flex flex-col bg-stone-900/50 rounded-xl border border-stone-800 overflow-hidden min-h-0">
              <div className="p-3 bg-stone-800/80 border-b border-stone-700 font-bold text-stone-200 text-sm flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="font-display uppercase text-base tracking-wider">Tickr Agent</span>
                  <span className="text-[10px] text-stone-400 font-mono">{PRESETS[settings.activeProvider].label}</span>
                  <span
                    className="text-[10px] text-stone-500 font-mono"
                    title={
                      `Each round = one model turn plus its searches (${roundBudget} rounds max). ` +
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
                  onViewReport={() => setIsReportOpen(true)}
                  metrics={
                    reportData
                      ? {
                          durationSecs,
                          tokenCount,
                          documentCount: reportData.findings?.length || 0,
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          </div>
        )}

        {/* Input area fixed at bottom */}
        <div className="mt-auto px-6 pb-8 pt-4 bg-gradient-to-t from-stone-900 via-stone-900 to-transparent w-full fixed bottom-0 z-20">
          <div className="max-w-4xl mx-auto w-full">
            {error && (
              <div className="mb-4 bg-red-500/10 border border-red-500/50 text-red-200 px-4 py-3 rounded text-sm">
                {error}
              </div>
            )}

            {!configured && !settingsOpen && (
              <button
                onClick={() => setSettingsOpen('manual')}
                className="mb-4 w-full bg-stone-900/80 backdrop-blur-md border border-yellow-500/40 text-yellow-200 px-4 py-3 rounded text-sm text-left hover:bg-stone-900 transition-colors"
              >
                No AI provider connected yet — click here to set up your API key.
              </button>
            )}

            <div className="bg-stone-800 border border-stone-700 rounded-xl shadow-2xl p-2 w-full flex items-center gap-2 relative z-30 transition-all focus-within:border-stone-500 focus-within:ring-1 focus-within:ring-stone-500">
              <div className="pl-3 py-2 flex items-center gap-2 text-stone-400 w-full flex-1">
                <Search className="w-5 h-5 shrink-0" />
                <input
                  type="text"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
                  placeholder="Enter a stock or ETF ticker symbol here"
                  disabled={running}
                  className="bg-transparent border-none outline-none w-full text-white font-mono uppercase placeholder-stone-600"
                  onKeyDown={(e) => e.key === 'Enter' && runAnalysis()}
                />
              </div>
              <button
                onClick={() => runAnalysis()}
                disabled={!ticker.trim() || running}
                className="bg-white text-black hover:bg-stone-200 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed px-6 py-2 rounded-lg font-medium transition-colors ml-2 tracking-wide text-sm"
              >
                Analyze
              </button>
            </div>

            <div className="text-center mt-4 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-xs text-stone-500 font-mono tracking-wider">
                AI can make mistakes, don't rely on it for financial advice.
              </span>
              {settings.tavilyKey && (
                <span
                  className="text-[10px] text-stone-600 font-mono border border-white/10 rounded px-1.5 py-0.5"
                  title="Estimated Tavily searches issued by this browser this calendar month (1 credit each — the app's only metered resource)."
                >
                  Tavily this month: {tavilyUsed}/1,000
                </span>
              )}
            </div>
          </div>
        </div>
      </main>

      <SettingsModal
        open={settingsOpen !== false}
        firstRun={settingsOpen === 'first-run'}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />

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
