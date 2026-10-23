"use client";

import { useEffect, useRef, useState } from "react";

interface Rect { left: number; top: number; width: number; height: number }

/** Eight decorative particles travel once toward the real spotlight, then stop. */
export function TourTrail({ rect, stop, ready }: { rect: Rect | null; stop: number; ready: boolean }) {
  const [reduced, setReduced] = useState(true);
  const [trail, setTrail] = useState<{ path: string; key: number } | null>(null);
  const previous = useRef<{ x: number; y: number } | null>(null);
  const lastStop = useRef<number | null>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(preference.matches);
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!ready || !rect || reduced || lastStop.current === stop) return;
    // Land on the border rather than over the target's words.
    const end = { x: rect.left + Math.min(16, rect.width / 2), y: rect.top };
    const guide = document.querySelector<HTMLElement>(".refinery-tour-guide")?.getBoundingClientRect();
    const start = previous.current ?? (guide ? { x: guide.right, y: guide.top + guide.height / 2 } : end);
    const control = { x: (start.x + end.x) / 2, y: Math.max(8, Math.min(start.y, end.y) - 36) };
    setTrail({ path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`, key: stop });
    previous.current = end;
    lastStop.current = stop;
  }, [ready, rect, reduced, stop]);

  if (reduced || !trail) return null;
  return <div className="refinery-tour-trail" aria-hidden="true" key={trail.key}>
    {Array.from({ length: 8 }, (_, index) => <span key={index}
      className={index % 3 === 0 ? "refinery-tour-smoke" : "refinery-tour-ember"}
      style={{ offsetPath: `path('${trail.path}')`, animationDelay: `${index * .045}s` }} />)}
  </div>;
}
