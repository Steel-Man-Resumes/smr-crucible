"use client";

import type { ReactNode } from "react";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PolicyAckBanner } from "@/components/PolicyAckBanner";
import { JoinSharingPrompt } from "@/components/JoinSharingPrompt";
import { ORG_JOINED_EVENT } from "@/lib/join-sharing-prompt";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { confirmedSignOut } from "@/lib/confirmed-sign-out";
import { AssistantDrawer } from "@crucible/consumer-ui";
import { AssistantChat } from "@/components/AssistantChat";
import { UiPrefsApplier } from "@/components/UiPrefsApplier";
import { NavAvatar } from "@/components/NavAvatar";
import { AdminTestModeBanner } from "@/components/AdminTestModeBanner";
import { GuidedTour } from "@/components/GuidedTour";
import { TourPageFrame } from "@/components/tour/TourPageFrame";
import { DevSwitcher } from "@/components/DevSwitcher";
import { ImpersonationChrome } from "@/components/ImpersonationChrome";
import { HighlightHost } from "@/components/SpotlightHighlight";
import { RefineryLaneHeader } from "@/components/lanes/LaneHeader";
import { useLaneFocus } from "@/components/lanes/useLaneFocus";
import { refineryOpenWithoutResume, forgeStartUrl } from "@/lib/lane-task";
import {
  useUserTier,
  useRealTier,
  canSwitchView,
  getViewAs,
  setViewAs,
  type UserTier,
} from "@/lib/useUserTier";
import { useEffectiveRole } from "@/components/RoleProvider";
import {
  FORGE_LAST_SYNCED_RUN_KEY,
  eraseLocalForgeRun,
  forgeRunFingerprint,
  forgeSyncDecision,
  readLocalForgeRunRaw,
} from "@/lib/forge-carry";
import { useOnboarding, type OnboardingState } from "@/lib/useOnboarding";
import {
  DERIVED_KEYS,
  DERIVED_OWNER_KEY,
  forgeQuestionHoldsBounce,
  forgeQuestionOpen,
  forgeSyncAllowed,
  settleDerivedKeys,
  applyForgeClearMark,
  IMPERSONATION_SEEN_KEY,
} from "@/lib/refinery-guards";
import { useUserContext } from "@/lib/use-user-context";
// Deep, runtime-pure import: the one shared gate-state ordering (no db/pg in the
// client bundle -- see @crucible/core/src/gateRank).
import { previewIdForHref } from "@/lib/featurePreviews";
import { clientToolUnlocked, lockedToolLine } from "@crucible/core/src/journeyStages";
import { CoBrandLockup, ProductFamilyBrand, ProductBrand } from "@/components/brand/BrandMarks";
import { ExternalLink, LockKeyhole, CheckCircle2, LogOut, Menu, X } from "lucide-react";
import { ProgressionProvider, useProgression } from "@/components/progression/ProgressionProvider";
import { stepForNav, navKeepsDirectAccess, progressStateLabel } from "@/lib/progression-ui";

/**
 * Dashboard Layout -- Authenticated area
 *
 * Desktop: sticky top bar + left sidebar with grouped tool nav.
 * Mobile: sticky top bar + hamburger → slide-in drawer.
 * Locked tools shown greyed (unlockable through normal progression).
 * Admin/partner-only tools hidden for tiers that can never reach them.
 */

interface NavItem {
  href: string;
  label: string;
  minTier: UserTier;
  minState: OnboardingState;
  requiresDisclosure?: boolean;
  targetId?: string;
  children?: NavItem[];
}

interface NavGroup {
  label?: string;
  items: NavItem[];
  collapsible?: boolean;
}

const TIER_RANK: Record<string, number> = {
  admin: 0,
  unlimited: 1,
  partner: 1,
  client: 2,
  default: 2,
  observer: 3,
};

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/dashboard", label: "Overview", targetId: "refinery-nav-overview", minTier: "observer", minState: "needs_profile", children: [
        { href: "/dashboard/progress", label: "Progress", minTier: "observer", minState: "needs_profile" },
      ] },
      { href: "/dashboard/jobs", label: "Find work", targetId: "refinery-nav-jobs", minTier: "client", minState: "needs_profile", children: [
        { href: "/dashboard/jobs", label: "Jobs", minTier: "client", minState: "needs_profile" },
        { href: "/dashboard/paths", label: "Explore paths", minTier: "client", minState: "needs_profile" },
        { href: "/dashboard/employers", label: "Employers", minTier: "client", minState: "needs_profile" },
      ] },
      { href: "/dashboard/vault", label: "My resumes", targetId: "refinery-nav-resumes", minTier: "client", minState: "needs_profile", children: [
        { href: "/dashboard/master", label: "Master Draft", minTier: "client", minState: "needs_profile" },
        { href: "/dashboard/vault", label: "Resumes & versions", minTier: "client", minState: "needs_profile" },
        { href: "/dashboard/application-tailor", label: "Tailor for a job", minTier: "client", minState: "needs_resume" },
        { href: "/dashboard/creative", label: "Creative work", minTier: "client", minState: "needs_profile" },
        { href: "/dashboard/cv", label: "CV", minTier: "client", minState: "needs_profile" },
        { href: "/dashboard/performer", label: "Performer page", minTier: "client", minState: "needs_profile" },
      ] },
      { href: "/dashboard/applications", label: "Applications", targetId: "refinery-nav-applications", minTier: "client", minState: "needs_profile" },
      { href: "/dashboard/interview", label: "Interview prep", targetId: "refinery-nav-interview", minTier: "client", minState: "needs_profile" },
      { href: "/dashboard/resources", label: "Support & disclosure", targetId: "refinery-nav-support", minTier: "client", minState: "needs_profile", children: [
        { href: "/dashboard/resources", label: "Local help", minTier: "client", minState: "needs_profile" },
        { href: "/dashboard/disclosure", label: "Disclosure plan", minTier: "client", minState: "needs_profile" },
        { href: "/dashboard/documents", label: "Private records & documents", minTier: "client", minState: "needs_profile" },
      ] },
    ],
  },
  {
    label: "My information",
    collapsible: true,
    items: [
      { href: "/dashboard/settings#account", label: "Profile & contact details", minTier: "observer", minState: "needs_profile" },
      { href: "/dashboard/documents", label: "Private documents", minTier: "client", minState: "needs_profile" },
      { href: "/dashboard/settings#privacy", label: "Sharing & privacy", minTier: "observer", minState: "needs_profile" },
      { href: "/dashboard/settings#data", label: "Export or delete my data", minTier: "observer", minState: "needs_profile" },
    ],
  },
  {
    label: "Program",
    items: [
      { href: "/dashboard/partner", label: "Partner Dashboard", minTier: "partner", minState: "needs_profile" },
    ],
  },
  {
    items: [
      { href: "/dashboard/help", label: "Help & tour", minTier: "observer", minState: "needs_profile" },
      { href: "/dashboard/help?mode=idea", label: "Share an idea", minTier: "observer", minState: "needs_profile" },
      { href: "/dashboard/settings", label: "Settings", targetId: "refinery-nav-settings", minTier: "observer", minState: "needs_profile" },
      { href: "/dashboard/admin", label: "Admin", minTier: "admin", minState: "needs_profile" },
      { href: "/dashboard/admin/access-requests", label: "Access requests", minTier: "admin", minState: "needs_profile" },
    ],
  },
];

function navContains(item: NavItem, pathname: string): boolean {
  return pathname === item.href || !!item.children?.some((child) => pathname === child.href);
}

// Org-oversight nav (org-oversight wave, 2026-08-07): an org admin/staff runs
// the organization -- the participant toolset (Job Board, Tailor, etc.) is NOT
// their nav; it lives behind the "Client view" toggle. These items lead the
// sidebar for org leaders instead of NAV_GROUPS.
interface OrgNavItem {
  href: string;
  label: string;
}
const ORG_ADMIN_NAV: OrgNavItem[] = [
  { href: "/dashboard", label: "Organization overview" },
  { href: "/dashboard#team", label: "Team & seats" },
  { href: "/dashboard#add", label: "Add participants" },
  // The person who has to answer for this internally should not have to ask
  // us for it, or find it in a PDF attached to an email six months ago.
  { href: "/dashboard/org-security", label: "Security & privacy" },
];
// The staff workspace (crm_v2 orgs). Grouped by the job, and every item is a
// real page: the earlier list was three entries, two of them jump-links into
// one long screen, which is why it read as thin. `admin` items need the
// organization-wide view.
interface OrgNavGroup {
  label: string;
  /** `needs`: shown only to people who hold that capability -- the nav mirrors
   *  the authorization model rather than guessing from a role name. */
  items: (OrgNavItem & { needs?: string })[];
}
const ORG_WORKSPACE_NAV: OrgNavGroup[] = [
  {
    label: "Work",
    items: [
      { href: "/dashboard/today", label: "Today" },
      { href: "/dashboard", label: "Caseload" },
      { href: "/dashboard/requests", label: "Sharing requests" },
    ],
  },
  { label: "Records", items: [{ href: "/dashboard/notes", label: "Case notes" }] },
  {
    label: "Organization",
    items: [
      { href: "/dashboard/insights", label: "Insights", needs: "org.insights.view" },
      { href: "/dashboard/team", label: "Team & access", needs: "org.staff.manage" },
      { href: "/dashboard/participants", label: "Add participants", needs: "org.participant.invite" },
      { href: "/dashboard/sharing-policy", label: "Sharing policy", needs: "org.staff.manage" },
      { href: "/dashboard/org-security", label: "Security & privacy" },
    ],
  },
];

const ORG_STAFF_NAV: OrgNavItem[] = [
  { href: "/dashboard", label: "My clients" },
  { href: "/dashboard#add", label: "Add participants" },
  { href: "/dashboard/org-security", label: "Security & privacy" },
];

// Personal, account-scoped data cached in localStorage. Cleared on sign-out so
// the next person to use this browser can never inherit the previous user's
// Forge/resume/job data (shared-machine isolation).
const PERSONAL_LS_KEYS = [
  "forge_session",
  "forge_preload",
  "forge_audience",
  "consumer_progress",
  "saved_jobs",
  "hidden_jobs",
  "refinery_last_job_search",
  "pending_access_code",
  // Points at an approved resume artifact and is sent to the generator as the
  // tailoring base. Nothing used to clear it, so a previous person's approved
  // resume text could seed the next person's document.
  "active_baseline_id",
  "view_as",
  "forge_last_synced_run",
  "interview_struggle_tags",
  DERIVED_OWNER_KEY,
  // r3 I4: the "impersonation seen" flag never outlives the sign-in.
  IMPERSONATION_SEEN_KEY,
];

/**
 * Keys that belong to ONE Forge run and must not survive into the next.
 *
 * `forge_session` is deliberately absent: when a new run arrives, that key IS
 * the new run. Everything here is derived from a run and goes stale the moment
 * a different person's intake lands in the same browser.
 */
const RUN_SCOPED_LS_KEYS = DERIVED_KEYS;

/**
 * The last Forge run this browser synced. Deliberately NOT inside
 * `forge_session`: that blob is replaced on every fresh start, so a boundary
 * stored inside it disappears exactly when a new run begins.
 */
const LAST_SYNCED_RUN_KEY = FORGE_LAST_SYNCED_RUN_KEY;

function removeKeys(keys: readonly string[]) {
  for (const k of keys) {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }
}

function clearPersonalLocalStorage() {
  removeKeys(PERSONAL_LS_KEYS);
}

/** Called when a NEW Forge run arrives in a browser that already synced one. */
function clearRunScopedLocalStorage() {
  removeKeys(RUN_SCOPED_LS_KEYS);
}

/**
 * Save a run this account owns (or that the person just said "Yes" to) via
 * /api/forge/save, then mark it owned and synced. Returns whether it saved.
 */
async function saveOwnedForgeRun(
  stored: string,
  forgeData: Record<string, any>,
  uid: string
): Promise<boolean> {
  const res = await fetch("/api/forge/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stored,
  });
  if (!res.ok) return false;
  const runId = forgeData.startedAt || "unknown";
  forgeData._synced = true;
  forgeData._syncedAt = runId;
  forgeData._ownerUserId = uid; // owned by the current account
  try {
    localStorage.setItem("forge_session", JSON.stringify(forgeData));
    localStorage.setItem(LAST_SYNCED_RUN_KEY, runId);
  } catch {
    // Storage unavailable: the server copy is saved either way.
  }
  window.dispatchEvent(new Event("forge-synced"));
  return true;
}

function isNavUnlocked(
  item: NavItem,
  userTier: UserTier,
  onboardingState: OnboardingState,
  disclosureComplete: boolean,
): boolean {
  if (userTier === "admin") return true;
  if (userTier === "partner") {
    return (TIER_RANK[userTier] ?? 3) <= (TIER_RANK[item.minTier] ?? 3);
  }
  const tierRank = TIER_RANK[userTier] ?? 3;
  if (tierRank > (TIER_RANK[item.minTier] ?? 3)) return false;
  // Same rule the dashboard cards use (one gate, two displays).
  return clientToolUnlocked({
    state: onboardingState,
    minState: item.minState,
    requiresDisclosure: item.requiresDisclosure,
    disclosureComplete,
  });
}

// Hide items requiring a tier the user can never reach (partner-only, admin-only)
function shouldShowItem(item: NavItem, userTier: UserTier): boolean {
  if (item.minTier === "admin" && userTier !== "admin") return false;
  if (item.minTier === "partner" && userTier !== "partner" && userTier !== "admin") return false;
  return true;
}

/**
 * Role/view switch (walkthrough C7): partner and admin accounts can flip into
 * the real client experience and back. The persistent amber banner
 * (AdminTestModeBanner) marks client view; this control lives in the top nav.
 */
function ViewAsToggle() {
  const realTier = useRealTier();
  const effectiveRole = useEffectiveRole();
  const [asClient, setAsClient] = useState(false);

  useEffect(() => {
    setAsClient(getViewAs() === "client");
  }, []);

  // Admins get the full DevSwitcher instead.
  if (realTier !== "partner") return null;
  // STAFF HAVE NO RESUME WORKSPACE (Troy, 2026-09-20): "they are employed
  // already." This used to offer org members "My job search", a private
  // job-seeker space under the same login. It made a casework tool look like it
  // had confused its user for a client. Partners with no organization keep the
  // preview, which is how they see what their clients see.
  if (effectiveRole?.orgRole) return null;

  function toggle() {
    setViewAs(asClient ? null : "client");
    window.location.href = "/dashboard";
  }

  const label = asClient ? "Partner view" : "Client view";
  const title = asClient ? "Return to your partner view" : "Experience the platform exactly as a client";

  return (
    <button
      onClick={toggle}
      title={title}
      className="t-focus hidden sm:inline-flex min-h-touch items-center gap-1.5 rounded-[4px] border border-t-line px-2.5 text-xs font-medium text-t-bone-dim transition-colors hover:border-t-line-strong hover:text-t-white"
    >
      {label}
    </button>
  );
}

export function RefineryShell({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p className="p-6 text-sm text-t-phos-dim">Loading your workspace...</p>}><ProgressionProvider><RefineryShellContent>{children}</RefineryShellContent></ProgressionProvider></Suspense>;
}

function RefineryShellContent({ children }: { children: ReactNode }) {
  const progression = useProgression();
  const userTier = useUserTier();
  const { data: sessionData, status: authStatus } = useSession();
  const pathname = usePathname();
  const onboarding = useOnboarding();
  const { context: userFullContext } = useUserContext();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navTrigger = useRef<HTMLButtonElement>(null);
  const navPanel = useRef<HTMLDivElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  async function leaveAccount() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      await confirmedSignOut();
      clearPersonalLocalStorage();
      window.location.replace("/login");
    } catch {
      setSignOutError("We couldn't confirm sign-out. Stay here and try again before leaving this computer.");
      setSigningOut(false);
    }
  }
  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!document.documentElement.dataset.guidedLearning) navPanel.current?.focus();
    const closeOnDesktop = () => {
      if (window.matchMedia("(min-width: 768px)").matches) setDrawerOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (document.documentElement.dataset.guidedLearning) return;
      if (event.key === "Escape") { event.preventDefault(); setDrawerOpen(false); return; }
      if (event.key !== "Tab") return;
      const panel = navPanel.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex="0"]')).filter((el) => el.offsetParent !== null);
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel || !panel.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", closeOnDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", closeOnDesktop);
      if (!document.documentElement.dataset.guidedLearning) navTrigger.current?.focus();
    };
  }, [drawerOpen]);
  // Shared-computer rule: the "Is it yours?" card for an unowned Forge run.
  const [forgePrompt, setForgePrompt] = useState<"none" | "ask" | "saving" | "saved" | "failed">("none");
  const [forgeSyncTick, setForgeSyncTick] = useState(0);
  // N7: the onboarding load count when "Yes" finished saving. "saved" holds
  // the bounce only until onboarding has loaded again after that.
  const [savedAtLoads, setSavedAtLoads] = useState<number | null>(null);
  // The run the card asked about. "Yes" saves only that run (another tab may
  // replace it); a changed run is asked about again and nothing is saved.
  const askedRunRef = useRef<string | null>(null);
  const [forgeRunChanged, setForgeRunChanged] = useState(false);
  const [forgeNotice, setForgeNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!forgeNotice) return;
    const t = setTimeout(() => setForgeNotice(null), 6000);
    return () => clearTimeout(t);
  }, [forgeNotice]);

  // R6: keys an earlier account left in this browser (its saved jobs, last
  // search, approved-resume pointer) are read by pages the moment they mount,
  // before this shell's effects run. Settle them here, during render, and show
  // the page only after. Idempotent, so a second render changes nothing.
  const shellUid = sessionData?.user?.id ?? null;
  const derivedSettledFor = useRef<string | null>(null);
  if (authStatus === "authenticated" && shellUid && derivedSettledFor.current !== shellUid) {
    const uid = shellUid;
    // A clear marked on the other host applies here first (N3).
    applyForgeClearMark(uid);
    settleDerivedKeys(uid);
    derivedSettledFor.current = uid;
  }
  const derivedReady =
    authStatus === "unauthenticated" ||
    (authStatus === "authenticated" && !!shellUid && derivedSettledFor.current === shellUid);

  // Close mobile drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Gate: client users who have never done the Forge get sent there first.
  // View-as sessions (admin/partner in client view) AND impersonation
  // sessions are exempt from the HARD redirect -- bouncing them to the Forge
  // domain would strand the operator outside the app with no way to exit.
  // They see the in-app "Start with The Forge" state instead; every other
  // gate stays real.
  const effectiveRole = useEffectiveRole();
  const laneFocus = useLaneFocus();
  useEffect(() => {
    // While the "Is it yours?" card is open (or its "Yes" is still landing),
    // stay here: bouncing to the Forge would skip the person's answer. After
    // a save, only until onboarding has re-read (N7).
    const holds = forgeQuestionHoldsBounce({
      prompt: forgePrompt,
      askNow: forgeSyncDecision(readLocalForgeRunRaw(), sessionData?.user?.id) === "ask",
      onboardingLoads: onboarding.loads,
      savedAtLoads,
    });
    if (
      !holds &&
      authStatus === "authenticated" &&
      effectiveRole !== null &&
      userTier === "client" &&
      getViewAs() === null &&
      !effectiveRole?.impersonating &&
      onboarding.state !== "loading" &&
      !onboarding.forgeComplete &&
      pathname !== "/dashboard/settings" &&
      // Lanes first (R2 review H1): support, job search and the documents
      // open without a resume; only the resume and interview routes need one.
      laneFocus.loaded &&
      !refineryOpenWithoutResume(pathname, laneFocus.task)
    ) {
      // Lanes first (Phase 5 R2): to the Forge's first screen, "What do you
      // need today?", on this same site so the sign-in comes along. Returning
      // with a task picked, that page shows where the run is (no bounce back).
      window.location.href = forgeStartUrl(window.location.hostname);
    }
  }, [authStatus, userTier, effectiveRole, onboarding.state, onboarding.forgeComplete, onboarding.loads, savedAtLoads, pathname, forgePrompt, sessionData?.user?.id, laneFocus.loaded, laneFocus.task]);

  // Post-auth: redeem access codes + sync Forge data + sync audience tier
  useEffect(() => {
    const pendingCode = localStorage.getItem("pending_access_code");
    if (pendingCode) {
      localStorage.removeItem("pending_access_code");
      fetch("/api/access-code/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pendingCode }),
      })
        .then((r) => { if (r.ok) window.dispatchEvent(new Event(ORG_JOINED_EVENT)); })
        .catch(() => {});
    }

    try {
      const audience = localStorage.getItem("forge_audience");
      if (audience && ["client", "partner", "observer"].includes(audience)) {
        localStorage.removeItem("forge_audience");
        fetch("/api/user/set-tier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier: audience }),
        }).catch(() => {});
      }
    } catch {
      // Silent
    }
  }, [authStatus, sessionData?.user?.id]);

  // Forge session sync -- with hard cross-user isolation. A Forge blob in
  // localStorage belongs to exactly one account; on a shared browser it must
  // never sync to, or render for, a different user.
  //
  // NO SILENT CLAIM (shared-computer hotfix 2026-10-07). An UNOWNED run (no
  // `_ownerUserId`) used to be claimed here whenever its name loosely matched
  // the account name ("Marcus" matched "Marcus Johnson"), which wrote the
  // previous person's record answers into this account. Now an unowned run
  // with work in it gets one "Is it yours?" card. Only "Yes" saves it
  // (/api/forge/save) and marks it owned; "No" erases it. Until then no screen
  // reads it: they all go through readOwnForgeSession(uid), which returns null
  // for an unowned run. An unowned run past the Forge's 24-hour idle limit is
  // erased, never offered. Impersonation never asks or claims: "Yes" would
  // save into the impersonated account.
  const syncRoleKey = effectiveRole === null ? "loading" : effectiveRole.impersonating ? "impersonating" : "self";
  useEffect(() => {
    const uid = sessionData?.user?.id;
    if (authStatus !== "authenticated" || !uid) return; // wait for the signed-in user id
    // N6: nothing while the role is loading or an admin is viewing as someone
    // else (the save route writes to the effective account).
    if (!forgeSyncAllowed(effectiveRole)) return;
    try {
      const stored = readLocalForgeRunRaw();
      const decision = forgeSyncDecision(stored, uid);

      if (decision === "purge") {
        // Foreign blob: purge so it can't sync to or surface for this account.
        clearPersonalLocalStorage();
        window.dispatchEvent(new Event("forge-synced"));
        return;
      }
      if (decision === "erase") {
        eraseLocalForgeRun();
        clearRunScopedLocalStorage();
        window.dispatchEvent(new Event("forge-synced"));
        return;
      }
      if (decision === "ask") {
        // Clear what is DERIVED from any earlier run, so nothing from an
        // unverified run shows, then ask. Nothing is saved or claimed here.
        clearRunScopedLocalStorage();
        if (askedRunRef.current === null) askedRunRef.current = stored;
        setForgePrompt((p) => (p === "none" || p === "saved" ? "ask" : p));
        return;
      }
      if (decision !== "owned" || !stored) return;

      const forgeData = JSON.parse(stored);
      if (!forgeData.forgeOutput && !forgeData.resumeText) return;

      // RUN BOUNDARY. `startedAt` identifies one Forge run; `_syncedAt` records
      // the run this browser last synced. When a DIFFERENT run arrives, every
      // key derived from the previous one is stale -- the prior persona's
      // approved baseline, saved and hidden jobs, progress counters, and the
      // last job search with its full result list. Clear before rebuilding the
      // preload below, not after. The last run we synced is remembered OUTSIDE
      // the intake blob, because the blob is exactly what a fresh start
      // replaces. (Found in review, 2026-09-19.)
      const runId = forgeData.startedAt || "unknown";
      let priorSyncedAt: string | null = null;
      try {
        priorSyncedAt =
          localStorage.getItem(LAST_SYNCED_RUN_KEY) || forgeData._syncedAt || null;
      } catch {
        priorSyncedAt = forgeData._syncedAt || null;
      }
      if (priorSyncedAt && priorSyncedAt !== runId) {
        clearRunScopedLocalStorage();
      }

      try {
        import("@/lib/forge-preload").then(({ buildForgePreload, saveForgePreload }) => {
          const preload = buildForgePreload(forgeData);
          saveForgePreload(preload);
        }).catch(() => {});
      } catch {
        // Preload build failed — not critical
      }

      if (priorSyncedAt === runId) return;
      // Owned by this account but not yet synced here (for example the
      // sign-up "Yes" path, whose server save was best-effort): save once.
      saveOwnedForgeRun(stored, forgeData, uid).catch(() => {});
    } catch {
      // Silent
    }
  }, [authStatus, sessionData?.user?.id, syncRoleKey, forgeSyncTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // The welcome tour waits while the question is on screen: a brand-new
  // account sees the card first, never the tour on top of it.
  const tourHeld = forgeQuestionOpen({
    prompt: forgePrompt,
    askNow: !effectiveRole?.impersonating && forgeSyncDecision(readLocalForgeRunRaw(), shellUid) === "ask",
  });

  // "Is it yours?" answers. Only "Yes" saves; "No" erases.
  async function answerForgePrompt(yes: boolean) {
    const uid = sessionData?.user?.id;
    if (!yes) {
      eraseLocalForgeRun();
      clearRunScopedLocalStorage();
      askedRunRef.current = null;
      setForgeRunChanged(false);
      setForgePrompt("none");
      window.dispatchEvent(new Event("forge-synced"));
      return;
    }
    if (!uid || effectiveRole?.impersonating) return;
    const stored = readLocalForgeRunRaw();
    const now = forgeSyncDecision(stored, uid);
    if (now !== "ask" || forgeRunFingerprint(stored) !== forgeRunFingerprint(askedRunRef.current)) {
      // The run changed or left since the card asked. Save nothing.
      if (now === "ask") {
        askedRunRef.current = stored; // ask again, about the run that is here now
        setForgeRunChanged(true);
        setForgePrompt("ask");
      } else {
        askedRunRef.current = null;
        setForgeRunChanged(false);
        setForgePrompt("none");
        if (now !== "owned") setForgeNotice("Nothing was saved. That resume is no longer on this computer.");
        setForgeSyncTick((t) => t + 1);
      }
      return;
    }
    setForgePrompt("saving");
    try {
      const ok = await saveOwnedForgeRun(stored as string, JSON.parse(stored as string), uid);
      if (ok) {
        askedRunRef.current = null;
        setForgeRunChanged(false);
        setSavedAtLoads(onboarding.loads);
        setForgePrompt("saved");
        setForgeNotice("Saved to your account.");
        setForgeSyncTick((t) => t + 1);
      } else {
        setForgePrompt("failed");
      }
    } catch {
      setForgePrompt("failed");
    }
  }

  // Refresh this session's last-seen time in the active-devices list. The
  // session row itself, and the new-device email, are written server-side at
  // sign-in (they no longer depend on this page loading). Fire-and-forget, once.
  useEffect(() => {
    if (authStatus === "authenticated") {
      fetch("/api/auth/session-ping", { method: "POST" }).catch(() => {});
    }
  }, [authStatus]);

  // Admin 2FA: an admin account without two-step verification is guided to
  // Settings to turn it on. The real gate is server-side (auth.ts authorized,
  // requirePlatformAdmin, effectiveAuth): admin tools need a session that
  // entered a code. Only in a real admin session
  // (not view-as, so QA impersonation isn't disrupted).
  const realTier = useRealTier();
  const [adminNeeds2fa, setAdminNeeds2fa] = useState(false);
  useEffect(() => {
    if (realTier === "admin" && getViewAs() === null) {
      fetch("/api/user/security-status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setAdminNeeds2fa(!!d && !d.twoFactorEnabled))
        .catch(() => {});
    } else {
      setAdminNeeds2fa(false);
    }
  }, [realTier]);
  useEffect(() => {
    if (adminNeeds2fa && pathname !== "/dashboard/settings") {
      window.location.href = "/dashboard/settings";
    }
  }, [adminNeeds2fa, pathname]);

  // Role-aware nav framing (role-clear wave): the first item names the
  // landing the user actually gets, and org leaders see the client toolset
  // labeled as what it is -- the tools their clients use.
  const orgRole = effectiveRole?.orgRole ?? null;
  // Tier from the DATABASE, not the session claim. The claim is minted at
  // sign-in and goes stale, so someone promoted to org staff would keep the
  // job-seeker nav -- Job Board, Application Tailor, Interview Prep -- until
  // they happened to sign out and back in. A case manager's nav is their
  // caseload; the client toolset lives behind the explicit "client view"
  // toggle and nowhere else.
  const resolvedTier = effectiveRole?.tier ?? userTier;
  const isOrgPartner = resolvedTier === "partner" && !!orgRole;
  const isOrgAdmin = orgRole === "owner" || orgRole === "org_admin";

  // Org leaders drop into the client experience through this one control
  // (mirrors the top-bar ViewAsToggle, but reachable from the nav on mobile).
  // Somebody on staff who used the old "My job search" switch still has that
  // choice saved in their browser, and the switch that would undo it is gone.
  // Without this they would be stranded in the client experience.
  useEffect(() => {
    if (orgRole && getViewAs()) {
      setViewAs(null);
      window.location.href = "/dashboard";
    }
  }, [orgRole]);

  function navItemLabel(item: NavItem): string {
    if (item.href !== "/dashboard") return item.label;
    if (userTier === "admin") return "Operator Home";
    if (isOrgPartner) return "My Organization";
    return item.label;
  }

  function renderNavItems(onItemClick?: () => void, mobile = false) {
    function renderItem(item: NavItem, secondary = false) {
      const step = userTier === "client" && (!secondary || item.href === "/dashboard/application-tailor")
        ? stepForNav(progression?.data?.steps ?? [], item.href) : null;
      const guidedLocked = step?.access === "locked";
      const directAccess = !guidedLocked || navKeepsDirectAccess(item.href);
      // Missing progress is not evidence that an existing user lost access.
      // Server APIs still decide whether the requested operation is allowed.
      const unlocked = userTier === "client" ? directAccess : isNavUnlocked(item, userTier, onboarding.state, onboarding.disclosureComplete);
      const active = secondary ? pathname === item.href : navContains(item, pathname);
      const targetId = item.targetId && (mobile ? drawerOpen : !drawerOpen) ? item.targetId : undefined;
      const lockLine = step?.reason || lockedToolLine({ state: onboarding.state, requiresDisclosure: item.requiresDisclosure, disclosureComplete: onboarding.disclosureComplete });
      const cls = `t-focus flex min-h-[40px] w-full items-center justify-between gap-2 rounded-[4px] border-l-[3px] px-3 py-2 text-left text-sm transition-colors ${secondary ? "font-normal" : "font-medium"} ${active ? "border-[#4f6b57] bg-[#e3ede5] text-[#344b38]" : "border-transparent text-t-bone-dim hover:bg-t-panel-2 hover:text-t-white"}`;
      const previewId = !unlocked && !guidedLocked ? previewIdForHref(item.href) : null;
      const content = <>
        <span className="min-w-0"><span className="block">{navItemLabel(item)}</span>{step && <span className="mt-0.5 block text-[10px] font-normal leading-snug">{guidedLocked && directAccess ? "Guided stage: " : ""}{progressStateLabel(step)}</span>}{!unlocked && <span className="mt-0.5 block text-[11px] font-normal leading-snug text-t-bone-dim">{lockLine}</span>}</span>
        {guidedLocked ? <LockKeyhole size={13} className="shrink-0 opacity-70" aria-hidden="true" /> : step?.state === "completed" ? <CheckCircle2 size={14} className="shrink-0 text-[#4f6b57]" aria-hidden="true" /> : !unlocked ? <LockKeyhole size={13} className="shrink-0 opacity-60" aria-hidden="true" /> : null}
      </>;
      return (
        <div key={`${item.href}:${item.label}`}>
          {guidedLocked && !directAccess && step ? (
            <button id={targetId} type="button" aria-haspopup="dialog" onClick={() => { onItemClick?.(); progression?.ask(step); }} className={cls} title={lockLine}>{content}</button>
          ) : unlocked || previewId ? (
            <Link id={targetId} href={unlocked ? item.href : `/dashboard/preview/${previewId}`} onClick={onItemClick}
              data-tour={`nav-${item.href.split("/").pop()}`} aria-current={unlocked && pathname === item.href ? "page" : undefined}
              title={!unlocked ? `${lockLine} See a preview.` : undefined} className={cls}>
              {content}
            </Link>
          ) : (
            <div id={targetId} aria-disabled="true" title={lockLine} className={`${cls} cursor-not-allowed opacity-70`}>{content}</div>
          )}
          {guidedLocked && directAccess && step ? <button type="button" aria-haspopup="dialog" onClick={() => { onItemClick?.(); progression?.ask(step); }} className="t-focus ml-4 mb-1 flex min-h-touch items-center gap-1.5 text-left text-[11px] text-t-amber-bright underline underline-offset-2"><LockKeyhole size={11} aria-hidden="true" />Ask t.ROY about this stage</button> : null}
          {!secondary && active && item.children && (
            <div aria-label={`${item.label} views`} className="my-1 ml-4 border-l border-t-line pl-1">
              {item.children.filter((child) => shouldShowItem(child, userTier)).map((child) => renderItem(child, true))}
            </div>
          )}
        </div>
      );
    }
    return NAV_GROUPS.map((group, gi) => {
      const visible = group.items.filter((item) => !(item.href === "/dashboard/partner" && isOrgPartner) && shouldShowItem(item, userTier));
      if (!visible.length) return null;
      const links = visible.map((item) => renderItem(item));
      if (group.collapsible) return (
        <details key={group.label} className="mt-3 border-t border-t-line pt-3" open={pathname === "/dashboard/documents" || pathname === "/dashboard/settings" ? true : undefined}>
          <summary className="t-focus cursor-pointer px-3 py-2 text-sm font-medium text-t-bone-dim hover:text-t-white">{group.label}</summary>
          <div className="ml-2">{links}</div>
        </details>
      );
      return (
        <div key={gi} className={gi > 0 ? "mt-2 border-t border-t-line pt-3" : ""}>
          {group.label && <p className="mb-1 px-3 font-term text-[9px] font-semibold uppercase text-t-bone-dim">{group.label}</p>}
          {links}
        </div>
      );
    });
  }

  function renderOrgNav(onItemClick?: () => void) {
    const linkClass = (active: boolean) =>
      `t-focus flex min-h-[40px] items-center rounded-[4px] border-l-[3px] px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-[#4f6b57] bg-[#e3ede5] text-[#344b38]"
          : "border-transparent text-t-bone-dim hover:bg-t-panel-2 hover:text-t-white"
      }`;
    // A participant's page belongs to Caseload, so Caseload stays lit there.
    const isActive = (href: string) =>
      href === pathname || (href === "/dashboard" && pathname.startsWith("/dashboard/clients/"));

    const workspace = !!effectiveRole?.crmV2;
    const flat = isOrgAdmin ? ORG_ADMIN_NAV : ORG_STAFF_NAV;
    return (
      <>
        {workspace ? (
          ORG_WORKSPACE_NAV.map((group, gi) => {
            const caps = effectiveRole?.capabilities ?? [];
            const items = group.items.filter((i) => !i.needs || caps.includes(i.needs));
            if (items.length === 0) return null;
            return (
              <div key={group.label} className={gi > 0 ? "mt-3" : ""}>
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-t-bone-dim">
                  {group.label}
                </p>
                {items.map((item) => (
                  <Link key={item.href} href={item.href} onClick={onItemClick}
                    aria-current={isActive(item.href) ? "page" : undefined} className={linkClass(isActive(item.href))}>
                    {item.label}
                  </Link>
                ))}
              </div>
            );
          })
        ) : (
          <div>
            {flat.map((item) => (
              <Link key={item.label} href={item.href} onClick={onItemClick} className={linkClass(item.href === pathname)}>
                {item.label}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-2 border-t border-t-line pt-3">
          <Link
            href="/dashboard/settings"
            onClick={onItemClick}
            className={`t-focus flex min-h-[40px] items-center rounded-[4px] border-l-[3px] px-3 py-2 text-sm font-medium transition-colors ${
              pathname === "/dashboard/settings"
                ? "border-[#4f6b57] bg-[#e3ede5] text-[#344b38]"
                : "border-transparent text-t-bone-dim hover:bg-t-panel-2 hover:text-t-white"
            }`}
          >
            Settings
          </Link>
        </div>
      </>
    );
  }

  return (
    <div className="refinery-app min-h-screen bg-t-bg font-body">
      {/* Applies the user's saved accessibility prefs app-wide (Phase 7.2). */}
      <UiPrefsApplier />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[4px] focus:bg-t-panel focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-t-white focus:shadow-xl"
      >
        Skip to content
      </a>
      <AdminTestModeBanner />
      <HighlightHost />
      <nav className="sticky top-0 z-30 border-b border-t-line bg-t-panel/95 backdrop-blur">
        <div className="px-4 sm:px-6">
          <div className="flex h-[72px] items-center justify-between gap-4">

            {/* Left: hamburger (mobile) + logo */}
            <div className="flex items-center gap-3">
              <button
                ref={navTrigger}
                onClick={() => setDrawerOpen(true)}
                className="t-focus -ml-2 flex h-11 w-11 items-center justify-center rounded-[4px] text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white md:hidden"
                aria-label="Open navigation"
                aria-expanded={drawerOpen}
                aria-controls="refinery-mobile-navigation"
              >
                <Menu size={21} aria-hidden="true" />
              </button>
              <ProductFamilyBrand product="refinery" productHref="/dashboard" />
            </div>

            {/* Right: account links */}
            <div className="flex items-center gap-2 sm:gap-4">
              <DevSwitcher />
              <ViewAsToggle />
              <CoBrandLockup compact className="hidden xl:flex" />
              <a
                href="https://forge.steelmanresumes.com"
                target="_blank"
                rel="noopener noreferrer"
                className="t-focus hidden min-h-touch items-center gap-1 rounded-[4px] px-2 text-sm text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white lg:flex"
              >
                The Forge
                <ExternalLink size={14} aria-hidden="true" />
              </a>
              <Link
                href="/dashboard/settings"
                aria-label="Settings"
                className="t-focus flex min-h-touch items-center gap-2 rounded-[4px] px-2 text-sm text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white"
              >
                <NavAvatar size={28} />
                <span className="hidden sm:inline">Settings</span>
              </Link>
              <button
                onClick={leaveAccount}
                disabled={signingOut}
                aria-label={signingOut ? "Signing out" : "Sign out"}
                className="t-focus flex min-h-touch items-center gap-1.5 rounded-[4px] px-2 text-sm text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white"
              >
                <LogOut size={15} aria-hidden="true" />
                <span className="hidden sm:inline">{signingOut ? "Signing out..." : "Sign out"}</span>
              </button>
            </div>
          </div>
        </div>
      </nav>
      {signOutError && !drawerOpen && <p role="alert" className="border-b border-t-red bg-t-panel px-4 py-3 text-sm text-t-red">{signOutError} <button type="button" onClick={leaveAccount} disabled={signingOut} className="t-focus min-h-touch underline">Try again</button></p>}

      {/* Body: sidebar + content */}
      <div className="flex min-h-[calc(100vh-72px)]">

        {/* Left sidebar -- desktop only */}
        <aside className="hidden w-60 flex-shrink-0 border-r border-t-line bg-t-panel md:block">
          <div className="sticky top-[72px] h-[calc(100vh-72px)] space-y-1 overflow-y-auto px-3 py-5">
            <p className="mb-4 px-3 font-term text-[10px] font-semibold uppercase text-[#4f6b57]">
              {isOrgPartner ? "Organization" : "Career workspace"}
            </p>
            {isOrgPartner ? renderOrgNav() : <nav aria-label="Career workspace">{renderNavItems()}</nav>}
          </div>
        </aside>

        {/* Main content */}
        <div className="min-w-0 flex-1">
        {!isOrgPartner && userTier === "client" && <Suspense fallback={null}><RefineryLaneHeader state={onboarding.state} /></Suspense>}
        <main id="main" className="px-4 py-6 pb-32 sm:px-7 sm:pb-8 lg:px-10">
          {forgeNotice && (
            <p role="status" className="mb-6 border border-t-line bg-t-panel px-4 py-3 text-sm text-t-white">
              {forgeNotice}
            </p>
          )}
          {(forgePrompt === "ask" || forgePrompt === "saving" || forgePrompt === "failed") && !effectiveRole?.impersonating && (
            <div role="region" aria-label="Resume on this computer" className="mb-6 border border-t-amber bg-t-panel px-4 py-4">
              <p className="text-base font-semibold text-t-white">
                There&apos;s a resume in progress on this computer. Is it yours?
              </p>
              {forgeRunChanged && (
                <p className="mt-1 text-sm text-t-bone-dim">
                  The resume on this computer changed since we asked. Nothing was saved. Is this one yours?
                </p>
              )}
              {forgePrompt === "failed" && (
                <p className="mt-1 text-sm text-t-red">It did not save. Try again.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => answerForgePrompt(true)}
                  disabled={forgePrompt === "saving"}
                  className="t-focus min-h-touch rounded-[4px] border border-[#4f6b57] bg-[#4f6b57] px-4 text-sm font-medium text-white hover:bg-[#3d5745] disabled:opacity-60"
                >
                  {forgePrompt === "saving"
                    ? "Saving..."
                    : sessionData?.user?.email
                      ? `Yes, save it to ${sessionData.user.email}`
                      : "Yes, save it to my account"}
                </button>
                <button
                  type="button"
                  onClick={() => answerForgePrompt(false)}
                  disabled={forgePrompt === "saving"}
                  className="t-focus min-h-touch rounded-[4px] border border-t-line px-4 text-sm font-medium text-t-white hover:border-t-line-strong disabled:opacity-60"
                >
                  No, erase it
                </button>
              </div>
            </div>
          )}
          {adminNeeds2fa && (
            <div className="mb-6 border border-t-amber bg-t-panel px-4 py-3 text-sm text-t-amber-bright">
              <span className="font-semibold">Two-step verification is required for admin accounts.</span>{" "}
              Admin tools stay locked until you turn it on under <span className="font-semibold">Security</span> below.
            </div>
          )}
          {/* The client journey banner is participant chrome -- org leaders run
              the org, they are not working a resume journey here. */}
          {/* DEMO ORGANIZATIONS SAY SO, ON EVERY SCREEN. Their participants are
              invented, and some are paired with real local employers so the
              demonstration looks like the real world. Without this line a made-up
              placement at a named employer could be read as a claim that it happened. */}
          {isOrgPartner && /\(Demo\)\s*$/.test(effectiveRole?.orgName ?? "") && (
            <p role="note" className="border-b border-t-amber/40 bg-t-panel px-4 py-1.5 text-center text-xs text-t-amber-bright">
              Sample data. These participants are fictional. The employers and local services named are real; no application or hire shown here took place.
            </p>
          )}
          {!isOrgPartner && <PolicyAckBanner />}
          {/* Asked once after joining an organization. Not while an admin is
              viewing as someone else: the answer would be recorded for the admin. */}
          {!isOrgPartner && !effectiveRole?.impersonating && <JoinSharingPrompt />}
          {derivedReady && effectiveRole !== null ? <TourPageFrame key={JSON.stringify([pathname, shellUid, effectiveRole?.accountId ?? null, effectiveRole?.tier ?? null, effectiveRole?.orgRole ?? null, effectiveRole?.impersonating?.mode ?? null])} pathname={pathname}>{children}</TourPageFrame> : null}
        </main>
        </div>
      </div>

      {/* First-run orientation -- self-gating (client tier, DB-persisted) */}
      <Suspense fallback={null}>
        <GuidedTour key={JSON.stringify([shellUid, effectiveRole?.accountId ?? null])} held={tourHeld || !derivedReady || effectiveRole === null} onNavigationReveal={setDrawerOpen} />
      </Suspense>

      {/* Developer impersonation frame (blue view / red assist) */}
      <ImpersonationChrome />

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer panel */}
      <div
        ref={navPanel}
        id="refinery-mobile-navigation"
        role="dialog"
        aria-label="Career workspace navigation"
        aria-modal={drawerOpen ? true : undefined}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
        tabIndex={-1}
        className={`fixed bottom-0 left-0 top-0 z-50 w-[min(19rem,88vw)] overflow-y-auto border-r border-t-line bg-t-panel shadow-xl transition-transform duration-200 md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-[72px] items-center justify-between border-b border-t-line px-4">
          <ProductBrand product="refinery" href="/dashboard" />
          <button
            onClick={() => setDrawerOpen(false)}
            className="t-focus flex h-11 w-11 items-center justify-center rounded-[4px] text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white"
            aria-label="Close navigation"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="px-2 py-4 space-y-1">
          {isOrgPartner ? renderOrgNav(() => setDrawerOpen(false)) : <nav aria-label="Career workspace">{renderNavItems(() => setDrawerOpen(false), true)}</nav>}
          <div className="mt-3 pt-3 border-t border-t-line space-y-1">
            {signOutError && <p role="alert" className="px-3 text-sm text-t-red">{signOutError}</p>}
            <a
              href="https://forge.steelmanresumes.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-touch items-center gap-1.5 rounded-[4px] px-3 py-2 text-sm text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white"
            >
              The Forge <ExternalLink size={14} aria-hidden="true" />
            </a>
            <button
              onClick={leaveAccount}
              disabled={signingOut}
              className="flex min-h-touch w-full items-center gap-1.5 rounded-[4px] px-3 py-2 text-left text-sm text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white"
            >
              <LogOut size={14} aria-hidden="true" /> {signingOut ? "Signing out..." : signOutError ? "Try sign-out again" : "Sign out"}
            </button>
          </div>
        </div>
      </div>

      {/* AI Assistant */}
      <AssistantDrawer>
        {!shellUid || authStatus !== "authenticated" || effectiveRole === null ? (
          <p role="status" className="p-5 text-sm text-t-bone-dim">Checking your account...</p>
        ) : (
          <AssistantChat
            key={JSON.stringify([shellUid, effectiveRole.accountId, effectiveRole.tier, effectiveRole.orgRole, effectiveRole.impersonating?.mode ?? null, isOrgPartner])}
            context={{
              currentPage: pathname === "/dashboard" ? "dashboard" : pathname.replace("/dashboard/", ""),
              forgeComplete: onboarding.state !== "needs_profile",
              readinessStage: userFullContext?.forge?.readinessStage ?? undefined,
              skills: userFullContext?.forge?.skills?.map((s) => (typeof s === "string" ? s : (s as any).name)).filter(Boolean) ?? undefined,
              barriers: userFullContext?.forge?.barriers ?? undefined,
              hasCriminalRecord: userFullContext?.forge?.hasCriminalRecord ?? undefined,
              userFullContext,
            }}
            // Org staff get t.ROY's caseload assistant (/api/assistant resolves
            // their org server-side). The Refinery coach is a job-seeker's coach
            // and answered a case manager as if they needed a resume.
            coach={!isOrgPartner}
            staff={isOrgPartner}
          />
        )}
      </AssistantDrawer>

    </div>
  );
}
