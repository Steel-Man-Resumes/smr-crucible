/**
 * useOnboarding — Derives onboarding state from profile + artifacts.
 *
 * States:
 *   "loading"        → Still fetching
 *   "needs_profile"  → No contact info (name + phone required)
 *   "needs_resume"   → Has profile, 0 resume artifacts
 *   "full_access"    → Has profile + at least 1 resume
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
      fetch("/api/artifacts/counts").then((r) => (r.ok ? r.json() : null)),
    ]).then(([profileRes, countsRes]) => {
      if (cancelled) return;

      const profileComplete = profileRes?.isComplete === true;
      const contactData = profileRes?.contact || null;
      const resumes = countsRes?.data?.resume || 0;

      setContact(contactData);
      setResumeCount(resumes);

      if (!profileComplete) {
        setState("needs_profile");
      } else if (resumes === 0) {
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

  // Listen for forge-synced events (may create artifacts)
  useEffect(() => {
    const handler = () => setTimeout(refresh, 500);
    window.addEventListener("forge-synced", handler);
    return () => window.removeEventListener("forge-synced", handler);
  }, [refresh]);

  return { state, contact, resumeCount, refresh };
}
