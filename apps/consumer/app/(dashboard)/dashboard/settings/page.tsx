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

  function exportData() {
    setExportStatus("exporting");
    try {
      const exportPayload: Record<string, any> = {};

      const keys = [
        "forge_session",
        "consumer_progress",
        "consent_record",
      ];
      for (const key of keys) {
        const val = localStorage.getItem(key);
        if (val) {
          try {
            exportPayload[key] = JSON.parse(val);
          } catch {
            exportPayload[key] = val;
          }
        }
      }

      exportPayload.exported_at = new Date().toISOString();
      exportPayload.format_version = "1.0";

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
      setExportStatus("idle");
    }
  }

  const [deleting, setDeleting] = useState(false);

  async function deleteAllData() {
    setDeleting(true);
    try {
      // Delete server-side data first
      const res = await fetch("/api/user/delete-data", { method: "DELETE" });
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

      {/* Set Password */}
      <SetPasswordSection />

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
                Your Forge data is stored locally on your device, not on our
                servers
              </li>
              <li className="flex gap-2">
                <span className="text-t-amber flex-shrink-0">•</span>
                AI conversations are processed but not permanently stored
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

function SetPasswordSection() {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSetPassword(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      setStatus("error");
      return;
    }
    if (pw !== confirm) {
      setErrorMsg("Passwords don’t match.");
      setStatus("error");
      return;
    }

    setStatus("saving");
    setErrorMsg("");

    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });

      if (res.ok) {
        setStatus("done");
        setPw("");
        setConfirm("");
        setTimeout(() => setStatus("idle"), 3000);
      } else {
        const data = await res.json();
        setErrorMsg(data.error || "Could not set password.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Something went wrong. Try again.");
      setStatus("error");
    }
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-t-white mb-4">
        Password
      </h2>
      <div className="bg-t-panel p-5 border border-t-line">
        <h3 className="font-semibold text-t-white mb-2">
          Set a password for quick login
        </h3>
        <p className="text-sm text-t-phos-dim mb-4">
          Optional. Set a password so you can sign in without waiting for a magic link email every time.
        </p>
        <form onSubmit={handleSetPassword} className="space-y-3">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="New password (min 8 characters)"
            autoComplete="new-password"
            className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
          />
          {status === "error" && (
            <p className="text-sm text-t-red">{errorMsg}</p>
          )}
          {status === "done" && (
            <p className="text-sm text-t-amber-bright">
              Password set! You can now sign in with email + password.
            </p>
          )}
          <TBtn type="submit" disabled={status === "saving" || !pw || !confirm}>
            {status === "saving" ? "saving..." : "set password"}
          </TBtn>
        </form>
      </div>
    </section>
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
