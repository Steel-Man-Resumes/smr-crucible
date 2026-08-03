"use client";

/**
 * Developer Switcher (Troy-only: rendered for admin tier).
 *
 * One control, every capacity:
 *   Me: Job Seeker   -> own account, real client experience (view_as=client)
 *   Me: Admin        -> home base (clears view_as)
 *   View as org...   -> org directory (blue, read-only dashboards)
 *   View / assist user... -> user directory (blue view / red assist)
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRealTier, getViewAs, setViewAs } from "@/lib/useUserTier";

export function DevSwitcher() {
  const realTier = useRealTier();
  const [open, setOpen] = useState(false);
  const [asClient, setAsClient] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAsClient(getViewAs() === "client");
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (realTier !== "admin") return null;

  function setClientMode(on: boolean) {
    setViewAs(on ? "client" : null);
    window.location.href = "/dashboard";
  }

  const item =
    "t-focus block w-full text-left px-3 py-2 text-sm text-t-phos hover:bg-t-panel-2 hover:text-t-white";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="t-focus inline-flex min-h-touch items-center gap-1.5 rounded-[4px] border border-t-amber px-2.5 text-xs font-bold text-t-amber-bright transition-colors hover:bg-t-amber/10"
        title="Developer Switcher -- operate in any capacity"
      >
        DEV
        <span aria-hidden="true" className="text-[9px]">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 border border-t-line bg-t-panel shadow-lg z-[60]">
          <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-t-phos-dim">
            Operate as
          </p>
          <button className={item} onClick={() => setClientMode(true)}>
            Me: Job Seeker
            {asClient && <span className="ml-2 text-[10px] text-t-amber-bright">(current)</span>}
            <span className="block text-[11px] text-t-phos-dim">
              Your own real client journey
            </span>
          </button>
          <button className={item} onClick={() => setClientMode(false)}>
            Me: Admin
            {!asClient && <span className="ml-2 text-[10px] text-t-amber-bright">(current)</span>}
            <span className="block text-[11px] text-t-phos-dim">
              Platform admin home base
            </span>
          </button>
          <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-t-phos-dim border-t border-t-line mt-1">
            Other accounts
          </p>
          <Link href="/dashboard/admin/orgs" className={item} onClick={() => setOpen(false)}>
            View as org...
            <span className="block text-[11px] text-[#2d5a85]">
              Any org&apos;s dashboard, read-only
            </span>
          </Link>
          <Link href="/dashboard/admin/users" className={item} onClick={() => setOpen(false)}>
            View / assist a user...
            <span className="block text-[11px]">
              <span className="text-[#2d5a85]">view (blue)</span>
              {" / "}
              <span className="text-t-red">assist (red)</span>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
