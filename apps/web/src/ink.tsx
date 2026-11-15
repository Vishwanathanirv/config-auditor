/** Hand-drawn marks. Each path is slightly irregular so it reads as a pen, not a vector shape. */

export function PenCircle({ className = "", color = "var(--pen)", animate = true }: { className?: string; color?: string; animate?: boolean }) {
  return (
    <svg viewBox="0 0 100 44" preserveAspectRatio="none" className={`pointer-events-none absolute ${className}`} aria-hidden>
      <path d="M58 4C30 1 5 8 4 22c-1 13 22 19 48 18 26-1 46-8 45-20C96 8 74 3 46 5" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" vectorEffect="non-scaling-stroke" className={animate ? "draw" : ""} style={{ ["--len" as string]: 320 }} />
    </svg>
  );
}

export function PenUnderline({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 12" preserveAspectRatio="none" className={`pointer-events-none absolute ${className}`} aria-hidden>
      <path d="M2 8c30-5 62-6 96-3 30 2 64 1 100-4" fill="none" stroke="var(--pen)" strokeWidth={2.6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Tick({ on, color = "var(--ink-blue)" }: { on: boolean; color?: string }) {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] shrink-0" aria-hidden>
      <path d="M3 4.2c4.5-.6 9.2-.5 13.6.2.5 4 .4 8.2-.2 12.1-4.4.5-8.9.5-13.2-.1-.5-4-.5-8.1-.2-12.2Z" fill="none" stroke="currentColor" strokeWidth={1.3} opacity={0.7} />
      {on && <path d="M5 10.5c1.4 1.2 2.6 2.6 3.6 4.2 2.2-4.6 5.2-8.6 9.4-12.2" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

/** A short curved stroke from a margin note back to the line it is about. */
export function Leader({ from, to, color }: { from: number; to: number; color: string }) {
  const h = Math.abs(to - from) + 24;
  const top = Math.min(from, to) - 12;
  const y1 = from - top;
  const y2 = to - top;
  return (
    <svg className="pointer-events-none absolute left-0 w-7" style={{ top, height: h }} viewBox={`0 0 28 ${h}`} aria-hidden>
      <path d={`M27 ${y1}C16 ${y1} 12 ${y2} 2 ${y2}`} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
      <path d={`M7 ${y2 - 3.5}L2 ${y2}l5 3.2`} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
