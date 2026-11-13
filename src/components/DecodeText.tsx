import { useEffect, useState } from 'react';

const GLYPHS = '01<>[]{}#$%&*+=/\\|:;';

function scramble(text: string, resolved: number): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out += i < resolved || ch === ' ' ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  }
  return out;
}

/**
 * One-shot terminal "decode": characters resolve left to right out of random
 * glyphs. Monospace keeps every glyph the same width, so nothing shifts while
 * it runs. `accent` keeps one substring styled (green italic) through the
 * whole scramble, and `delay` staggers sibling decodes into a cascade. Screen
 * readers get the final text only.
 */
export function DecodeText({
  text,
  accent,
  delay = 0,
  duration = 1100,
}: {
  text: string;
  accent?: string;
  delay?: number;
  duration?: number;
}) {
  const accentStart = accent ? text.indexOf(accent) : -1;
  const accentEnd = accentStart >= 0 ? accentStart + accent.length : -1;
  const [shown, setShown] = useState(() => scramble(text, 0));

  useEffect(() => {
    let frame = 0;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = (now - start) / duration;
        if (t >= 1) {
          setShown(text);
          return;
        }
        setShown(scramble(text, Math.floor(t * text.length)));
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [text, delay, duration]);

  return (
    <>
      <span aria-hidden>
        {accentStart < 0
          ? shown
          : [...shown].map((ch, i) => (
              <span key={i} className={i >= accentStart && i < accentEnd ? 'italic text-green-400' : undefined}>
                {ch}
              </span>
            ))}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}
