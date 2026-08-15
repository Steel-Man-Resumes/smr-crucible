"use client";

/**
 * Phase 7.7: the user's avatar in the top nav. Reads the saved choice from
 * /api/user/ui-prefs and re-reads it when the Settings page saves a new one
 * (UI_PREFS_EVENT), so the change shows without a reload.
 *
 * Two modes:
 *  - Illustrated (the zero-PII default): a client-rendered SVG mark.
 *  - Photo: when ui_avatar.photoAssetId is set, the chosen photo is fetched from
 *    the owner-exclusive proxy (/api/avatar/[id]/image) and shown. The id is NOT
 *    an access grant -- the proxy re-checks ownership -- and on any load error we
 *    fall back to the illustrated mark, so a stale/missing photo never breaks the
 *    nav.
 */

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { IllustratedAvatar } from "@/components/IllustratedAvatar";
import { UI_PREFS_EVENT } from "@/lib/ui-prefs-apply";
import type { AvatarChoice, UiPrefs } from "@crucible/core";

export function NavAvatar({ size = 30 }: { size?: number }) {
  const { data: session } = useSession();
  const [choice, setChoice] = useState<AvatarChoice | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/ui-prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data) {
          setChoice((j.data as UiPrefs).avatar);
          setPhotoFailed(false);
        }
      })
      .catch(() => {});

    function onChange(e: Event) {
      const detail = (e as CustomEvent).detail as UiPrefs | undefined;
      if (detail && "avatar" in detail) {
        setChoice(detail.avatar);
        setPhotoFailed(false);
      }
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

  const photoAssetId = choice?.photoAssetId;
  if (photoAssetId && !photoFailed) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={`/api/avatar/${photoAssetId}/image`}
        alt="Your picture"
        width={size}
        height={size}
        onError={() => setPhotoFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: "9999px",
          objectFit: "cover",
          display: "block",
        }}
      />
    );
  }

  return (
    <IllustratedAvatar choice={choice} fallbackInitial={fallbackInitial} size={size} />
  );
}
