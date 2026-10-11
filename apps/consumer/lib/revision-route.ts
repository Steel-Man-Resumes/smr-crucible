/**
 * The account checks every revision route shares (Phase 5 lane R1).
 *
 * Signed in fully (never a session that still owes its second step), and
 * never while an admin is viewing as someone: a revision is the person's own
 * finished work, saved and read only by the person (owner only, migration
 * 081). An admin viewing as someone reads and writes nothing here.
 */

import { auth } from "@/auth";
import { effectiveAuth } from "@/lib/effective-auth";
import { forgeSessionUser } from "@/lib/session-policy";

export type RevisionCaller = { ok: true; userId: string } | { ok: false; status: number; error: string };

export async function revisionCaller(): Promise<RevisionCaller> {
  const real = forgeSessionUser(await auth());
  if (!real?.id) return { ok: false, status: 401, error: "Not authenticated" };
  const eff = await effectiveAuth().catch(() => null);
  if (eff?.user?.id && eff.user.id !== real.id) {
    return { ok: false, status: 403, error: "Saved resumes are off while viewing as someone." };
  }
  return { ok: true, userId: real.id };
}

export { REVISION_SAVES_PER_DAY, REVISION_TOO_LARGE } from "./revision-limits";
