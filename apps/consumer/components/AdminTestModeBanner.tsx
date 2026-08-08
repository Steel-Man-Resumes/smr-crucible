"use client";

import { useEffect, useState } from "react";
import { useRealTier, canSwitchView, getViewAs, setViewAs } from "@/lib/useUserTier";
import { useOrgRole } from "@/components/RoleProvider";

/**
 * Persistent acting-as indicator (walkthrough C7 P0: when operating as another
 * role, make it abundantly clear on screen). Shown whenever an admin or
 * partner account is in client view. Without it, it is easy to forget which
 * mode you are in -- the source of "is this a bug, or am I just being gated?"
 * confusion. The gates and locks are real in client view.
 */
export function AdminTestModeBanner() {
  const realTier = useRealTier();
  const { orgRole, orgName } = useOrgRole();
  const [view, setView] = useState<"client" | "observer" | null>(null);

  useEffect(() => {
    const read = () => setView(getViewAs());
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  if (!canSwitchView(realTier) || !view) return null;

  // Model A: for an org leader in client view, this isn't a "preview" -- it's
  // their own private job-search workspace. Frame it that way, and offer a clear
  // switch back to running the org.
  const isOrgLeader = realTier === "partner" && !!orgRole && view === "client";
  const org = orgName || "your organization";

  if (isOrgLeader) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-2 text-center text-sm font-medium text-white" style={{ background: "#2d5a85" }}>
        <span>
          You&apos;re in your personal job search -- private from your team.
        </span>
        <button
          type="button"
          onClick={() => {
            setViewAs(null);
            window.location.href = "/dashboard";
          }}
          className="t-focus bg-[#14100a] px-3 py-1 text-xs font-semibold text-t-amber-bright hover:bg-black"
        >
          Back to {org} admin
        </button>
      </div>
    );
  }

  const roleLabel = realTier === "admin" ? "admin" : "partner";
  const viewLabel = view === "observer" ? "an observer" : "a client";

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-2 text-center text-sm font-medium text-white" style={{ background: "#2d5a85" }}>
      <span>
        Viewing as {viewLabel} -- your real role is {roleLabel}. The gates and
        locks are real.
      </span>
      <button
        type="button"
        onClick={() => {
          setViewAs(null);
          window.location.href = "/dashboard";
        }}
        className="t-focus bg-[#14100a] px-3 py-1 text-xs font-semibold text-t-amber-bright hover:bg-black"
      >
        Back to {roleLabel} view
      </button>
    </div>
  );
}
