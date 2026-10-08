"use client";

/**
 * Premium tools in the Refinery (lib/premium.ts, migration 078).
 *
 * usePremium()   the person's status (one fetch, shared by every gate on a page).
 * PremiumGate    shows the tool when it is open, and the locked card when not.
 * PremiumLocked  why it is locked and how to get it: "Ask your organization"
 *                (enter their code in Settings) or "Ask SMR for access" (a
 *                short form; one row Troy sees in admin, no email). No price.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  PREMIUM_ASK_ORG_HEADING,
  PREMIUM_ASK_ORG_LINE,
  PREMIUM_ASK_SENT_LINE,
  PREMIUM_ASK_SMR_HEADING,
  PREMIUM_ASK_SMR_LINE,
  PREMIUM_NEVER_PAY_LINE,
  PREMIUM_TOOL_LABELS,
  premiumLockedLine,
  toolIsOpen,
  type PremiumStatus,
  type PremiumToolId,
} from "@/lib/premium";

export const PREMIUM_CHANGED_EVENT = "premium-changed";

let shared: Promise<PremiumStatus | null> | null = null;

function loadStatus(force = false): Promise<PremiumStatus | null> {
  if (!shared || force) {
    shared = fetch("/api/user/premium")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j?.data as PremiumStatus) ?? null)
      .catch(() => null);
  }
  return shared;
}

export function usePremium(): { status: PremiumStatus | null; loaded: boolean; refresh: () => void } {
  const [status, setStatus] = useState<PremiumStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(() => {
    void loadStatus(true).then((s) => {
      setStatus(s);
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    let live = true;
    void loadStatus().then((s) => {
      if (!live) return;
      setStatus(s);
      setLoaded(true);
    });
    const onChange = () => refresh();
    window.addEventListener(PREMIUM_CHANGED_EVENT, onChange);
    return () => {
      live = false;
      window.removeEventListener(PREMIUM_CHANGED_EVENT, onChange);
    };
  }, [refresh]);
  return { status, loaded, refresh };
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export function PremiumLocked({ tool, status, compact = false }: { tool: PremiumToolId; status: PremiumStatus | null; compact?: boolean }) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const pending = status?.openRequest ?? null;

  async function ask() {
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/user/premium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setState("error");
        setError(data.error || "That didn't go through. Try again in a minute.");
        return;
      }
      setState("sent");
      window.dispatchEvent(new Event(PREMIUM_CHANGED_EVENT));
    } catch {
      setState("error");
      setError("We couldn't reach the server. Try again in a minute.");
    }
  }

  return (
    <section
      data-testid={`premium-locked-${tool}`}
      aria-label={`${PREMIUM_TOOL_LABELS[tool]} is locked`}
      className={compact ? "border border-t-line bg-t-panel p-3" : "mx-auto max-w-2xl border border-t-line bg-t-panel p-5 sm:p-6"}
    >
      <p className={compact ? "text-sm font-semibold text-t-white" : "text-lg font-semibold text-t-white"}>
        {PREMIUM_TOOL_LABELS[tool]} isn&apos;t open for you yet
      </p>
      <p className="mt-1 text-sm leading-relaxed text-t-bone-dim">
        {premiumLockedLine(tool)} {PREMIUM_NEVER_PAY_LINE}
      </p>

      <div className={compact ? "mt-3 space-y-3" : "mt-5 grid gap-4 sm:grid-cols-2"}>
        <div className="border border-t-line p-3">
          <p className="text-sm font-semibold text-t-white">{PREMIUM_ASK_ORG_HEADING}</p>
          <p className="mt-1 text-sm text-t-bone-dim">{PREMIUM_ASK_ORG_LINE}</p>
          <Link href="/dashboard/settings" className="t-focus mt-2 inline-block min-h-touch text-sm font-medium text-t-amber-bright underline underline-offset-4">
            Enter a code in Settings
          </Link>
        </div>

        <div className="border border-t-line p-3">
          <p className="text-sm font-semibold text-t-white">{PREMIUM_ASK_SMR_HEADING}</p>
          {state === "sent" || pending ? (
            <p role="status" className="mt-1 text-sm text-t-phos" data-testid="premium-request-sent">
              {state === "sent" || !pending?.createdAt ? PREMIUM_ASK_SENT_LINE : `You asked on ${shortDate(pending.createdAt)}. When it's approved, this tool opens here.`}
            </p>
          ) : (
            <>
              <label htmlFor={`premium-note-${tool}`} className="mt-1 block text-sm text-t-bone-dim">
                {PREMIUM_ASK_SMR_LINE}
              </label>
              <textarea
                id={`premium-note-${tool}`}
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={3}
                maxLength={500}
                disabled={state === "sending"}
                className="mt-2 w-full border border-t-line bg-t-panel-2 px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
              />
              <button
                type="button"
                onClick={ask}
                disabled={state === "sending"}
                data-testid={`premium-ask-${tool}`}
                className="t-focus mt-2 min-h-touch bg-t-amber px-4 text-sm font-bold text-white hover:bg-t-amber-bright disabled:opacity-60"
              >
                {state === "sending" ? "Sending..." : "Send my request"}
              </button>
              {state === "error" && <p className="mt-2 text-sm text-t-red">{error}</p>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** The tool when open; the locked card when not; nothing while loading. */
export function PremiumGate({ tool, children }: { tool: PremiumToolId; children: ReactNode }) {
  const { status, loaded } = usePremium();
  if (!loaded) return <div className="px-4 py-12 text-sm text-t-phos-dim">Loading...</div>;
  // The status could not be read: show the tool; the server still checks every call.
  const open = status ? toolIsOpen(status, tool) : true;
  if (open) return <>{children}</>;
  return (
    <div className="px-4 py-10">
      <PremiumLocked tool={tool} status={status} />
    </div>
  );
}
