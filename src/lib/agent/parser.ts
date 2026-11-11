/**
 * Extracts the ReportData JSON object from the agent's final text output.
 * Carried over verbatim (logic kept identical) from the original App.tsx
 * parseFinalText: parse ```json blocks newest-first (code fence first),
 * then fall back to brace-slicing with several recovery strategies.
 */

export function extractReportJson(text: string): unknown | null {
  if (!text) return null;
  try {
    let foundData: unknown = null;
    const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)];
    for (let i = matches.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(matches[i][1]);
        if (looksLikeReport(parsed)) {
          foundData = parsed;
          break;
        }
      } catch {
        /* skip broken course block */
      }
    }

    if (!foundData) {
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          const possibleJson = text.slice(firstBrace, lastBrace + 1);
          const parsed = JSON.parse(possibleJson);
          if (looksLikeReport(parsed)) {
            foundData = parsed;
          }
        } catch {
          const match = text.match(/\{\s*"verdict"[\s\S]*?\}\s*\}/);
          if (match) {
            try {
              const parsed = JSON.parse(match[0]);
              if (looksLikeReport(parsed)) {
                foundData = parsed;
              }
            } catch {
              /* keep trying */
            }
          }
        }
      }
    }
    return foundData;
  } catch {
    return null;
  }
}

function looksLikeReport(parsed: unknown): boolean {
  const obj = parsed as { verdict?: unknown; findings?: unknown; deep_insights?: unknown } | null;
  if (!obj || typeof obj !== "object") return false;
  return !!(obj.verdict || obj.findings || obj.deep_insights);
}
