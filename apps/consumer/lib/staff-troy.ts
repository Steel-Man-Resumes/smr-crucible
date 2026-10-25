/**
 * The staff t.ROY panel's launch contract (CRM build plan section 1, lane C4).
 *
 *   openStaffTroy({ clientId, skill })
 *
 * Today ("Prep me") and the participant page rail call this. It opens the
 * docked assistant drawer with one skill preselected and, when given, one
 * participant as the subject. Nothing is sent: the skill's request is put in
 * the message box and the staff member presses Send. The server decides what
 * the skill may read (it re-resolves the staff member and re-checks reach on
 * every tool call); this file only carries the choice.
 *
 * Safe to import on the server: nothing touches `window` at import time, and
 * the skill list and trigger words are shared with /api/assistant.
 */

export type StaffSkillId =
  | "staff-prep-me"
  | "staff-check-in"
  | "staff-what-changed"
  | "staff-find-help"
  | "staff-outcome-note";

export interface StaffTroyRequest {
  clientId?: string;
  skill: StaffSkillId;
  /** Optional: the first name the calling page already shows, for the "About" chip. */
  firstName?: string;
}

export interface StaffSkill {
  id: StaffSkillId;
  /** The button. */
  label: string;
  /** Needs a person selected to make sense. */
  needsPerson: boolean;
  /** Built and on. A skill that is not ready is never offered. */
  ready: boolean;
  /** What is put in the message box. {first} becomes the first name or "this person". */
  request: string;
}

export const STAFF_SKILLS: readonly StaffSkill[] = [
  { id: "staff-prep-me", label: "Prep me", needsPerson: true, ready: true,
    request: "Prep me for my next conversation with {first}." },
  { id: "staff-check-in", label: "Draft a check-in", needsPerson: true, ready: true,
    request: "Draft a check-in to {first} that I will send myself." },
  { id: "staff-find-help", label: "Find local help", needsPerson: false, ready: true,
    request: "Find local help for {first}. The need is: " },
  { id: "staff-what-changed", label: "What changed", needsPerson: false, ready: true,
    request: "What changed for {first} in the last 7 days?" },
  { id: "staff-outcome-note", label: "Write the outcome note", needsPerson: true, ready: true,
    request: "Help me write the outcome note for {first}. Here is what I know: " },
];

const IDS: ReadonlySet<string> = new Set(STAFF_SKILLS.map((s) => s.id));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStaffSkill(v: unknown): v is StaffSkillId {
  return typeof v === "string" && IDS.has(v) && !!STAFF_SKILLS.find((s) => s.id === v)?.ready;
}

export function isParticipantId(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function staffSkill(id: StaffSkillId): StaffSkill {
  return STAFF_SKILLS.find((s) => s.id === id)!;
}

export function skillRequest(id: StaffSkillId, firstName?: string | null): string {
  const name = (firstName ?? "").trim().split(/\s+/)[0] || "this person";
  return staffSkill(id).request.replace("{first}", name);
}

/**
 * Which skill a typed staff message is asking for, when no button chose one.
 * Plain words a case manager uses. Unknown means none: the always-on staff
 * doctrine still applies.
 */
export function staffSkillFromText(text: string | null | undefined): StaffSkillId | null {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;
  const rules: [StaffSkillId, RegExp][] = [
    ["staff-prep-me", /\bprep(?:are)? me\b|\bi(?:'m| am) meeting\b|\bbefore (?:i|my) (?:meet|call|see)\b|\bget me ready for\b/],
    ["staff-outcome-note", /\boutcome note\b|\bplacement note\b|\b(?:got|was) hired\b|\bstarted (?:work|the job)\b/],
    ["staff-check-in", /\bcheck[- ]?in\b/],
    ["staff-find-help", /\b(?:find|local) (?:local )?help\b|\bresources? (?:for|near)\b|\bhelp with (?:housing|food|id|transportation|rent)\b/],
    ["staff-what-changed", /\bwhat(?:'s| has)? changed\b|\bwhat'?s new with\b|\bsince last week\b/],
  ];
  for (const [id, re] of rules) if (re.test(t) && isStaffSkill(id)) return id;
  return null;
}

/* ------------------------------------------------------------ the browser -- */

export const STAFF_TROY_EVENT = "staff-troy-open";

let pending: StaffTroyRequest | null = null;

/** Open the staff panel with a skill preselected. Never sends anything. */
export function openStaffTroy(request: StaffTroyRequest): void {
  if (!isStaffSkill(request.skill)) return;
  const clean: StaffTroyRequest = {
    skill: request.skill,
    clientId: isParticipantId(request.clientId) ? request.clientId : undefined,
    firstName: typeof request.firstName === "string" ? request.firstName.trim().split(/\s+/)[0]?.slice(0, 40) || undefined : undefined,
  };
  pending = clean;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<StaffTroyRequest>(STAFF_TROY_EVENT, { detail: clean }));
}

/** The panel takes the last request once (covers a click before the panel mounted). */
export function takePendingStaffTroy(): StaffTroyRequest | null {
  const p = pending;
  pending = null;
  return p;
}
