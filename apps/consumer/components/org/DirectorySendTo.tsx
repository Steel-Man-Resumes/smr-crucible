"use client";
/**
 * <DirectorySendTo listing={...} /> (staff pass integration, S1 wiring D1):
 * the Directory page's "Send to" slot. The Directory names no person, so the
 * staff member picks one first (the same Find a person search, only people
 * they work with), then the listing goes into that person's handoff tray
 * through S5's <SendToButton>. Nothing is sent here: the person page's
 * handoff panel sends, after the staff member reads it and writes a note.
 *
 * The name and place shown in the tray are re-read from the live listing when
 * the handoff is sent (staffHandoff.ts sendHandoff), never taken from here.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useEffectiveRole } from "@/components/RoleProvider";
import { SendToButton } from "@/components/org/SendToButton";
import { StaffDirectoryPage } from "@/components/org/StaffDirectory";
import type { DirectoryListingRef } from "@/components/org/StaffDirectory";
import type { HandoffItemInput } from "@crucible/core/src/staffHandoffShared";

interface Hit { user_id: string; name: string | null }

/** The tray item for a directory listing. Role and reason are starting words the staff member changes on the person's page. Exported for tests. */
export function directoryItem(listing: DirectoryListingRef): HandoffItemInput {
  return listing.kind === "employer"
    ? { kind: "employer", employerId: listing.id, name: listing.name, role: "Open roles", why: "This employer is in our directory." }
    : { kind: "resource", resourceId: listing.id, name: listing.name, why: "This place is in our directory." };
}

export function DirectorySendTo({ listing }: { listing: DirectoryListingRef }) {
  const role = useEffectiveRole();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pick, setPick] = useState<Hit | null>(null);
  const seq = useRef(0);
  const id = useId();

  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) { setHits(null); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/org/search?${new URLSearchParams({ q: term, scope: "all" })}`);
        if (!res.ok) throw new Error();
        const d = await res.json();
        if (mine !== seq.current) return;
        setHits((d.hits ?? []).slice(0, 6)); setFailed(false);
      } catch { if (mine === seq.current) setFailed(true); }
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  if (!role?.orgId || !role.capabilities?.includes("org.suggest.write")) return null;
  if (pick) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <SendToButton personId={pick.user_id} personName={pick.name} item={directoryItem(listing)} />
        <button type="button" onClick={() => { setPick(null); setQ(""); }} className="t-focus text-xs text-t-phos-dim underline underline-offset-4">Someone else</button>
      </span>
    );
  }
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="t-focus border border-t-line text-xs text-t-phos px-2 py-1">Send to someone</button>;
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <label htmlFor={`${id}-q`} className="text-xs text-t-phos-dim">Who is it for?</label>
      <span className="inline-flex flex-wrap items-center gap-2">
        <input id={`${id}-q`} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus autoComplete="off" placeholder="Name"
          className="plain-field t-focus rounded-[4px] border border-t-line bg-t-panel-2 px-2 py-1 text-xs text-t-white" />
        <button type="button" onClick={() => { setOpen(false); setQ(""); }} className="t-focus text-xs text-t-phos-dim underline underline-offset-4">Cancel</button>
      </span>
      <span aria-live="polite">
        {failed && <span role="alert" className="text-xs text-t-amber-bright">Search did not answer. Try again in a moment.</span>}
        {hits && hits.length === 0 && !failed && <span className="text-xs text-t-phos-dim">Nobody you work with matches that.</span>}
        {hits && hits.length > 0 && (
          <span className="flex flex-wrap gap-2">
            {hits.map((h) => (
              <button key={h.user_id} type="button" onClick={() => setPick(h)} className="t-focus border border-t-line px-2 py-1 text-xs text-t-white">
                {h.name || "Name not shared"}
              </button>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The Directory page with its slots filled, as a client component: a server
 * page cannot pass a component as a prop. S6 adds Contribute={...} here.
 */
export function StaffDirectoryWithSlots() {
  return <StaffDirectoryPage SendTo={DirectorySendTo} />;
}
