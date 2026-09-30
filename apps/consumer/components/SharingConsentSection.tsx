"use client";

/**
 * SharingConsentSection -- Settings -> "Share your progress" (W7 consent).
 *
 * Lets the user grant/revoke the 'sharing' consent layer, which is what lets a
 * support partner (the org whose access code they used) see their journey
 * progress. The words live in core (SETTINGS_SHARING_TEXT) with their own
 * version, and match the one-time prompt after joining. Self-contained:
 * hydrates from GET /api/consent, toggles via POST /api/consent.
 */

import { useState, useEffect } from "react";
import { SETTINGS_SHARING_TEXT as TEXT } from "@crucible/core/src/joinSharingPromptShared";
import { SHARING_CHANGED_EVENT } from "@/lib/join-sharing-prompt";

export function SharingConsentSection() {
  const [sharing, setSharing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch("/api/consent")
        .then((r) => (r.ok ? r.json() : { consents: [] }))
        .then((d) => {
          const rec = (d.consents || []).find(
            (c: any) => c.consent_layer === "sharing"
          );
          setSharing(rec?.status === "granted");
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    load();
    // The one-time prompt after joining sets this same consent; stay in step.
    window.addEventListener(SHARING_CHANGED_EVENT, load);
    return () => window.removeEventListener(SHARING_CHANGED_EVENT, load);
  }, []);

  async function toggle() {
    const next = !sharing;
    setSaving(true);
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layer: "sharing", action: next ? "grant" : "revoke" }),
      });
      if (res.ok) {
        setSharing(next);
        // They chose here, so the one-time prompt has nothing left to ask.
        window.dispatchEvent(new Event(SHARING_CHANGED_EVENT));
      }
    } catch {
      // leave state as-is on failure
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-t-white mb-4">{TEXT.heading}</h2>
      <div className="bg-t-panel border border-t-line p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-t-white mb-1">{TEXT.title}</h3>
            <p className="text-sm text-t-phos-dim leading-relaxed">
              {TEXT.sees} {TEXT.never} {TEXT.more} {TEXT.control}
            </p>
          </div>
          <button
            type="button"
            onClick={toggle}
            disabled={loading || saving}
            role="switch"
            aria-checked={sharing}
            aria-label={TEXT.switchLabel}
            className={`t-focus relative inline-flex h-7 w-12 flex-shrink-0 items-center border transition-colors disabled:opacity-50 ${
              sharing ? "bg-t-amber border-t-amber" : "bg-t-panel-2 border-t-line"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform transition-transform ${
                sharing ? "translate-x-6 bg-[#14100a]" : "translate-x-1 bg-t-phos-dim"
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-t-phos-dim mt-3">
          {loading
            ? "Loading..."
            : sharing
              ? TEXT.on
              : TEXT.off}
        </p>
      </div>
    </section>
  );
}
