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

import { useCallback, useEffect, useState } from "react";

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

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/impersonate");
      if (res.ok) setStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 60_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

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
              ASSIST MODE -- you are operating <strong>{who}</strong>&apos;s
              account. Changes are REAL.
            </>
          ) : (
            <>
              Viewing as <strong>{who}</strong> -- read-only, changes blocked.
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
