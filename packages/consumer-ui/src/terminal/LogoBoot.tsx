"use client";

import { useEffect, useRef, useState } from "react";

const BOOT_LINES = ["initializing steelman v3.0...", "loading mark..."];

interface LogoBootProps {
  className?: string;
  imgClassName?: string;
  onDone?: () => void;
}

/**
 * Skippable boot-sequence reveal of the traced logo mark. Terminal lines
 * appear, then the mark wipes in with a stepped (CRT-scan) clip-path, ~1.5s
 * total. Click/tap/Enter/Space skips instantly. prefers-reduced-motion shows
 * the final state immediately, no animation.
 */
export function LogoBoot({ className = "", imgClassName = "w-40 sm:w-56", onDone }: LogoBootProps) {
  const [stage, setStage] = useState(0);
  const [reduced, setReduced] = useState(false);
  const doneRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Skipping must cancel every pending timer -- otherwise a still-scheduled
  // "show line 2" callback can fire after skip and regress the stage back
  // down, flashing the sequence back into view after it was dismissed.
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setStage(BOOT_LINES.length + 2);
    onDone?.();
  };

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      setReduced(true);
      finish();
      return;
    }

    BOOT_LINES.forEach((_, i) => {
      timersRef.current.push(setTimeout(() => setStage(i + 1), i * 220));
    });
    timersRef.current.push(setTimeout(() => setStage(BOOT_LINES.length + 1), BOOT_LINES.length * 220 + 150));
    timersRef.current.push(setTimeout(finish, 1500));

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const imageRevealing = stage >= BOOT_LINES.length + 1;
  const done = stage >= BOOT_LINES.length + 2;

  return (
    <div
      className={`relative inline-block cursor-pointer select-none font-term ${className}`}
      onClick={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") finish();
      }}
      role="button"
      tabIndex={0}
      aria-label="Skip intro animation"
    >
      <div className="mb-3 space-y-1 text-sm text-t-phos-dim" aria-hidden="true">
        {BOOT_LINES.map((line, i) => (
          <div
            key={line}
            className={stage > i || done ? "opacity-100" : "opacity-0"}
            style={{ transition: reduced ? "none" : "opacity 150ms linear" }}
          >
            <span>{"$ "}</span>
            {line}
          </div>
        ))}
      </div>
      <img
        src="/logo-mark.svg"
        alt="Steel Man Resumes"
        className={imgClassName}
        style={{
          clipPath: imageRevealing || done ? "inset(0 0 0% 0)" : "inset(0 0 100% 0)",
          transition: reduced ? "none" : "clip-path 700ms steps(24)",
        }}
      />
      {!done && (
        <span className="absolute -bottom-5 left-0 whitespace-nowrap text-xs text-t-phos-dim" aria-hidden="true">
          (click to skip)
        </span>
      )}
    </div>
  );
}
