/**
 * useOnboarding — Derives onboarding state from the server gate decision.
 *
 * States:
 *   "loading"        → Still fetching
 *   "needs_profile"  → Profile incomplete (name + phone required)
 *   "needs_resume"   → Has profile, no resume tailored to a target job yet
 *   "full_access"    → Has profile + a resume tailored to a target job
 *
 * Forge → Profile → Find Job → Build Resume → Full Access
 *
 * Admin tier always returns "full_access" (god mode).
 *
 * Phase 1D: this used to derive `state` itself from three parallel fetches
 * (/api/user/profile + /api/artifacts?type=resume + /api/artifacts?
 * type=disclosure_plan), filtering resumes client-side for "job-targeted."
 * That is now GET /api/user/journey -> computeGateDecision(), built on the
 * SERVER definition of "resume tailored" (getUserProfile.
 * hasResumeTailoredToTarget, which reads the application_document provenance
 * snapshot -- see packages/core/src/journey.ts). OnboardingGate and
 * RefineryShell.isNavUnlocked consume `state` unchanged; they don't know or
 * care that it now comes from one endpoint instead of a client filter.
 *
 * `contact` still comes from /api/user/profile directly -- the journey
 * snapshot doesn't carry the full merged contact object (session name +
 * consumer_profile.profile_data.contact + Forge-resume fallback chain), and
 * duplicating that fallback logic here would create a second source of
 * truth for it. `disclosureComplete` comes from the journey snapshot's
 * hasDisclosurePlan (getUserProfile's real DB signal, not the new event
 * ledger, which has no history for plans created before this shipped).
 */

import { useState, useEffect, useCallback } from "react";
import { useUserTier } from "./useUserTier";

export type OnboardingState = "loading" | "needs_profile" | "needs_resume" | "full_access";

export interface UserContact {
  name: string;
  phone: string;
  email: string;
  city: string;
  state: string;
}

export interface OnboardingData {
  state: OnboardingState;
  contact: UserContact | null;
  resumeCount: number;
  forgeComplete: boolean;
  disclosureComplete: boolean;
  refresh: () => void;
}

export function useOnboarding(): OnboardingData {
  const tier = useUserTier();
  const [state, setState] = useState<OnboardingState>("loading");
  const [contact, setContact] = useState<UserContact | null>(null);
  const [resumeCount, setResumeCount] = useState(0);
  const [forgeComplete, setForgeComplete] = useState(false);
  const [disclosureComplete, setDisclosureComplete] = useState(false);

  const refresh = useCallback(() => {
    // Admin = god mode, skip checks
    if (tier === "admin") {
      setState("full_access");
      setForgeComplete(true);
      setDisclosureComplete(true);
      return;
    }

    let cancelled = false;

    Promise.all([
      fetch("/api/user/journey").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/user/profile").then((r) => (r.ok ? r.json() : null)),
    ]).then(([journeyRes, profileRes]) => {
      if (cancelled) return;

      const gateState = journeyRes?.gate?.state as OnboardingState | undefined;
      const metrics = journeyRes?.snapshot?.metrics;
      const contactData = profileRes?.contact || null;
      const hasForge = metrics?.forgeComplete === true || tier === "partner";

      setContact(contactData);
      setResumeCount(metrics?.resumesBuilt ?? 0);
      setForgeComplete(hasForge);
      setDisclosureComplete(metrics?.hasDisclosurePlan === true);

      // Fallback preserves the pre-Phase-1D default (needs_profile) if the
      // journey endpoint didn't come back -- the page keeps working, just
      // conservatively locked rather than silently full-access.
      setState(gateState ?? "needs_profile");
    }).catch(() => {
      if (!cancelled) setState("needs_profile");
    });

    return () => { cancelled = true; };
  }, [tier]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Listen for forge-synced and resume-saved events
  useEffect(() => {
    const handler = () => setTimeout(refresh, 500);
    window.addEventListener("forge-synced", handler);
    window.addEventListener("resume-saved", handler);
    return () => {
      window.removeEventListener("forge-synced", handler);
      window.removeEventListener("resume-saved", handler);
    };
  }, [refresh]);

  // Listen for disclosure_plan saves
  useEffect(() => {
    const handler = () => setTimeout(refresh, 500);
    window.addEventListener("disclosure-saved", handler);
    return () => window.removeEventListener("disclosure-saved", handler);
  }, [refresh]);

  return { state, contact, resumeCount, forgeComplete, disclosureComplete, refresh };
}
