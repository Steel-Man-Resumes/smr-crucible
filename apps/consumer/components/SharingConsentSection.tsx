"use client";

/**
 * SharingConsentSection -- Settings -> "Share your progress" (W7 consent).
 *
 * Lets the user grant/revoke the 'sharing' consent layer, which is what lets a
 * support partner (the org whose access code they used) see their journey
 * progress. We are explicit about what is and is not shared. Self-contained:
 * hydrates from GET /api/consent, toggles via POST /api/consent.
 */

import { useState, useEffect } from "react";

export function SharingConsentSection() {
  const [sharing, setSharing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
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
      if (res.ok) setSharing(next);
    } catch {
      // leave state as-is on failure
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-8 font-term">
      <h2 className="text-lg font-bold text-t-white mb-4">Share your progress</h2>
      <div className="bg-t-panel border border-t-line p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-t-white mb-1">
              Let your support partner see your progress
            </h3>
            <p className="text-sm text-t-phos-dim leading-relaxed">
              If a partner organization gave you a code, you can let them see where you
              are in your journey -- your stage, how many jobs you have applied to, and
              when you were last active. They never see your resume, your disclosure plan,
              or anything you write while practicing. You can turn this off anytime.
            </p>
          </div>
          <button
            type="button"
            onClick={toggle}
            disabled={loading || saving}
            role="switch"
            aria-checked={sharing}
            aria-label="Share my progress with my support partner"
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
              ? "On -- your partner can see your progress signals."
              : "Off -- your progress is private to you."}
        </p>
      </div>
    </section>
  );
}
