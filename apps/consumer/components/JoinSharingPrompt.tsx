"use client";

/**
 * JoinSharingPrompt -- asked once, right after someone joins an organization:
 * may that organization see your progress?
 *
 * "Yes" sets the same 'sharing' consent as the Settings switch, through the
 * same POST /api/consent. "Not now" sends nothing and stores nothing on the
 * server; this browser remembers not to ask again. The server decides whether
 * to ask at all (GET /api/sharing/join-prompt): never for someone who already
 * chose, never for staff, never where a program requires sharing.
 *
 * Self-contained: renders nothing when signed out or when there is nothing to ask.
 */
import { useCallback, useEffect, useState } from "react";
import { JOIN_SHARING_PROMPT_TEXT as TEXT } from "@crucible/core/src/joinSharingPromptShared";
import {
  ORG_JOINED_EVENT,
  SHARING_CHANGED_EVENT,
  rememberDismissed,
  shouldShowJoinPrompt,
} from "@/lib/join-sharing-prompt";

interface Decision { show: boolean; orgId?: string; orgName?: string; viewerId?: string }

const storage = () => {
  try { return window.localStorage; } catch { return null; }
};

export function JoinSharingPrompt() {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [state, setState] = useState<"ask" | "saving" | "saved" | "failed" | "closed">("ask");

  const check = useCallback(() => {
    fetch("/api/sharing/join-prompt")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Decision | null) => {
        if (!d) return;
        setDecision(d);
        // Keep a "saved" or "failed" line on screen; only a closed prompt can reopen.
        setState((prev) => (prev === "closed" ? "ask" : prev));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    check();
    window.addEventListener(ORG_JOINED_EVENT, check);
    window.addEventListener(SHARING_CHANGED_EVENT, check);
    return () => {
      window.removeEventListener(ORG_JOINED_EVENT, check);
      window.removeEventListener(SHARING_CHANGED_EVENT, check);
    };
  }, [check]);

  if (state === "closed") return null;
  if (state === "saved" || state === "failed") {
    return (
      <div role="status" className="mx-auto max-w-3xl px-4 pt-4">
        <p className="border border-t-line bg-t-panel px-4 py-3 text-sm text-t-phos">
          {state === "saved" ? TEXT.saved : TEXT.failed}{" "}
          <button type="button" onClick={() => setState("closed")} className="t-focus underline underline-offset-4">OK</button>
        </p>
      </div>
    );
  }
  if (!decision || !shouldShowJoinPrompt(decision, decision.viewerId, storage())) return null;

  async function yes() {
    setState("saving");
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layer: "sharing", action: "grant", source: "join_prompt" }),
      });
      setState(res.ok ? "saved" : "failed");
      if (res.ok) {
        setDecision({ show: false });
        window.dispatchEvent(new Event(SHARING_CHANGED_EVENT));
      }
    } catch {
      setState("failed");
    }
  }

  function notNow() {
    if (decision?.viewerId && decision.orgId) rememberDismissed(storage(), decision.viewerId, decision.orgId);
    setState("closed");
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4">
      <section aria-labelledby="join-sharing-title" className="border border-t-amber bg-t-panel p-5">
        <h2 id="join-sharing-title" className="text-lg font-bold text-t-white">
          {TEXT.title(decision.orgName || "your organization")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-t-phos">{TEXT.sees}</p>
        <p className="mt-1 text-sm leading-relaxed text-t-phos">{TEXT.never}</p>
        <p className="mt-1 text-sm leading-relaxed text-t-phos-dim">{TEXT.control}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={yes} disabled={state === "saving"}
            className="t-focus min-h-touch bg-t-amber px-4 py-2 text-sm font-semibold text-[#14100a] disabled:opacity-50">
            {state === "saving" ? "Saving..." : TEXT.yes}
          </button>
          <button type="button" onClick={notNow} disabled={state === "saving"}
            className="t-focus min-h-touch border border-t-line px-4 py-2 text-sm text-t-phos hover:text-t-white disabled:opacity-50">
            {TEXT.notNow}
          </button>
        </div>
      </section>
    </div>
  );
}
