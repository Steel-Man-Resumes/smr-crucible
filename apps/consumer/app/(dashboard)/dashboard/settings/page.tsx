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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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

  function deleteAllData() {
    const keys = [
      "forge_session",
      "consumer_progress",
      "consent_record",
    ];
    for (const key of keys) {
      localStorage.removeItem(key);
    }
    setShowDeleteConfirm(false);
    window.location.href = "/";
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-foreground mb-2">Settings</h1>
      <p className="text-body text-muted mb-8">
        Your data, your control. Manage your information and privacy.
      </p>

      {/* Daily Usage */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-foreground mb-4">
          Daily Usage
        </h2>
        <div className="bg-white rounded-2xl p-5 border border-border">
          {usage ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-foreground">
                  AI calls today
                </span>
                <span className="text-sm text-muted">
                  {usage.limit === null
                    ? `${usage.used} used (unlimited)`
                    : `${usage.used} / ${usage.limit}`}
                </span>
              </div>
              {usage.limit !== null && (
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-sage-600 rounded-full h-2 transition-all"
                    style={{
                      width: `${Math.min(100, (usage.used / usage.limit) * 100)}%`,
                    }}
                  />
                </div>
              )}
              {usage.remaining !== null && usage.remaining <= 5 && usage.remaining > 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  {usage.remaining} AI call{usage.remaining === 1 ? "" : "s"} left today. Resets at midnight.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Loading usage...</p>
          )}
        </div>
      </section>

      {/* Partner Access Code */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-foreground mb-4">
          Partner Access Code
        </h2>
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-border">
            <h3 className="font-semibold text-foreground mb-2">
              Enter a code
            </h3>
            <p className="text-sm text-muted mb-3">
              If you got a code from a partner organization (like a job center or
              nonprofit), enter it here to unlock more AI calls per day.
            </p>
            <form onSubmit={redeemCode} className="flex gap-2">
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="PARTNER123"
                className="flex-1 px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch uppercase"
                disabled={codeStatus === "redeeming"}
              />
              <button
                type="submit"
                disabled={codeStatus === "redeeming" || !codeInput.trim()}
                className="px-5 py-3 bg-sage-600 text-white rounded-xl text-sm font-medium hover:bg-sage-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-touch"
              >
                {codeStatus === "redeeming" ? "..." : "Redeem"}
              </button>
            </form>
            {codeStatus === "success" && (
              <p className="text-sm text-sage-600 mt-2">
                Code redeemed! Your daily limit has been increased.
              </p>
            )}
            {codeStatus === "error" && (
              <p className="text-sm text-red-600 mt-2">{codeError}</p>
            )}
          </div>

          {/* Display active codes */}
          {redeemedCodes.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-border">
              <h3 className="font-semibold text-foreground mb-3">
                Your active codes
              </h3>
              <div className="space-y-2">
                {redeemedCodes.map((code, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 border-b border-border last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {code.partner_name}
                      </p>
                      <p className="text-xs text-muted">
                        {code.tier === "unlimited" || code.tier === "admin"
                          ? "Unlimited calls"
                          : `${code.daily_limit ?? 200} calls/day`}
                      </p>
                    </div>
                    <span className="text-xs text-muted">
                      {new Date(code.redeemed_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Set Password */}
      <SetPasswordSection />

      {/* Privacy & Data */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-foreground mb-4">
          Privacy & Data
        </h2>

        <div className="space-y-4">
          {/* How we handle your data */}
          <div className="bg-white rounded-2xl p-5 border border-border">
            <h3 className="font-semibold text-foreground mb-2">
              How we handle your data
            </h3>
            <ul className="space-y-2 text-sm text-muted">
              <li className="flex gap-2">
                <span className="text-sage-500 flex-shrink-0">•</span>
                Your Forge data is stored locally on your device, not on our
                servers
              </li>
              <li className="flex gap-2">
                <span className="text-sage-500 flex-shrink-0">•</span>
                AI conversations are processed but not permanently stored
              </li>
              <li className="flex gap-2">
                <span className="text-sage-500 flex-shrink-0">•</span>
                We never sell or share your personal information
              </li>
              <li className="flex gap-2">
                <span className="text-sage-500 flex-shrink-0">•</span>
                You can export or delete your data at any time
              </li>
            </ul>
          </div>

          {/* Export data */}
          <div className="bg-white rounded-2xl p-5 border border-border">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">
                  Download your data
                </h3>
                <p className="text-sm text-muted mt-1">
                  Get a copy of everything we have stored about you.
                </p>
              </div>
              <button
                onClick={exportData}
                disabled={exportStatus !== "idle"}
                className="px-4 py-2 border-2 border-sage-300 text-sage-700 rounded-xl text-sm font-medium hover:bg-sage-50 disabled:opacity-50 transition-colors min-h-touch"
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
          <div className="bg-white rounded-2xl p-5 border border-red-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">
                  Delete all your data
                </h3>
                <p className="text-sm text-muted mt-1">
                  Permanently remove all stored data from this device. This
                  cannot be undone.
                </p>
              </div>
              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-2 border-2 border-red-300 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 transition-colors min-h-touch"
                >
                  Delete
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-2 text-sm text-muted hover:text-foreground min-h-touch"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={deleteAllData}
                    className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors min-h-touch"
                  >
                    Confirm Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section>
        <h2 className="text-lg font-bold text-foreground mb-4">About</h2>
        <div className="bg-white rounded-2xl p-5 border border-border">
          <h3 className="font-semibold text-foreground mb-2">
            Steel Man Resumes
          </h3>
          <p className="text-sm text-muted leading-relaxed mb-3">
            Built by people who believe your past doesn&apos;t define your
            paycheck. The Forge and Refinery are tools designed to help you take
            the next step on your own terms.
          </p>
          <p className="text-xs text-muted">
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
      setErrorMsg("Passwords don\u2019t match.");
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
      <h2 className="text-lg font-bold text-foreground mb-4">
        Password
      </h2>
      <div className="bg-white rounded-2xl p-5 border border-border">
        <h3 className="font-semibold text-foreground mb-2">
          Set a password for quick login
        </h3>
        <p className="text-sm text-muted mb-4">
          Optional. Set a password so you can sign in without waiting for a magic link email every time.
        </p>
        <form onSubmit={handleSetPassword} className="space-y-3">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="New password (min 8 characters)"
            autoComplete="new-password"
            className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch"
          />
          {status === "error" && (
            <p className="text-sm text-red-600">{errorMsg}</p>
          )}
          {status === "done" && (
            <p className="text-sm text-sage-600">
              Password set! You can now sign in with email + password.
            </p>
          )}
          <button
            type="submit"
            disabled={status === "saving" || !pw || !confirm}
            className="px-5 py-3 bg-sage-600 text-white rounded-xl text-sm font-medium hover:bg-sage-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-touch"
          >
            {status === "saving" ? "Saving..." : "Set Password"}
          </button>
        </form>
      </div>
    </section>
  );
}
