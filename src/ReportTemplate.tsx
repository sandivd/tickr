import {
  X, FileText, CheckCircle2, ChevronRight, Calendar
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { ReportData } from './App';
import type { MarketSnapshot } from './lib/agent/marketData';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';

interface Props {
  data: ReportData;
  ticker: string;
  onClose: () => void;
  durationSecs?: number;
  toolRuns?: number;
  tokenCount?: number;
  documentCount?: number;
  /** App-fetched current-level stats (relay /market); omitted when unavailable. */
  snapshot?: MarketSnapshot | null;
}

const AnalysisCard = ({ title, subtext, flag, children, className = "" }: any) => (
  <div className={`bg-white rounded p-6 border border-stone-200 flex flex-col ${className}`}>
    <div className="flex justify-between items-start mb-2">
      <h3 className="text-lg font-semibold text-stone-900">{title}</h3>
    </div>
    {(subtext || flag) && (
      <div className="mb-6">
        {subtext && <div className="text-stone-700 text-[15px]">{subtext}</div>}
        {flag && (
          <div className="mt-2 inline-block bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold px-2 py-1 rounded">
            ⚠ {flag}
          </div>
        )}
      </div>
    )}
    <div className="flex-1 w-full flex flex-col">
      {children}
    </div>
  </div>
);

/** Days since an ISO date string (null when absent/unparseable) — staleness checks. */
const daysSince = (iso?: string): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : null;
};

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

/** "$0.62B" / "$33.5B" — chart-scheme revenue figures are already in billions. */
const fmtB = (v: number) => `$${v < 10 ? v.toFixed(2) : v.toFixed(1)}B`;

const fmtVol = (v: number) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : String(v);

/**
 * Market snapshot strip — the app's own deterministic market facts (computed
 * by the relay from Yahoo's daily series, NOT researched by the model). This
 * is ground truth the written report's numbers can be eyeballed against.
 */
function SnapshotStrip({ snapshot }: { snapshot: MarketSnapshot }) {
  const prev = snapshot.previousClose;
  const dayAbs = prev !== null ? snapshot.latestClose - prev : null;
  const dayPct = prev !== null ? (snapshot.latestClose / prev - 1) * 100 : null;
  const bandPos =
    snapshot.fiftyTwoLow !== null &&
    snapshot.fiftyTwoHigh !== null &&
    snapshot.fiftyTwoHigh > snapshot.fiftyTwoLow
      ? Math.min(
          100,
          Math.max(
            0,
            ((snapshot.latestClose - snapshot.fiftyTwoLow) / (snapshot.fiftyTwoHigh - snapshot.fiftyTwoLow)) * 100
          )
        )
      : null;
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-6">
      <div className="flex justify-between items-baseline mb-4 flex-wrap gap-1">
        <h3 className="text-lg font-semibold text-stone-900">Market Snapshot</h3>
        <div className="text-xs text-stone-500 font-mono">
          session {snapshot.asOf} · app-computed from Yahoo daily series · all figures {snapshot.currency}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div>
          <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">Latest close</div>
          <div className="text-2xl font-bold text-stone-900 font-mono">${snapshot.latestClose.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">Prev close</div>
          <div className="text-lg font-mono text-stone-800">{prev !== null ? `$${prev.toFixed(2)}` : '—'}</div>
          {dayAbs !== null && dayPct !== null && (
            <div className={`text-xs font-mono font-semibold ${dayAbs >= 0 ? 'text-[#0b5a4b]' : 'text-red-600'}`}>
              {dayAbs >= 0 ? '+' : ''}
              {dayAbs.toFixed(2)} ({pct(dayPct)})
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">YTD</div>
          <div
            className={`text-lg font-bold font-mono ${
              snapshot.ytdPct === null ? 'text-stone-400' : snapshot.ytdPct >= 0 ? 'text-[#0b5a4b]' : 'text-red-600'
            }`}
          >
            {snapshot.ytdPct === null ? '—' : pct(snapshot.ytdPct)}
          </div>
          <div className="text-[10px] text-stone-400">vs prior year-end close</div>
        </div>
        <div>
          <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">50-day avg</div>
          <div className="text-lg font-mono text-stone-800">
            {snapshot.fiftyDayAvg !== null ? `$${snapshot.fiftyDayAvg.toFixed(2)}` : '—'}
          </div>
          {snapshot.fiftyDayAvg !== null && (
            <div
              className={`text-xs font-mono font-semibold ${
                snapshot.latestClose >= snapshot.fiftyDayAvg ? 'text-[#0b5a4b]' : 'text-red-600'
              }`}
            >
              {snapshot.latestClose >= snapshot.fiftyDayAvg ? '+' : ''}
              {(snapshot.latestClose - snapshot.fiftyDayAvg).toFixed(2)} vs latest
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mt-6 items-end">
        <div className="md:col-span-4">
          <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-2">52-week range</div>
          {snapshot.fiftyTwoLow !== null &&
          snapshot.fiftyTwoHigh !== null &&
          bandPos !== null ? (
            <div className="relative">
              <div className="h-1.5 bg-stone-200 rounded-full w-full" />
              <div
                className="absolute -top-[5px] w-4 h-4 rounded-full border-2 border-white shadow"
                style={{ left: `calc(${bandPos}% - 8px)`, background: '#0b5a4b' }}
              />
              <div className="flex justify-between mt-2 text-xs font-mono text-stone-500">
                <span>${snapshot.fiftyTwoLow.toFixed(2)}</span>
                <span>latest ${snapshot.latestClose.toFixed(2)}</span>
                <span>${snapshot.fiftyTwoHigh.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-stone-400 italic">52-week band unavailable this run</div>
          )}
        </div>
        <div>
          <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">Volume (latest)</div>
          <div className="text-lg font-mono text-stone-800">
            {snapshot.volume !== null ? fmtVol(snapshot.volume) : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Valuation sanity card — DCF-lite gut-check math computed in the browser
 * from the report's own chart (TTM revenue/margin) plus optional cited
 * valuation inputs from the schema. Missing input = "Not confirmed", never
 * an estimate. Skipped entirely for ETFs (no meaningful P/S).
 */
function ValuationSanity({ data }: { data: ReportData }) {
  const perf = data.financial_charts?.financial_performance_4q || [];
  // Strict guard on purpose: ANY distributions key (even null) hides this
  // card — P/S is meaningless for funds, and a spurious stock-mode card on
  // an unverified ETF report is worse than a hidden one. (The main chart's
  // isEtfPerf treats null as "no evidence" because a subtitle flip there is
  // a user-facing bug; here hiding is the conservative failure mode.)
  if (perf.length > 0 && perf[0].distributions !== undefined) return null; // ETF
  const ttmRevenue = perf.reduce((s, q) => s + (Number.isFinite(q.revenue) ? Number(q.revenue) : 0), 0);
  const ttmNet = perf.reduce((s, q) => s + (Number.isFinite(q.net_income) ? Number(q.net_income) : 0), 0);
  // A TTM margin mixing a partial net-income sum with the full revenue sum
  // is unsound (the two sides would cover different quarter sets) — compute
  // it only when the chart states all four quarters of both figures.
  const marginReady =
    perf.length === 4 && perf.every((q) => Number.isFinite(q.revenue) && Number.isFinite(q.net_income));
  const netMargin = marginReady && ttmRevenue > 0 ? (ttmNet / ttmRevenue) * 100 : null;
  const mcap = typeof data.valuation?.market_cap_b === 'number' ? data.valuation.market_cap_b : null;
  const fwd =
    typeof data.valuation?.forward_revenue_guidance_b === 'number'
      ? data.valuation.forward_revenue_guidance_b
      : null;
  const fwdLabel =
    typeof data.valuation?.guidance_period_label === 'string' && data.valuation.guidance_period_label
      ? data.valuation.guidance_period_label
      : '';
  const ttmPS = mcap !== null && ttmRevenue > 0 ? mcap / ttmRevenue : null;
  const fwdPS = mcap !== null && fwd !== null && fwd > 0 ? mcap / fwd : null;

  const Not = ({ alt = 'Not confirmed' }: { alt?: string }) => (
    <span className="text-sm font-sans font-normal text-stone-400 italic">{alt}</span>
  );
  const Cell = ({ label, sub, value }: { label: string; sub?: string; value: ReactNode }) => (
    <div className="bg-stone-50 rounded-lg border border-stone-100 p-4">
      <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">{label}</div>
      <div className="text-lg font-bold font-mono text-stone-900">{value}</div>
      {sub && <div className="text-[10px] text-stone-400 mt-1 leading-snug">{sub}</div>}
    </div>
  );

  return (
    <AnalysisCard title="Valuation sanity check" className="md:col-span-2">
      <div className="text-stone-700 text-[15px]">
        Rough multiple math on this report's own numbers — a gut-check, not a valuation model. "Not confirmed" means
        no cited source stated the figure this run; Tickr never fills gaps with estimates.
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
        <Cell
          label="Market cap"
          value={mcap !== null ? `$${mcap}B` : <Not />}
          sub="Only if a cited Yahoo quote/statistics snippet stated it"
        />
        <Cell
          label="TTM revenue"
          value={ttmRevenue > 0 ? fmtB(ttmRevenue) : <Not alt="Quarterly chart missing" />}
          sub="Sum of the quarterly chart above"
        />
        <Cell
          label="TTM net margin"
          value={
            netMargin !== null ? (
              <span className={netMargin >= 0 ? '' : 'text-red-600'}>{netMargin.toFixed(1)}%</span>
            ) : (
              <Not alt={perf.length === 4 ? 'Net income unverified for some quarters' : 'Quarterly chart missing'} />
            )
          }
          sub="TTM net income ÷ TTM revenue"
        />
        <Cell
          label="P/S (TTM)"
          value={ttmPS !== null ? `${ttmPS.toFixed(1)}×` : <Not />}
          sub="Market cap ÷ TTM revenue"
        />
        <Cell
          label="Revenue guidance"
          value={fwd !== null ? fmtB(fwd) : <Not />}
          sub={
            fwd !== null
              ? fwdLabel || "Management's explicit guidance (labeled)"
              : 'Only when management explicitly guided it in a cited release'
          }
        />
        <Cell
          label="P/S (fwd)"
          value={fwdPS !== null ? `${fwdPS.toFixed(1)}×` : <Not />}
          sub="Market cap ÷ guided revenue for the labeled period"
        />
      </div>
    </AnalysisCard>
  );
}

export default function ReportTemplate({ data, ticker, onClose, durationSecs = 0, toolRuns = 0, tokenCount = 0, documentCount = 0, snapshot = null }: Props) {
  const scoreColor = (score: number) => {
    if (score >= 80) return 'text-[#0b5a4b]';
    if (score >= 60) return 'text-blue-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const findings = data.findings || [];
  const charts = data.financial_charts;
  const priceAgeDays = daysSince(charts?.stock_price_as_of);
  const finAgeDays = daysSince(charts?.financials_as_of);
  const perf = charts?.financial_performance_4q || [];
  // A quarter object may carry explicit nulls (older prompts encouraged
  // emitting all four keys) — null !== undefined, so a null distributions
  // field previously flipped the whole chart into ETF mode. Treat null as
  // missing.
  const isEtfPerf = perf.length > 0 && perf[0].distributions != null;
  // Honest-gap annotations: quarters this run could not verify, plus a
  // short array when the model had to drop unconfirmable quarters entirely.
  const unverifiedQuarters = perf
    .filter((q) => q.revenue == null && q.net_income == null && q.distributions == null)
    .map((q) => q.quarter);
  const partialCoverage = perf.length > 0 && perf.length < 4;
  // Stock-mode quarters where revenue was verified but net income was not:
  // the NI bar is simply absent, which otherwise reads as "≈0" instead of
  // "revenue verified, net income unverified".
  const missingNetIncome = !isEtfPerf
    ? perf.filter((q) => q.revenue != null && q.net_income == null).map((q) => q.quarter)
    : [];
  
  return (
    <div className="min-h-full bg-[#F6F4F0] text-stone-900 font-sans w-full flex flex-col h-full overflow-y-auto print-full">
      <div className="w-full border-b border-stone-200 px-[40px] py-4 flex items-center justify-between sticky top-0 z-50 bg-[#F6F4F0] print-normal">
        <div className="font-display uppercase font-bold text-stone-900 text-lg tracking-wider flex items-center gap-2">
          {ticker} Document Analysis
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={onClose}
            className="text-stone-700 hover:text-stone-900 transition-colors flex items-center justify-center p-2 no-print"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="flex-1 py-8 px-[40px] w-full max-w-[1200px] mx-auto flex flex-col gap-6">
        
        {/* Executive Summary */}
        <div className="flex flex-col gap-6">
          <AnalysisCard title="Executive Summary" className="w-full">
            <div className="bg-stone-50 p-5 rounded-xl border border-stone-100 mb-6 text-stone-800 leading-relaxed font-medium text-lg w-full">
              "{data.verdict?.summary || 'No summary available.'}"
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-10 gap-8 w-full mt-2">
              <div className="md:col-span-7 flex flex-col">
                {data.verdict?.key_takeaways && (Array.isArray(data.verdict.key_takeaways) ? data.verdict.key_takeaways.length > 0 : true) && (
                  <div className="w-full text-left flex-1">
                     <div className="text-sm font-bold text-stone-500 uppercase tracking-wider mb-4 border-b border-stone-100 pb-2">Key Takeaways</div>
                     <div className="space-y-3">
                       {Array.isArray(data.verdict.key_takeaways) ? data.verdict.key_takeaways.map((takeaway, i) => (
                          <div key={i} className="flex gap-3 text-base">
                             <CheckCircle2 className="w-5 h-5 text-[#0b5a4b] shrink-0 mt-0.5" />
                             <div className="text-stone-700 leading-relaxed">{takeaway}</div>
                          </div>
                       )) : (
                          <div className="flex gap-3 text-base">
                             <CheckCircle2 className="w-5 h-5 text-[#0b5a4b] shrink-0 mt-0.5" />
                             <div className="text-stone-700 leading-relaxed">{String(data.verdict.key_takeaways)}</div>
                          </div>
                       )}
                     </div>
                  </div>
                )}
              </div>
              
              <div className="md:col-span-3 flex flex-col h-full text-center md:border-l md:border-stone-100 md:pl-8">
                 <h4 className="text-sm font-bold text-stone-500 uppercase tracking-wider mb-1">Conviction Score</h4>
                 <p className="text-xs text-stone-400 mb-4">Based on analyzed filings</p>
                 <div className={`text-6xl font-display font-bold mb-1 flex-1 flex items-center justify-center ${data.verdict ? scoreColor(data.verdict.conviction_score) : 'text-stone-400'}`}>
                    {data.verdict?.conviction_score || '-'}
                 </div>
                 
                 <div className="text-xs text-stone-500 uppercase tracking-widest font-bold mb-6">out of 100</div>
                 <div className="grid grid-cols-4 gap-1 border-t border-stone-100 pt-4 mt-auto w-full">
                   <div className="flex flex-col items-center">
                     <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">Docs</div>
                     <div className="text-sm font-mono text-stone-800">{documentCount}</div>
                   </div>
                   <div className="flex flex-col items-center border-l border-stone-100">
                     <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">Time</div>
                     <div className="text-sm font-mono text-stone-800">{durationSecs}s</div>
                   </div>
                   <div className="flex flex-col items-center border-l border-stone-100">
                     <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">Runs</div>
                     <div className="text-sm font-mono text-stone-800">{toolRuns}</div>
                   </div>
                   <div className="flex flex-col items-center border-l border-stone-100">
                     <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">Tokens</div>
                     <div className="text-sm font-mono text-stone-800">
                        {tokenCount > 0 ? (tokenCount / 1000).toFixed(1) + 'k' : '-'}
                     </div>
                   </div>
                 </div>
              </div>
            </div>
          </AnalysisCard>
        </div>

        {/* Market snapshot — app-computed deterministic facts, not researched */}
        {snapshot && <SnapshotStrip snapshot={snapshot} />}

        {/* Financial Charts */}
        {data.financial_charts && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
            <AnalysisCard
              title="Stock Price"
              subtext={"This chart shows the closing price for the past four months on the last trading date." + (charts?.stock_price_as_of ? ` Latest data point: ${charts.stock_price_as_of}.` : "")}
              flag={priceAgeDays !== null && priceAgeDays > 45 ? "Stale data — the newest price shown is over 45 days old. Verify against a live quote (Yahoo Finance, Google Finance)." : undefined}
            >
              <div className="h-64 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.financial_charts.stock_price_4m ? [...data.financial_charts.stock_price_4m] : []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e4" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#78716c' }} dy={10} />
                    <YAxis domain={['auto', 'auto']} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#78716c' }} dx={-10} />
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e4', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number) => [`$${value}`, 'Price']}
                    />
                    <Line type="linear" dataKey="price" stroke="#0b5a4b" strokeWidth={2} dot={{ r: 4, fill: '#0b5a4b', strokeWidth: 0 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </AnalysisCard>
            
                        <AnalysisCard
              title="Financial Performance"
              subtext={
                (isEtfPerf ? "This chart shows the quarterly distributions (dividends/yield per share) for the past four completed quarters." : "This chart shows the revenue and net income for the past four completed quarters.")
                + (data.financial_charts.financial_performance_4q && data.financial_charts.financial_performance_4q.length > 0 ? ` Newest quarter: ${data.financial_charts.financial_performance_4q[data.financial_charts.financial_performance_4q.length - 1].quarter}.` : "")
              }
              flag={finAgeDays !== null && finAgeDays > 240 ? "Stale data — the newest quarter shown ended more than ~8 months ago. More recent results may now exist." : undefined}
            >
              <div className="h-64 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.financial_charts.financial_performance_4q ? [...data.financial_charts.financial_performance_4q] : []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e4" />
                    <XAxis dataKey="quarter" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#78716c' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#78716c' }} dx={-10} tickFormatter={(value) => isEtfPerf ? `$${value}` : `${value}B`} />
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e4', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number, name: string) => name === 'Distributions' ? [`$${value}`, name] : [`$${value}B`, name]}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                    {isEtfPerf ? (
                      <Bar dataKey="distributions" name="Distributions" fill="#10b981" radius={[4, 4, 0, 0]} barSize={48} />
                    ) : (
                      <>
                        <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={32} />
                        <Bar dataKey="net_income" name="Net Income" fill="#1e3a8a" radius={[4, 4, 0, 0]} barSize={32} />
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {(partialCoverage || unverifiedQuarters.length > 0 || missingNetIncome.length > 0) && (
                <p className="text-xs text-stone-500 mt-2">
                  {partialCoverage ? `Only ${perf.length} of the last 4 completed quarters could be verified this run. ` : ""}
                  {unverifiedQuarters.length > 0 ? `No source stated figures for: ${unverifiedQuarters.join(", ")} — shown as empty, never estimated. ` : ""}
                  {missingNetIncome.length > 0 ? `Net income not stated for: ${missingNetIncome.join(", ")} — shown as empty, never estimated.` : ""}
                </p>
              )}
            </AnalysisCard>
            <ValuationSanity data={data} />
          </div>
        )}

        {/* Deep Insights */}
        {data.deep_insights && data.deep_insights.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-display font-bold text-stone-900 uppercase tracking-wider mb-6">Deep Insights</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {data.deep_insights.slice(0, 3).map((insight, index) => (
                <div key={index} className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col">
                   <div className="flex items-start justify-between mb-4 border-b border-stone-100 pb-4">
                     <div className="flex items-center gap-3">
                       <div>
                         <div className="text-xs text-stone-500 font-bold uppercase tracking-wider">{insight.category}</div>
                         <h4 className="font-bold text-stone-900 text-lg mt-0.5 leading-tight">{insight.title}</h4>
                       </div>
                     </div>
                   </div>
                   <div className="text-stone-700 leading-relaxed text-[15px] flex-1">{insight.description}</div>
                   <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between">
                     <span className="text-xs text-stone-500 font-bold uppercase tracking-wider">Impact Score</span>
                     <span className={`text-sm font-mono font-bold px-2 py-0.5 rounded ${insight.impact_score >= 8 ? 'bg-red-50 text-red-700' : insight.impact_score >= 5 ? 'bg-yellow-50 text-yellow-700' : 'bg-green-50 text-green-700'}`}>{insight.impact_score}/10</span>
                   </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detailed Findings */}
        <div className="mt-8">
           <h2 className="text-2xl font-display font-bold text-stone-900 uppercase tracking-wider mb-6">Document Findings</h2>
           
           {findings.length === 0 ? (
             <div className="text-stone-500 italic p-8 bg-white rounded border border-stone-200 text-center">
               No specific document findings returned.
             </div>
           ) : (
             <div className="flex flex-col gap-6">
               {findings.map((finding, index) => (
                 <div key={index} className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col">
                   <div className="flex items-start justify-between mb-4 border-b border-stone-100 pb-4">
                     <div className="flex items-center gap-3">
                       <div className="w-10 h-10 rounded bg-stone-100 text-stone-600 flex items-center justify-center">
                         <FileText className="w-5 h-5" />
                       </div>
                       <div>
                         <h4 className="font-bold text-stone-900 text-lg">{finding.documentType || finding.document_type || "Document"}</h4>
                         {finding.date && (
                           <div className="text-xs text-stone-500 font-mono flex items-center gap-1 mt-1">
                             <Calendar className="w-3 h-3" /> {finding.date}
                           </div>
                         )}
                       </div>
                     </div>
                     {(finding.sourceUrl || finding.source_url) && (
                       <a href={finding.sourceUrl || finding.source_url} target="_blank" rel="noreferrer" className="hover:opacity-80 transition-opacity flex items-center justify-center p-1" title="View Source">
                         <img src="https://upload.wikimedia.org/wikipedia/commons/8/87/PDF_file_icon.svg" alt="PDF" className="w-8 h-8" />
                       </a>
                     )}
                   </div>
                   
                   <ul className="space-y-3 mt-2 flex-1">
                     {Array.isArray(finding.keyInsights || finding.key_insights) ? (finding.keyInsights || finding.key_insights)?.map((insight, i) => (
                       <li key={i} className="flex gap-2 text-sm text-stone-700 leading-relaxed">
                         <ChevronRight className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                         <span>{insight}</span>
                       </li>
                     )) : (finding.keyInsights || finding.key_insights) ? (
                       <li className="flex gap-2 text-sm text-stone-700 leading-relaxed">
                         <ChevronRight className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                         <span>{String(finding.keyInsights || finding.key_insights)}</span>
                       </li>
                     ) : null}
                   </ul>
                 </div>
               ))}
             </div>
           )}
        </div>
      </div>
    </div>
  );
}
