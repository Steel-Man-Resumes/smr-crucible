"use client";

/**
 * <PolicyAckBanner> -- a participant whose program requires sharing, and who has
 * not acknowledged it, is told so where they will see it. It links to the full
 * text; it does not ask for a one-click "accept" from a banner, because nobody
 * should agree to something from a strip at the top of a page.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

export function PolicyAckBanner() {
  const [orgs, setOrgs] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/sharing").then((r) => (r.ok ? r.json() : null)).then((d) => {
      const waiting = (d?.policies ?? []).filter((p: { acknowledged: boolean }) => !p.acknowledged).map((p: { orgName: string }) => p.orgName);
      setOrgs(waiting);
    }).catch(() => {});
  }, []);
  if (orgs.length === 0) return null;
  return (
    <p role="status" className="border-b border-t-amber/40 bg-t-panel px-4 py-2 text-center text-sm text-t-white">
      {orgs.join(" and ")} {orgs.length === 1 ? "requires" : "require"} some sharing as part of the program. Nothing is open yet.{" "}
      <Link href="/dashboard/settings#privacy" className="t-focus font-semibold text-t-amber-bright underline underline-offset-4">Read what they require</Link>
    </p>
  );
}
