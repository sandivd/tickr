import { memo, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Info, Brain, Code, CheckCircle, MessageSquare, AlertCircle, ChevronDown, HelpCircle } from 'lucide-react';

export interface TimelineEvent {
  id: number;
  kind: 'info' | 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'error';
  label: string;
  detail?: string;
  toolName?: string;
  startTime?: number;
  endTime?: number;
  callId?: string;
}

const ICONS = {
  info: Info,
  thinking: Brain,
  tool_call: Code,
  tool_result: CheckCircle,
  text: MessageSquare,
  error: AlertCircle,
} as const;

/**
 * One timeline card, memoized. While a run streams, the timeline re-renders
 * ~20×/s (live-duration tick) and once per App state change: completed cards
 * receive a stable `now` (= their own endTime), so they skip every tick —
 * only the one still-running card re-renders, instead of every card on the
 * wall (which previously re-mounted all framer-motion subtrees 20×/s).
 */
const TimelineCard = memo(function TimelineCard({ event, isLive, now }: { event: TimelineEvent; isLive: boolean; now: number }) {
  const Icon = ICONS[event.kind];
  const durationMs = event.endTime
    ? event.endTime - (event.startTime || event.endTime)
    : isLive
      ? Math.max(0, now - (event.startTime || now))
      : 0;
  const durationSec = (durationMs / 1000).toFixed(2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="bg-[#0d1210]/70 backdrop-blur-md border border-green-500/15 rounded-lg w-full flex flex-col overflow-hidden shadow-2xl"
    >
      <div className="p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5 text-green-400 shrink-0" />
          <h3 className="font-mono text-sm md:text-[15px] tracking-wide text-stone-100"><span className="text-green-400 mr-2">&gt;</span>{event.label}</h3>
        </div>

        {event.detail && (
          <div className="bg-black/40 border border-green-500/10 rounded-md p-4 flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
               {event.kind === 'tool_result' ? (
                  <CheckCircle className="w-4 h-4 text-green-400/60" />
               ) : (
                  <div className="w-4 h-4 border-2 border-green-500/40 border-dashed rounded-full" />
               )}
            </div>
            <div className="text-[12px] leading-relaxed text-stone-300 font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto w-full">
              {event.detail}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-green-500/10 bg-black/30 px-6 py-3 flex items-center justify-between text-[11px] font-mono text-stone-500">
        <div className="flex items-center gap-1.5 hover:text-green-300 transition-colors">
          {event.toolName ? (
            <>
              <Code className="w-3 h-3" />
              <span className="font-mono text-green-300/70">{event.toolName}</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span className="cursor-pointer">View Results</span>
            </>
          )}
        </div>
        <span className="tabular-nums text-stone-400">{durationSec} sec</span>
      </div>
    </motion.div>
  );
});

export const AgentTimeline = memo(function AgentTimeline({ events, running, paused, hasReport, onViewReport, onDecisionClick, metrics }: { events: TimelineEvent[]; running: boolean; paused?: boolean; hasReport?: boolean; onViewReport?: () => void; onDecisionClick?: () => void; metrics?: { durationSecs: number; tokenCount: number; documentCount: number } }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let timer: any;
    if (running) {
      timer = setInterval(() => {
        setTick(t => t + 1);
      }, 50); // 50ms for smooth 2 decimal places updates
    }
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [events.length, running]);

  const now = Date.now();

  return (
    <div className="w-full flex flex-col items-center py-12 relative px-6">
      {events.length > 0 && (
         <div className="absolute top-0 bottom-0 left-1/2 w-px bg-green-500/20 -translate-x-1/2 z-0" />
      )}

      <div className="space-y-6 w-full max-w-lg relative z-10">
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <TimelineCard
              key={e.id}
              event={e}
              isLive={!e.endTime && running}
              // Completed cards pin `now` to their endTime so the memo skips
              // every tick; only the live card keeps ticking.
              now={e.endTime !== undefined ? e.endTime : running ? now : 0}
            />
          ))}
        </AnimatePresence>

        {running && !paused && (
           <motion.div
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             className="bg-[#0d1210]/70 backdrop-blur-md border border-green-500/15 rounded-lg p-6 w-full flex flex-col gap-4 overflow-hidden shadow-2xl"
           >
             <div className="flex items-center gap-3">
               <div className="w-5 h-5 border-2 border-green-400 rounded-full animate-pulse shrink-0" />
               <span className="font-mono text-sm md:text-[15px] tracking-wide text-stone-100"><span className="text-green-400 mr-2">&gt;</span>Skill is working...</span>
             </div>
           </motion.div>
        )}

        {paused && (
           <motion.div
             initial={{ opacity: 0, scale: 0.95 }}
             animate={{ opacity: 1, scale: 1 }}
             className="bg-black/40 backdrop-blur-md border border-yellow-500/50 rounded-lg p-6 w-full flex items-center justify-between cursor-pointer hover:bg-black/60 transition-colors shadow-lg shadow-black/10 animate-pulse"
             onClick={onDecisionClick}
           >
             <div className="flex items-center gap-3">
               <HelpCircle className="w-5 h-5 text-yellow-500 shrink-0" />
               <div>
                  <h3 className="font-mono text-sm md:text-[15px] tracking-wide text-stone-100"><span className="text-yellow-400 mr-2">&gt;</span>Strategic Decision Required</h3>
                  <p className="text-sm text-stone-400 mt-0.5">I found conflicting reports on their new EV timeline...</p>               </div>
             </div>
             <ChevronDown className="w-5 h-5 text-stone-500 -rotate-90" />
           </motion.div>
        )}

        {hasReport && (
           <motion.div
             initial={{ opacity: 0, y: 16 }}
             animate={{ opacity: 1, y: 0 }}
             className="bg-[#0d1210]/70 backdrop-blur-md border border-green-500/25 rounded-lg w-full flex flex-col cursor-pointer hover:bg-[#0d1210] hover:border-green-500/40 transition-colors shadow-2xl"
             onClick={onViewReport}
           >
             <div className="p-6 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                   <div>
                      <h3 className="font-mono text-sm md:text-[15px] tracking-wide text-stone-100"><span className="text-green-400 mr-2">&gt;</span>Your report is now ready</h3>
                      <p className="text-sm text-stone-400 mt-0.5">Click to see the final intelligence report.</p>
                   </div>
                 </div>
                 <ChevronDown className="w-5 h-5 text-green-400/60 -rotate-90" />
             </div>
             {metrics && (
                 <div className="border-t border-green-500/10 bg-black/30 px-6 py-3 flex flex-wrap gap-4 text-[11px] font-mono text-stone-500">
                    <span className="flex items-center gap-1.5"><span className="text-green-300/70">Docs:</span> {metrics.documentCount}</span>
                    <span className="flex items-center gap-1.5"><span className="text-green-300/70">Time:</span> {metrics.durationSecs}s</span>
                    <span className="flex items-center gap-1.5"><span className="text-green-300/70">Tokens:</span> {metrics.tokenCount.toLocaleString()}</span>
                 </div>
             )}
           </motion.div>
        )}

        <div ref={endRef} className="h-4 w-full" />
      </div>
    </div>
  );
});
