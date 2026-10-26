"use client";

/**
 * Developer mode (platform admins only): four labeled modes (house lane L2).
 *
 *   Admin                                 yourself, with your admin tools
 *   View as staff of an org (read-only)   pick a demo org, then a person
 *   View as a participant (read-only)     pick a demo participant, or find
 *                                         any account in Admin > Users
 *   Exit                                  end the view, back where you started
 *
 * Viewing is the audited impersonation it always was: a signed 60-minute
 * cookie, a row in impersonation_session for every start and end, the admin's
 * second factor required, writes refused at the edge AND at every org route
 * (lib/view-as.ts). DevModeBanner names who you are viewing and how to exit.
 *
 * REAL ORGANIZATIONS' PEOPLE ARE HIDDEN until "Show real organizations" is
 * pressed (A1 defect H8): the menu is opened on shared screens, and the
 * personas API does not even send real names until asked. Real participants
 * are never listed here.
 *
 * The soft "Me: Job Seeker / Observer / Admin" preview stays gone (B7,
 * 2026-10-23): it drew a job seeker's screens while every save landed in the
 * admin's own account.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRealTier, setViewAs } from "@/lib/useUserTier";
import { useEffectiveRole } from "@/components/RoleProvider";
import { DEV_MODE_LABELS, currentDevMode, groupByOrg, splitPersonas } from "@/lib/dev-mode";
import { endViewAs, startViewAs } from "@/lib/dev-view-client";

interface Persona {
  userId: string;
  name: string | null;
  email: string | null;
  role?: "owner" | "org_admin" | "staff";
  title?: string | null;
  orgName: string;
  demo?: boolean;
}

interface PersonaPayload {
  data?: Persona[];
  participants?: Persona[];
  realOrgCount?: number;
}

const ROLE_LABEL: Record<string, string> = { owner: "Owner", org_admin: "Org leader", staff: "Staff" };

export function DevSwitcher() {
  const { data: clearAuth } = useSession();
  const adminId = (clearAuth?.user as { id?: string } | undefined)?.id ?? null;
  const realTier = useRealTier();
  const role = useEffectiveRole();
  const mode = currentDevMode(role);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<"staff" | "participant" | null>(null);
  const [payload, setPayload] = useState<PersonaPayload | null>(null);
  const [real, setReal] = useState<Persona[] | null>(null);
  const [showReal, setShowReal] = useState(false);
  const [openOrg, setOpenOrg] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // An admin browser may still hold the retired soft-preview keys (view_as,
  // admin_test_mode). Clear them once, so nothing that reads them branches.
  useEffect(() => {
    if (realTier === "admin") setViewAs(null);
  }, [realTier]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Demo people load the first time the menu opens.
  useEffect(() => {
    if (!open || payload !== null) return;
    fetch("/api/dev/personas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setPayload((j as PersonaPayload) ?? {}))
      .catch(() => setPayload({}));
  }, [open, payload]);

  // Real organizations' staff load only when asked for, on purpose.
  useEffect(() => {
    if (!showReal || real !== null) return;
    fetch("/api/dev/personas?real=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setReal(((j as PersonaPayload)?.data ?? []) as Persona[]))
      .catch(() => setReal([]));
  }, [showReal, real]);

  if (realTier !== "admin") return null;

  async function view(targetUserId: string) {
    setStarting(targetUserId);
    setError(null);
    const ok = await startViewAs(targetUserId, adminId);
    if (!ok) {
      setStarting(null);
      setError("That view did not start. Check that two-step is on for this sign-in.");
    }
  }

  const item =
    "t-focus block w-full min-h-touch text-left px-3 py-2 text-sm text-t-phos hover:bg-t-panel-2 hover:text-t-white";
  const heading = "px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-t-phos-dim border-t border-t-line mt-1";
  const current = (m: string) => (mode === m ? " (now)" : "");

  const staff = splitPersonas(payload?.data ?? []);
  const participants = groupByOrg(payload?.participants ?? []);

  function personRow(p: Persona, sub: string) {
    return (
      <button
        key={`${p.orgName}:${p.userId}`}
        className={`${item} pl-6`}
        disabled={starting !== null}
        onClick={() => view(p.userId)}
      >
        {p.name || p.email}
        {starting === p.userId && <span className="ml-2 text-[10px] text-t-phos-dim">starting...</span>}
        <span className="block text-[11px] text-[#7da4c4]">{sub}</span>
      </button>
    );
  }

  function orgGroup(orgName: string, people: Persona[], kind: "staff" | "participant") {
    const key = `${kind}:${orgName}`;
    const isOpen = openOrg === key;
    return (
      <div key={key}>
        <button className={item} onClick={() => setOpenOrg(isOpen ? null : key)} aria-expanded={isOpen}>
          <span className="flex items-center justify-between">
            <span className="truncate">{orgName}</span>
            <span aria-hidden="true" className="ml-2 text-[9px] text-t-phos-dim">{isOpen ? "▲" : "▼"}</span>
          </span>
          <span className="block text-[11px] text-t-phos-dim">
            {people.length} {people.length === 1 ? "person" : "people"}
          </span>
        </button>
        {isOpen &&
          people.map((p) =>
            personRow(p, kind === "staff" ? `${ROLE_LABEL[p.role ?? "staff"] ?? "Staff"}${p.title ? `, ${p.title}` : ""}` : "Participant")
          )}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="t-focus inline-flex min-h-touch items-center gap-1.5 rounded-[4px] border border-t-amber px-2.5 text-xs font-bold text-t-amber-bright transition-colors hover:bg-t-amber/10"
        title="Developer mode"
        aria-expanded={open}
      >
        DEV
        <span aria-hidden="true" className="text-[9px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 max-w-[calc(100vw-2rem)] border border-t-line bg-t-panel shadow-lg z-[60] max-h-[80vh] overflow-y-auto">
          <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-t-phos-dim">Developer mode</p>

          {/* 1. Admin */}
          {mode === "admin" ? (
            <p className={`${item} cursor-default`}>
              {DEV_MODE_LABELS.admin}{current("admin")}
              <span className="block text-[11px] text-t-phos-dim">You, with your admin tools.</span>
            </p>
          ) : (
            <button className={item} onClick={() => void endViewAs(adminId, { to: "admin" })}>
              {DEV_MODE_LABELS.admin}
              <span className="block text-[11px] text-t-phos-dim">End the view and go to your admin home.</span>
            </button>
          )}

          {/* 2. View as staff of an org */}
          <button
            className={`${item} border-t border-t-line`}
            onClick={() => setSection(section === "staff" ? null : "staff")}
            aria-expanded={section === "staff"}
          >
            {DEV_MODE_LABELS.staff}{current("staff")}
            <span className="block text-[11px] text-[#7da4c4]">Their organization, their screens. Changes are off.</span>
          </button>
          {section === "staff" && (
            <div>
              {payload === null && <p className="px-3 py-2 text-xs text-t-phos-dim">Loading...</p>}
              {payload !== null && staff.demo.length === 0 && (
                <p className="px-3 py-2 text-xs text-t-phos-dim">No demo organizations have staff yet.</p>
              )}
              {staff.demo.map(([orgName, people]) => orgGroup(orgName, people, "staff"))}
              {(payload?.realOrgCount ?? 0) > 0 && !showReal && (
                <button className={`${item} text-t-phos-dim`} onClick={() => setShowReal(true)}>
                  Show real organizations ({payload?.realOrgCount})
                  <span className="block text-[11px]">Hidden so names stay off shared screens. Every view is recorded.</span>
                </button>
              )}
              {showReal && (
                <>
                  <p className={heading}>Real organizations</p>
                  {real === null && <p className="px-3 py-2 text-xs text-t-phos-dim">Loading...</p>}
                  {real !== null && groupByOrg(real).map(([orgName, people]) => orgGroup(orgName, people, "staff"))}
                  <button className={`${item} text-t-phos-dim`} onClick={() => { setShowReal(false); setOpenOrg(null); }}>
                    Hide real organizations
                  </button>
                </>
              )}
            </div>
          )}

          {/* 3. View as a participant */}
          <button
            className={`${item} border-t border-t-line`}
            onClick={() => setSection(section === "participant" ? null : "participant")}
            aria-expanded={section === "participant"}
          >
            {DEV_MODE_LABELS.participant}{current("participant")}
            <span className="block text-[11px] text-[#7da4c4]">A job seeker&apos;s own screens. Changes are off.</span>
          </button>
          {section === "participant" && (
            <div>
              {payload === null && <p className="px-3 py-2 text-xs text-t-phos-dim">Loading...</p>}
              {participants.map(([orgName, people]) => orgGroup(orgName, people, "participant"))}
              <Link href="/dashboard/admin/users" className={`${item} pl-6`} onClick={() => setOpen(false)}>
                Find any account...
                <span className="block text-[11px] text-t-phos-dim">Search in Admin, Users. View or assist from there.</span>
              </Link>
            </div>
          )}

          {/* 4. Exit */}
          {mode === "admin" ? (
            <p className={`${item} border-t border-t-line cursor-default text-t-phos-dim`}>
              {DEV_MODE_LABELS.exit}
              <span className="block text-[11px]">You are not viewing as anyone.</span>
            </p>
          ) : (
            <button className={`${item} border-t border-t-line`} onClick={() => void endViewAs(adminId, { to: "start" })}>
              {DEV_MODE_LABELS.exit}
              <span className="block text-[11px] text-t-phos-dim">End the view and go back where you started.</span>
            </button>
          )}

          <p className={heading}>Admin tools</p>
          <Link href="/dashboard/admin/orgs" className={item} onClick={() => setOpen(false)}>
            Organizations
            <span className="block text-[11px] text-[#7da4c4]">Open an organization&apos;s console, read-only.</span>
          </Link>
          {error && <p role="alert" className="px-3 py-2 text-xs text-t-red">{error}</p>}
        </div>
      )}
    </div>
  );
}
