"use client";
/**
 * The Add people end of "open Add people with Michael Shaw filled in" (lane
 * S1, staff pass 2026-10-27). Read once, cleared at once, shown plainly.
 *
 * The current organization comes from useEffectiveRole(); a prefill for any
 * other organization is dropped. Until the role has loaded, nothing is read.
 *
 * Mount (OrgDashboard, the add form; WIRING NEEDED in the S1 report):
 *   const prefill = useAddPersonPrefill((p) => { setInviteName(prefillFullName(p)); if (p.email) setInviteEmail(p.email); });
 *   {prefill.current && <AddPersonPrefillNotice prefill={prefill.current} onClose={prefill.dismiss} />}
 *   <DuplicateWarning name={inviteName} email={inviteEmail} phone={prefill.current?.phone ?? undefined} />
 *   and after a successful invite: prefill.sent()
 *
 * Nothing here sends anything. The staff member reads the form and presses
 * Send invite; the duplicate warning runs on the filled values like on typed
 * ones.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useEffectiveRole } from "@/components/RoleProvider";
import { ADD_PERSON_PREFILL_EVENT, takeAddPersonPrefill, type AddPersonPrefill } from "@/lib/org-add-person-prefill";

export function useAddPersonPrefill(onFill: (p: AddPersonPrefill) => void): { current: AddPersonPrefill | null; dismiss: () => void; sent: () => void } {
  const viewerId = useSession().data?.user?.id;
  // The organization this staff member works in, from the server (/api/user/role).
  // A prefill made for any other org is dropped unread (review round 1, S5).
  const orgId = useEffectiveRole()?.orgId ?? null;
  const [current, setCurrent] = useState<AddPersonPrefill | null>(null);
  const fill = useRef(onFill); fill.current = onFill;
  useEffect(() => {
    if (!viewerId || !orgId) return;
    const take = () => {
      const p = takeAddPersonPrefill(viewerId, { orgId });
      if (!p) return;
      setCurrent(p);
      fill.current(p);
    };
    take();
    // Already on Add people when the button was pressed: the page did not remount.
    window.addEventListener(ADD_PERSON_PREFILL_EVENT, take);
    return () => window.removeEventListener(ADD_PERSON_PREFILL_EVENT, take);
  }, [viewerId, orgId]);
  const dismiss = useCallback(() => setCurrent(null), []);
  /** The invite went out from this form: the t.ROY run that filled it was used (migration 106). */
  const latest = useRef(current); latest.current = current;
  const sent = useCallback(() => {
    const id = latest.current?.skillRunId;
    if (id) fetch("/api/org/ai-skill-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept", id }) }).catch(() => {});
    setCurrent(null);
  }, []);
  return { current, dismiss, sent };
}

export function AddPersonPrefillNotice({ prefill, onClose }: { prefill: AddPersonPrefill; onClose: () => void }) {
  const extras = [prefill.phone ? `phone ${prefill.phone}` : null, prefill.program ? `program: ${prefill.program}` : null].filter(Boolean);
  return (
    <div role="status" data-add-person-prefill="" className="mb-3 border border-t-line bg-t-panel-2 px-3 py-2 text-xs text-t-phos">
      <p className="font-semibold text-t-white">t.ROY filled this in from your words. Check it, then press Send invite.</p>
      {!prefill.email && <p className="mt-1">The invite needs their email address. Type it in the box.</p>}
      {extras.length > 0 && <p className="mt-1">After they join, add {extras.join(" and ")} on their page.</p>}
      <button type="button" onClick={onClose} className="t-focus mt-1 min-h-touch underline">Got it</button>
    </div>
  );
}
