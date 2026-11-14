"use client";

/**
 * Settings: "Email me my finished resume" (079, users.forge_package_email).
 * On by default. Only ever the account's own address, and only once it is
 * confirmed. Turning it off stops the automatic email; nothing else changes.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export function PackageEmailSetting() {
  const t = useTranslations("refineryAccount.packageEmail");
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
      if (!res.ok) setError(j.error || t("notSaved"));
      else setData((d) => (d ? { ...d, on } : d));
    } catch {
      setError(t("notSaved"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="package-email" className="scroll-mt-32 mb-8" data-testid="package-email-setting">
      <h2 className="text-lg font-bold text-t-white mb-1">{t("heading")}</h2>
      <label className="flex items-start gap-2 text-sm text-t-white">
        <input
          type="checkbox"
          checked={data.on}
          disabled={saving}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-t-amber"
        />
        <span>{t("toggle")}</span>
      </label>
      <p className="mt-1 text-sm text-t-phos-dim">
        {data.email
          ? data.proven
            ? t("confirmed", { email: data.email })
            : t("unconfirmed", { email: data.email })
          : t("noEmail")}
      </p>
      {error && <p className="mt-1 text-sm text-t-red">{error}</p>}
    </section>
  );
}
