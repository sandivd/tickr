const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

/** Idle time before cards the pointer isn't near start patrolling on their own. */
const IDLE_MS = 4000;
/** Pointer distance (px) past a card's edge at which its glow fades out. */
const GLOW_REACH_PX = 160;
/** Delay between neighbouring patrolling cards so they don't move in lockstep. */
const ROAM_STAGGER_S = 3;

export function hasFinePointer(): boolean {
  return window.matchMedia(FINE_POINTER_QUERY).matches;
}

/**
 * Cursor-tracked border glow for every `[data-glow]` element. One shared
 * pointermove listener writes CSS custom properties directly, so nothing
 * re-renders. Cards the pointer isn't near patrol their border after a short
 * idle (and always, on touch screens). Returns a cleanup for effects.
 */
export function initBorderGlow(): () => void {
  const cards = () => document.querySelectorAll<HTMLElement>('[data-glow]');
  let pointer: { x: number; y: number } | null = null;
  let frame = 0;
  let idleTimer = 0;
  let roaming: HTMLElement[] = [];

  const reach = (el: HTMLElement) => {
    const p = pointer;
    if (!p) return null;
    const r = el.getBoundingClientRect();
    const dx = Math.max(r.left - p.x, 0, p.x - r.right);
    const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
    return {
      x: p.x - r.left,
      y: p.y - r.top,
      o: Math.max(0, 1 - Math.hypot(dx, dy) / GLOW_REACH_PX),
    };
  };

  const paint = () => {
    frame = 0;
    cards().forEach((el) => {
      const hit = reach(el);
      if (!hit || hit.o === 0) {
        el.style.removeProperty('--glow-o');
        return;
      }
      el.style.setProperty('--glow-x', `${hit.x}px`);
      el.style.setProperty('--glow-y', `${hit.y}px`);
      el.style.setProperty('--glow-o', hit.o.toFixed(3));
    });
  };

  const stopRoam = () => {
    roaming.forEach((el) => {
      el.classList.remove('glow-roam');
      el.style.animationDelay = '';
    });
    roaming = [];
  };

  const roam = () => {
    roaming = [...cards()].filter((el) => !reach(el)?.o);
    roaming.forEach((el, i) => {
      el.style.removeProperty('--glow-x');
      el.style.removeProperty('--glow-y');
      el.style.removeProperty('--glow-o');
      el.style.animationDelay = `${-i * ROAM_STAGGER_S}s`;
      el.classList.add('glow-roam');
    });
  };

  const schedulePaint = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const scheduleRoam = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(roam, IDLE_MS);
  };

  const onMove = (e: PointerEvent) => {
    pointer = { x: e.clientX, y: e.clientY };
    stopRoam();
    schedulePaint();
    scheduleRoam();
  };
  const onLeave = (e: MouseEvent) => {
    if (e.relatedTarget) return;
    pointer = null;
    schedulePaint();
    scheduleRoam();
  };

  if (hasFinePointer()) {
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseout', onLeave);
    scheduleRoam();
  } else {
    roam();
  }

  return () => {
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('mouseout', onLeave);
    window.clearTimeout(idleTimer);
    cancelAnimationFrame(frame);
    stopRoam();
    cards().forEach((el) => {
      el.style.removeProperty('--glow-x');
      el.style.removeProperty('--glow-y');
      el.style.removeProperty('--glow-o');
    });
  };
}
