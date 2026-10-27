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

import { LeaveOrgButton } from "@/components/settings/LeaveOrgButton";
import { DeleteDataControls } from "@/components/settings/DeleteDataControls";
import { useServerSwitches } from "@/components/ServerSwitches";
import { useState, useEffect, FormEvent } from "react";
import { SettingsLesson } from "@/components/tour/SettingsLesson";
import { SettingsTour, openSettingsTour } from "@/components/tour/SettingsTour";
import { CoachSettingsSection } from "@/components/CoachSettingsSection";
import { SharingConsentSection } from "@/components/SharingConsentSection";
import { ORG_JOINED_EVENT } from "@/lib/join-sharing-prompt";
import { SharingControls } from "@/components/SharingControls";
import { StaffWorkflowSettings } from "@/components/org/StaffWorkflowSettings";
import { OrgSetupGuide } from "@/components/org/OrgSetupGuide";
import { RequirementCard, type RequirementPolicy, type RequirementText } from "@/components/RequirementCard";
import { ConsentPanel } from "@/components/ConsentPanel";
import { AiCostsOwnSection } from "@/components/AiCostsSection";
import { DecisionLogViewer } from "@/components/DecisionLogViewer";
import { LoginHistoryCard } from "@/components/LoginHistoryCard";
import { AccessibilitySettingsSection } from "@/components/AccessibilitySettingsSection";
import { AvatarSettingsSection } from "@/components/AvatarSettingsSection";
import { signIn, signOut, useSession } from "next-auth/react";
import { confirmedSignOut } from "@/lib/confirmed-sign-out";
import { clearAccountBrowserState } from "@/lib/account-browser-state";
import { useRealTier } from "@/lib/useUserTier";
import { TBtn } from "@crucible/consumer-ui";
import { useEffectiveRole } from "@/components/RoleProvider";
import { passwordProblem, PASSWORD_HINT } from "@/lib/password-policy";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { ownForgeRunExportEntry, eraseLocalForgeRun } from "@/lib/forge-carry";
import { PremiumToolsSection } from "@/components/premium/PremiumToolsSection";
import { PackageEmailSetting } from "@/components/PackageEmailSetting";
import { PREMIUM_CHANGED_EVENT } from "@/components/premium/PremiumGate";
import { usageWords, type UsageView } from "@/lib/usage-view";
import { ALL_TICKED, DOCUMENTS_DOWNLOAD_FAILED, EXPORT_BOXES, OWN_DEVICE_LABEL, SHARED_COMPUTER_WARNING, documentsFileName, exportCategories, exportConfirmBody, exportFileName, exportLeavesOut, type ExportTicks } from "@/lib/export-plan";

const STAFF_HIDDEN_EXPORT_BOXES = new Set<string>(["resumes", "applications", "record_check"]);

type UsageData = UsageView | { error: string };

/** Settings -> Usage. The same allowance the tools spend from (lib/usage-view.ts). */
function UsageCard({ usage }: { usage: UsageData | null }) {
  if (!usage) return <p className="text-sm text-t-phos-dim">Loading usage...</p>;
  if ("error" in usage) return <p className="text-sm text-t-phos-dim">{usage.error}</p>;
  const words = usageWords(usage);
  const total = usage.kind === "allowance" ? (usage.base ?? 0) + usage.bonus : 0;
  return (
    <div>
      <p className="text-sm font-medium text-t-white mb-2">{words.headline}</p>
      {usage.kind === "allowance" && total > 0 && (
        <div className="w-full bg-t-line h-2 mb-3" aria-hidden="true">
          <div className="bg-t-amber h-2 transition-all" style={{ width: `${Math.min(100, (Math.min(usage.used, total) / total) * 100)}%` }} />
        </div>
      )}
      <p className="text-sm text-t-phos-dim">{words.line}</p>
      {words.bonusLine && <p className="text-sm text-t-phos-dim mt-1">{words.bonusLine}</p>}
      {usage.blockedReason && <p className="text-sm text-t-amber-bright mt-2">{usage.blockedReason}</p>}
      {usage.ceilings.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-t-white mb-1">{usage.kind === "per-tool" ? "Used today" : "Tools with a lower limit of their own"}</p>
          <ul className="text-xs text-t-phos-dim space-y-0.5">
            {usage.ceilings.map((c) => (
              <li key={c.tool}>{c.label}: {c.paused ? "paused" : `${c.left} left today`}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface RedeemedCode {
  org_id?: string;
  partner_name: string;
  tier: string;
  daily_limit: number | null;
  redeemed_at: string;
}

export default function SettingsPage() {
  // Shared-computer rule: the export includes the local Forge run only when
  // it is marked as this user's (lib/forge-carry.ts).
  const ownerUid = useSession().data?.user?.id;
  const realTier = useRealTier();
  const effectiveRole = useEffectiveRole();
  // Phase 7.4: per-category export. All on = the full dump (the default).
  const [exportCats, setExportCats] = useState<ExportTicks>(ALL_TICKED);
  // Export confirmation belongs to the download controls. Deletion has its
  // own proof field and account-specific requirements beside each action.
  const [ownDevice, setOwnDevice] = useState(false);
  const [docsStatus, setDocsStatus] = useState<"idle" | "working" | "done">("idle");
  const [docsMessage, setDocsMessage] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");

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
  const [codesLoaded, setCodesLoaded] = useState(false);

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
      .catch(() => setUsage({ error: "Your allowance could not be read right now." }));

    fetch("/api/access-code/mine")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("codes"))))
      .then((data) => { setRedeemedCodes(data.codes || []); setCodesLoaded(true); })
      // Unknown membership: show neither the switch nor "no program".
      .catch(() => {});

    loadHiddenEmployers();
  }, []);

  // BEFORE JOINING A PROGRAM THAT REQUIRES SHARING, the person is shown what it
  // requires and why. Joining is still their decision, and acknowledging is a
  // separate step afterwards -- but nobody should learn a program's conditions
  // only after they are inside it.
  const [pendingPolicy, setPendingPolicy] = useState<{ policy: RequirementPolicy & { items: { scope: string; label: string; shows: string; never: string }[] }; text: RequirementText } | null>(null);

  async function redeemCode(e: React.FormEvent, confirmed = false) {
    e.preventDefault();
    if (!codeInput.trim()) return;

    if (!confirmed) {
      const check = await fetch(`/api/access-code/policy?code=${encodeURIComponent(codeInput.trim())}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (check?.policy) { setPendingPolicy(check); return; }
    }
    setPendingPolicy(null);

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
        // Joined: the one-time "share your progress?" question can now be asked.
        window.dispatchEvent(new Event(ORG_JOINED_EVENT));
        // A sponsoring organization opens the premium tools.
        window.dispatchEvent(new Event(PREMIUM_CHANGED_EVENT));
        // Refresh codes and usage
        const [codesRes, usageRes] = await Promise.all([
          fetch("/api/access-code/mine"),
          fetch("/api/usage"),
        ]);
        if (codesRes.ok) {
          const data = await codesRes.json();
          setRedeemedCodes(data.codes || []);
          setCodesLoaded(true);
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
      // Only send the categories the user kept checked. If all are checked,
      // omit the field entirely so the server returns the full dump.
      const categories = exportCategories(exportCats);
      const res = await fetch("/api/user/export-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...exportConfirmBody({ password: reauthPassword, ownDevice }),
          ...(categories ? { categories } : {}),
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
      const localDevice: Record<string, any> = { ...ownForgeRunExportEntry(ownerUid) };
      const keys = ["consumer_progress", "consent_record"];
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
      a.download = exportFileName(new Date());
      a.click();
      URL.revokeObjectURL(url);

      setExportStatus("done");
      setTimeout(() => setExportStatus("idle"), 3000);
    } catch {
      alert("Failed to export data. Please try again.");
      setExportStatus("idle");
    }
  }

  // Every document file at once, as a ZIP (/api/user/export-vault). The JSON
  // above lists the documents; this is the files themselves.
  async function downloadDocuments() {
    setDocsStatus("working");
    setDocsMessage("");
    try {
      const res = await fetch("/api/user/export-vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportConfirmBody({ password: reauthPassword, ownDevice })),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDocsMessage(data.error || DOCUMENTS_DOWNLOAD_FAILED);
        setDocsStatus("idle");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = documentsFileName(new Date());
      a.click();
      URL.revokeObjectURL(url);
      setDocsStatus("done");
      setTimeout(() => setDocsStatus("idle"), 3000);
    } catch {
      setDocsMessage(DOCUMENTS_DOWNLOAD_FAILED);
      setDocsStatus("idle");
    }
  }

  async function finishDeletion() {
    // Then clear all localStorage. This list is the difference between "delete
    // my data" actually returning the app to a clean slate and leaving two keys
    // behind that quietly repopulate the next session: the last job search with
    // its full result list, and the pointer to an approved resume that the
    // generator uses as its tailoring base.
    eraseLocalForgeRun();
    const keys = [
      "consumer_progress",
      "consent_record",
      "hidden_jobs",
      "saved_jobs",
      "forge_preload",
      "refinery_last_job_search",
      "active_baseline_id",
      "forge_audience",
      "view_as",
    ];
    for (const key of keys) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Restricted browser storage must not prevent signing out.
      }
    }
    // Sign out (confirmed by the server when possible) and clear everything
    // this browser held for the account: on a shared computer the next person
    // must inherit nothing, including queues and staff note drafts.
    let confirmed = true;
    try {
      await confirmedSignOut();
    } catch {
      confirmed = false;
    }
    clearAccountBrowserState();
    if (confirmed) window.location.assign("/login");
    else await signOut({ callbackUrl: "/login" });
  }

  // Org staff are not job seekers. Their settings should not describe resumes
  // they do not have, or offer to erase "your plans and history" when what the
  // account actually holds is other people's caseload assignments.
  const isOrgStaff = !!effectiveRole?.orgRole;
  // Staff cannot see the resume, application and record-check boxes, so they
  // stay ticked: a box unticked before the role loaded must not drop data or
  // ask staff to tick a box they cannot see (review 2026-10-27).
  useEffect(() => {
    if (!isOrgStaff) return;
    setExportCats((c) => (Array.from(STAFF_HIDDEN_EXPORT_BOXES).every((k) => c[k as keyof ExportTicks])
      ? c
      : { ...c, ...Object.fromEntries(Array.from(STAFF_HIDDEN_EXPORT_BOXES).map((k) => [k, true])) } as ExportTicks));
  }, [isOrgStaff]);
  // View-as or assist (S10): every Settings route answers as the person, and
  // the private sections (security, photo, export, delete) refuse outright.
  const impersonating = effectiveRole?.impersonating ?? null;

  // STAFF GET THEIR OWN SETTINGS, not a job seeker's. A case manager was being
  // asked whether to "share your progress with your support partner", offered
  // a coach personality, a partner-code box and a list of employers to hide.
  // None of that is theirs. What IS theirs is how their caseload is arranged.
  const SECTIONS: { id: string; label: string }[] = isOrgStaff
    ? [
        { id: "workflow", label: "My workflow" },
        { id: "account", label: "Account" },
        { id: "accessibility", label: "Accessibility" },
        { id: "privacy", label: "AI transparency" },
        { id: "security", label: "Security" },
        { id: "data", label: "Data" },
        { id: "usage", label: "Usage" },
        { id: "help", label: "Help & About" },
      ]
    : [
        { id: "account", label: "Account" },
        { id: "coach", label: "Coach & AI" },
        { id: "accessibility", label: "Accessibility" },
        { id: "privacy", label: "Privacy & Consent" },
        { id: "security", label: "Security" },
        { id: "data", label: "Data" },
        { id: "usage", label: "Usage" },
        { id: "help", label: "Help & About" },
      ];

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h1 className="text-2xl font-bold text-t-white">Settings</h1>
        {/* The Settings tour (SETTINGS-TOUR.md): a quiet way in for people who skipped the chip. Never for staff or under view-as or assist. */}
        {!isOrgStaff && !impersonating && (
          <button type="button" onClick={openSettingsTour} data-tour-open="settings"
            className="t-focus flex-shrink-0 text-xs text-t-phos-dim underline hover:text-t-amber-bright py-1">
            Show me around
          </button>
        )}
      </div>
      <p className="text-base text-t-phos-dim mb-4">
        {isOrgStaff
          ? "How you work here, and your account."
          : "Your data, your control. Manage your information and privacy."}
      </p>

      {impersonating && (
        <div id="settings-impersonating" role="status" className="mb-6 border border-t-amber bg-t-panel p-4 text-sm text-t-white">
          <p className="font-semibold mb-1">
            {impersonating.mode === "view" ? "You are viewing this person's Settings. Nothing here can be changed." : "You are assisting this person in Settings."}
          </p>
          <p className="text-t-phos-dim">
            These are their settings, not yours. Sharing and consent switches, program codes and the tours stay theirs to change. Security, photo, export and delete are hidden.
          </p>
        </div>
      )}

      {!isOrgStaff && !impersonating && <SettingsTour />}
      {!isOrgStaff && !impersonating && <SettingsLesson />}

      {/* Jump nav -- keeps this long page navigable. Sticks under the top bar. */}
      <nav
        id="refinery-tool-settings-map"
        aria-label="Settings sections"
        className="sticky top-[72px] z-10 -mx-1 mb-8 flex flex-wrap gap-1 border-b border-t-line bg-t-bg/95 py-2 backdrop-blur"
      >
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="t-focus rounded-[4px] px-3 py-1.5 text-xs font-medium text-t-phos-dim transition-colors hover:bg-t-panel-2 hover:text-t-amber-bright"
          >
            {s.label}
          </a>
        ))}
      </nav>

      {isOrgStaff && (
        <div id="workflow" className="scroll-mt-32 mb-10">
          {(effectiveRole?.capabilities ?? []).includes("org.staff.manage") && effectiveRole?.crmV2 && (
            <>
              <GroupHeading>Organization</GroupHeading>
              <OrgSetupGuide />
            </>
          )}
          <GroupHeading>My workflow</GroupHeading>
          <StaffWorkflowSettings workspace={!!effectiveRole?.crmV2} />
        </div>
      )}

      {/* ── 1. Account ─────────────────────────────────────────────── */}
      <div id="account" className="scroll-mt-32 mb-10">
        <GroupHeading>Account</GroupHeading>
        <AccountSection />
        {!impersonating && <AvatarSettingsSection />}
        {pendingPolicy && (
          <div role="dialog" aria-label="What this program requires" className="mb-4">
            <RequirementCard policy={pendingPolicy.policy} text={pendingPolicy.text} items={pendingPolicy.policy.items} compact />
            <p className="text-sm text-t-phos-dim mb-3">
              Joining does not open anything by itself. After you join you will be asked to acknowledge this, and you can read it again first.
            </p>
            <div className="flex gap-3 mb-6">
              <button onClick={(e) => redeemCode(e, true)} className="t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2">Join {pendingPolicy.policy.orgName}</button>
              <button onClick={() => setPendingPolicy(null)} className="t-focus border border-t-line text-sm text-t-phos px-4 py-2">Not now</button>
            </div>
          </div>
        )}
        {!isOrgStaff && <AccountExtras
          codeInput={codeInput}
          setCodeInput={setCodeInput}
          redeemCode={redeemCode}
          codeStatus={codeStatus}
          codeError={codeError}
          redeemedCodes={redeemedCodes}
          hiddenEmployers={hiddenEmployers}
          addHiddenEmployer={addHiddenEmployer}
          hideInput={hideInput}
          setHideInput={setHideInput}
          hideReasonInput={hideReasonInput}
          setHideReasonInput={setHideReasonInput}
          hideBusy={hideBusy}
          unhideEmployer={unhideEmployer}
        />}
        {!isOrgStaff && <PremiumToolsSection />}
        {!isOrgStaff && <PackageEmailSetting />}
      </div>

      {/* ── 2. Coach & AI ──────────────────────────────────────────── */}
      {!isOrgStaff && (
      <div id="coach" className="scroll-mt-32 mb-10">
        <GroupHeading>Coach &amp; AI</GroupHeading>
        <CoachSettingsSection />
      </div>
      )}

      {/* ── 3. Accessibility ───────────────────────────────────────── */}
      <div id="accessibility" className="scroll-mt-32 mb-10">
        <GroupHeading>Accessibility</GroupHeading>
        <h2 className="text-lg font-bold text-t-white mb-1">Make it easier to use</h2>
        <p className="text-sm text-t-phos-dim mb-4">
          Bigger text, less motion, and reading help. Changes take effect right away.
        </p>
        <AccessibilitySettingsSection />
      </div>

      {/* ── 4. Privacy & Consent ───────────────────────────────────── */}
      <div id="privacy" className="scroll-mt-32 mb-10">
        <GroupHeading>{isOrgStaff ? "AI transparency" : "Privacy & Consent"}</GroupHeading>
        {/* The progress switch reaches a program, so it shows only to a member (S7). */}
        {!isOrgStaff && codesLoaded && (redeemedCodes.length > 0
          ? <SharingConsentSection />
          : <p id="settings-share-progress" className="text-sm text-t-phos-dim mb-8">No program is linked to your account, so no program can see your progress.</p>)}
        {!isOrgStaff && <SharingControls />}
        {!isOrgStaff && <ConsentPanel />}
        {/* AI transparency: t.ROY's recorded reasoning */}
        <DecisionLogViewer />
      </div>

      {/* ── 5. Security ────────────────────────────────────────────── */}
      <div id="security" className="scroll-mt-32 mb-10">
        <GroupHeading>Security</GroupHeading>
        {impersonating ? <p className="text-sm text-t-phos-dim">Hidden while you view or assist as this person.</p> : <SecuritySection />}
      </div>

      {/* ── 6. Data ────────────────────────────────────────────────── */}
      <div id="data" className="scroll-mt-32 mb-10">
        <GroupHeading>Data</GroupHeading>
        {impersonating ? <p className="text-sm text-t-phos-dim">Hidden while you view or assist as this person.</p> : <DataSection
          exportCats={exportCats}
          setExportCats={setExportCats}
          reauthPassword={reauthPassword}
          setReauthPassword={setReauthPassword}
          exportData={exportData}
          exportStatus={exportStatus}
          ownDevice={ownDevice}
          setOwnDevice={setOwnDevice}
          downloadDocuments={downloadDocuments}
          docsStatus={docsStatus}
          docsMessage={docsMessage}
          onDeleted={finishDeletion}
        />}
      </div>

      {/* ── 7. Usage ───────────────────────────────────────────────── */}
      <div id="usage" className="scroll-mt-32 mb-10">
        <GroupHeading>Usage</GroupHeading>

        {/* Daily Usage: the allowance the tools spend from (S5) */}
        <section className="mb-8" id="settings-usage-today">
          <h2 className="text-lg font-bold text-t-white mb-4">
            Daily Usage
          </h2>
          <div className="bg-t-panel p-5 border border-t-line">
            <UsageCard usage={usage} />
          </div>
        </section>

        {/* AI usage/cost -- quiet by design */}
        <AiCostsOwnSection />
      </div>

      {/* ── 8. Help & About ────────────────────────────────────────── */}
      <div id="help" className="scroll-mt-32 mb-10">
        <GroupHeading>Help &amp; About</GroupHeading>

        {/* Get help */}
        <section className="mb-8">
          <h2 className="text-lg font-bold text-t-white mb-4">Get help</h2>
          <div className="bg-t-panel p-5 border border-t-line space-y-3">
            <p className="text-sm text-t-phos-dim">
              Stuck on something? Ask t.ROY on any page, or open Help &amp;
              Feedback to search for an answer, report a problem, or message
              Troy. A real person reads every message.
            </p>
            <a
              href="/dashboard/help"
              className="t-focus inline-flex items-center px-4 py-2 border border-t-amber text-t-amber-bright text-sm font-medium hover:bg-t-amber/10 transition-colors min-h-touch"
            >
              Open Help &amp; Feedback
            </a>
            <p className="text-xs text-t-phos-dim pt-1">
              Want to know exactly how we protect your data?{" "}
              <a href="/dashboard/security" className="text-t-amber-bright hover:text-t-amber underline">
                Read our trust page
              </a>
              .
            </p>
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
              {isOrgStaff
                ? "Built by people who believe a past doesn't define a paycheck. You use it to support the people you work with; they use it to take the next step on their own terms."
                : "Built by people who believe your past doesn't define your paycheck. The Forge and Refinery are tools designed to help you take the next step on your own terms."}
            </p>
            <p className="text-xs text-t-phos-dim">
              All AI-powered features are designed with transparency, consent, and
              your dignity in mind.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide text-t-amber-bright mb-4 pb-2 border-b border-t-line">
      {children}
    </h2>
  );
}

type ExportCats = ExportTicks;

function DataSection({
  exportCats,
  setExportCats,
  reauthPassword,
  setReauthPassword,
  exportData,
  exportStatus,
  ownDevice,
  setOwnDevice,
  downloadDocuments,
  docsStatus,
  docsMessage,
  onDeleted,
}: {
  exportCats: ExportCats;
  setExportCats: React.Dispatch<React.SetStateAction<ExportCats>>;
  reauthPassword: string;
  setReauthPassword: (v: string) => void;
  exportData: () => void;
  exportStatus: "idle" | "exporting" | "done";
  ownDevice: boolean;
  setOwnDevice: (v: boolean) => void;
  downloadDocuments: () => void;
  docsStatus: "idle" | "working" | "done";
  docsMessage: string;
  onDeleted: () => Promise<void>;
}) {
  // Read the role here rather than threading a prop through several layers.
  const dataSectionRole = useEffectiveRole();
  const isOrgStaff = !!dataSectionRole?.orgRole;
  const accountId = useSession().data?.user?.id;
  // The record check line shows only while that step is on (settings/layout.tsx).
  const { recordStep } = useServerSwitches();
  // Staff seats build no resumes, applications or record checks; those boxes
  // stay ticked (a full copy still carries anything there) but are not shown.
  const EXPORT_CATS = isOrgStaff ? EXPORT_BOXES.filter((b) => !STAFF_HIDDEN_EXPORT_BOXES.has(b.key)) : EXPORT_BOXES;
  const anyChecked = Object.values(exportCats).some(Boolean);
  const leftOut = exportLeavesOut(exportCats);

  return (
    <section className="mb-8">
      <div className="space-y-4">
        {/* How we handle your data */}
        <div className="bg-t-panel p-5 border border-t-line">
          <h3 className="font-semibold text-t-white mb-2">
            How we handle your data
          </h3>
          <ul className="space-y-2 text-sm text-t-phos-dim">
            <li className="flex gap-2">
              <span className="text-t-amber flex-shrink-0">&bull;</span>
              {isOrgStaff
                ? "Your settings, saved views and drafts are saved to your account so your work is here when you come back"
                : "Your Forge answers and results are saved to your account so your work is here when you come back"}
            </li>
            <li className="flex gap-2">
              <span className="text-t-amber flex-shrink-0">&bull;</span>
              Conversations with t.ROY are saved to your account so he can
              remember your recent work. Deleting your data clears them.
            </li>
            {recordStep && (
            <li className="flex gap-2">
              <span className="text-t-amber flex-shrink-0">&bull;</span>
              In the record check, what you type about your record goes to
              the AI only after you say yes on that screen. A saved checklist
              keeps the list and the state. What you typed is kept only if
              you tick the box for it. Taking back your yes deletes your
              saved checklists.
            </li>
            )}
            <li className="flex gap-2">
              <span className="text-t-amber flex-shrink-0">&bull;</span>
              We never sell your personal information. It goes only to the
              services that run the app, and to a program when you choose to
              share with it
            </li>
            <li className="flex gap-2">
              <span className="text-t-amber flex-shrink-0">&bull;</span>
              You can export or delete your data at any time
            </li>
          </ul>
        </div>

        {/* Export data -- per category, then the document files */}
        <div className="bg-t-panel p-5 border border-t-line" id="settings-export">
          <h3 className="font-semibold text-t-white">
            Download your data
          </h3>
          <p className="text-sm text-t-phos-dim mt-1 mb-3">
            Get a copy of what we have stored, as one file. Keep every box
            ticked for a full copy. Your document files come separately, with
            the button further down.
          </p>
          <div className="mb-4 space-y-2">
            <label htmlFor="export-password" className="block text-sm text-t-white">Password for downloads</label>
            <p id="export-password-help" className="text-sm text-t-phos-dim">If your account has a password, enter it here. If it has no password, leave this blank. Confirm the device below before downloading.</p>
            <PasswordInput id="export-password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} autoComplete="current-password" aria-describedby="export-password-help" className="w-full min-h-touch border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white" />
          </div>
          <div className="space-y-2 mb-4">
            {EXPORT_CATS.map((c) => (
              <label key={c.key} className="flex items-center gap-3 text-sm text-t-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportCats[c.key]}
                  onChange={(e) =>
                    setExportCats((prev) => ({ ...prev, [c.key]: e.target.checked }))
                  }
                  className="h-4 w-4 accent-t-amber"
                />
                {c.label}
              </label>
            ))}
          </div>
          {leftOut.length > 0 && (
            <p className="text-sm text-t-amber-bright mb-4" data-testid="export-leaves-out">
              This copy leaves out {leftOut.join(", ")}. Tick every box for a full copy.
            </p>
          )}
          <div className="border border-t-amber bg-t-panel-2 p-3 mb-4" role="note">
            <p className="text-sm text-t-white">{SHARED_COMPUTER_WARNING}</p>
            <label className="mt-2 flex items-center gap-3 text-sm text-t-white cursor-pointer">
              <input
                type="checkbox"
                checked={ownDevice}
                onChange={(e) => setOwnDevice(e.target.checked)}
                className="h-4 w-4 accent-t-amber"
              />
              {OWN_DEVICE_LABEL}
            </label>
          </div>
          <button
            onClick={exportData}
            disabled={exportStatus !== "idle" || !anyChecked || !ownDevice}
            className="t-focus px-4 py-2 border border-t-amber text-t-amber-bright text-sm font-medium hover:bg-t-amber/10 disabled:opacity-50 transition-colors min-h-touch"
          >
            {exportStatus === "exporting"
              ? "Preparing..."
              : exportStatus === "done"
                ? "Downloaded"
                : "Export"}
          </button>
          <div className="mt-5 border-t border-t-line pt-4">
            <h4 className="text-sm font-semibold text-t-white">Your document files</h4>
            <p className="text-sm text-t-phos-dim mt-1 mb-3">
              Every file in Private records and documents, in one ZIP, up to about
              4 MB at a time. If you have more than that, download them one at a
              time from that page.
            </p>
            <button
              onClick={downloadDocuments}
              disabled={docsStatus !== "idle" || !ownDevice}
              className="t-focus px-4 py-2 border border-t-amber text-t-amber-bright text-sm font-medium hover:bg-t-amber/10 disabled:opacity-50 transition-colors min-h-touch"
            >
              {docsStatus === "working" ? "Preparing..." : docsStatus === "done" ? "Downloaded" : "Download my documents"}
            </button>
            {docsMessage && <p role="alert" className="text-sm text-t-amber-bright mt-2">{docsMessage}</p>}
          </div>
        </div>

        <DeleteDataControls key={accountId || "signed-out"} isOrgStaff={isOrgStaff} onDeleted={onDeleted} />
      </div>
    </section>
  );
}

// Partner Access Code + Hidden Employers live under Account (kept intact).
function AccountExtras({
  codeInput,
  setCodeInput,
  redeemCode,
  codeStatus,
  codeError,
  redeemedCodes,
  hiddenEmployers,
  addHiddenEmployer,
  hideInput,
  setHideInput,
  hideReasonInput,
  setHideReasonInput,
  hideBusy,
  unhideEmployer,
}: {
  codeInput: string;
  setCodeInput: (v: string) => void;
  redeemCode: (e: React.FormEvent) => void;
  codeStatus: "idle" | "redeeming" | "success" | "error";
  codeError: string;
  redeemedCodes: RedeemedCode[];
  hiddenEmployers: { id: string; display_name: string; reason: string | null }[];
  addHiddenEmployer: (e: FormEvent) => void;
  hideInput: string;
  setHideInput: (v: string) => void;
  hideReasonInput: string;
  setHideReasonInput: (v: string) => void;
  hideBusy: boolean;
  unhideEmployer: (id: string) => void;
}) {
  return (
    <>
      {/* Program code: joins a program's seat (S6). It promises no extra AI calls and shares nothing on its own. */}
      <section className="mb-8 mt-8" id="settings-program-code">
        <h2 className="text-lg font-bold text-t-white mb-4">
          Join a program with a code
        </h2>
        <div className="space-y-4">
          <div className="bg-t-panel p-5 border border-t-line">
            <h3 className="font-semibold text-t-white mb-2">
              Enter a code
            </h3>
            <p className="text-sm text-t-phos-dim mb-3">
              If a program (like a job center or nonprofit) gave you a code, enter it
              here. The code joins you to a program&apos;s seat. If the program has
              rules about sharing, you see them before you join, and joining shares
              nothing by itself. If the code changes your AI allowance, Usage below
              shows the new number.
            </p>
            <form onSubmit={redeemCode} className="flex gap-2">
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="Your code"
                aria-label="Program code"
                className="flex-1 px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch uppercase"
                disabled={codeStatus === "redeeming"}
              />
              <TBtn type="submit" disabled={codeStatus === "redeeming" || !codeInput.trim()}>
                {codeStatus === "redeeming" ? "..." : "join"}
              </TBtn>
            </form>
            {codeStatus === "success" && (
              <p className="text-sm text-t-amber-bright mt-2">
                You joined. Your program is listed below.
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
                Your programs
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
                      <p className="text-xs text-t-phos-dim">Joined with a code</p>
                    </div>
                    <div className="text-right">
                      <span className="block text-xs text-t-phos-dim">
                        {new Date(code.redeemed_at).toLocaleDateString()}
                      </span>
                      {code.org_id && <LeaveOrgButton orgId={code.org_id} orgName={code.partner_name} />}
                    </div>
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

    </>
  );
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(pw);
    if (problem) {
      setErrorMsg(problem);
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
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-t-white mb-1">Security</h2>
      <p className="text-sm text-t-phos-dim mb-4">
        Manage your password, two-step verification and signed-in devices.
      </p>

      <div className="bg-t-panel p-5 border border-t-line" id="settings-password">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h3 className="font-semibold text-t-white">
              {creating ? "Create a password" : "Password"}
            </h3>
            <p className="text-sm text-t-phos-dim mt-0.5">
              {creating
                ? "Set a password so you can sign in instantly without waiting for an email link."
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
            <PasswordInput
              id="settings-current-password"
              aria-label="Current password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
              className={`w-full px-4 py-3 border text-sm bg-t-panel-2 text-t-white focus:outline-none transition-colors min-h-touch ${
                needsCurrent ? "border-t-red focus:border-t-red" : "border-t-line focus:border-t-amber"
              }`}
            />
          )}
          <PasswordInput
            id="settings-new-password"
            aria-label="New password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={creating ? "New password (10+ characters)" : "New password"}
            autoComplete="new-password"
            className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
          />

          <p className="text-xs text-t-phos-dim">
            {PASSWORD_HINT}. Use a password you don&apos;t use on another site. A password manager can make and remember one for you.
          </p>

          <PasswordInput
            id="settings-confirm-password"
            aria-label="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
          />

          {status === "error" && <p className="text-sm text-t-red">{errorMsg}</p>}
          {status === "done" && (
            <p className="text-sm text-t-phos">
              {creating ? "Password created." : "Password updated."}
            </p>
          )}

          <TBtn type="submit" disabled={status === "saving" || !pw || !confirm || (hasPassword === true && !current)}>
            {status === "saving" ? "saving..." : creating ? "create password" : "update password"}
          </TBtn>
        </form>
      </div>

      <TwoFactorCard enabled={twoFactorEnabled} refresh={refresh} />

      <ActiveDevicesCard />

      <LoginHistoryCard />
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
    <div className="bg-t-panel p-5 border border-t-line mt-3" id="settings-devices">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold text-t-white">Active devices</h3>
          <p className="text-sm text-t-phos-dim mt-0.5">
            Where you&apos;re signed in. Revoke anything you don&apos;t recognize. It gets
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
                  {s.location ? `${s.location} · ` : ""}last active {fmtWhen(s.lastSeenAt)}
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
  const { data: sessionData, update: updateSession } = useSession();
  // S1: two-step needs a confirmed email; the server says so with a 409.
  const [needsEmailProof, setNeedsEmailProof] = useState(false);
  const [proofLink, setProofLink] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const accountEmail = sessionData?.user?.email || "";

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
      } else if (r.status === 409 && d.needsEmailProof) {
        setNeedsEmailProof(true);
      } else {
        setErr(d.error || "Could not start setup.");
      }
    } finally {
      setBusy(false);
    }
  }

  // An email-link sign-in to the account's own address is the proof.
  async function sendProofLink() {
    if (!accountEmail) return;
    setProofLink("sending");
    try {
      const res = await signIn("resend", {
        email: accountEmail,
        redirect: false,
        callbackUrl: "/dashboard/settings",
      });
      setProofLink(res?.error ? "failed" : "sent");
    } catch {
      setProofLink("failed");
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
        // The server recorded that this session entered a code; refresh the
        // session so it carries that (unlocks admin tools without a re-login).
        await updateSession().catch(() => {});
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
    <div className="bg-t-panel p-5 border border-t-line mt-3" id="settings-two-step">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-t-white">Two-step verification</h3>
          <p className="text-sm text-t-phos-dim mt-0.5">
            {enabled
              ? "On. You'll enter a code from your authenticator app every time you sign in, whether you use a password, an email link, or Google."
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
      {!enabled && mode === "idle" && !needsEmailProof && (
        <div className="mt-4">
          <TBtn onClick={startSetup} disabled={busy}>
            {busy ? "starting..." : "turn on two-step"}
          </TBtn>
        </div>
      )}

      {/* S1: email not confirmed yet -> send a sign-in link to the account's own address */}
      {!enabled && needsEmailProof && (
        <div className="mt-4 space-y-3 border border-t-line p-4">
          <p className="font-semibold text-t-white">Confirm your email first</p>
          <p className="text-sm text-t-phos-dim">
            Two-step verification needs a confirmed email address. We&apos;ll send a sign-in
            link to {accountEmail || "your email address"}. Open it, and then you can turn on
            two-step here.
          </p>
          {proofLink === "sent" ? (
            <p className="text-sm text-t-phos">Check your email for the link.</p>
          ) : (
            <TBtn onClick={sendProofLink} disabled={proofLink === "sending" || !accountEmail}>
              {proofLink === "sending" ? "sending..." : "Email me a link"}
            </TBtn>
          )}
          {proofLink === "failed" && (
            <p className="text-sm text-t-red">We couldn&apos;t send the link. Try again in a few minutes.</p>
          )}
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
            Two-step is on. Save these backup codes somewhere safe. Each one works once if you
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
  const accountRole = useEffectiveRole();
  const contactHeading = accountRole?.orgRole ? "Your contact info" : "Resume Contact Info";
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
            <p className="text-sm font-medium text-t-white">{session?.user?.email || "Unknown"}</p>
          </div>
          <span className="text-xs text-t-amber-bright border border-t-amber px-2 py-1">
            {(session?.user as any)?.tier || "client"}
          </span>
        </div>

        {/* Resume contact info */}
        {!editing ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-t-phos-dim uppercase">{contactHeading}</p>
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-t-amber-bright hover:text-t-amber font-medium"
              >
                Edit
              </button>
            </div>
            {contact ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-t-phos-dim">Name:</span> <span className="text-t-white">{contact.name || "Not set"}</span></div>
                <div><span className="text-t-phos-dim">Phone:</span> <span className="text-t-white">{contact.phone || "Not set"}</span></div>
                <div><span className="text-t-phos-dim">Email:</span> <span className="text-t-white">{contact.email || "Not set"}</span></div>
                <div><span className="text-t-phos-dim">Location:</span> <span className="text-t-white">{[contact.city, contact.state].filter(Boolean).join(", ") || "Not set"}</span></div>
              </div>
            ) : (
              <p className="text-sm text-t-phos-dim">{accountRole?.orgRole ? "No contact info set yet. Use Edit to add it." : "No contact info set. Complete your profile on the dashboard."}</p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3">
            <p className="text-xs text-t-phos-dim uppercase mb-1">Edit {contactHeading}</p>
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
              placeholder={accountRole?.orgRole ? "Email" : "Resume email"}
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
