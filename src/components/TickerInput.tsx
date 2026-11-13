import { useEffect, useRef } from 'react';
import { Search, ArrowRight } from 'lucide-react';
import { hasFinePointer } from '../lib/motion';

/** Within this many px of the Analyze button's centre it starts leaning toward the cursor… */
const MAGNET_REACH_PX = 90;
/** …by at most this many px. */
const MAGNET_MAX_PX = 5;

/**
 * Shared ticker entry row — the landing hero and the pinned run bar both
 * render it, so the Analyze affordance looks and behaves identically in
 * both states. Enter submits; the button disables on empty input or while
 * a run is in flight.
 */
export function TickerInput({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inert = disabled || !value.trim();

  useEffect(() => {
    const button = buttonRef.current;
    if (!button || inert || !hasFinePointer()) return;

    let pointer: { x: number; y: number } | null = null;
    let frame = 0;

    const pull = () => {
      frame = 0;
      let next = { x: 0, y: 0 };
      if (pointer) {
        const r = button.getBoundingClientRect();
        // The rect includes any in-flight transition, so subtract the current
        // translate to get the resting centre (otherwise the button oscillates).
        const t = getComputedStyle(button).transform;
        const m = t === 'none' ? null : new DOMMatrixReadOnly(t);
        const cx = r.left + r.width / 2 - (m?.e ?? 0);
        const cy = r.top + r.height / 2 - (m?.f ?? 0);
        const dx = pointer.x - cx;
        const dy = pointer.y - cy;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < MAGNET_REACH_PX) {
          const strength = (1 - d / MAGNET_REACH_PX) * MAGNET_MAX_PX;
          next = { x: (dx / d) * strength, y: (dy / d) * strength };
        }
      }
      button.style.transform = next.x || next.y ? `translate(${next.x.toFixed(2)}px, ${next.y.toFixed(2)}px)` : '';
    };
    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(pull);
    };
    const onLeave = (e: MouseEvent) => {
      if (e.relatedTarget) return;
      pointer = null;
      if (!frame) frame = requestAnimationFrame(pull);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseout', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseout', onLeave);
      cancelAnimationFrame(frame);
      button.style.transform = '';
    };
  }, [inert]);

  return (
    <div
      data-glow
      className="glow-card bg-[#0e1311]/90 backdrop-blur-md border border-green-500/25 rounded-lg p-2 w-full flex items-center gap-2 relative z-30 transition-all focus-within:border-green-500/60 focus-within:ring-1 focus-within:ring-green-500/40"
    >
      <div className="pl-3 py-2 flex items-center gap-3 text-stone-500 w-full flex-1">
        <Search className="w-5 h-5 shrink-0" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter a stock or ETF ticker symbol here"
          disabled={disabled}
          className="bg-transparent border-none outline-none w-full text-stone-100 font-mono uppercase placeholder-stone-600 disabled:opacity-50"
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        />
      </div>
      <button
        ref={buttonRef}
        onClick={onSubmit}
        disabled={disabled || !value.trim()}
        className="border border-green-500/50 text-green-300 hover:bg-green-500/10 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent px-5 py-2 rounded-md font-mono text-sm tracking-wide flex items-center gap-2 transition-[color,background-color,border-color,transform] duration-200 ease-out shrink-0 ml-2"
      >
        Analyze <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
