"use client";

import { useState, useEffect, useCallback } from "react";

export interface UserFullContext {
  profile: {
    name: string | null;
    email: string | null;
    city: string | null;
    state: string;
    tier: string;
  };
  forge: {
    headline: string | null;
    summary: string | null;
    strengths: Array<{ title: string; evidence: string }>;
    skills: Array<{ name: string; category?: string } | string>;
    careerPaths: Array<{ title: string; match_reason?: string; salary_range?: string } | string>;
    readinessStage: string | null;
    hasCriminalRecord: boolean;
    barriers: string[];
    goals: string[];
    goalNarrative: string | null;
  } | null;
  resumes: Array<{
    id: string;
    targetJob: string | null;
    targetCompany: string | null;
    createdFrom: string | null;
    summary: string | null;
    createdAt: string;
  }>;
  disclosurePlan: {
    exists: boolean;
    targetJob?: string | null;
    scriptExcerpt?: string | null;
    timingAdvice?: string | null;
    completedAt?: string;
  };
  applications: Array<{
    id: string;
    company: string;
    role: string;
    status: string;
    resumeTailored: boolean;
    followUpAt: string | null;
  }>;
  journey: {
    onboardingState: string;
    disclosureComplete: boolean;
    forgeComplete: boolean;
    interviewSessionCount: number;
    applicationCount: number;
    hasResumeTailoredToTarget: boolean;
  };
}

export function useUserContext() {
  const [context, setContext] = useState<UserFullContext | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    fetch("/api/user/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setContext(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh when any major tool action fires
  useEffect(() => {
    const handle = () => setTimeout(refresh, 600);
    window.addEventListener("resume-saved", handle);
    window.addEventListener("disclosure-saved", handle);
    window.addEventListener("forge-synced", handle);
    return () => {
      window.removeEventListener("resume-saved", handle);
      window.removeEventListener("disclosure-saved", handle);
      window.removeEventListener("forge-synced", handle);
    };
  }, [refresh]);

  return { context, loading };
}
