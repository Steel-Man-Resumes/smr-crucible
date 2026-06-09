"use client";

import { useState, createContext, useContext, useCallback } from "react";
import type { ReactNode } from "react";
import type { ResumeDocument } from "@/components/resume/resumeModel";

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

  // Page 2: Resume
  resumeText?: string;
  resumeFileName?: string;
  resumeMethod?: "upload" | "import" | "external" | "guided" | "rush" | "paste";
  /** Structured base resume built in the Forge (Phase 7). Carried into the
   *  analysis and saved as the base the Application Tailor aims at jobs. */
  resumeDoc?: ResumeDocument;

  // Page 3: Goals
  goals?: string[];
  goalNarrative?: string;
  hookNarrative?: string;

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
  preferences?: Record<string, string>;

  // Page 6-7: Output
  forgeOutput?: Record<string, unknown>;

  // Audience & engagement tracking
  audience?: "client" | "partner" | "observer";
  pagesVisited?: string[];

  // Demo mode (partner/observer walkthrough with sample data)
  isDemo?: boolean;

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

function loadSession(): ForgeSessionData {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem("forge_session");
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveSession(data: ForgeSessionData) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("forge_session", JSON.stringify(data));
  } catch {
    // localStorage may be full or unavailable — fail silently
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
