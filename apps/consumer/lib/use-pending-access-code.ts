"use client";

/**
 * usePendingAccessCode(): the shell's post-sign-in code redemption, made safe
 * (house lane L2, defect H5). See lib/pending-access-code.ts for the rule.
 *
 * The shell (RefineryShell.tsx, lane L1) calls this hook ONCE at the top of
 * its component, in place of the inline localStorage block that redeemed the
 * code inside its "Post-auth" effect. Returns a plain sentence to show when a
 * code was refused for a reason the person should know (an admin account, or
 * the organization's own staff), else null.
 */

import { useEffect, useRef, useState } from "react";
import { useEffectiveRole } from "@/components/RoleProvider";
import { useRealTier } from "@/lib/useUserTier";
import { ORG_JOINED_EVENT } from "@/lib/join-sharing-prompt";
import { PENDING_ACCESS_CODE_KEY, pendingCodeAction } from "@/lib/pending-access-code";

function readStored(): string | null {
  try { return localStorage.getItem(PENDING_ACCESS_CODE_KEY); } catch { return null; }
}
function removeStored(): void {
  try { localStorage.removeItem(PENDING_ACCESS_CODE_KEY); } catch { /* storage unavailable */ }
}

export function usePendingAccessCode(): string | null {
  const role = useEffectiveRole();
  const realTier = useRealTier();
  const [notice, setNotice] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    const code = readStored();
    const action = pendingCodeAction(role, realTier, code);
    if (action === "wait") return;
    done.current = true;
    removeStored();
    if (action === "drop" || !code) return;
    fetch("/api/access-code/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then(async (r) => {
        if (r.ok) { window.dispatchEvent(new Event(ORG_JOINED_EVENT)); return; }
        const body = await r.json().catch(() => null);
        // Only the two refusals the route words for people (409); the generic
        // code refusal stays quiet here, as before.
        if (r.status === 409 && typeof body?.error === "string") setNotice(body.error);
      })
      .catch(() => {});
  }, [role, realTier]);

  return notice;
}
