"use client";

/**
 * The account this browser is signed in to, in the Forge header, with a way
 * out: "Signed in as you@example.com. Not you? Sign out". Shown whenever
 * someone is fully signed in, so nobody types into an account they did not
 * choose without seeing it (security review 3a r1, M1: login CSRF, shared
 * computers).
 *
 * Signing out here clears the Forge run from this browser first: a run marked
 * for an account is that account's, and the next person at this computer must
 * not see it or carry it into another account (H1).
 */

import { signOut, useSession } from "next-auth/react";
import { sessionPending } from "@/lib/session-policy";

const RUN_KEYS = ["forge_session", "forge_preload", "forge_audience", "forge_last_synced_run"];

/** Clear this browser's Forge run, then sign out and land on the public front door. */
export async function signOutOfForge(opts: { clearRun: boolean } = { clearRun: true }) {
  if (opts.clearRun && typeof window !== "undefined") {
    for (const k of RUN_KEYS) {
      try {
        localStorage.removeItem(k);
      } catch {
        // storage unavailable: nothing to clear
      }
    }
  }
  await signOut({ callbackUrl: "/intro" });
}

export function ForgeAccountBar() {
  const { data, status } = useSession();
  const user = data?.user as { email?: string | null; mfa?: unknown; claim?: unknown } | undefined;
  if (status !== "authenticated" || !user || sessionPending(user)) return null;
  return (
    <div className="border-t border-ws-bg/15 bg-ws-bone" data-testid="forge-account-bar">
      <p className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1.5 text-xs text-t-bone-dim sm:px-6">
        <span className="min-w-0 break-all">
          Signed in as <span className="font-semibold text-ws-bg" data-testid="forge-account-email">{user.email || "your account"}</span>.
        </span>
        <span>
          Not you?{" "}
          <button
            type="button"
            onClick={() => void signOutOfForge({ clearRun: true })}
            className="t-focus min-h-[32px] font-semibold text-ws-bg underline underline-offset-2"
          >
            Sign out
          </button>
        </span>
      </p>
    </div>
  );
}
