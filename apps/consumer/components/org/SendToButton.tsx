"use client";
/**
 * <SendToButton> (staff pass S5): "Send to <first name>" for any one thing a
 * staff member found for a person (a directory result, a connection, a t.ROY
 * answer). It adds the thing to that person's handoff tray in this tab and
 * says where to finish. It never sends: the person page's handoff panel does,
 * after the staff member reads it and writes a note.
 */
import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { sendToLabel, firstNameOf, type HandoffItemInput } from "@crucible/core/src/staffHandoffShared";
import { addToTray, type AddResult } from "@/lib/handoff-tray";

export function addedWords(r: AddResult, name: string | null | undefined): string {
  const first = firstNameOf(name, "their");
  const whose = first === "their" ? "their" : `${first}'s`;
  if (r === "added") return `Added to ${whose} handoff.`;
  if (r === "already") return `Already in ${whose} handoff.`;
  if (r === "full") return `${first === "their" ? "Their" : `${first}'s`} handoff is full (ten things). Send it first.`;
  return "This browser tab could not keep it. Try again.";
}

export function SendToButton({ personId, personName, item, viewerId, className }: {
  personId: string; personName: string | null; item: HandoffItemInput; viewerId?: string | null; className?: string;
}) {
  const session = useSession();
  const staffId = viewerId ?? (session.data?.user as { id?: string } | undefined)?.id ?? null;
  const [said, setSaid] = useState<string | null>(null);
  if (!staffId) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={className ?? "t-focus border border-t-line text-xs text-t-phos px-2 py-1"}
        onClick={() => setSaid(addedWords(addToTray(staffId, personId, item), personName))}>
        {sendToLabel(personName)}
      </button>
      {said && (
        <span role="status" className="text-xs text-t-phos-dim">
          {said} <Link className="t-focus text-t-amber-bright underline underline-offset-4" href={`/dashboard/clients/${personId}?tab=tasks#handoff`}>Open it to send</Link>
        </span>
      )}
    </span>
  );
}
