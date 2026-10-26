"use client";

/**
 * <OrgSetupPrompt> -- the first-run nudge for an organization's owner while
 * setup is not finished (org_profile.setup_completed_at is empty; house lane
 * L3a). Shown on Today and in Settings. Says nothing to anyone who cannot run
 * setup, and nothing once it is done. "Not now" hides it for this browser
 * session only; setup stays reachable from Settings and Structure.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

const HIDE_KEY = "smr.org.setupPrompt.hidden";

export function OrgSetupPrompt({ placement = "today" }: { placement?: "today" | "settings" }) {
  const [show, setShow] = useState(false);
  const [done, setDone] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/org/profile").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!live || !d?.canManage) return;
      setDone(!d.needsSetup);
      let hidden = false;
      try { hidden = sessionStorage.getItem(HIDE_KEY) === "1"; } catch {}
      setShow(d.needsSetup && (placement === "settings" || !hidden));
    }).catch(() => {});
    return () => { live = false; };
  }, [placement]);

  if (placement === "settings" && done) return (
    <p className="text-sm text-t-phos-dim mb-4">
      Your organization&apos;s words, groups and modules:{" "}
      <Link href="/dashboard/setup" className="t-focus font-semibold text-t-amber-bright underline underline-offset-4">Change setup</Link>{" · "}
      <Link href="/dashboard/structure" className="t-focus font-semibold text-t-amber-bright underline underline-offset-4">Structure</Link>
    </p>
  );
  if (!show) return null;
  return (
    <section aria-labelledby="setup-prompt-heading" className="bg-t-panel border border-t-amber rounded-[4px] px-4 py-3 mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-[14rem] flex-1">
        <h2 id="setup-prompt-heading" className="text-sm font-semibold text-t-white">Set up your organization</h2>
        <p className="text-sm text-t-phos-dim">About two minutes: your kind of organization, the words your team uses, and your programs or sites. Nothing changes until you finish.</p>
      </div>
      <div className="flex gap-2">
        <Link href="/dashboard/setup" className="t-focus min-h-[44px] inline-flex items-center px-4 py-2 text-sm font-semibold bg-t-amber text-[#14100a] rounded-[4px]">Start setup</Link>
        {placement === "today" && (
          <button type="button" className="t-focus min-h-[44px] px-3 py-2 text-sm text-t-phos-dim underline underline-offset-4 hover:text-t-white"
            onClick={() => { try { sessionStorage.setItem(HIDE_KEY, "1"); } catch {} setShow(false); }}>Not now</button>
        )}
      </div>
    </section>
  );
}
