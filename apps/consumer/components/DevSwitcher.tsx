"use client";

/**
 * Developer Switcher (Troy-only: rendered for admin tier).
 *
 * One control, every capacity:
 *   Me: Job Seeker   -> own account, real client experience (view_as=client)
 *   Me: Observer     -> the evidence landing a funder/researcher sees
 *   Me: Admin        -> home base (clears view_as)
 *   Personas         -> one-click blue-view impersonation of seeded org roles
 *                       (org leader, staff) -- their REAL landing + data
 *   View as org...   -> org directory (blue, read-only dashboards)
 *   View / assist user... -> user directory (blue view / red assist)
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  useRealTier,
  getViewAs,
  setViewAs,
  type ViewAs,
} from "@/lib/useUserTier";

interface Persona {
  userId: string;
  name: string | null;
  email: string | null;
  role: "org_admin" | "staff";
  title: string | null;
  orgName: string;
}

export function DevSwitcher() {
  const realTier = useRealTier();
  const [open, setOpen] = useState(false);
  const [viewAs, setViewAsState] = useState<ViewAs | null>(null);
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setViewAsState(getViewAs());
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Load personas the first time the menu opens
  useEffect(() => {
    if (!open || personas !== null) return;
    fetch("/api/dev/personas")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setPersonas((j?.data as Persona[]) ?? []))
      .catch(() => setPersonas([]));
  }, [open, personas]);

  if (realTier !== "admin") return null;

  function setSelfView(view: ViewAs | null) {
    setViewAs(view);
    window.location.href = "/dashboard";
  }

  async function startViewImpersonation(targetUserId: string) {
    setStarting(targetUserId);
    try {
      const res = await fetch("/api/dev/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId, mode: "view" }),
      });
      if (res.ok) {
        // Their real landing, inside the blue read-only frame
        window.location.assign("/dashboard");
        return;
      }
    } catch {}
    setStarting(null);
  }

  const item =
    "t-focus block w-full text-left px-3 py-2 text-sm text-t-phos hover:bg-t-panel-2 hover:text-t-white";
  const current = (
    <span className="ml-2 text-[10px] text-t-amber-bright">(current)</span>
  );

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
        <div className="absolute right-0 top-full mt-1 w-64 border border-t-line bg-t-panel shadow-lg z-[60] max-h-[80vh] overflow-y-auto">
          <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-t-phos-dim">
            Operate as
          </p>
          <button className={item} onClick={() => setSelfView("client")}>
            Me: Job Seeker
            {viewAs === "client" && current}
            <span className="block text-[11px] text-t-phos-dim">
              Your own real client journey
            </span>
          </button>
          <button className={item} onClick={() => setSelfView("observer")}>
            Me: Observer
            {viewAs === "observer" && current}
            <span className="block text-[11px] text-t-phos-dim">
              The evidence view funders see
            </span>
          </button>
          <button className={item} onClick={() => setSelfView(null)}>
            Me: Admin
            {viewAs === null && current}
            <span className="block text-[11px] text-t-phos-dim">
              Operator home base
            </span>
          </button>

          {personas !== null && personas.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-t-phos-dim border-t border-t-line mt-1">
                Personas (blue view, read-only)
              </p>
              {personas.map((p) => (
                <button
                  key={p.userId}
                  className={item}
                  disabled={starting !== null}
                  onClick={() => startViewImpersonation(p.userId)}
                >
                  {p.name || p.email}
                  {starting === p.userId && (
                    <span className="ml-2 text-[10px] text-t-phos-dim">starting...</span>
                  )}
                  <span className="block text-[11px] text-[#7da4c4]">
                    {p.role === "org_admin" ? "Org leader" : "Staff"} -- {p.orgName}
                  </span>
                </button>
              ))}
            </>
          )}

          <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-t-phos-dim border-t border-t-line mt-1">
            Other accounts
          </p>
          <Link href="/dashboard/admin/orgs" className={item} onClick={() => setOpen(false)}>
            View as org...
            <span className="block text-[11px] text-[#7da4c4]">
              Any org&apos;s dashboard, read-only
            </span>
          </Link>
          <Link href="/dashboard/admin/users" className={item} onClick={() => setOpen(false)}>
            View / assist a user...
            <span className="block text-[11px]">
              <span className="text-[#7da4c4]">view (blue)</span>
              {" / "}
              <span className="text-t-red">assist (red)</span>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
