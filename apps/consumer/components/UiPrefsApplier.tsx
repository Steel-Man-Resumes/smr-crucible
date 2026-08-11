"use client";

/**
 * Phase 7.2: reads the signed-in user's saved accessibility prefs once on
 * mount and applies them app-wide (font scale, density, reduced-motion), then
 * re-applies whenever the Settings page dispatches UI_PREFS_EVENT so a change
 * is visible immediately. Renders nothing.
 *
 * Mounted high in the dashboard shell so every dashboard page inherits the
 * prefs. Fire-and-forget: a failed fetch just leaves the OS/default behavior
 * in place.
 */

import { useEffect } from "react";
import { applyUiPrefs, UI_PREFS_EVENT } from "@/lib/ui-prefs-apply";
import type { UiPrefs } from "@crucible/core";

export function UiPrefsApplier() {
  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/ui-prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data) applyUiPrefs(j.data as UiPrefs);
      })
      .catch(() => {});

    function onChange(e: Event) {
      const detail = (e as CustomEvent).detail as UiPrefs | undefined;
      if (detail) applyUiPrefs(detail);
    }
    window.addEventListener(UI_PREFS_EVENT, onChange as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(UI_PREFS_EVENT, onChange as EventListener);
    };
  }, []);

  return null;
}
