/**
 * useOnboarding — Derives onboarding state from profile + artifacts.
 *
 * States:
 *   "loading"        → Still fetching
 *   "needs_profile"  → No contact info (name + phone required)
 *   "needs_resume"   → Has profile, no job-targeted resume yet
 *   "full_access"    → Has profile + at least 1 job-targeted resume
 *
 * The Forge auto-creates a "forge" source resume, but that doesn't count.
 * Only resumes built for a specific job (via Job Board → "Build Resume")
 * unlock the full toolset. This enforces the flow:
 * Forge → Profile → Find Job → Build Resume → Full Access
 *
 * Admin tier always returns "full_access" (god mode).
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
  refresh: () => void;
}

export function useOnboarding(): OnboardingData {
  const tier = useUserTier();
  const [state, setState] = useState<OnboardingState>("loading");
  const [contact, setContact] = useState<UserContact | null>(null);
  const [resumeCount, setResumeCount] = useState(0);

  const refresh = useCallback(() => {
    // Admin = god mode, skip checks
    if (tier === "admin") {
      setState("full_access");
      return;
    }

    let cancelled = false;

    Promise.all([
      fetch("/api/user/profile").then((r) => (r.ok ? r.json() : null)),
      // Fetch actual resume artifacts to check for job-targeted ones
      fetch("/api/artifacts?type=resume&limit=50").then((r) => (r.ok ? r.json() : null)),
    ]).then(([profileRes, artifactsRes]) => {
      if (cancelled) return;

      const profileComplete = profileRes?.isComplete === true;
      const contactData = profileRes?.contact || null;

      // Count only resumes that are job-targeted (not auto-created Forge imports)
      const allResumes = artifactsRes?.data || [];
      const jobTargetedResumes = allResumes.filter((a: any) => {
        const ctx = a.target_context || {};
        // A "real" resume has a specific targetJob AND wasn't just the forge auto-import
        return ctx.source === "job" || (ctx.targetJob && ctx.source !== "forge");
      });

      setContact(contactData);
      setResumeCount(jobTargetedResumes.length);

      if (!profileComplete) {
        setState("needs_profile");
      } else if (jobTargetedResumes.length === 0) {
        setState("needs_resume");
      } else {
        setState("full_access");
      }
    }).catch(() => {
      if (!cancelled) setState("needs_profile");
    });

    return () => { cancelled = true; };
  }, [tier]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Listen for forge-synced events
  useEffect(() => {
    const handler = () => setTimeout(refresh, 500);
    window.addEventListener("forge-synced", handler);
    return () => window.removeEventListener("forge-synced", handler);
  }, [refresh]);

  return { state, contact, resumeCount, refresh };
}
