/**
 * The participant page for staff (CRM lane C2, 2026-10-25): what the page may
 * draw, decided in pure functions so the rules are tested without a browser.
 *
 * NOTHING HERE READS DATA. The page gets the same payload it always got from
 * /api/org/clients/[id] (orgClientView.getClientHeader). These functions only
 * decide what of that payload is shown, and they never show more than it.
 *
 * BL1 (B8 review): identity and progress come from the person's account only
 * with progress sharing on (identitySource "account"). For an invited
 * non-sharer staff see the name and email their own organization typed, and
 * nothing derived from progress: no lit station, no counts, no last active.
 */
import { STATIONS, stationForJourneyStage, type StationId } from "./refinery-nav";

export type ShareScope = "applications" | "resume" | "documents";
export type PersonTab = "notes" | "timeline" | "tasks" | "referrals" | "outcomes" | "shared" | "screen";

export interface ScopeView {
  shared: boolean; sharedAt: string | null; requestPending: boolean; required: boolean; stoppedByParticipant: boolean; fromDate: string | null;
}
export interface PersonView {
  name: string | null; email: string | null;
  identitySource?: "account" | "invite" | "none";
  currentStage: number | null;
  scopes: Record<ShareScope, ScopeView>;
  awaitingAcknowledgement?: boolean;
  progress: { nextStepAction: string | null; applications: number; savedJobs: number; practiceSessions: number; hasTailoredResume: boolean; lastActiveAt: string | null } | null;
}

export const SHARE_SCOPES: { key: ShareScope; label: string; wouldShow: string }[] = [
  { key: "applications", label: "Applications", wouldShow: "the jobs they are tracking, where each one stands, and their follow-up dates. Never their private notes on a job or the pay they wrote down." },
  { key: "resume", label: "Resumes", wouldShow: "the resumes in their library as they stand now, to read. Never the edit history, and never their disclosure plan." },
  { key: "documents", label: "Cover letters", wouldShow: "their cover letters as they stand now, to read." },
];

export const PERSON_TABS: { key: PersonTab; label: string }[] = [
  { key: "notes", label: "Notes" },
  // House lane L5: everything on record, newest first; and closed-loop referrals.
  { key: "timeline", label: "Timeline" },
  { key: "tasks", label: "Tasks and suggestions" },
  { key: "referrals", label: "Referrals" },
  { key: "outcomes", label: "Outcomes" },
  { key: "shared", label: "What they shared" },
  { key: "screen", label: "Their screen" },
];

/** Troy's ruling, 2026-10-24: this line sits under the note box, word for word. */
export const NOTE_CARE_LINE = "Do not record diagnoses, treatment, medication or anything from a court file here.";
export function noteOwnershipLine(first: string): string {
  return `Notes belong to your organization. They can be corrected, and earlier wording is kept. They cannot be deleted. Never visible to ${first}.`;
}

/** BL1: anything drawn from progress needs progress sharing on. */
export function progressVisible(p: Pick<PersonView, "identitySource" | "progress">): boolean {
  return p.identitySource === "account" && p.progress != null;
}

/**
 * How the page names the person mid-sentence: their first name, or "this
 * person" when no name is shown (joined by code, not sharing). Use capFirst
 * where it starts a sentence.
 */
export function firstName(p: Pick<PersonView, "name">): string {
  const n = (p.name ?? "").trim();
  return n ? n.split(/\s+/)[0] : "this person";
}
export function capFirst(first: string): string {
  return first ? first[0].toUpperCase() + first.slice(1) : first;
}

/** Initials for the person's avatar. Only from the name the header already shows; none when no name is shown. */
export function personInitials(name: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  if (!words.length) return "";
  return (words.length === 1 ? words[0][0] : words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export interface StationCell { id: StationId; label: string; short: string; lit: boolean }

/**
 * The seven participant stations with the person's one lit, from the legacy
 * stage through stationForJourneyStage (no new vocabulary). Nothing is lit for
 * a non-sharer, and no station is ever shown as finished: the stage tells
 * where someone is, not what they completed.
 */
export function personStations(p: Pick<PersonView, "identitySource" | "currentStage">): { lit: StationId | null; cells: StationCell[] } {
  const lit = p.identitySource === "account" && p.currentStage != null ? stationForJourneyStage(p.currentStage) : null;
  return { lit, cells: STATIONS.map((s) => ({ id: s.id, label: s.label, short: s.short, lit: s.id === lit })) };
}

export interface GlanceTile { key: "active" | "applications" | "tasks" | "asks"; label: string; value: string; note: string; tab: PersonTab }

/** The at-a-glance row. Progress tiles say "Not shared" for a non-sharer; tasks and asks are the organization's own records. */
export function personGlance(p: PersonView, openTasks: number | null, fmtDay: (s: string) => string): GlanceTile[] {
  const shows = progressVisible(p);
  const asks = SHARE_SCOPES.filter((s) => p.scopes[s.key]?.requestPending).length;
  return [
    {
      key: "active", label: "Last active", tab: "screen",
      value: shows ? (p.progress!.lastActiveAt ? fmtDay(p.progress!.lastActiveAt) : "Not yet") : "Not shared",
      note: shows ? "From their progress sharing" : "Progress is private",
    },
    {
      key: "applications", label: "Applications", tab: "shared",
      value: shows ? String(p.progress!.applications) : "Not shared",
      note: shows ? "A count from their progress sharing" : "Progress is private",
    },
    {
      key: "tasks", label: "Open tasks", tab: "tasks",
      value: openTasks == null ? "--" : String(openTasks),
      note: "Your organization's tasks for them, not done",
    },
    {
      key: "asks", label: "Open asks", tab: "shared",
      value: String(asks),
      note: asks ? "Waiting on their answer" : "Nothing asked and waiting",
    },
  ];
}

/**
 * Which shared scope, if any, the page fetches on an event. Fetching a scope
 * IS the logged access, so this is the one place that decides it:
 *  - opening the "What they shared" tab fetches nothing; staff pick an item;
 *  - picking an item fetches it only if it is shared;
 *  - on first load, only the staff member's own saved start tab (Settings,
 *    My workflow) can open a shared item, exactly as before.
 */
export type OpenEvent =
  | { kind: "tab"; tab: PersonTab }
  | { kind: "item"; scope: ShareScope }
  | { kind: "load"; pref: string; last: string | null };

export function scopeToFetch(e: OpenEvent, scopes: Record<ShareScope, ScopeView>): ShareScope | null {
  if (e.kind === "tab") return null;
  if (e.kind === "item") return scopes[e.scope]?.shared ? e.scope : null;
  const want = initialOpen(e.pref, e.last, scopes);
  return want.scope;
}

/** Where the page starts. Same rule as the eight-tab page it replaces. */
export function initialOpen(pref: string, last: string | null, scopes: Record<ShareScope, ScopeView>): { tab: PersonTab; scope: ShareScope | null } {
  const want = pref === "last" ? last || "notes" : pref;
  if (want === "screen") return { tab: "screen", scope: null };
  if ((want === "applications" || want === "resume" || want === "documents") && scopes[want]?.shared) return { tab: "shared", scope: want };
  return { tab: "notes", scope: null };
}

/**
 * Their screen, station by station: what each holds and what staff can see of
 * it. A map, not a window. "never" areas are not part of any sharing choice.
 */
export interface ScreenArea { station: StationId; holds: string; scopes: ShareScope[]; never?: string }
export const THEIR_SCREEN: readonly ScreenArea[] = [
  { station: "overview", holds: "Where they are and the next step they are being shown.", scopes: [] },
  { station: "find", holds: "Where they search for jobs, explore paths and look up employers.", scopes: ["applications"] },
  { station: "tailor", holds: "Their resume library, the resumes they fit to one job, and their cover letters.", scopes: ["resume", "documents"] },
  { station: "plan", holds: "Their plan for if and how to talk about their record, and their private records and documents.", scopes: [], never: "Never shared with staff, by design. No program can require it." },
  { station: "practice", holds: "Interview practice, including voice practice.", scopes: [], never: "Never shared with staff, by design. With progress sharing on you see only how many sessions." },
  { station: "apply", holds: "Each application they are tracking and where it stands.", scopes: ["applications"] },
  { station: "next", holds: "School, money, health and local help they have saved.", scopes: [], never: "Not something they can share with your organization." },
];

/** "Tailor and package" etc., from the one station list. */
export function stationLabel(id: StationId): string {
  return STATIONS.find((s) => s.id === id)?.label ?? id;
}
