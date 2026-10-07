"use client";

/**
 * t.ROY drifts in: his figure with one short, quiet burst of light around it
 * when he arrives, then stillness. The canvas sits only inside the figure's
 * own box (never over text), stops when the tab is hidden, and is not drawn
 * at all when motion is reduced.
 */

import { useEffect, useRef } from "react";
import { TroyLivingIcon } from "@crucible/consumer-ui";

const BURST_MS = 2600;
const COUNT = 14;

export function TroyArrival({ size = 64, reduced: motionPref }: { size?: number; reduced: boolean | null }) {
  const reduced = motionPref !== false;
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (reduced || !c || !g) return;
    const dpr = window.devicePixelRatio || 1;
    const w = (c.width = c.offsetWidth * dpr);
    const h = (c.height = c.offsetHeight * dpr);
    let raf = 0;
    let last = 0;
    let t = 0;
    const draw = (now: number) => {
      t += last ? Math.min(now - last, 50) : 0;
      last = now;
      g.clearRect(0, 0, w, h);
      const k = t / BURST_MS;
      if (k >= 1) return;
      for (let i = 0; i < COUNT; i++) {
        const a = i * 2.39996;
        const d = (0.18 + 0.32 * k * (0.6 + (i % 5) * 0.1)) * w;
        g.globalAlpha = Math.sin(Math.PI * k) * (0.35 + (i % 3) * 0.2);
        g.fillStyle = i % 4 ? "#dbc173" : "#ece7d9";
        g.beginPath();
        g.arc(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d - k * 8 * dpr, (1 + (i % 2)) * dpr, 0, 7);
        g.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVis);
    onVis();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduced]);

  // The box is the figure plus room for the light; the canvas never leaves it.
  const box = Math.round(size * 1.75);
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: box, height: box }}
      aria-hidden="true"
    >
      {!reduced && <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />}
      <TroyLivingIcon size={size} />
    </span>
  );
}
