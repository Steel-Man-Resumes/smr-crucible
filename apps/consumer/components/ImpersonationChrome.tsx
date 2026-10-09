"use client";

/**
 * Impersonation chrome -- the Gemini-style tinted frame + banner + countdown
 * shown whenever a developer impersonation session is active.
 *
 *   view   -> cool blue frame ("just looking, writes are blocked at the edge")
 *   assist -> red frame ("this session can change a real person's account")
 *
 * Polls /api/dev/impersonate for status; offers End (and, for assist, the
 * optional transparency note into the target's coach chat).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { clearForgeBrowserKeysEverywhere, impersonationSeenFor, IMPERSONATION_SEEN_KEY } from "@/lib/refinery-guards";

interface Status {
  active: boolean;
  mode?: "view" | "assist";
  target?: { id: string; name: string | null; email: string | null };
  expiresAt?: string | null;
}

export function ImpersonationChrome() {
  const [status, setStatus] = useState<Status>({ active: false });
  const [now, setNow] = useState(Date.now());
  const [ending, setEnding] = useState(false);

  // Whether this browser has seen the session active, FOR THIS ADMIN (kept
  // in storage too, so a reload or a new page after it ran out still knows;
  // the stored value is the admin's own id, so a flag left by anyone else is
  // dropped, never acted on: review r3, I4). When the status is then
  // inactive (it expired, or was ended anywhere), the keys the person's
  // session left in this browser are cleared once, the same as the End
  // button does (security review 3a Part 2 r2, N3).
  const { data: authData } = useSession();
  const adminId = (authData?.user as { id?: string } | undefined)?.id ?? null;
  const wasActive = useRef(false);
  const cleared = useRef(false);
  const settle = useCallback((active: boolean) => {
    if (!adminId) return;
    let seen = wasActive.current;
    try {
      if (active) localStorage.setItem(IMPERSONATION_SEEN_KEY, adminId);
      else seen = seen || impersonationSeenFor(adminId);
    } catch {
      // storage unavailable: this tab's own memory still applies
    }
    if (active) {
      wasActive.current = true;
      cleared.current = false;
    } else if (seen && !cleared.current) {
      cleared.current = true;
      wasActive.current = false;
      clearForgeBrowserKeysEverywhere(adminId);
      try {
        localStorage.removeItem(IMPERSONATION_SEEN_KEY);
      } catch {
        // ignore
      }
    }
  }, [adminId]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/impersonate");
      if (res.ok) {
        const s = (await res.json()) as Status;
        setStatus(s);
        settle(!!s.active && !!s.mode);
      }
    } catch {}
  }, [settle]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 60_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  // The countdown reaching zero also ends it, before the next poll.
  const runOut = status.active && status.expiresAt ? Date.parse(status.expiresAt) <= now : false;
  useEffect(() => {
    if (runOut) settle(false);
  }, [runOut, settle]);

  if (!status.active || !status.mode) return null;

  const isAssist = status.mode === "assist";
  const expiresMs = status.expiresAt ? new Date(status.expiresAt).getTime() : 0;
  const remaining = Math.max(0, Math.floor((expiresMs - now) / 1000));
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");
  const expired = status.expiresAt !== null && remaining === 0;

  async function end(notify: boolean) {
    setEnding(true);
    try {
      await fetch("/api/dev/impersonate", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notify }),
      });
    } finally {
      // Whatever the person's session left in this browser goes with it (M3).
      clearForgeBrowserKeysEverywhere(adminId);
      window.location.href = "/dashboard/admin/users";
    }
  }

  const frame = isAssist ? "#ad2318" : "#2d5a85";
  const tint = isAssist ? "rgba(173,35,24,0.05)" : "rgba(45,90,133,0.05)";
  const who = status.target?.name || status.target?.email || "user";

  return (
    <>
      {/* Full-viewport tinted frame -- never intercepts clicks */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[90]"
        style={{
          boxShadow: `inset 0 0 0 4px ${frame}`,
          background: tint,
        }}
      />
      {/* Status banner */}
      <div
        className="fixed bottom-0 inset-x-0 z-[95] flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm font-medium text-white"
        style={{ background: frame }}
      >
        <span>
          {isAssist ? (
            <>
              ASSIST MODE. You are operating <strong>{who}</strong>&apos;s
              account. Changes are REAL.
            </>
          ) : (
            <>
              Viewing as <strong>{who}</strong> in read-only mode. Changes are blocked.
            </>
          )}
        </span>
        {status.expiresAt && (
          <span className="tabular-nums text-white/90">
            {expired ? "Session expired" : `${mm}:${ss} left`}
          </span>
        )}
        {isAssist ? (
          <span className="flex items-center gap-2">
            <button
              onClick={() => end(true)}
              disabled={ending}
              className="t-focus bg-white/15 hover:bg-white/25 px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              End + notify them
            </button>
            <button
              onClick={() => end(false)}
              disabled={ending}
              className="t-focus bg-[#14100a] hover:bg-black px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              End session
            </button>
          </span>
        ) : (
          <button
            onClick={() => end(false)}
            disabled={ending}
            className="t-focus bg-[#14100a] hover:bg-black px-3 py-1 text-xs font-semibold disabled:opacity-50"
          >
            End session
          </button>
        )}
      </div>
    </>
  );
}

export default ImpersonationChrome;
