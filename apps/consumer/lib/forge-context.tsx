"use client";

import { useState, createContext, useContext, useCallback } from "react";
import type { ReactNode } from "react";
import type { ResumeDocument } from "@/components/resume/resumeModel";
import { migrateStoredSession, STORED_SESSION_VERSION } from "@/lib/forge-preferences";

// --- Forge Session Context ---
// Tracks user progress through the Forge flow without requiring auth.
// Persisted to localStorage so users can resume where they left off.

export interface ForgeSessionData {
  // Page 1: Readiness
  readinessStage?:
    | "precontemplation"
    | "contemplation"
    | "preparation"
    | "action";

  /**
   * The person's own pick between the short path and the full one (welcome
   * screen). Unset means the default for their readiness answer. See
   * lib/forge-path.ts, rule R1.
   */
  pathChoice?: "light" | "full";
  /** Offered screens the person chose to add to a short path ("story"). */
  pathExtras?: string[];

  // Page 2: Resume
  resumeText?: string;
  /** The resume exactly as the person gave it (upload or paste), before any
   *  builder edits. The build screen shows THIS page and its real flaws. */
  originalResumeText?: string;
  resumeFileName?: string;
  resumeMethod?: "upload" | "import" | "external" | "guided" | "rush" | "paste";
  /** Structured base resume built in the Forge (Phase 7). Carried into the
   *  analysis and saved as the base the Application Tailor aims at jobs. */
  resumeDoc?: ResumeDocument;

  // Page 3: Goals
  goals?: string[];
  goalNarrative?: string;
  hookNarrative?: string;
  // Self-disclosure (feeds generation mode -- F2 s.2.3). How the user rates their
  // own resume + what they worry about; used to bias sharpen-vs-scaffold and to
  // be sensitive to gaps/tenure/thin-history in generation.
  resumeConfidence?: "none" | "rough" | "decent" | "strong";
  resumeWorries?: string[];

  // Page 4: Story / Hurdles
  challenges?: string[];
  criminalRecord?: {
    type: string;
    charge_count: string;
    most_recent: string;
    supervision: string;
    context: string;
  };
  challengeNarratives?: Record<string, string>;

  // Page 5: Preferences
  // Comma-joined ids per question; see lib/forge-preferences.ts for the format.
  preferences?: Record<string, string>;

  // Page 6-7: Output
  forgeOutput?: Record<string, unknown>;

  // Audience & engagement tracking
  audience?: "client" | "partner" | "observer";
  pagesVisited?: string[];

  // Demo mode (partner/observer walkthrough with sample data)
  isDemo?: boolean;

  /**
   * Everything a Forge Tablet carry code brought across the wall that has no
   * other home in this shape. Set only by /carry; nothing else reads or writes
   * it, so adding it cannot affect any existing flow.
   *
   * The jobs skeleton matters most: those years were recovered a rung at a
   * time on a narrowing ladder inside a facility, and they are the single
   * hardest thing in that whole session to reproduce.
   */
  carriedIn?: {
    code: string;
    skills: string[];
    credentials?: string[];
    transport?: string;
    distance?: string;
    shifts?: string[];
    obligations?: string[];
    disclosureTiming?: string;
    jobs: Array<{
      kind: string;
      title?: string;
      yearStarted: number | null;
      yearApprox: boolean;
      yearEnded?: number | null;
      endApprox?: boolean;
    }>;
  };

  // Meta
  startedAt?: string;
  lastPageVisited?: string;
  consentGranted?: boolean;
}

interface ForgeContextValue {
  session: ForgeSessionData;
  updateSession: (updates: Partial<ForgeSessionData>) => void;
  clearSession: () => void;
}

const ForgeContext = createContext<ForgeContextValue | null>(null);

export function useForgeSession() {
  const ctx = useContext(ForgeContext);
  if (!ctx)
    throw new Error("useForgeSession must be used within ForgeProvider");
  return ctx;
}

/**
 * An anonymous Forge run lives only in this browser. On a library or
 * reentry-center computer the next person would otherwise open the last
 * person's resume and record answers, so a run left alone this long is
 * erased the next time the Forge loads. Each save restarts the clock.
 */
export const FORGE_SESSION_MAX_IDLE_MS = 24 * 60 * 60 * 1000;

/** True when a stored run's last save is older than the idle limit. */
export function isForgeSessionExpired(
  savedAt: unknown,
  now: number = Date.now()
): boolean {
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return true;
  return now - savedAt > FORGE_SESSION_MAX_IDLE_MS;
}

/** Read the stored run, migrating and expiring it. Exported for tests. */
export function loadSession(): ForgeSessionData {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem("forge_session");
    if (!stored) return {};
    // A run saved by an older build is brought up to the current shape here,
    // once, so somebody mid-run resumes with their answers intact. The stamp
    // `_v` marks runs already on the current shape.
    const { session: parsed, migrated } = migrateStoredSession(JSON.parse(stored));
    if (migrated && typeof parsed._savedAt === "number") {
      // Keep the original save time: migrating is not activity, so it must
      // not extend how long a run left on a shared computer survives.
      try {
        localStorage.setItem("forge_session", JSON.stringify(parsed));
      } catch {
        // storage unavailable: the migrated copy still serves this page load
      }
    }
    // Runs saved before the stamp existed (or copied in by the Refinery) have
    // no `_savedAt`. Stamp them now rather than erase someone mid-run; the
    // clock then applies like any other run.
    if (typeof parsed?._savedAt !== "number") {
      saveSession(parsed);
      return parsed as ForgeSessionData;
    }
    if (isForgeSessionExpired(parsed._savedAt)) {
      localStorage.removeItem("forge_session");
      return {};
    }
    return parsed as ForgeSessionData;
  } catch {
    return {};
  }
}

function saveSession(data: ForgeSessionData) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      "forge_session",
      JSON.stringify({ ...data, _v: STORED_SESSION_VERSION, _savedAt: Date.now() })
    );
  } catch {
    // localStorage may be full or unavailable — fail silently
  }
}

/**
 * "Done, clear this computer": erase everything this site keeps in the
 * browser (the Forge run, cached job lists, practice notes, session flags).
 * Each Forge/Refinery host is its own origin, so this cannot touch other sites.
 */
export function clearThisComputer() {
  if (typeof window === "undefined") return;
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
}

export function ForgeProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ForgeSessionData>(loadSession);

  const updateSession = useCallback((updates: Partial<ForgeSessionData>) => {
    setSession((prev) => {
      const next = { ...prev, ...updates };
      saveSession(next);
      return next;
    });
  }, []);

  const clearSession = useCallback(() => {
    setSession({});
    if (typeof window !== "undefined") {
      localStorage.removeItem("forge_session");
    }
  }, []);

  return (
    <ForgeContext.Provider value={{ session, updateSession, clearSession }}>
      {children}
    </ForgeContext.Provider>
  );
}
