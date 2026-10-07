import type { CSSProperties } from "react";

// The SMR site's workshop palette (its locked t-* values), applied to the Refinery
// login only so the front door looks like the site that sends people here.
// Every t-* class inside the scope picks these up; nothing else in the app changes.
export const WORKSHOP_SCOPE = {
  "--t-bg": "#121110",
  "--t-panel": "#1a1815",
  "--t-panel-2": "#201d18",
  "--t-panel-3": "#28231c",
  "--t-line": "#3a352c",
  "--t-line-strong": "#5a5246",
  "--t-amber": "#b98b32",
  "--t-amber-bright": "#dbc173",
  "--t-phos": "#9fbf8f",
  "--t-phos-dim": "#b9b3a0",
  "--t-white": "#ece7d9",
  "--t-bone-dim": "#b9b3a0",
  "--t-red": "#d9392a",
  "--t-red-bright": "#d9392a",
} as CSSProperties;
