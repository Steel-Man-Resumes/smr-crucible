/** Presentation of server-owned progress. This module never awards or unlocks. */
export const PROGRESSION_CHANGED_EVENT = "progression-changed";
export const PROGRESSION_STEPS = ["foundation", "direction", "tailor", "apply", "interview", "offer"] as const;
export type ProgressStepId = typeof PROGRESSION_STEPS[number];
export type ProgressAccess = "locked" | "earned" | "early" | "existing" | "essential";
export type ProgressState = "available" | "current" | "next" | "completed";
export interface ProgressStep {
  id: ProgressStepId; label: string; href: string; state: ProgressState;
  reason?: string; access: ProgressAccess; unlockable?: boolean;
}
export interface ProgressRequest {
  id: string; stepId: string; kind: string; status: string; decisionNote?: string | null; createdAt: string;
  idempotencyKey?: string;
}
export interface ProgressData {
  contextKey: string;
  steps: ProgressStep[];
  currentStepId: ProgressStepId;
  nextAction: { label: string; href: string };
  nextReward?: { label: string; requirement?: string } | null;
  allowance: { enabled: boolean; remaining?: number | null; blockedReason?: string | null; unit?: string; expiresAt?: string | null; description: string };
  celebration?: { id: string; title: string; detail: string } | null;
  requests?: ProgressRequest[];
}
export type ProgressSelection = Partial<Record<"laneId" | "applicationId" | "artifactId" | "revisionId", string>>;
export type AccessRequestKind = "unlock" | "ai_bonus" | "feedback" | "bug";
export interface UnlockResult { outcome: "granted" | "review_required" | "pending" | "denied"; message: string; requestId?: string; summary?: string }

export function safeProgressHref(href: string): string {
  return /^\/(?!\/)/.test(href) && !/[\r\n\\]/.test(href) ? href : "/dashboard";
}
export function isProgressStepId(value: unknown): value is ProgressStepId {
  return typeof value === "string" && (PROGRESSION_STEPS as readonly string[]).includes(value);
}
export function stepForNav(steps: ProgressStep[], href: string): ProgressStep | null {
  const id: ProgressStepId | undefined = href === "/dashboard/vault" ? "foundation"
    : href === "/dashboard/jobs" ? "direction"
    : href === "/dashboard/application-tailor" ? "tailor"
    : href === "/dashboard/applications" ? "apply"
    : href === "/dashboard/interview" ? "interview" : undefined;
  return steps.find((step) => step.id === id) ?? null;
}
/** Essential pages remain reachable while their guided stage may be next. */
export function navKeepsDirectAccess(href: string): boolean {
  return href !== "/dashboard/application-tailor" && href !== "/dashboard/applications";
}
export function progressStateLabel(step: ProgressStep): string {
  if (step.state === "completed") return "Completed";
  if (step.access === "early") return step.state === "current" ? "Recommended now · early access" : "Early access";
  if (step.state === "current") return "Recommended now";
  if (step.access === "locked") return "Next · locked";
  return step.state === "next" ? "Next · available" : "Available";
}

function destinationKey(href: string): string {
  const url = new URL(safeProgressHref(href), "https://workspace.invalid");
  url.searchParams.sort();
  return `${url.pathname}?${url.searchParams}${url.hash}`;
}

/** A process lock must never swallow an independent support/practice action. */
export function progressPrimaryAction(data: ProgressData) {
  const current = data.steps.find((step) => step.id === data.currentStepId);
  const override = !!current && destinationKey(current.href) !== destinationKey(data.nextAction.href);
  return { current, override, locked: current?.access === "locked" && !override,
    heading: override ? data.nextAction.label : current?.label || "Keep your work moving" };
}

export function progressionAllowanceDisplay(allowance: ProgressData["allowance"]) {
  const remaining = typeof allowance.remaining === "number" && Number.isFinite(allowance.remaining) ? Math.max(0, allowance.remaining) : null;
  const blockedReason = allowance.blockedReason?.trim() || null;
  return { remaining, blockedReason, canAsk: allowance.enabled,
    countLabel: blockedReason ? "left in today’s count" : "available" };
}

export function readProgressData(raw: unknown): ProgressData {
  const data = raw as ProgressData | null;
  if (!data || typeof data !== "object" || !Array.isArray(data.steps) || !isProgressStepId(data.currentStepId)
    || !data.nextAction || typeof data.nextAction.label !== "string" || typeof data.nextAction.href !== "string"
    || !data.allowance || typeof data.allowance.enabled !== "boolean" || typeof data.allowance.description !== "string") throw new Error("Progress unavailable");
  if (data.allowance.remaining != null && (typeof data.allowance.remaining !== "number" || !Number.isFinite(data.allowance.remaining))) throw new Error("Progress unavailable");
  if (data.allowance.blockedReason != null && typeof data.allowance.blockedReason !== "string") throw new Error("Progress unavailable");
  const seen = new Set<string>();
  for (const step of data.steps) {
    if (!step || !isProgressStepId(step.id) || seen.has(step.id) || typeof step.label !== "string" || typeof step.href !== "string"
      || !["available", "current", "next", "completed"].includes(step.state)
      || !["locked", "earned", "early", "existing", "essential"].includes(step.access)) throw new Error("Progress unavailable");
    seen.add(step.id);
  }
  if (seen.size !== PROGRESSION_STEPS.length) throw new Error("Progress unavailable");
  return data;
}
