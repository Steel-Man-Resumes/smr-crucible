"use client";

import { useState, useEffect } from "react";

import { useSession } from "next-auth/react";
import { useEffectiveRole } from "@/components/RoleProvider";

export interface UserFullContext {
  accountId: string;
  sessionAccountId: string;
  workPreferences?: import("./job-fit").JobFitPreferences;
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
    scriptSavedAt?: string | null;
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
  const { data: session, status } = useSession();
  const role = useEffectiveRole();
  const sessionAccountId = status === "authenticated" ? session?.user?.id ?? null : null;
  const accountId = role?.sessionAccountId === sessionAccountId ? role?.accountId ?? null : null;
  const scope = sessionAccountId && accountId ? JSON.stringify([
    sessionAccountId, accountId, role?.tier, role?.orgRole, role?.impersonating?.mode ?? null,
  ]) : null;
  const [snapshot, setSnapshot] = useState<{ scope: string; context: UserFullContext | null; loading: boolean } | null>(null);

  useEffect(() => {
    setSnapshot(null);
    if (!scope) return;
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch("/api/user/context", { cache: "no-store", signal: request.signal });
        const data = response.ok ? await response.json() : null;
        if (!active || request.signal.aborted) return;
        // The cookie may have changed before this request reached the server.
        const context = data?.accountId === accountId && data?.sessionAccountId === sessionAccountId ? data : null;
        setSnapshot({ scope, context, loading: false });
      } catch {
        if (active && !request.signal.aborted) setSnapshot({ scope, context: null, loading: false });
      }
    };
    void refresh();
    const handle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 600);
    };
    window.addEventListener("resume-saved", handle);
    window.addEventListener("disclosure-saved", handle);
    window.addEventListener("forge-synced", handle);
    return () => {
      active = false;
      controller?.abort();
      clearTimeout(timer);
      window.removeEventListener("resume-saved", handle);
      window.removeEventListener("disclosure-saved", handle);
      window.removeEventListener("forge-synced", handle);
    };
  }, [scope, accountId, sessionAccountId]);

  // Never return a prior owner's private profile while effects are catching up.
  const current = scope && snapshot?.scope === scope ? snapshot : null;
  return { context: current?.context ?? null, loading: status !== "unauthenticated" && (current?.loading ?? true) };
}
