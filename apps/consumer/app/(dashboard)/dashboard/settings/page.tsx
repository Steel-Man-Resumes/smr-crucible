"use client";

/**
 * Settings & Data Controls
 *
 * JBS-compliant data management:
 * - Consent layer management (view/revoke)
 * - Data export (download your data)
 * - Data deletion (right to be forgotten)
 * - Partner access code management
 * - Daily AI usage display
 */

import { useState, useEffect, FormEvent } from "react";
import { CoachSettingsSection } from "@/components/CoachSettingsSection";
import { SharingConsentSection } from "@/components/SharingConsentSection";
import { ConsentPanel } from "@/components/ConsentPanel";
import { AiCostsOwnSection } from "@/components/AiCostsSection";
import { useSession } from "next-auth/react";
import { useRealTier } from "@/lib/useUserTier";
import { TBtn } from "@crucible/consumer-ui";

interface UsageData {
  used: number;
  limit: number | null;
  remaining: number | null;
}

interface RedeemedCode {
  partner_name: string;
  tier: string;
  daily_limit: number | null;
  redeemed_at: string;
}

export default function SettingsPage() {
  const realTier = useRealTier();
  const isAdmin = realTier === "admin";
  const [testMode, setTestMode] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Phase 1C reauth gate: export and delete both require the current
  // password (password accounts) or the literal string "DELETE" typed out
  // (magic-link/OAuth-only accounts, which have no password to re-prove).
  // Either field is accepted -- the server decides which one it needs based
  // on whether the account has a password_hash.
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthTyped, setReauthTyped] = useState("");

  // Load admin test mode on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      setTestMode(localStorage.getItem("admin_test_mode") === "client");
    }
  }, []);
  const [exportStatus, setExportStatus] = useState<
    "idle" | "exporting" | "done"
  >("idle");

  // Access code state
  const [codeInput, setCodeInput] = useState("");
  const [codeStatus, setCodeStatus] = useState<
    "idle" | "redeeming" | "success" | "error"
  >("idle");
  const [codeError, setCodeError] = useState("");
  const [redeemedCodes, setRedeemedCodes] = useState<RedeemedCode[]>([]);

  // Usage state
  const [usage, setUsage] = useState<UsageData | null>(null);

  // N1: hidden employers (manage + un-hide).
  const [hiddenEmployers, setHiddenEmployers] = useState<
    { id: string; display_name: string; reason: string | null }[]
  >([]);
  const [hideInput, setHideInput] = useState("");
  const [hideReasonInput, setHideReasonInput] = useState("");
  const [hideBusy, setHideBusy] = useState(false);

  function loadHiddenEmployers() {
    fetch("/api/user/hidden-employers")
      .then((r) => (r.ok ? r.json() : { employers: [] }))
      .then((d) => setHiddenEmployers(d.employers || []))
      .catch(() => {});
  }

  async function addHiddenEmployer(e: FormEvent) {
    e.preventDefault();
    const name = hideInput.trim();
    if (!name || hideBusy) return;
    setHideBusy(true);
    try {
      const res = await fetch("/api/user/hidden-employers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, reason: hideReasonInput.trim() || undefined }),
      });
      if (res.ok) {
        setHideInput("");
        setHideReasonInput("");
        loadHiddenEmployers();
      }
    } catch {} finally {
      setHideBusy(false);
    }
  }

  async function unhideEmployer(id: string) {
    try {
      const res = await fetch("/api/user/hidden-employers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) setHiddenEmployers((prev) => prev.filter((e) => e.id !== id));
    } catch {}
  }

  // Load usage + redeemed codes on mount
  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then(setUsage)
      .catch(() => {});

    fetch("/api/access-code/mine")
      .then((r) => r.json())
      .then((data) => setRedeemedCodes(data.codes || []))
      .catch(() => {});

    loadHiddenEmployers();
  }, []);

  async function redeemCode(e: React.FormEvent) {
    e.preventDefault();
    if (!codeInput.trim()) return;

    setCodeStatus("redeeming");
    setCodeError("");

    try {
      const res = await fetch("/api/access-code/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeInput.trim() }),
      });

      if (res.ok) {
        setCodeStatus("success");
        setCodeInput("");
        // Refresh codes and usage
        const [codesRes, usageRes] = await Promise.all([
          fetch("/api/access-code/mine"),
          fetch("/api/usage"),
        ]);
        if (codesRes.ok) {
          const data = await codesRes.json();
          setRedeemedCodes(data.codes || []);
        }
        if (usageRes.ok) setUsage(await usageRes.json());
        setTimeout(() => setCodeStatus("idle"), 3000);
      } else {
        const data = await res.json();
        setCodeError(data.error || "Could not redeem code");
        setCodeStatus("error");
        setTimeout(() => setCodeStatus("idle"), 5000);
      }
    } catch {
      setCodeError("Something went wrong. Try again.");
      setCodeStatus("error");
      setTimeout(() => setCodeStatus("idle"), 5000);
    }
  }

  async function exportData() {
    setExportStatus("exporting");
    try {
      // Real server-side export -- everything Postgres holds for this user.
      // Reauth-gated (Phase 1C): same password/typed-confirmation contract
      // as delete, since a full data export is nearly as sensitive.
      const res = await fetch("/api/user/export-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          password: reauthPassword || undefined,
          typedConfirmation: reauthTyped || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to export data. Please try again.");
        setExportStatus("idle");
        return;
      }
      const exportPayload: Record<string, any> = await res.json();

      // Fold in the local-device keys so nothing is lost, under their own key
      // so they never collide with the server-side field names above.
      const localDevice: Record<string, any> = {};
      const keys = ["forge_session", "consumer_progress", "consent_record"];
      for (const key of keys) {
        const val = localStorage.getItem(key);
        if (val) {
          try {
            localDevice[key] = JSON.parse(val);
          } catch {
            localDevice[key] = val;
          }
        }
      }
      exportPayload.localDevice = localDevice;

      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `second-mile-data-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setExportStatus("done");
      setTimeout(() => setExportStatus("idle"), 3000);
    } catch {
      alert("Failed to export data. Please try again.");
      setExportStatus("idle");
    }
  }

  const [deleting, setDeleting] = useState(false);

  async function deleteAllData() {
    setDeleting(true);
    try {
      // Delete server-side data first. Reauth-gated (Phase 1C) -- see
      // apps/consumer/app/api/user/delete-data/route.ts's contract comment.
      const res = await fetch("/api/user/delete-data", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          password: reauthPassword || undefined,
          typedConfirmation: reauthTyped || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to delete data. Please try again.");
        setDeleting(false);
        return;
      }
    } catch {
      alert("Failed to delete data. Please try again.");
      setDeleting(false);
      return;
    }

    // Then clear all localStorage
    const keys = [
      "forge_session",
      "consumer_progress",
      "consent_record",
      "hidden_jobs",
      "saved_jobs",
      "forge_preload",
    ];
    for (const key of keys) {
      localStorage.removeItem(key);
    }
    setShowDeleteConfirm(false);
    // Force fresh JWT by signing out — tier was reset server-side
    window.location.href = "/login";
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-t-white mb-2">Settings</h1>
      <p className="text-base text-t-phos-dim mb-8">
        Your data, your control. Manage your information and privacy.
      </p>

      <CoachSettingsSection />

      <SharingConsentSection />

      <ConsentPanel />

      {/* AI usage/cost -- quiet by design */}
      <AiCostsOwnSection />

      {/* Admin Test Mode Toggle */}
      {isAdmin && (
        <section className="mb-8">
          <div className="bg-t-panel-2 p-5 border border-t-amber">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-t-amber-bright">Admin Mode</h3>
                <p className="text-sm text-t-phos-dim mt-1">
                  {testMode
                    ? "Testing as a regular client. Toggle off to restore admin access."
                    : "You have full admin access. Toggle on to see the real user experience."}
                </p>
              </div>
              <button
                onClick={() => {
                  if (testMode) {
                    localStorage.removeItem("admin_test_mode");
                  } else {
                    localStorage.setItem("admin_test_mode", "client");
                  }
                  window.location.reload();
                }}
                className={`t-focus px-4 py-2 text-sm font-medium transition-colors min-h-touch ${
                  testMode
                    ? "bg-t-amber text-white hover:bg-t-amber-bright"
                    : "bg-transparent border border-t-amber text-t-amber-bright hover:bg-t-amber/10"
                }`}
              >
                {testMode ? "Back to Admin" : "Test as Client"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Account Info */}
      <AccountSection />

      {/* Daily Usage */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-t-white mb-4">
          Daily Usage
        </h2>
        <div className="bg-t-panel p-5 border border-t-line">
          {usage ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-t-white">
                  AI calls today
                </span>
                <span className="text-sm text-t-phos-dim">
                  {usage.limit === null
                    ? `${usage.used} used (unlimited)`
                    : `${usage.used} / ${usage.limit}`}
                </span>
              </div>
              {usage.limit !== null && (
                <div className="w-full bg-t-line h-2">
                  <div
                    className="bg-t-amber h-2 transition-all"
                    style={{
                      width: `${Math.min(100, (usage.used / usage.limit) * 100)}%`,
                    }}
                  />
                </div>
              )}
              {usage.remaining !== null && usage.remaining <= 5 && usage.remaining > 0 && (
                <p className="text-xs text-t-amber-bright mt-2">
                  {usage.remaining} AI call{usage.remaining === 1 ? "" : "s"} left today. Resets at midnight.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-t-phos-dim">Loading usage...</p>
          )}
        </div>
      </section>

      {/* Partner Access Code */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-t-white mb-4">
          Partner Access Code
        </h2>
        <div className="space-y-4">
          <div className="bg-t-panel p-5 border border-t-line">
            <h3 className="font-semibold text-t-white mb-2">
              Enter a code
            </h3>
            <p className="text-sm text-t-phos-dim mb-3">
              If you got a code from a partner organization (like a job center or
              nonprofit), enter it here to unlock more AI calls per day.
            </p>
            <form onSubmit={redeemCode} className="flex gap-2">
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="PARTNER123"
                className="flex-1 px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch uppercase"
                disabled={codeStatus === "redeeming"}
              />
              <TBtn type="submit" disabled={codeStatus === "redeeming" || !codeInput.trim()}>
                {codeStatus === "redeeming" ? "..." : "redeem"}
              </TBtn>
            </form>
            {codeStatus === "success" && (
              <p className="text-sm text-t-amber-bright mt-2">
                Code redeemed! Your daily limit has been increased.
              </p>
            )}
            {codeStatus === "error" && (
              <p className="text-sm text-t-red mt-2">{codeError}</p>
            )}
          </div>

          {/* Display active codes */}
          {redeemedCodes.length > 0 && (
            <div className="bg-t-panel p-5 border border-t-line">
              <h3 className="font-semibold text-t-white mb-3">
                Your active codes
              </h3>
              <div className="space-y-2">
                {redeemedCodes.map((code, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 border-b border-t-line last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-t-white">
                        {code.partner_name}
                      </p>
                      <p className="text-xs text-t-phos-dim">
                        {code.tier === "unlimited" || code.tier === "admin"
                          ? "Unlimited calls"
                          : `${code.daily_limit ?? 200} calls/day`}
                      </p>
                    </div>
                    <span className="text-xs text-t-phos-dim">
                      {new Date(code.redeemed_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* N1: Hidden Employers */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-t-white mb-4">Hidden Employers</h2>
        <div className="bg-t-panel p-5 border border-t-line">
          <p className="text-sm text-t-phos-dim mb-4">
            Employers you hide never show up in your job search. Hide a former employer, or
            anywhere you have already applied. You can un-hide any of them here.
          </p>

          <form onSubmit={addHiddenEmployer} className="space-y-2 mb-4">
            <input
              type="text"
              value={hideInput}
              onChange={(e) => setHideInput(e.target.value)}
              placeholder="Employer name to hide"
              maxLength={200}
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            />
            <input
              type="text"
              value={hideReasonInput}
              onChange={(e) => setHideReasonInput(e.target.value)}
              placeholder="Reason (optional)"
              maxLength={280}
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            />
            <TBtn type="submit" disabled={hideBusy || !hideInput.trim()}>
              {hideBusy ? "..." : "hide employer"}
            </TBtn>
          </form>

          {hiddenEmployers.length === 0 ? (
            <p className="text-sm text-t-phos-dim">You have not hidden any employers.</p>
          ) : (
            <div className="space-y-2">
              {hiddenEmployers.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-3 py-2 border-b border-t-line last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-t-white truncate">{e.display_name}</p>
                    {e.reason && <p className="text-xs text-t-phos-dim truncate">{e.reason}</p>}
                  </div>
                  <button
                    onClick={() => unhideEmployer(e.id)}
                    className="t-focus flex-shrink-0 text-xs font-medium text-t-amber-bright hover:text-t-amber"
                  >
                    Un-hide
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Security */}
      <SecuritySection />

      {/* Privacy & Data */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-t-white mb-4">
          Privacy & Data
        </h2>

        <div className="space-y-4">
          {/* How we handle your data */}
          <div className="bg-t-panel p-5 border border-t-line">
            <h3 className="font-semibold text-t-white mb-2">
              How we handle your data
            </h3>
            <ul className="space-y-2 text-sm text-t-phos-dim">
              <li className="flex gap-2">
                <span className="text-t-amber flex-shrink-0">•</span>
                Your Forge answers and results are saved to your account so
                your work is here when you come back
              </li>
              <li className="flex gap-2">
                <span className="text-t-amber flex-shrink-0">•</span>
                Conversations with t.ROY are saved to your account so he can
                remember your recent work. Deleting your data clears them.
              </li>
              <li className="flex gap-2">
                <span className="text-t-amber flex-shrink-0">•</span>
                We never sell or share your personal information
              </li>
              <li className="flex gap-2">
                <span className="text-t-amber flex-shrink-0">•</span>
                You can export or delete your data at any time
              </li>
            </ul>
          </div>

          {/* Reauth for export/delete -- password accounts fill the password
              field; magic-link/OAuth-only accounts (no password) type the
              word DELETE instead. Either one satisfies the server's gate. */}
          <div className="bg-t-panel p-5 border border-t-line">
            <h3 className="font-semibold text-t-white">Confirm your identity</h3>
            <p className="text-sm text-t-phos-dim mt-1">
              Exporting or deleting your data is sensitive -- confirm it&apos;s
              you before either action below. Enter your password, or if you
              sign in with a magic link and have no password, type DELETE.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-3">
              <input
                type="password"
                value={reauthPassword}
                onChange={(e) => setReauthPassword(e.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
                className="flex-1 px-3 py-2 bg-t-bg border border-t-line text-t-white text-sm min-h-touch"
              />
              <input
                type="text"
                value={reauthTyped}
                onChange={(e) => setReauthTyped(e.target.value)}
                placeholder='Or type DELETE (no-password accounts)'
                className="flex-1 px-3 py-2 bg-t-bg border border-t-line text-t-white text-sm min-h-touch"
              />
            </div>
          </div>

          {/* Export data */}
          <div className="bg-t-panel p-5 border border-t-line">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-t-white">
                  Download your data
                </h3>
                <p className="text-sm text-t-phos-dim mt-1">
                  Get a copy of everything we have stored about you.
                </p>
              </div>
              <button
                onClick={exportData}
                disabled={exportStatus !== "idle"}
                className="t-focus px-4 py-2 border border-t-amber text-t-amber-bright text-sm font-medium hover:bg-t-amber/10 disabled:opacity-50 transition-colors min-h-touch"
              >
                {exportStatus === "exporting"
                  ? "Preparing..."
                  : exportStatus === "done"
                    ? "Downloaded"
                    : "Export"}
              </button>
            </div>
          </div>

          {/* Delete data */}
          <div className="bg-t-panel p-5 border border-t-red">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-t-white">
                  Delete all your data
                </h3>
                <p className="text-sm text-t-phos-dim mt-1">
                  Permanently remove all stored data from this device. This
                  cannot be undone.
                </p>
              </div>
              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="t-focus px-4 py-2 border border-t-red text-t-red text-sm font-medium hover:bg-t-red/10 transition-colors min-h-touch"
                >
                  Delete
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-2 text-sm text-t-phos-dim hover:text-t-white min-h-touch"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={deleteAllData}
                    disabled={deleting}
                    className="t-focus px-4 py-2 bg-t-red text-white text-sm font-bold hover:bg-t-red/80 disabled:opacity-50 transition-colors min-h-touch"
                  >
                    {deleting ? "Deleting..." : "Confirm Delete"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section>
        <h2 className="text-lg font-bold text-t-white mb-4">About</h2>
        <div className="bg-t-panel p-5 border border-t-line">
          <h3 className="font-semibold text-t-white mb-2">
            Steel Man Resumes
          </h3>
          <p className="text-sm text-t-phos-dim leading-relaxed mb-3">
            Built by people who believe your past doesn&apos;t define your
            paycheck. The Forge and Refinery are tools designed to help you take
            the next step on your own terms.
          </p>
          <p className="text-xs text-t-phos-dim">
            All AI-powered features are designed with transparency, consent, and
            your dignity in mind.
          </p>
        </div>
      </section>
    </div>
  );
}

function scorePassword(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: "" };
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw)) s++;
  const labels = ["keep going", "getting there", "solid", "strong", "fabulous", "unbreakable"];
  const score = Math.min(s, 5);
  return { score, label: labels[score] };
}

function fmtWhen(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function SecuritySection() {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [needsCurrent, setNeedsCurrent] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  function refresh() {
    return fetch("/api/user/security-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setHasPassword(!!d.hasPassword);
          setUpdatedAt(d.passwordUpdatedAt);
          setTwoFactorEnabled(!!d.twoFactorEnabled);
        }
      })
      .catch(() => {});
  }
  useEffect(() => {
    refresh();
  }, []);

  const strength = scorePassword(pw);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 10) {
      setErrorMsg("Use at least 10 characters.");
      setStatus("error");
      return;
    }
    if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) {
      setErrorMsg("Include at least one letter and one number.");
      setStatus("error");
      return;
    }
    if (pw !== confirm) {
      setErrorMsg("Those two don't match yet.");
      setStatus("error");
      return;
    }
    setStatus("saving");
    setErrorMsg("");
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          hasPassword ? { password: pw, currentPassword: current } : { password: pw }
        ),
      });
      if (res.ok) {
        setStatus("done");
        setPw("");
        setConfirm("");
        setCurrent("");
        setNeedsCurrent(false);
        await refresh();
        setTimeout(() => setStatus("idle"), 3500);
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || "Could not save that. Try again.");
        setNeedsCurrent(!!data.needsCurrent);
        setStatus("error");
      }
    } catch {
      setErrorMsg("Something went wrong. Try again.");
      setStatus("error");
    }
  }

  const creating = hasPassword === false;
  const strengthColors = ["bg-t-line", "bg-t-red", "bg-t-amber", "bg-t-amber-bright", "bg-t-phos", "bg-t-phos"];

  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-t-white mb-1">Security</h2>
      <p className="text-sm text-t-phos-dim mb-4">
        Your account, locked down the way it should be.
      </p>

      <div className="bg-t-panel p-5 border border-t-line">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h3 className="font-semibold text-t-white">
              {creating ? "Create a password" : "Password"}
            </h3>
            <p className="text-sm text-t-phos-dim mt-0.5">
              {creating
                ? "Set a password so you can sign in instantly -- no waiting for an email link."
                : updatedAt
                  ? `Last changed ${fmtWhen(updatedAt)}.`
                  : "Sign in with your email and password."}
            </p>
          </div>
          {!creating && hasPassword !== null && (
            <span className="flex-shrink-0 text-[11px] px-2 py-0.5 border border-t-phos text-t-phos">
              Password set
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 mt-3">
          {hasPassword && (
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
              className={`w-full px-4 py-3 border text-sm bg-t-panel-2 text-t-white focus:outline-none transition-colors min-h-touch ${
                needsCurrent ? "border-t-red focus:border-t-red" : "border-t-line focus:border-t-amber"
              }`}
            />
          )}
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={creating ? "New password (10+ characters)" : "New password"}
            autoComplete="new-password"
            className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
          />

          {pw && (
            <div className="flex items-center gap-3">
              <div className="flex gap-1 flex-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      i < strength.score ? strengthColors[strength.score] : "bg-t-line"
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs text-t-phos-dim w-20 text-right capitalize">
                {strength.label}
              </span>
            </div>
          )}

          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
          />

          {status === "error" && <p className="text-sm text-t-red">{errorMsg}</p>}
          {status === "done" && (
            <p className="text-sm text-t-phos">
              {creating ? "Password created. You're all set." : "Password updated. Nice and secure."}
            </p>
          )}

          <TBtn type="submit" disabled={status === "saving" || !pw || !confirm || (hasPassword === true && !current)}>
            {status === "saving" ? "saving..." : creating ? "create password" : "update password"}
          </TBtn>
        </form>
      </div>

      <TwoFactorCard enabled={twoFactorEnabled} refresh={refresh} />

      <ActiveDevicesCard />
    </section>
  );
}

interface DeviceSession {
  jti: string;
  device: string;
  location: string | null;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

function ActiveDevicesCard() {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    return fetch("/api/user/sessions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSessions(d?.sessions ?? []))
      .catch(() => setSessions([]));
  }
  useEffect(() => {
    load();
  }, []);

  async function revoke(jti: string) {
    setBusy(jti);
    try {
      const r = await fetch("/api/user/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", jti }),
      });
      const d = await r.json().catch(() => ({}));
      if (d?.selfRevoked) {
        window.location.href = "/login";
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function revokeOthers() {
    setBusy("others");
    try {
      await fetch("/api/user/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke_others" }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (sessions !== null && sessions.length === 0) return null;
  const hasOthers = (sessions || []).some((s) => !s.current);

  return (
    <div className="bg-t-panel p-5 border border-t-line mt-3">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold text-t-white">Active devices</h3>
          <p className="text-sm text-t-phos-dim mt-0.5">
            Where you&apos;re signed in. Revoke anything you don&apos;t recognize -- it&apos;s
            signed out right away.
          </p>
        </div>
        {hasOthers && (
          <button
            type="button"
            onClick={revokeOthers}
            disabled={busy === "others"}
            className="t-focus flex-shrink-0 text-xs px-3 py-1.5 border border-t-line text-t-phos-dim hover:text-t-amber-bright disabled:opacity-50"
          >
            {busy === "others" ? "..." : "Sign out others"}
          </button>
        )}
      </div>
      {sessions === null ? (
        <p className="text-sm text-t-phos-dim">Loading...</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li
              key={s.jti}
              className="flex flex-wrap items-center justify-between gap-2 border border-t-line px-3 py-2.5"
            >
              <div>
                <div className="text-sm font-medium text-t-white">
                  {s.device}
                  {s.current && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 border border-t-phos text-t-phos">
                      This device
                    </span>
                  )}
                </div>
                <div className="text-xs text-t-phos-dim">
                  {s.location ? `${s.location} -- ` : ""}last active {fmtWhen(s.lastSeenAt)}
                </div>
              </div>
              {!s.current && (
                <button
                  type="button"
                  onClick={() => revoke(s.jti)}
                  disabled={busy === s.jti}
                  className="t-focus text-xs px-3 py-1.5 border border-t-line text-t-phos-dim hover:text-t-amber-bright disabled:opacity-50"
                >
                  {busy === s.jti ? "..." : "Revoke"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TwoFactorCard({
  enabled,
  refresh,
}: {
  enabled: boolean;
  refresh: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<"idle" | "setup" | "backup">("idle");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showDisable, setShowDisable] = useState(false);
  const [disableToken, setDisableToken] = useState("");

  async function startSetup() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/user/2fa/setup", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setQr(d.qr);
        setSecret(d.secret);
        setMode("setup");
      } else {
        setErr(d.error || "Could not start setup.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/user/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setBackup(d.backupCodes || []);
        setCode("");
        setMode("backup");
        await refresh();
      } else {
        setErr(d.error || "That code didn't match.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/user/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: disableToken.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setShowDisable(false);
        setDisableToken("");
        await refresh();
      } else {
        setErr(d.error || "Could not turn it off.");
      }
    } finally {
      setBusy(false);
    }
  }

  function copyBackup() {
    try {
      navigator.clipboard.writeText(backup.join("\n"));
    } catch {
      // ignore
    }
  }

  return (
    <div className="bg-t-panel p-5 border border-t-line mt-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-t-white">Two-step verification</h3>
          <p className="text-sm text-t-phos-dim mt-0.5">
            {enabled
              ? "On. You'll enter a code from your authenticator app when you sign in."
              : "Add a second step at sign-in with an authenticator app (Google Authenticator, Authy, 1Password)."}
          </p>
        </div>
        <span
          className={`flex-shrink-0 text-[11px] px-2 py-0.5 border ${
            enabled ? "border-t-phos text-t-phos" : "border-t-line text-t-phos-dim"
          }`}
        >
          {enabled ? "On" : "Off"}
        </span>
      </div>

      {err && <p className="text-sm text-t-red mt-3">{err}</p>}

      {/* Off, idle -> offer to turn on */}
      {!enabled && mode === "idle" && (
        <div className="mt-4">
          <TBtn onClick={startSetup} disabled={busy}>
            {busy ? "starting..." : "turn on two-step"}
          </TBtn>
        </div>
      )}

      {/* Setup: scan QR + confirm a code */}
      {!enabled && mode === "setup" && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-t-phos-dim">
            1. Scan this with your authenticator app.
          </p>
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Two-factor QR code" className="border border-t-line bg-white p-2" width={200} height={200} />
          )}
          <p className="text-xs text-t-phos-dim">
            Can&apos;t scan? Enter this key manually:
            <span className="block mt-1 font-mono text-t-white break-all">{secret}</span>
          </p>
          <p className="text-sm text-t-phos-dim">2. Enter the 6-digit code it shows.</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="000000"
              className="px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white tracking-widest focus:border-t-amber focus:outline-none min-h-touch w-40"
            />
            <TBtn onClick={confirmEnable} disabled={busy || code.length < 6}>
              {busy ? "verifying..." : "verify & turn on"}
            </TBtn>
            <button
              type="button"
              onClick={() => { setMode("idle"); setErr(""); }}
              className="text-sm text-t-phos-dim hover:text-t-white px-3"
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {/* Backup codes shown once */}
      {mode === "backup" && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-t-phos">
            Two-step is on. Save these backup codes somewhere safe -- each works once if you
            ever lose your phone. You won&apos;t see them again.
          </p>
          <div className="grid grid-cols-2 gap-2 bg-t-panel-2 border border-t-line p-3 font-mono text-sm text-t-white">
            {backup.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <TBtn onClick={copyBackup}>copy codes</TBtn>
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="text-sm text-t-phos-dim hover:text-t-white px-3"
            >
              I saved them
            </button>
          </div>
        </div>
      )}

      {/* On -> allow turning off (re-auth required) */}
      {enabled && (
        <div className="mt-4">
          {!showDisable ? (
            <button
              type="button"
              onClick={() => { setShowDisable(true); setErr(""); }}
              className="text-sm text-t-phos-dim hover:text-t-amber-bright underline"
            >
              Turn off two-step verification
            </button>
          ) : (
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                value={disableToken}
                onChange={(e) => setDisableToken(e.target.value)}
                placeholder="Current code or a backup code"
                className="px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none min-h-touch flex-1 min-w-[220px]"
              />
              <TBtn onClick={disable} disabled={busy || !disableToken.trim()}>
                {busy ? "..." : "confirm turn off"}
              </TBtn>
              <button
                type="button"
                onClick={() => { setShowDisable(false); setDisableToken(""); setErr(""); }}
                className="text-sm text-t-phos-dim hover:text-t-white px-3"
              >
                cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AccountSection() {
  const { data: session } = useSession();
  const [contact, setContact] = useState<{
    name: string; phone: string; email: string; city: string; state: string;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", phone: "", email: "", city: "", state: "" });

  useEffect(() => {
    fetch("/api/user/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.contact) {
          setContact(data.contact);
          setEditForm(data.contact);
        }
      })
      .catch(() => {});
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        const { contact: updated } = await res.json();
        setContact(updated);
        setEditing(false);
      }
    } catch {} finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-t-white mb-4">Account</h2>
      <div className="bg-t-panel p-5 border border-t-line">
        {/* Auth email */}
        <div className="flex items-center justify-between pb-3 border-b border-t-line mb-3">
          <div>
            <p className="text-xs text-t-phos-dim uppercase">Signed in as</p>
            <p className="text-sm font-medium text-t-white">{session?.user?.email || "—"}</p>
          </div>
          <span className="text-xs text-t-amber-bright border border-t-amber px-2 py-1">
            {(session?.user as any)?.tier || "client"}
          </span>
        </div>

        {/* Resume contact info */}
        {!editing ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-t-phos-dim uppercase">Resume Contact Info</p>
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-t-amber-bright hover:text-t-amber font-medium"
              >
                Edit
              </button>
            </div>
            {contact ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-t-phos-dim">Name:</span> <span className="text-t-white">{contact.name || "—"}</span></div>
                <div><span className="text-t-phos-dim">Phone:</span> <span className="text-t-white">{contact.phone || "—"}</span></div>
                <div><span className="text-t-phos-dim">Email:</span> <span className="text-t-white">{contact.email || "—"}</span></div>
                <div><span className="text-t-phos-dim">Location:</span> <span className="text-t-white">{[contact.city, contact.state].filter(Boolean).join(", ") || "—"}</span></div>
              </div>
            ) : (
              <p className="text-sm text-t-phos-dim">No contact info set. Complete your profile on the dashboard.</p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3">
            <p className="text-xs text-t-phos-dim uppercase mb-1">Edit Resume Contact Info</p>
            <input
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              placeholder="Full name"
              className="w-full px-3 py-2 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors"
            />
            <input
              value={editForm.phone}
              onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
              placeholder="Phone"
              type="tel"
              className="w-full px-3 py-2 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors"
            />
            <input
              value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              placeholder="Resume email"
              type="email"
              className="w-full px-3 py-2 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={editForm.city}
                onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                placeholder="City"
                className="w-full px-3 py-2 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors"
              />
              <input
                value={editForm.state}
                onChange={(e) => setEditForm({ ...editForm, state: e.target.value.toUpperCase() })}
                placeholder="State"
                maxLength={2}
                className="w-full px-3 py-2 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors uppercase"
              />
            </div>
            <div className="flex gap-2 items-center">
              <TBtn type="submit" disabled={saving} size="sm">
                {saving ? "saving..." : "save"}
              </TBtn>
              <button
                type="button"
                onClick={() => { setEditing(false); setEditForm(contact || { name: "", phone: "", email: "", city: "", state: "" }); }}
                className="px-4 py-2 text-sm text-t-phos-dim hover:text-t-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Sign-in methods */}
      <div className="bg-t-panel p-5 border border-t-line mt-4">
        <h3 className="font-semibold text-t-white mb-3">Sign-in Methods</h3>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between py-2 border-b border-t-line">
            <div>
              <p className="font-medium text-t-white">Email & Password</p>
              <p className="text-xs text-t-phos-dim">Sign in with your email and a password you set</p>
            </div>
            <span className="text-xs text-t-amber-bright border border-t-amber px-2 py-1">Active</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-t-line">
            <div>
              <p className="font-medium text-t-white">Magic Link</p>
              <p className="text-xs text-t-phos-dim">One-time sign-in link sent to your email. No password needed.</p>
            </div>
            <span className="text-xs text-t-amber-bright border border-t-amber px-2 py-1">Available</span>
          </div>
          <p className="text-xs text-t-phos-dim leading-relaxed pt-1">
            Lost your device? Use the magic link option on the sign-in page to get back in.
            You can set a new password anytime below.
          </p>
        </div>
      </div>
    </section>
  );
}
