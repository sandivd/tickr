/**
 * Tavily web-search tool (https://tavily.com).
 *
 * The OPTIONAL universal fallback for providers that don't ship native web
 * search with the user's chosen model (e.g. OpenCode Console models, custom
 * OpenAI-compatible gateways, or OpenRouter models without the web plugin).
 * The user provides their own Tavily key; the request goes straight from
 * the browser to api.tavily.com.
 */

import { resilientFetch, composeAbort, TAVILY_TIMEOUT_MS } from "./net";
import { recordTavilyCredits } from "../usage";

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  /** Tavily's best-effort publish/updated date, when detectable (null otherwise). */
  publishedDate?: string | null;
}

/** Recency/relevance knobs for a single search (validated upstream by Tavily). */
export interface TavilySearchOptions {
  topic?: "general" | "news" | "finance";
  time_range?: "day" | "week" | "month" | "year";
  max_results?: number;
  /** Attach each result's publish/update date (beta; auto-on for topic=news). */
  include_published_date?: boolean;
}

export const TAVILY_TOOL_NAME = "tavily_search";

export const TAVILY_TOOL_DESCRIPTION =
  "Search the live web for current, real-time information. Use this for every query about stock prices, financial metrics, recent news, SEC filings, or anything that may post-date your training data. Returns ranked results with publish/update dates, titles, URLs and content snippets. For market data use topic='finance' plus a short time_range; for SEC filings/documents append 'filetype:pdf'.";

export const tavilyToolSchema = {
  type: "function" as const,
  function: {
    name: TAVILY_TOOL_NAME,
    description: TAVILY_TOOL_DESCRIPTION,
    parameters: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The web search query. For SEC filings/documents, append 'filetype:pdf'.",
        },
        topic: {
          type: "string",
          enum: ["general", "news", "finance"],
          description: "'finance' for prices/earnings/market data, 'news' for current events; omit for filings and general research.",
        },
        time_range: {
          type: "string",
          enum: ["day", "week", "month", "year"],
          description: "Freshness window. Use 'week' or 'month' for stock prices and current figures; omit for filings.",
        },
      },
      required: ["query"],
    },
  },
};

/**
 * The OpenAI function-tool definition for tavily_search.
 */
export const tavilyOpenAITool = { type: "function" as const, function: { ...tavilyToolSchema.function } };

export async function searchTavily(
  apiKey: string,
  query: string,
  signal?: AbortSignal,
  options?: TavilySearchOptions
): Promise<TavilyResult[]> {
  // Hard 20s ceiling so a Tavily outage fails the tool (letting the agent's
  // fail-streak throttle engage) instead of freezing the agent round. A
  // timeout surfaces as an explicit message; a user stop propagates as-is.
  const timeoutSignal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(TAVILY_TIMEOUT_MS) : undefined;
  // Credit meter: 1 credit per search actually issued — recorded here, the
  // single choke point for every adapter's fallback path, so circuit-breaker
  // skips (never sent) and native provider search (not billed to Tavily)
  // stay out of the count.
  recordTavilyCredits(1);
  let resp: Response;
  try {
    resp = await resilientFetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: options?.max_results ?? 6,
        include_answer: false,
        include_raw_content: false,
        include_published_date: options?.include_published_date ?? false,
        ...(options?.topic ? { topic: options.topic } : {}),
        ...(options?.time_range ? { time_range: options.time_range } : {}),
      }),
      signal: composeAbort(signal, timeoutSignal),
    }, "Tavily web search");
  } catch (e) {
    if ((e as { name?: string })?.name === "TimeoutError") {
      throw new Error(`Tavily search timed out after ${TAVILY_TIMEOUT_MS / 1000}s — network issue or Tavily outage.`);
    }
    throw e;
  }

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "");
    throw new Error(`Tavily search failed (${resp.status}): ${errorText.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    results?: Array<{ title: string; url: string; content: string; published_date?: string | null }>;
  };
  return (data.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content || "",
    publishedDate: r.published_date ?? null,
  }));
}

/** Compact string form handed back to the model as the tool result.
 *  Lean runs use shorter snippets — the content is the model's context, and
 *  trimming it shrinks every subsequent turn (especially the final report
 *  synthesis slop on free-tier models). */
export function formatTavilyResults(query: string, results: TavilyResult[], lean = false): string {
  const slice = lean ? 500 : 800;
  const lines: string[] = [`Query: ${query}`, ""];
  results.forEach((r, i) => {
    lines.push(`[${i + 1}] ${r.title}`);
    lines.push(`URL: ${r.url}`);
    if (r.publishedDate) lines.push(`Published/updated: ${r.publishedDate}`);
    lines.push(r.content.slice(0, slice));
    lines.push("");
  });
  if (results.length === 0) lines.push("No results found.");
  return lines.join("\n");
}

export interface TavilyExtract {
  url: string;
  rawContent: string;
}

/**
 * Tavily Extract — full page text for specific URLs. The search endpoint
 * only returns short snippets, which truncate exactly where earnings
 * press-release income-statement tables live (bullet highlights first,
 * tables after) — so quarterly net income in dollars frequently never
 * reaches the model. Extract closes that gap for the few pages that matter.
 *
 * 1 credit per call (up to 5 URLs); callers gate it hard (quarterly-figure
 * queries only, primary-looking results only, a few calls per run) so the
 * free tier is unaffected in practice. Unextractable URLs come back in
 * `failed_results` rather than failing the request — they are filtered out
 * here, and the caller treats a total failure as best-effort skip.
 */
export async function extractTavily(
  apiKey: string,
  urls: string[],
  signal?: AbortSignal
): Promise<TavilyExtract[]> {
  const timeoutSignal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(TAVILY_TIMEOUT_MS) : undefined;
  recordTavilyCredits(1);
  let resp: Response;
  try {
    resp = await resilientFetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        urls,
        extract_depth: "basic",
        format: "text",
      }),
      signal: composeAbort(signal, timeoutSignal),
    }, "Tavily extract");
  } catch (e) {
    if ((e as { name?: string })?.name === "TimeoutError") {
      throw new Error(`Tavily extract timed out after ${TAVILY_TIMEOUT_MS / 1000}s — network issue or Tavily outage.`);
    }
    throw e;
  }

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "");
    throw new Error(`Tavily extract failed (${resp.status}): ${errorText.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    results?: Array<{ url: string; raw_content?: string | null }>;
  };
  return (data.results || [])
    .filter((r) => r.url && r.raw_content)
    .map((r) => ({ url: r.url, rawContent: r.raw_content as string }));
}
