"use client";

/**
 * DevModeBanner: the persistent line that says who you are viewing as and how
 * to get out (house lane L2). Two cases, one component:
 *
 *   view-as   a platform admin is viewing (or assisting) as someone. Reads the
 *             audited session from GET /api/dev/impersonate and names the
 *             person, their role and organization. "Exit" ends the view and
 *             returns to the page it started from.
 *   orgView   the admin's read-only console for another organization
 *             (/dashboard/partner?codeId=). Pass orgView={{ orgName }}; the
 *             link goes back to Organizations.
 *
 * It renders nothing for anyone else. The shell (lane L1) mounts
 * <DevModeBanner /> once at the top of the main column; the partner console
 * page mounts the orgView form itself. Sticky, so it stays in sight while the
 * page scrolls. The blue or red frame and the countdown stay in
 * ImpersonationChrome.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { devBannerText, orgViewBannerText } from "@/lib/dev-mode";
import { endViewAs } from "@/lib/dev-view-client";

interface Status {
  active: boolean;
  mode?: "view" | "assist";
  target?: { id: string; name: string | null; email: string | null } | null;
  orgName?: string | null;
  orgRole?: string | null;
}

export function DevModeBanner({ orgView }: { orgView?: { orgName: string | null } } = {}) {
  const { data } = useSession();
  const user = data?.user as { id?: string; tier?: string } | undefined;
  const isAdmin = user?.tier === "admin";
  const [status, setStatus] = useState<Status>({ active: false });
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!isAdmin || orgView) return;
    let live = true;
    const load = () =>
      fetch("/api/dev/impersonate", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => { if (live && s) setStatus(s as Status); })
        .catch(() => {});
    load();
    const poll = window.setInterval(load, 60_000);
    return () => { live = false; window.clearInterval(poll); };
  }, [isAdmin, orgView]);

  if (orgView) {
    if (!isAdmin) return null;
    return (
      <div role="status" className="sticky top-0 z-[80] mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border border-[#2d5a85] bg-[#10202f] px-4 py-2.5 text-sm text-white">
        <span>{orgViewBannerText(orgView.orgName)}</span>
        <Link href="/dashboard/admin/orgs" className="t-focus inline-flex min-h-touch items-center underline">
          Back to Organizations
        </Link>
      </div>
    );
  }

  if (!isAdmin || !status.active || !status.mode) return null;
  const assist = status.mode === "assist";
  const text = devBannerText({
    who: status.target?.name || status.target?.email || null,
    mode: status.mode,
    orgName: status.orgName,
    orgRole: status.orgRole,
  });
  return (
    <div
      role="status"
      className="sticky top-0 z-[80] mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm font-medium text-white"
      style={{ background: assist ? "#ad2318" : "#2d5a85" }}
    >
      <span>{text}</span>
      <button
        type="button"
        disabled={ending}
        onClick={() => { setEnding(true); void endViewAs(user?.id ?? null, { to: "start" }); }}
        className="t-focus inline-flex min-h-touch items-center bg-[#14100a] px-3 text-xs font-semibold hover:bg-black disabled:opacity-50"
      >
        {ending ? "Ending..." : "Exit view"}
      </button>
    </div>
  );
}

export default DevModeBanner;
