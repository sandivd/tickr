/** Disclaimer + Tavily meter line, shared by the landing hero and the run bar. */
export function DisclaimerRow({ tavilyUsed, tavilyKeySet }: { tavilyUsed: number; tavilyKeySet: boolean }) {
  return (
    <div className="flex items-center gap-2 flex-wrap font-mono">
      <span className="text-xs text-stone-500 tracking-wider">
        AI can make mistakes, don't rely on it for financial advice.
      </span>
      {tavilyKeySet && (
        <span
          className="text-[10px] text-stone-600 border border-white/10 rounded px-1.5 py-0.5"
          title="Estimated Tavily searches issued by this browser this calendar month (1 credit each — the app's only metered resource)."
        >
          Tavily this month: {tavilyUsed}/1,000
        </span>
      )}
    </div>
  );
}
