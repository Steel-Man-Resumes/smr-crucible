"use client";

/**
 * <CompletionConfetti> -- a short celebration burst when the Forge finishes.
 * Starts at the top, drifts down, gone in under 4 seconds. Pure CSS, no
 * library. Respects prefers-reduced-motion (renders nothing).
 */

import { useEffect, useState } from "react";

const COLORS = ["#9b6d1d", "#2d5a85", "#2f6b3c", "#795212", "#4f6b57"];
const PIECES = 36;

export function CompletionConfetti() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 4000);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 h-screen overflow-hidden z-[70]"
    >
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-4vh) rotate(0deg); opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translateY(70vh) rotate(540deg); opacity: 0; }
        }
      `}</style>
      {Array.from({ length: PIECES }, (_, i) => {
        // Deterministic pseudo-random spread (no Math.random -> stable SSR/CSR)
        const left = ((i * 37) % 100);
        const delay = ((i * 13) % 40) / 40;
        const duration = 2.4 + ((i * 7) % 12) / 10;
        const size = 5 + ((i * 11) % 6);
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: `${left}%`,
              top: 0,
              width: size,
              height: size * 0.6,
              background: COLORS[i % COLORS.length],
              animation: `confetti-fall ${duration}s ease-in ${delay}s forwards`,
              opacity: 0,
            }}
          />
        );
      })}
    </div>
  );
}

export default CompletionConfetti;
