"use client";

/**
 * Phase 7.7 (illustrated half): a deterministic, client-side, zero-PII avatar.
 *
 * We store the CHOICE (shape/color/accent/initial) -- never an image, never a
 * photo, no upload, no R2. The SVG is rendered purely from that choice plus a
 * fallback initial, so the same choice always draws the same mark. This is the
 * zero-PII default; the photo + AI-headshot path is R2-gated and not built here.
 *
 * AVATAR_FILLS is the single source of truth for the palette (paired base +
 * text colors chosen for legible contrast on the mark). fillsForColor() is pure
 * and exercised in adversarial.mts.
 */

import type { AvatarChoice, AvatarColor, AvatarShape } from "@crucible/core";

interface Fill {
  bg: string;
  fg: string;
  ring: string;
}

// Deterministic palette. Each entry pairs a fill with a light initial color
// that reads clearly on it (never a low-contrast combination).
export const AVATAR_FILLS: Record<AvatarColor, Fill> = {
  amber: { bg: "#7a5a1c", fg: "#f6e6c4", ring: "#d7b86e" },
  phos: { bg: "#274b2f", fg: "#cdeecf", ring: "#7bbf86" },
  slate: { bg: "#33404b", fg: "#dbe6ef", ring: "#8fa6ba" },
  clay: { bg: "#6d3b2c", fg: "#f3ddd2", ring: "#c78a72" },
  plum: { bg: "#4a2c52", fg: "#ecd6f0", ring: "#a878b0" },
  teal: { bg: "#1f4b4c", fg: "#cfeeee", ring: "#6fb8b8" },
};

/** Pure: the fill triple for a color, defaulting to amber for anything unknown. */
export function fillsForColor(color: AvatarColor): Fill {
  return AVATAR_FILLS[color] ?? AVATAR_FILLS.amber;
}

/** Pure: the SVG path/shape spec for a given shape name. */
function shapeGeometry(shape: AvatarShape, size: number) {
  const c = size / 2;
  switch (shape) {
    case "square":
      return { type: "rect" as const, x: size * 0.08, y: size * 0.08, w: size * 0.84, h: size * 0.84, rx: size * 0.16 };
    case "hex":
      return { type: "poly" as const, points: hexPoints(c, c, size * 0.46) };
    case "shield":
      return { type: "path" as const, d: shieldPath(size) };
    case "circle":
    default:
      return { type: "circle" as const, cx: c, cy: c, r: size * 0.44 };
  }
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function shieldPath(size: number): string {
  const s = size;
  return `M${s * 0.5} ${s * 0.08}
          L${s * 0.9} ${s * 0.22}
          L${s * 0.9} ${s * 0.52}
          Q${s * 0.9} ${s * 0.82} ${s * 0.5} ${s * 0.94}
          Q${s * 0.1} ${s * 0.82} ${s * 0.1} ${s * 0.52}
          L${s * 0.1} ${s * 0.22}
          Z`;
}

interface Props {
  choice: AvatarChoice | null;
  /** Used when choice is null or its initial is empty (e.g. the user's name). */
  fallbackInitial?: string;
  size?: number;
  className?: string;
}

export function IllustratedAvatar({ choice, fallbackInitial, size = 40, className }: Props) {
  const shape = choice?.shape ?? "circle";
  const color = choice?.color ?? "slate";
  const accent = choice?.accent ?? "solid";
  const initial =
    (choice?.initial || fallbackInitial || "?").trim().charAt(0).toUpperCase() || "?";

  const fill = fillsForColor(color);
  const geo = shapeGeometry(shape, size);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label="Your avatar"
    >
      {geo.type === "circle" && (
        <circle cx={geo.cx} cy={geo.cy} r={geo.r} fill={fill.bg} />
      )}
      {geo.type === "rect" && (
        <rect x={geo.x} y={geo.y} width={geo.w} height={geo.h} rx={geo.rx} fill={fill.bg} />
      )}
      {geo.type === "poly" && <polygon points={geo.points} fill={fill.bg} />}
      {geo.type === "path" && <path d={geo.d} fill={fill.bg} />}

      {/* Accent: a ring around the mark, or a small corner dot. Solid = none. */}
      {accent === "ring" && geo.type === "circle" && (
        <circle cx={geo.cx} cy={geo.cy} r={geo.r} fill="none" stroke={fill.ring} strokeWidth={size * 0.05} />
      )}
      {accent === "ring" && geo.type !== "circle" && (
        <circle cx={size / 2} cy={size / 2} r={size * 0.46} fill="none" stroke={fill.ring} strokeWidth={size * 0.04} />
      )}
      {accent === "corner" && (
        <circle cx={size * 0.8} cy={size * 0.2} r={size * 0.11} fill={fill.ring} />
      )}

      <text
        x="50%"
        y="50%"
        dy="0.02em"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.42}
        fontWeight={700}
        fontFamily="'IBM Plex Sans', 'Segoe UI', Arial, sans-serif"
        fill={fill.fg}
      >
        {initial}
      </text>
    </svg>
  );
}
