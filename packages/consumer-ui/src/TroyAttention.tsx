/**
 * TroyAttention -- t.ROY leaves his corner, points at one thing, and goes back.
 *
 * This is TROY.4 from the walkthrough plan: free-floating movement plus
 * particles synced to him. He drifts to wherever the person's eyes should be,
 * says one short thing, and leaves. He does not follow, does not persist, and
 * does not speak twice on the same surface in the same session.
 *
 * WHY IT IS DELIBERATELY RARE. A proactive assistant that fires at the wrong
 * moment does not read as powerful, it reads as Clippy, and that comparison is
 * very hard to come back from. So the trigger is the expensive part, not the
 * animation: one surface, one moment, one sentence, dismissible, and silent
 * forever after on that surface. Being right is worth more than being present.
 *
 * ACCESSIBILITY. The message is a live region, so a screen reader hears it
 * without the travel meaning anything. Under prefers-reduced-motion (or the
 * app's own reduce-motion setting) nothing travels: the tag simply appears in
 * place. The particles are decorative and always aria-hidden.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { TroyLivingIcon } from "./TroyLivingIcon";

type Phase = "idle" | "arriving" | "speaking" | "leaving";

interface TroyAttentionProps {
  /** CSS selector for the element his advice is about. */
  targetSelector: string;
  /** One short sentence. Two lines maximum on a phone. */
  message: string;
  /** Distinguishes this moment from every other, for once-per-session. */
  surfaceId: string;
  /** Hold off until the person has actually settled on the screen. */
  delayMs?: number;
  /** Gate on whatever condition means the advice is warranted. */
  enabled?: boolean;
}

const SEEN_PREFIX = "troy_attention_seen:";
const ARRIVE_MS = 900;
const SPEAK_MS = 5200;
const LEAVE_MS = 700;
const PARTICLES = 7;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (document.documentElement.classList.contains("reduce-motion")) return true;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function alreadySeen(surfaceId: string): boolean {
  try {
    return sessionStorage.getItem(SEEN_PREFIX + surfaceId) === "1";
  } catch {
    // Storage blocked (private window, kiosk). Better to stay quiet than to
    // risk repeating on every render.
    return true;
  }
}

function markSeen(surfaceId: string) {
  try {
    sessionStorage.setItem(SEEN_PREFIX + surfaceId, "1");
  } catch {
    /* ignore */
  }
}

export function TroyAttention({
  targetSelector,
  message,
  surfaceId,
  delayMs = 2500,
  enabled = true,
}: TroyAttentionProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [reduced, setReduced] = useState(false);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }

  function dismiss() {
    clearTimers();
    setPhase((p) => (p === "idle" ? p : "leaving"));
    timers.current.push(window.setTimeout(() => setPhase("idle"), LEAVE_MS));
  }

  useEffect(() => {
    if (!enabled || alreadySeen(surfaceId)) return;

    const start = window.setTimeout(() => {
      const el = document.querySelector(targetSelector);
      if (!el) return; // the thing he would point at is not on screen; say nothing

      const box = el.getBoundingClientRect();
      // Off-screen or collapsed: pointing at it would be pointing at nothing.
      if (box.width === 0 || box.height === 0) return;
      if (box.top > window.innerHeight || box.bottom < 0) return;

      setReduced(prefersReducedMotion());
      setRect(box);
      markSeen(surfaceId);
      setPhase("arriving");

      timers.current.push(window.setTimeout(() => setPhase("speaking"), ARRIVE_MS));
      timers.current.push(
        window.setTimeout(() => setPhase("leaving"), ARRIVE_MS + SPEAK_MS)
      );
      timers.current.push(
        window.setTimeout(() => setPhase("idle"), ARRIVE_MS + SPEAK_MS + LEAVE_MS)
      );
    }, delayMs);

    timers.current.push(start);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSelector, surfaceId, enabled, delayMs]);

  // He gets out of the way the moment the person starts working. That is the
  // whole point: he is drawing attention TO the task, not competing with it.
  useEffect(() => {
    if (phase === "idle") return;
    const el = document.querySelector(targetSelector);
    if (!el) return;
    const onEngage = () => dismiss();
    el.addEventListener("focusin", onEngage);
    el.addEventListener("pointerdown", onEngage);
    window.addEventListener("scroll", onEngage, { passive: true, once: true });
    return () => {
      el.removeEventListener("focusin", onEngage);
      el.removeEventListener("pointerdown", onEngage);
      window.removeEventListener("scroll", onEngage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, targetSelector]);

  if (phase === "idle" || !rect) return null;

  const arrived = phase === "speaking" || phase === "leaving";
  // Sit just left of the target, vertically centred on it, clamped on screen.
  const toX = Math.max(12, Math.min(rect.left - 64, window.innerWidth - 300));
  const toY = Math.max(12, Math.min(rect.top + rect.height / 2 - 30, window.innerHeight - 120));

  return (
    <div className="troy-attn" aria-hidden={false}>
      {/* Particles: decorative, never announced. */}
      {!reduced &&
        Array.from({ length: PARTICLES }).map((_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`troy-attn__p${arrived ? " troy-attn__p--there" : ""}`}
            style={{
              ["--i" as string]: String(i),
              ["--tx" as string]: `${toX + 30 + (i % 3) * 9}px`,
              ["--ty" as string]: `${toY + 24 + ((i * 13) % 26) - 13}px`,
              transitionDelay: `${i * 55}ms`,
            }}
          />
        ))}

      <div
        className={`troy-attn__body${arrived ? " troy-attn__body--there" : ""}${
          phase === "leaving" ? " troy-attn__body--out" : ""
        }`}
        style={{ ["--tx" as string]: `${toX}px`, ["--ty" as string]: `${toY}px` }}
      >
        <TroyLivingIcon size={52} attention={phase === "speaking"} />
        <div className="troy-attn__tag" role="status" aria-live="polite">
          <p className="troy-attn__msg">{message}</p>
          <button
            type="button"
            onClick={dismiss}
            className="troy-attn__x"
            aria-label="Dismiss this tip"
          >
            &times;
          </button>
        </div>
      </div>

      <style>{TROY_ATTENTION_CSS}</style>
    </div>
  );
}

const TROY_ATTENTION_CSS = `
.troy-attn{position:fixed;inset:0;z-index:55;pointer-events:none}
.troy-attn__body{
  position:absolute;left:0;top:0;
  display:flex;align-items:center;gap:8px;
  /* He starts in his corner and returns to it. */
  transform:translate(calc(100vw - 88px), calc(100vh - 110px)) scale(0.75);
  opacity:0;
  transition:transform 900ms cubic-bezier(.22,1,.36,1), opacity 420ms ease;
  will-change:transform,opacity;
}
.troy-attn__body--there{transform:translate(var(--tx),var(--ty)) scale(1);opacity:1}
.troy-attn__body--out{opacity:0;transition-duration:700ms}
.troy-attn__tag{
  pointer-events:auto;
  display:flex;align-items:flex-start;gap:6px;
  max-width:248px;padding:8px 10px;
  background:var(--t-panel,#fff);
  border:1px solid rgba(139,92,246,0.55);
  box-shadow:0 6px 22px rgba(76,29,149,0.22);
}
.troy-attn__msg{margin:0;font-size:12px;line-height:1.45;color:var(--t-white,#1c1e1b)}
.troy-attn__x{
  flex:0 0 auto;margin:-2px -2px 0 0;padding:0 3px;
  font-size:15px;line-height:1;color:var(--t-phos-dim,#54594f);
  background:none;border:0;cursor:pointer;
}
.troy-attn__x:hover{color:var(--t-white,#1c1e1b)}
.troy-attn__p{
  position:absolute;left:0;top:0;width:5px;height:5px;border-radius:9999px;
  background:rgba(139,92,246,0.9);
  box-shadow:0 0 7px rgba(139,92,246,0.85);
  transform:translate(calc(100vw - 60px), calc(100vh - 86px)) scale(0.4);
  opacity:0;
  transition:transform 820ms cubic-bezier(.22,1,.36,1), opacity 500ms ease;
}
.troy-attn__p--there{transform:translate(var(--tx),var(--ty)) scale(1);opacity:0.95}
@media (prefers-reduced-motion: reduce){
  .troy-attn__body{transition:opacity 200ms ease;transform:translate(var(--tx),var(--ty))}
  .troy-attn__p{display:none}
}
html.reduce-motion .troy-attn__body{transition:opacity 200ms ease;transform:translate(var(--tx),var(--ty))}
html.reduce-motion .troy-attn__p{display:none}
`;

export default TroyAttention;
