/**
 * Phase 7.2: apply the user's accessibility prefs to the live DOM.
 *
 * One place that maps prefs -> <html> attributes/classes, shared by the
 * root applier (on load) and the Settings page (on change) so a toggle takes
 * effect instantly without a reload. Pure DOM writes, no network.
 *
 *  - data-font-scale on <html> drives the root rem in globals.css (size only).
 *  - data-density on <html> drives the compact line-height in globals.css.
 *  - reduced motion: an EXPLICIT true adds .reduce-motion; false removes it and
 *    stops honoring the OS query (the user opted out); null/"follow the device"
 *    leaves the class off and lets the prefers-reduced-motion media query rule.
 */

import type { UiPrefs } from "@crucible/core";

export const UI_PREFS_EVENT = "ui-prefs-changed";

export function applyUiPrefs(prefs: Pick<UiPrefs, "fontScale" | "density" | "reducedMotion">) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;

  html.setAttribute("data-font-scale", prefs.fontScale || "normal");
  html.setAttribute("data-density", prefs.density || "comfortable");

  if (prefs.reducedMotion === true) {
    html.classList.add("reduce-motion");
    html.setAttribute("data-reduced-motion", "on");
  } else {
    html.classList.remove("reduce-motion");
    // false = explicit opt-out; null = follow the OS. We record which so the
    // settings control can show the right state, but neither forces motion off.
    html.setAttribute("data-reduced-motion", prefs.reducedMotion === false ? "off" : "auto");
  }
}
