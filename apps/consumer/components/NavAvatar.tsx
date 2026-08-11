"use client";

/**
 * Phase 7.7: the user's illustrated avatar in the top nav. Reads the saved
 * choice from /api/user/ui-prefs and re-reads it when the Settings page saves a
 * new one (UI_PREFS_EVENT), so the change shows without a reload. Falls back to
 * the initial of the signed-in name/email when no choice is saved. Zero PII --
 * a drawing, never a photo.
 */

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { IllustratedAvatar } from "@/components/IllustratedAvatar";
import { UI_PREFS_EVENT } from "@/lib/ui-prefs-apply";
import type { AvatarChoice, UiPrefs } from "@crucible/core";

export function NavAvatar({ size = 30 }: { size?: number }) {
  const { data: session } = useSession();
  const [choice, setChoice] = useState<AvatarChoice | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/ui-prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data) setChoice((j.data as UiPrefs).avatar);
      })
      .catch(() => {});

    function onChange(e: Event) {
      const detail = (e as CustomEvent).detail as UiPrefs | undefined;
      if (detail && "avatar" in detail) setChoice(detail.avatar);
    }
    window.addEventListener(UI_PREFS_EVENT, onChange as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(UI_PREFS_EVENT, onChange as EventListener);
    };
  }, []);

  const fallbackInitial = (session?.user?.name || session?.user?.email || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <IllustratedAvatar choice={choice} fallbackInitial={fallbackInitial} size={size} />
  );
}
