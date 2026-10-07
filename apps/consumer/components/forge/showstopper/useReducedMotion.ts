"use client";

import { useEffect, useState } from "react";

/**
 * True when motion should stop: the app's own setting wins (html.reduce-motion
 * on, or data-reduced-motion="off" to keep motion), otherwise the device's
 * prefers-reduced-motion. Null until read in the browser: nothing should move
 * (or be decided) before we know.
 */
export function useReducedMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    const html = document.documentElement;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => {
      if (html.classList.contains("reduce-motion")) return true;
      if (html.dataset.reducedMotion === "off") return false;
      return mq.matches;
    };
    const update = () => setReduced(read());
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}
