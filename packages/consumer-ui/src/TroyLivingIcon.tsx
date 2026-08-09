/**
 * TroyLivingIcon — t.ROY as a living presence, not a static button glyph.
 *
 * Renders the official hooded t.ROY figure (transparent) with a purple glow
 * under/around him. He is always gently alive (a slow float + glow pulse) and
 * can enter an `attention` state — a brighter, faster glow and a pop — for the
 * important moments when he has something to say.
 *
 * Presentational only: `pointer-events: none` so the wrapping control owns the
 * click. Motion respects `prefers-reduced-motion` (glow stays, movement stops).
 *
 * Roadmap (not built yet, tracked in docs/WALKTHROUGH-FEEDBACK-PLAN-2026-08-08.md
 * TROY.4): free-floating movement around the screen + particles synced to him.
 */

"use client";

interface TroyLivingIconProps {
  /** Rendered size in px (square footprint). Default 60. */
  size?: number;
  /** Brighten + speed the glow and pop, to draw the eye at key moments. */
  attention?: boolean;
  className?: string;
}

export function TroyLivingIcon({
  size = 60,
  attention = false,
  className = "",
}: TroyLivingIconProps) {
  return (
    <span
      className={`troy-living${attention ? " troy-living--attn" : ""} ${className}`}
      style={{ ["--troy-size" as string]: `${size}px` }}
      aria-hidden="true"
    >
      <span className="troy-living__glow" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/t-roy-avatar.png"
        alt=""
        className="troy-living__fig"
        draggable={false}
      />
      <style>{TROY_LIVING_CSS}</style>
    </span>
  );
}

const TROY_LIVING_CSS = `
.troy-living{
  position:relative;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:var(--troy-size,60px);
  height:var(--troy-size,60px);
  pointer-events:none;
  --troy-purple:139,92,246;
  --troy-purple-deep:76,29,149;
}
.troy-living__glow{
  position:absolute;
  inset:-32%;
  border-radius:9999px;
  background:radial-gradient(circle at 50% 56%,
    rgba(var(--troy-purple),0.55),
    rgba(var(--troy-purple),0.26) 42%,
    rgba(var(--troy-purple),0) 70%);
  filter:blur(2px);
  animation:troyGlow 3.4s ease-in-out infinite;
}
.troy-living__fig{
  position:relative;
  width:100%;
  height:100%;
  object-fit:contain;
  filter:
    drop-shadow(0 0 5px rgba(var(--troy-purple),0.60))
    drop-shadow(0 2px 11px rgba(var(--troy-purple-deep),0.45));
  animation:troyBob 4.6s ease-in-out infinite;
  will-change:transform;
}
@keyframes troyBob{
  0%,100%{transform:translateY(0)}
  50%{transform:translateY(-6%)}
}
@keyframes troyGlow{
  0%,100%{opacity:0.7;transform:scale(1)}
  50%{opacity:1;transform:scale(1.09)}
}
.troy-living--attn .troy-living__glow{
  animation-duration:1.1s;
  background:radial-gradient(circle at 50% 56%,
    rgba(var(--troy-purple),0.85),
    rgba(var(--troy-purple),0.42) 46%,
    rgba(var(--troy-purple),0) 72%);
}
.troy-living--attn .troy-living__fig{
  animation:troyPop 1.15s ease-in-out infinite;
  filter:
    drop-shadow(0 0 8px rgba(var(--troy-purple),0.85))
    drop-shadow(0 2px 16px rgba(var(--troy-purple-deep),0.55));
}
@keyframes troyPop{
  0%,100%{transform:translateY(0) scale(1)}
  30%{transform:translateY(-10%) scale(1.08)}
  62%{transform:translateY(0) scale(1)}
}
@media (prefers-reduced-motion: reduce){
  .troy-living__glow,.troy-living__fig{animation:none !important}
}
`;
