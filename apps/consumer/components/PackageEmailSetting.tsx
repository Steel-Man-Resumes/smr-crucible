"use client";

/**
 * Settings: "Email me my finished resume" (079, users.forge_package_email).
 * On by default. Only ever the account's own address, and only once it is
 * confirmed. Turning it off stops the automatic email; nothing else changes.
 */

import { useEffect, useState } from "react";

export function PackageEmailSetting() {
  const [data, setData] = useState<{ on: boolean; email: string | null; proven: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/user/package-email")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.data && setData(j.data))
      .catch(() => {});
  }, []);

  if (!data) return null;

  async function toggle(on: boolean) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/user/package-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(j.error || "That didn't save. Try again.");
      else setData((d) => (d ? { ...d, on } : d));
    } catch {
      setError("That didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="package-email" className="scroll-mt-32 mb-8" data-testid="package-email-setting">
      <h2 className="text-lg font-bold text-t-white mb-1">Your finished resume by email</h2>
      <label className="flex items-start gap-2 text-sm text-t-white">
        <input
          type="checkbox"
          checked={data.on}
          disabled={saving}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-t-amber"
        />
        <span>Email me my finished resume</span>
      </label>
      <p className="mt-1 text-sm text-t-phos-dim">
        {data.email
          ? data.proven
            ? `When you finish a resume in the Forge, we send it to ${data.email}. Only to that address.`
            : `When you finish a resume in the Forge, we send it to ${data.email} once that address is confirmed. Sign in with an email link once to confirm it.`
          : "When you finish a resume in the Forge, we send it to your account email."}
      </p>
      {error && <p className="mt-1 text-sm text-t-red">{error}</p>}
    </section>
  );
}
