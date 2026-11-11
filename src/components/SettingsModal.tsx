import { useEffect, useState } from "react";
import { X, ExternalLink, Eye, EyeOff, CheckCircle2, XCircle, Loader2, KeyRound, ShieldCheck, Trash2, Gauge } from "lucide-react";
import type { Settings, ProviderId } from "../lib/agent/types";
import { PRESETS, PROVIDER_ORDER } from "../lib/agent/presets";
import { clearSettings } from "../lib/settings";
import { getMonthlyUsage } from "../lib/usage";

interface Props {
  open: boolean;
  settings: Settings;
  firstRun?: boolean;
  onClose: () => void;
  onSave: (s: Settings) => void;
}

/**
 * Provider + key configuration UI.
 * Nothing leaves the browser except requests to the providers themselves.
 */
export function SettingsModal({ open, settings, firstRun, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [tavilyUsed, setTavilyUsed] = useState(0);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setTestState("idle");
      setTestMsg("");
      setModels([]);
      setTavilyUsed(getMonthlyUsage().credits);
    }
  }, [open, settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pid = draft.activeProvider;
  const preset = PRESETS[pid];
  const pcfg = draft.providers[pid];

  const showBaseUrl = pid === "custom" || pid === "opencode";

  const setProvider = (id: ProviderId) => {
    setTestState("idle");
    setTestMsg("");
    setModels([]);
    setDraft((d) => ({
      ...d,
      activeProvider: id,
      providers: {
        ...d.providers,
        [id]: { ...d.providers[id], model: d.providers[id]?.model || PRESETS[id].defaultModel },
      },
    }));
  };

  const setProviderField = (field: "apiKey" | "model" | "baseUrl", value: string) => {
    setDraft((d) => ({
      ...d,
      providers: { ...d.providers, [d.activeProvider]: { ...d.providers[d.activeProvider], [field]: value } },
    }));
  };

  const setProviderFlag = (field: "webPluginOn", value: boolean) => {
    setDraft((d) => ({
      ...d,
      providers: { ...d.providers, [d.activeProvider]: { ...d.providers[d.activeProvider], [field]: value } },
    }));
  };

  const fetchModels = async (): Promise<string[]> => {
    const key = pcfg?.apiKey || "";
    if (pid === "custom" || !preset.modelsUrl) return [];
    const headers: Record<string, string> = {};
    let url = preset.modelsUrl;
    if (preset.authStyle === "bearer" && key) headers["Authorization"] = `Bearer ${key}`;
    if (preset.authStyle === "x-api-key" && key) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    }
    if (preset.authStyle === "query" && key) {
      url += (url.includes("?") ? "&" : "?") + `key=${encodeURIComponent(key)}`;
    }
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const list: any[] = Array.isArray(json) ? json : json.data ?? json.models ?? [];
    return list
      .map((m) => (typeof m === "string" ? m : (m.id ?? m.name ?? "")))
      .map((n) => String(n).replace(/^models\//, ""))
      .filter((n) => n && !n.includes("embedding") && !n.includes("embedding"))
      .sort();
  };

  const runTest = async () => {
    const key = pcfg?.apiKey || "";
    if (pid === "custom") {
      setTestMsg("Custom endpoints can't be pre-validated — save and run a tickr analysis to test.");
      setTestState("fail");
      return;
    }
    if (!key) {
      setTestMsg("Enter an API key first.");
      setTestState("fail");
      return;
    }
    setTestState("testing");
    setTestMsg("Checking connectivity and key...");
    try {
      const list = await fetchModels();
      setModels(list);
      setTestState("ok");
      setTestMsg(`Connection OK — ${list.length} models available.`);
    } catch (e: any) {
      setTestState("fail");
      setTestMsg(`Connection failed: ${e?.message || String(e)}`);
    }
  };

  // Reuse the models fetch result for "Test" only; Load models is implicit on test success.
  const btn = "px-3 py-2 rounded-lg text-sm font-medium transition-colors";
  const inputClass =
    "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-white font-mono outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 placeholder-stone-600";

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-stone-900 border border-stone-700 rounded-xl shadow-2xl max-h-[92vh] overflow-y-auto no-scrollbar">
        <div className="flex items-center justify-between p-5 border-b border-stone-800">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-white" />
            <h2 className="text-white font-bold text-lg tracking-tight">
              {firstRun ? "Connect your AI provider" : "AI Provider Settings"}
            </h2>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-xs text-stone-400 leading-relaxed">
            Tickr runs entirely in your browser (BYOK). Your API key is stored locally in this browser and is sent
            <span className="text-stone-200"> only</span> to the provider you select below. Tickr has no server and
            never sees your keys.
          </p>

          {/* Provider select */}
          <div>
            <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Provider</label>
            <select
              value={pid}
              onChange={(e) => setProvider(e.target.value as ProviderId)}
              className={`${inputClass} font-sans`}
            >
              {PROVIDER_ORDER.map((id) => (
                <option key={id} value={id}>
                  {PRESETS[id].label}
                </option>
              ))}
            </select>
            <p className="text-xs text-stone-500 mt-2">{preset.description}</p>
            {preset.browserAccess && (
              <p className={`text-xs mt-2 leading-relaxed ${
                preset.browserAccess.tone === "warn" ? "text-yellow-500/90" : "text-green-600"
              }`}>
                {preset.browserAccess.text}
              </p>
            )}
            {preset.kind === "openai-compatible" && pid === "custom" && (
              <p className="text-xs text-yellow-500/80 mt-1">
                Note: api.openai.com blocks direct browser calls (CORS). Use OpenRouter/OpenCode, or a proxy endpoint
                you control.
              </p>
            )}
          </div>

          {/* API key */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">API Key</label>
              {preset.keySignupUrl && (
                <a
                  href={preset.keySignupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  Get a key <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <div className="relative">
              <input
                type={showKey[pid] ? "text" : "password"}
                value={pcfg?.apiKey || ""}
                onChange={(e) => setProviderField("apiKey", e.target.value.trim())}
                placeholder="Paste your API key..."
                className={`${inputClass} pr-10`}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                onClick={() => setShowKey((s) => ({ ...s, [pid]: !s[pid] }))}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-500 hover:text-white p-1"
                type="button"
              >
                {showKey[pid] ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Model + base URL */}
          <div className={showBaseUrl ? "" : "grid grid-cols-2 gap-4"}>
            {showBaseUrl && (
              <div className="mb-4">
                <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">
                  {pid === "custom" ? "Endpoint base URL (Chat Completions)" : "Endpoint base URL (defaults to TICKR's shared relay)"}
                </label>
                <input
                  type="text"
                  value={pcfg?.baseUrl || ""}
                  onChange={(e) => setProviderField("baseUrl", e.target.value.trim())}
                  placeholder={pid === "custom" ? "https://your-gateway.example.com/v1" : preset.baseUrl}
                  className={inputClass}
                  spellCheck={false}
                />
                <p className="text-[11px] text-stone-500 mt-1">
                  {pid === "custom"
                    ? "Must speak the OpenAI chat-completions format and send CORS headers for browser origins."
                    : "Empty = TICKR's shared relay (recommended). To use your own instead, deploy proxy/cloudflare-worker.js in ~2 minutes (steps in the README) and paste its URL here. The model list / test connection always uses OpenCode's own catalog."}
                </p>
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Model</label>
              <input
                type="text"
                value={pcfg?.model || ""}
                onChange={(e) => setProviderField("model", e.target.value.trim())}
                placeholder={preset.defaultModel || "e.g. org/model-name"}
                list="tickr-model-list"
                className={inputClass}
                spellCheck={false}
              />
              <datalist id="tickr-model-list">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {models.length === 0 && pid !== "custom" && (
                <p className="text-[11px] text-stone-600 mt-1">Run "Test connection" to load the model list.</p>
              )}
              {pid === "openrouter" && (
                <p className="text-[11px] text-stone-500 mt-1">
                  Free accounts: stay on <span className="text-stone-300">openrouter/free</span> or pick a model ending
                  in <span className="text-stone-300">:free</span> — paid model IDs fail with 402 on a $0 balance.
                </p>
              )}
            </div>
          </div>

          {/* OpenRouter native web plugin — explicit consent (billed per search) */}
          {pid === "openrouter" && preset.webPlugin && (
            <div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!pcfg?.webPluginOn}
                  onChange={(e) => setProviderFlag("webPluginOn", e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-white shrink-0"
                />
                <span className="block">
                  <span className="block text-xs font-bold text-stone-300 uppercase tracking-wider">
                    OpenRouter native web-search plugin — off by default
                  </span>
                  <span className="block text-[11px] text-stone-500 mt-1 leading-relaxed">{preset.webPluginNote}</span>
                </span>
              </label>
            </div>
          )}

          {/* Agent tool-round budget (global; runs these days can be long) */}
          <div>
            <label
              htmlFor="tickr-round-budget"
              className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-2"
            >
              Agent tool budget — {draft.agentRoundBudget ?? 16} {(draft.agentRoundBudget ?? 16) === 1 ? "round" : "rounds"}
              {(draft.agentRoundBudget ?? 16) <= 8 ? " (lean)" : ""}
            </label>
            <input
              id="tickr-round-budget"
              type="range"
              min={4}
              max={16}
              step={1}
              value={draft.agentRoundBudget ?? 16}
              onChange={(e) => setDraft((d) => ({ ...d, agentRoundBudget: Number(e.target.value) }))}
              className="w-full accent-white"
            />
            <p className="text-[11px] text-stone-500 mt-1 leading-relaxed">
              One round = one model turn plus its searches. 16 = the full document sweep (~10 filings). Free-tier
              models commonly take 10–20 min per run at 16 — at ≤8 the run goes <span className="text-stone-300">lean</span>:
              ~6 filings, slimmer search payloads, faster final report. The app-injected price/market data is exact
              either way.
            </p>
          </div>

          {/* Tavily */}
          <div>
            <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">
              {pid === "openrouter" ? "Web search (Tavily) — recommended" : "Web search fallback (Tavily) — optional"}
            </label>
            <input
              type="password"
              value={draft.tavilyKey || ""}
              onChange={(e) => setDraft((d) => ({ ...d, tavilyKey: e.target.value.trim() }))}
              placeholder="tvly-... (for gateways without native search)"
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] text-stone-500 mt-1">
              {pid === "anthropic" || pid === "google"
                ? `${preset.label} has built-in web search. Tavily is only used as an extra tool.`
                : pid === "openrouter"
                  ? "Tickr searches via your own Tavily key by default (free tier). OpenRouter's plugin above stays off unless you opt in — it is billed per search by OpenRouter."
                  : "Recommended: this provider has no built-in search. Get a free key at tavily.com"}
            </p>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-stone-500">
              <Gauge className="w-3.5 h-3.5 shrink-0" />
              <span>
                Tavily usage this month (this browser): {tavilyUsed} search{tavilyUsed === 1 ? "" : "es"} · free tier ≈
                1,000/mo · counts only searches issued here, not other apps on the same key.
              </span>
            </div>
          </div>

          {/* Test + save */}
          <div className="flex items-center gap-3">
            <button onClick={runTest} disabled={testState === "testing"} className={`${btn} border border-stone-700 text-stone-200 hover:border-stone-500 disabled:opacity-50`}>
              {testState === "testing" ? "Testing..." : "Test connection"}
            </button>
            {testState === "ok" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
            {testState === "fail" && <XCircle className="w-4 h-4 text-red-400" />}
          </div>
          {testMsg && (
            <p className={`text-xs ${testState === "ok" ? "text-green-500" : testState === "fail" ? "text-red-400" : "text-stone-400"} flex items-center gap-1.5`}>
              {testState === "testing" && <Loader2 className="w-3 h-3 animate-spin" />}
              {testMsg}
            </p>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-stone-800">
            <button
              onClick={() => {
                if (window.confirm("Delete all stored keys and settings from this browser?")) {
                  clearSettings();
                  window.location.reload();
                }
              }}
              className="text-xs text-stone-500 hover:text-red-400 flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear stored data
            </button>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className={`${btn} text-stone-400 hover:text-white`}>
                {firstRun ? "Skip for now" : "Cancel"}
              </button>
              <button
                onClick={() => onSave(draft)}
                disabled={!pcfg?.apiKey}
                className={`${btn} bg-white text-black hover:bg-stone-200 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed`}
              >
                Save & start analyzing
              </button>
            </div>
          </div>

          <p className="text-[11px] text-stone-600 flex items-start gap-1.5 pt-1">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Keys persist locally (localStorage). If you deploy Tickr from your own repo, users of your page store keys
            in their own browsers only.
          </p>
        </div>
      </div>
    </div>
  );
}
