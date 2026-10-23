"use client";

/**
 * Dashboard — Overview
 *
 * Audience-aware: client / partner / observer / admin each see a different entry experience.
 *
 * Client states:
 * 1. needs_profile → Profile setup form
 * 2. needs_resume  → Job Board + Application Tailor only, locked cards for rest
 * 3. full_access   → Everything unlocked
 *
 * Partner: methodology review mode — bypass Forge gate, show tool landscape + deep links.
 * Observer: evidence mode — research citations, tool explainers, methodology/evidence pages.
 * Admin: god mode (everything unlocked, all states skipped).
 */

import { TroyWork } from "@crucible/consumer-ui";
import { MySharedTasks } from "@/components/MySharedTasks";
import { MySuggestions } from "@/components/MySuggestions";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { TaskPicker } from "@/components/lanes/TaskPicker";
import { LaneHome } from "@/components/lanes/LaneHome";
import { ProgressOverview } from "@/components/progression/ProgressOverview";
import { useLaneFocus } from "@/components/lanes/useLaneFocus";
import { routeHref } from "@/lib/lane-task";
import { useSession } from "next-auth/react";
import { readOwnForgeSession } from "@/lib/forge-carry";
import { useUserTier } from "@/lib/useUserTier";
import { useOnboarding, type UserContact } from "@/lib/useOnboarding";
import { SavedJobsPanel } from "@/components/apply/SavedJobsPanel";
import { PartnerToolsOverview } from "@/components/PartnerToolsOverview";
import { OrgDashboard } from "@/components/org/OrgDashboard";
import { AdminHome } from "@/components/admin/AdminHome";
import { useEffectiveRole } from "@/components/RoleProvider";
import { TBtn } from "@crucible/consumer-ui";

// Shared fact-history snapshot for a compact progress recap.

interface DashboardData {
  narrative?: { headline?: string; summary?: string };
  strengths?: Array<{ title: string; evidence: string }>;
  skills?: Array<{ name: string; category: string }>;
  career_paths?: Array<{
    title: string;
    salary_range?: string;
    match_reason: string;
  }>;
}

const TYPE_LABELS: Record<string, string> = {
  resume: "resumes",
  cover_letter: "cover letters",
  disclosure_plan: "disclosure plans",
  interview_prep: "interview sessions",
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const sessionTier = useUserTier();
  const effectiveRole = useEffectiveRole();
  // Prefer the database-resolved tier. The session claim is minted at sign-in
  // and goes stale; this one is read per request. useUserTier still governs
  // view-as previews, which is why it is kept rather than replaced.
  const tier = effectiveRole?.impersonating ? sessionTier : (effectiveRole?.tier ?? sessionTier);
  const isAdmin = tier === "admin";
  const onboarding = useOnboarding();
  // Shared-computer rule: only a local run marked as this user's is read.
  const ownerUid = useSession().data?.user?.id;
  // Lanes first (Phase 5 R2): the first screen after sign-in asks what the
  // person needs today; once picked, this page is their lane home.
  const focus = useLaneFocus();
  const router = useRouter();
  const changeTask = useSearchParams().get("change") === "1";
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState("");

  // Forge data
  const [forgeData, setForgeData] = useState<DashboardData>({});
  const [artifactCounts, setArtifactCounts] = useState<Record<string, number>>({});

  // Load Forge output
  useEffect(() => {
    let cancelled = false;
    setForgeData({});
    async function loadData() {
      try {
        const res = await fetch("/api/forge/load", { cache: "no-store" });
        if (res.ok) {
          const { data: profile } = await res.json();
          if (!cancelled && profile?.forgeOutput) {
            setForgeData(profile.forgeOutput);
            return;
          }
        }
      } catch {}
      try {
        const session = readOwnForgeSession(ownerUid);
        if (!cancelled && session?.forgeOutput) setForgeData(session.forgeOutput);
      } catch {}
    }
    loadData();
    // Refresh after the "Is it yours?" card saves a run (or erases one).
    window.addEventListener("forge-synced", loadData);
    return () => {
      cancelled = true;
      window.removeEventListener("forge-synced", loadData);
    };
  }, [ownerUid]);

  // Account totals are labeled across all lanes; they never select a resume.
  useEffect(() => {
    if (!ownerUid) return;
    let live = true;
    setArtifactCounts({});
    fetch("/api/artifacts/counts", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : null)
      .then((body) => { if (live && body?.data) setArtifactCounts(body.data); })
      .catch(() => {});
    return () => { live = false; };
  }, [ownerUid]);
  const totalArtifacts = Object.values(artifactCounts).reduce((a, b) => a + b, 0);

  // ─── State: Loading ───────────────────────────────────────────────────
  //
  // WAIT FOR WHO THIS PERSON IS, not just for their onboarding state.
  //
  // useUserTier falls back to "client" whenever the session has not resolved
  // yet, which is a lie with consequences: this dispatch would fall straight
  // past the partner branch and hand an organization's case worker the
  // job-seeker profile form -- "these details go on your resume header" --
  // when what they came for is their caseload. A case manager does not have a
  // resume header.
  //
  // effectiveRole comes from /api/user/role, which resolves tier AND org role
  // from the DATABASE rather than the token, so it is both later and more
  // trustworthy than the session claim. null means still loading.
  if (effectiveRole === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <TroyWork compact decorative />
      </div>
    );
  }

  if (onboarding.state === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <TroyWork compact decorative />
      </div>
    );
  }

  // ─── Audience: Partner ────────────────────────────────────────────────
  // Org leaders and staff land on their organization's mission control.
  // Partner accounts with no org link get the tools overview + callout.
  if (tier === "partner") {
    if (effectiveRole === null) {
      // Role still resolving -- avoid flashing the wrong landing
      return (
        <div className="flex items-center justify-center py-20">
          <TroyWork compact decorative />
        </div>
      );
    }
    return effectiveRole.orgRole ? (
      <OrgDashboard />
    ) : (
      <PartnerToolsOverview noOrgCallout />
    );
  }

  // ─── Audience: Observer ───────────────────────────────────────────────
  if (tier === "observer") {
    return <ObserverDashboard />;
  }

  // ─── Audience: Admin (no view-as active) ──────────────────────────────
  // The operator lands on Operator Home. His own job-seeker journey is one
  // click away ("My job search" -> view-as client).
  if (isAdmin) {
    return <AdminHome />;
  }

  // ─── Lanes first: "What do you need today?" ───────────────────────────
  // Job seekers only (partners, observers and admins returned above). Viewing
  // as someone reads their pick but never asks or saves one for them.
  if (!effectiveRole?.impersonating) {
    if (!focus.loaded) {
      return (
        <div className="flex items-center justify-center py-20">
          <TroyWork compact decorative />
        </div>
      );
    }
    if (!focus.task || changeTask) {
      return (
        <div className="py-4">
          {pickError && <p role="alert" className="mb-3 text-t-red">{pickError}</p>}
          <TaskPicker
            tourTargetId="refinery-tool-overview-next"
            current={focus.task}
            busy={picking}
            helpHref="/dashboard/resources#support"
            onPick={async (t) => {
              setPicking(true);
              setPickError("");
              const saved = await focus.save(t);
              setPicking(false);
              if (!saved) { setPickError("Your choice wasn't saved. Try again."); return; }
              router.push(routeHref(t, { signedIn: true, hasResume: onboarding.state === "full_access" }));
            }}
          />
        </div>
      );
    }
  }

  // ─── State: needs_profile ─────────────────────────────────────────────
  if (onboarding.state === "needs_profile" && !isAdmin) {
    return (
      <div className="space-y-10">
        <ProgressOverview />
        {focus.task && <LaneHome laneId={focus.laneId} task={focus.task} profileFirst hidePrimaryAction />}
        <div id="profile-setup" className="scroll-mt-48">
          <ProfileSetup contact={onboarding.contact} onComplete={onboarding.refresh} />
        </div>
      </div>
    );
  }

  // The lane home carries one current resume and one next action. The
  // navigation holds the tool catalog; saved work stays in its own library.
  return (
    <div className="space-y-7">
      <MiniForgeBanner />
      <ProgressOverview />
      {focus.task ? <LaneHome laneId={focus.laneId} task={focus.task} hidePrimaryAction /> : <h1 className="text-2xl font-bold text-t-white">Overview</h1>}
      <MySharedTasks />
      <MySuggestions />
      <SavedJobsPanel heading="Applications to keep moving" limit={3} />
      {(forgeData.narrative?.summary || forgeData.skills?.length || totalArtifacts > 0) && (
        <section aria-labelledby="your-foundation-heading" className="border border-t-line bg-t-panel p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="your-foundation-heading" className="text-base font-semibold text-t-white">The work you can build on</h2>
            <Link href="/dashboard/progress" className="t-focus inline-flex min-h-touch items-center text-sm text-t-amber-bright underline underline-offset-2">Your progress</Link>
          </div>
          {forgeData.narrative?.headline && <p className="mt-1 font-medium text-t-white">{forgeData.narrative.headline}</p>}
          {forgeData.narrative?.summary && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-t-phos-dim">{forgeData.narrative.summary}</p>}
          {!!forgeData.skills?.length && (
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Skills from your shared history">
              {forgeData.skills.slice(0, 6).map((skill, index) => <span key={`${skill.name}:${index}`} className="border border-t-line bg-t-panel-2 px-2 py-1 text-xs text-t-phos">{skill.name}</span>)}
            </div>
          )}
          {totalArtifacts > 0 && <p className="mt-3 text-xs text-t-bone-dim">Saved across all lanes: {Object.entries(artifactCounts).filter(([, count]) => count > 0).map(([type, count]) => `${count} ${TYPE_LABELS[type] || type.replaceAll("_", " ")}`).join(" · ")}.</p>}
        </section>
      )}
      <p className="text-sm text-t-phos-dim">Aiming at another kind of work? <Link href="/dashboard/vault" className="t-focus text-t-amber-bright underline underline-offset-2">Start a lane in My resumes</Link>. Your work history stays together while each goal keeps its own documents.</p>
    </div>
  );
}


// ─── Observer Dashboard ───────────────────────────────────────────────────────

function ObserverDashboard() {
  const HEADLINE_CITATIONS = [
    {
      finding: "Affect labeling reduces amygdala reactivity by up to 50%",
      source: "Lieberman et al., 2007",
      detail: "fMRI study. Putting feelings into words activates prefrontal cortex and dampens amygdala response. That is the mechanism behind why free-text prompts are therapeutic, not just data collection.",
    },
    {
      finding: "A criminal record reduces job callbacks by 50% for white applicants and 64% for Black applicants",
      source: "Pager, 2003 (Milwaukee audit study)",
      detail: "Black applicants without records were called back less than white applicants with records. Employment barriers are structural, not motivational. This tool is built to work within that system as it really is.",
    },
    {
      finding: "85% of HR professionals say justice-impacted employees perform the same as or better than other employees",
      source: "SHRM, 2021",
      detail: "31% lower turnover in year one. The employer marks in this tool are built on evidence that hiring people with records is good business rather than charity.",
    },
    {
      finding: "Redemption sequences (bad→good narratives) predict higher well-being and generativity",
      source: "McAdams & McLean, 2013",
      detail: "Narrative identity theory. People who construct redemption arcs show better outcomes than those with contamination sequences. The Forge is a structured redemption narrative builder.",
    },
    {
      finding: "Lasting desistance requires both a concrete 'hook for change' and identity transformation",
      source: "Giordano et al., 2002",
      detail: "A job offer without identity work, or identity work without a concrete opportunity, both fail. This tool addresses both simultaneously.",
    },
  ];

  return (
    <div className="space-y-10">
      {/* Header */}
      <section className="bg-t-panel p-6 sm:p-8 border border-t-line">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-t-panel-2 border border-t-line flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-t-steel">
              <path d="M8 1C5.58 1 3 3.13 3 6v4c0 1 .5 2 1 2.5s1 1.5 1 2.5h6c0-1 .5-2 1-2.5S13 11 13 10V6c0-2.87-2.58-5-5-5z" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-t-steel mb-1">t.ROY: Evidence View</p>
            <h1 className="text-2xl font-bold text-t-white mb-2">Built on evidence. Designed for scrutiny.</h1>
            <p className="text-base text-t-phos-dim leading-relaxed">
              Every feature in this tool has a research basis. This view surfaces the citations, outcomes data, and design decisions. The full evidence deck is in the Evidence tab.
            </p>
          </div>
        </div>
      </section>

      {/* Key citations */}
      <section>
        <h2 className="text-lg font-bold text-t-white mb-4">Five findings this tool is built on</h2>
        <div className="space-y-3">
          {HEADLINE_CITATIONS.map((c, i) => (
            <div key={i} className="bg-t-panel p-5 border border-t-line">
              <p className="font-semibold text-t-white mb-1">&ldquo;{c.finding}&rdquo;</p>
              <p className="text-xs font-medium text-t-steel mb-2">{c.source}</p>
              <p className="text-sm text-t-phos-dim leading-relaxed">{c.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Deep links */}
      <section className="grid sm:grid-cols-2 gap-4">
        <Link
          href="/dashboard/evidence"
          className="block bg-t-panel border border-t-steel p-6 hover:bg-t-panel-2 transition-colors"
        >
          <h3 className="font-semibold text-lg text-t-white mb-1">Full Evidence Deck</h3>
          <p className="text-sm text-t-phos-dim">
            All citations, methodology notes, and outcome data. Structured for grant applications and academic review.
          </p>
        </Link>
        <Link
          href="/dashboard/methodology"
          className="block bg-t-panel border border-t-amber p-6 hover:bg-t-panel-2 transition-colors"
        >
          <h3 className="font-semibold text-lg text-t-white mb-1">Design Methodology</h3>
          <p className="text-sm text-t-phos-dim">
            How each behavioral rule translates into a feature. The 10 non-negotiables and why they exist.
          </p>
        </Link>
      </section>

      {/* Try it */}
      <section className="bg-t-panel border border-t-line p-6">
        <h2 className="font-semibold text-t-white mb-2">See it in action</h2>
        <p className="text-sm text-t-phos-dim mb-4">
          The Forge demo runs with sample data for Jordan, a warehouse worker from Milwaukee with a felony record. Walk through all 8 pages and see what the tool produces.
        </p>
        <TBtn href="/intro" size="sm">launch demo</TBtn>
      </section>

      {/* Settings */}
      <section className="border-t border-t-line pt-8">
        <Link
          href="/dashboard/settings"
          className="t-focus text-sm text-t-phos-dim hover:text-t-white bg-t-panel px-4 py-3 border border-t-line transition-colors"
        >
          Settings & privacy
        </Link>
      </section>
    </div>
  );
}

// ─── Profile Setup Component ────────────────────────────────────────────────

function ProfileSetup({
  contact,
  onComplete,
}: {
  contact: UserContact | null;
  onComplete: () => void;
}) {
  const [name, setName] = useState(contact?.name || "");
  const [email, setEmail] = useState(contact?.email || "");
  const [phone, setPhone] = useState(contact?.phone || "");
  const [city, setCity] = useState(contact?.city || "");
  const [state, setState] = useState(contact?.state || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError("Name and phone number are required for your resume.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, city, state }),
      });

      if (res.ok) {
        onComplete();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not save. Please try again.");
        setSaving(false);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-t-white mb-2">
        {name ? `Welcome, ${name.split(" ")[0]}` : "Welcome to The Refinery"}
      </h1>
      <p className="text-base text-t-phos-dim mb-4">
        I analyzed your background in The Forge. Now we put it to work.
        These details go on your resume header. Nothing else.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="text-sm font-medium text-t-white block mb-1">Full Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name (as it appears on a resume)"
            className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            required
          />
          <p className="text-xs text-t-phos-dim mt-1">Top of every resume we build for you.</p>
        </div>

        <div>
          <label className="text-sm font-medium text-t-white block mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
          />
          <p className="text-xs text-t-phos-dim mt-1">Resume header + how employers reach you.</p>
        </div>

        <div>
          <label className="text-sm font-medium text-t-white block mb-1">Phone Number *</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(414) 555-1234"
            className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            required
          />
          <p className="text-xs text-t-phos-dim mt-1">Required on resumes. Employers call this number.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Milwaukee"
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">State</label>
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="WI"
              maxLength={2}
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch uppercase"
            />
          </div>
          <p className="text-xs text-t-phos-dim col-span-2">For local job matching.</p>
        </div>

        {error && <p className="text-sm text-t-red">{error}</p>}

        <div className="bg-t-panel p-4 border border-t-line">
          <p className="text-xs text-t-phos leading-relaxed">
            Your contact details are saved in your account and used on your documents. Your location also helps match local jobs and support. You choose what to share with your program.
            You can update or delete everything anytime in Settings.
          </p>
        </div>

        <TBtn type="submit" disabled={saving || !name.trim() || !phone.trim()} className="w-full">
          {saving ? "saving..." : "save & continue"}
        </TBtn>
      </form>
    </div>
  );
}

// ─── Mini Forge welcome banner ────────────────────────────────────────────

function MiniForgeBanner() {
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  if (searchParams.get("welcome") !== "mini-forge" || dismissed) return null;

  return (
    <div className="bg-t-panel border border-t-line p-5 flex items-start gap-4">
      <div className="flex-1">
        <p className="font-semibold text-t-white">Welcome. You started this inside.</p>
        <p className="text-sm text-t-phos-dim mt-1">
          Your career plan from The Mini Forge is loaded. Your tools are ready.
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-t-phos-dim hover:text-t-white text-sm shrink-0"
        aria-label="Dismiss"
      >
        Done
      </button>
    </div>
  );
}
