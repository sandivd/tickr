/**
 * Report history drawer — the app's longitudinal memory shelf.
 *
 * All data lives in the browser (localStorage); the drawer only reads the
 * in-memory list App maintains. Groups reports by ticker, draws each
 * ticker's conviction trend as a tiny sparkline (recharts), and lets the
 * user reopen an archived report exactly as it was produced, or re-run the
 * same ticker with fresh data.
 */

import { useEffect } from "react";
import { X, Trash2, RefreshCw, FileText, History as HistoryIcon } from "lucide-react";
import { LineChart, Line, YAxis, ResponsiveContainer } from "recharts";
import type { HistoryEntry } from "../lib/history";
import { clearHistory } from "../lib/history";

interface Props {
  open: boolean;
  entries: HistoryEntry[];
  onClose: () => void;
  onOpenEntry: (entry: HistoryEntry) => void;
  onRerunEntry: (entry: HistoryEntry) => void;
  onDeleteEntry: (id: string) => void;
  onClearAll: () => void;
}

const scoreColor = (score: number | null) => {
  if (score === null) return "bg-stone-700 text-stone-300";
  if (score >= 80) return "bg-emerald-800/80 text-emerald-200";
  if (score >= 60) return "bg-sky-800/80 text-sky-200";
  if (score >= 40) return "bg-yellow-800/80 text-yellow-200";
  return "bg-red-900/80 text-red-200";
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function HistoryDrawer({ open, entries, onClose, onOpenEntry, onRerunEntry, onDeleteEntry, onClearAll }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Newest-first list → first-seen order keeps groups ordered by recency.
  const groups: Array<{ ticker: string; items: HistoryEntry[] }> = [];
  for (const e of entries) {
    const g = groups.find((x) => x.ticker === e.ticker);
    if (g) g.items.push(e);
    else groups.push({ ticker: e.ticker, items: [e] });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
      <div
        role="dialog"
        aria-label="Report history"
        className="w-full max-w-md h-full bg-[#0d1210] border-l border-green-500/15 shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-green-500/15">
          <div className="flex items-center gap-2">
            <HistoryIcon className="w-5 h-5 text-green-400" />
            <h2 className="font-mono font-medium tracking-wide text-stone-100"><span className="text-green-400 mr-2">&gt;</span>Report history</h2>
            <span className="text-[11px] text-stone-500 font-mono">{entries.length}/30</span>
          </div>
          <div className="flex items-center gap-1">
            {entries.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm("Delete the entire saved history from this browser? This cannot be undone.")) {
                    clearHistory();
                    onClearAll();
                  }
                }}
                className="text-xs text-stone-500 hover:text-red-400 flex items-center gap-1 rounded px-2 py-1 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear all
              </button>
            )}
            <button onClick={onClose} className="text-stone-500 hover:text-stone-200 p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-5">
          {entries.length === 0 ? (
            <div className="text-sm text-stone-500 leading-relaxed pt-6 text-center">
              No saved reports yet. Every completed analysis is archived here automatically (this browser only,
              newest first, max 30).
            </div>
          ) : (
            groups.map((g) => {
              // Conviction trend points, oldest → newest.
              const pts = g.items
                .filter((e) => typeof e.conviction === "number")
                .map((e) => ({ when: e.savedAt, conviction: e.conviction as number }))
                .reverse();
              return (
                <div key={g.ticker}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-lg uppercase tracking-wider text-stone-100">
                      <span className="text-green-400 mr-2">&gt;</span>{g.ticker}
                    </span>
                    <span className="text-[11px] text-stone-500 font-mono">
                      {g.items.length} report{g.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {pts.length >= 2 && (
                    <div className="h-10 mb-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={pts}>
                          <YAxis hide domain={[0, 100]} />
                          <Line
                            type="monotone"
                            dataKey="conviction"
                            stroke="#4ade80"
                            strokeWidth={2}
                            dot={{ r: 2.5, fill: "#4ade80", strokeWidth: 0 }}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="space-y-2">
                    {g.items.map((e) => (
                      <div key={e.id} className="bg-black/30 border border-green-500/15 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <span
                            className={`text-xs font-mono font-bold px-2 py-0.5 rounded shrink-0 ${scoreColor(e.conviction)}`}
                          >
                            {e.conviction !== null ? e.conviction : "—"}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs text-stone-300 truncate">{e.summary || "No summary stored."}</div>
                            <div className="text-[10px] text-stone-500 font-mono mt-0.5">
                              {fmtWhen(e.savedAt)} · {e.providerLabel} · {e.model}
                              {e.seconds > 0 ? ` · ${e.seconds}s` : ""}
                              {e.tavilyCredits > 0
                                ? ` · ${e.tavilyCredits} search${e.tavilyCredits === 1 ? "" : "es"}`
                                : ""}
                              {e.tokens > 0 ? ` · ${(e.tokens / 1000).toFixed(1)}k tok` : ""}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 mt-2">
                          <button
                            onClick={() => onOpenEntry(e)}
                            className="text-[11px] text-green-300/70 hover:text-green-200 border border-green-500/25 hover:border-green-500/40 bg-green-500/[0.04] rounded px-2 py-1 flex items-center gap-1 transition-colors"
                          >
                            <FileText className="w-3 h-3" /> Open
                          </button>
                          <button
                            onClick={() => onRerunEntry(e)}
                            className="text-[11px] text-green-300/70 hover:text-green-200 border border-green-500/25 hover:border-green-500/40 bg-green-500/[0.04] rounded px-2 py-1 flex items-center gap-1 transition-colors"
                            title="Run a fresh analysis for this ticker"
                          >
                            <RefreshCw className="w-3 h-3" /> Re-run
                          </button>
                          <button
                            onClick={() => onDeleteEntry(e.id)}
                            className="ml-auto text-stone-600 hover:text-red-400 p-1 transition-colors"
                            title="Delete this saved report"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 border-t border-green-500/15 text-[10px] text-stone-600 leading-relaxed">
          Stored only in this browser's localStorage. The full report JSON is kept so an archived analysis can be
          reopened exactly as it was produced.
        </div>
      </div>
    </div>
  );
}
