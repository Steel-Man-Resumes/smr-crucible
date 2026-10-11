"use client";

/**
 * "Check and finish" (Phase 5 lane R2, CC 2026-10-10). Under R1's rule raw
 * text is always DRAFT: a Refinery resume, a Tailor result or the pre-finish
 * builder downloads marked DRAFT until it is checked. This is the way out,
 * wherever such a resume shows: the draft line, and one link that opens the
 * finish page with that resume loaded (same cards, saved as a revision).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { CHECK_AND_FINISH_LABEL, DRAFT_BADGE } from "@/lib/lane-task";

export const checkAndFinishHref = (artifactId: string) => `/output?check=${encodeURIComponent(artifactId)}`;

/** The draft line and the link. `status` known: shown at once; unknown: read from the newest revision. */
export function CheckAndFinish({ artifactId, status, className = "", showBadge = true }: { artifactId: string; status?: "draft" | "finished" | null; className?: string; showBadge?: boolean }) {
  const [known, setKnown] = useState<"draft" | "finished" | null>(status ?? null);
  useEffect(() => {
    if (status) {
      setKnown(status);
      return;
    }
    let live = true;
    fetch(`/api/revisions?artifactId=${encodeURIComponent(artifactId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setKnown(j?.revision?.status === "finished" ? "finished" : "draft"))
      .catch(() => live && setKnown("draft"));
    return () => {
      live = false;
    };
  }, [artifactId, status]);

  if (known === null) return null;
  if (known === "finished") {
    return (
      <p className={`text-xs text-t-phos ${className}`} data-testid="finished-line">
        Finished. Downloads use the checked version.
      </p>
    );
  }
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`} data-testid="check-and-finish">
      {showBadge && (
        <span className="text-xs font-medium text-t-amber-bright" data-testid="draft-badge">
          {DRAFT_BADGE}
        </span>
      )}
      <Link href={checkAndFinishHref(artifactId)} className="t-focus inline-flex min-h-touch items-center text-sm font-semibold text-t-amber-bright underline underline-offset-2 hover:text-t-amber" data-testid="check-and-finish-link">
        {CHECK_AND_FINISH_LABEL}
      </Link>
    </div>
  );
}
