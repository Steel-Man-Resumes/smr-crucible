/**
 * Staff t.ROY says what he can do, at useful moments, without nagging
 * (lane S1, staff pass 2026-10-27).
 *
 * Troy: "most people will not even know that the ability exists. he should
 * not be obnoxious, but offer useful help at useful times."
 *
 * THE RULES (L2 market report Q2: Chen et al., CHI 2025; NN/g 2025)
 *  - Built from what is in front of the staff member: the screen they are on
 *    and the person they are looking at. No "Ask me anything" chip.
 *  - Shown at a pause (5 seconds with no typing, clicking or scrolling) or
 *    right after a dead end (t.ROY could not do what they asked).
 *  - Never while they are typing, never while t.ROY is working.
 *  - At most one every 20 seconds, at most one per answer, at most one per
 *    screen visit, and an offer they dismissed (or already saw) is not shown
 *    again this session.
 *  - Off switch: "Suggestions" in their own staff preferences (default on;
 *    the field is troySuggestions, read through suggestionsOn below).
 *  - Tapping an offer never sends anything: it puts the words in the message
 *    box (or opens a skill), and they press Send.
 *
 * Pure: the chat drives it with its own clock and events, the tests drive it
 * with numbers.
 */
import type { StaffSkillId } from "./staff-troy";

export type StaffScreen =
  | "today" | "people" | "person" | "add-people" | "asks" | "referrals" | "notes" | "search"
  | "insights" | "employers" | "local-help" | "directory" | "team" | "settings" | "other";

/** Which screen a path is. */
export function staffScreenOf(pathname: string | null | undefined): StaffScreen {
  const p = String(pathname ?? "").replace(/\/+$/, "");
  if (p === "/dashboard" || p === "/dashboard/today") return "today";
  if (p === "/dashboard/people") return "people";
  if (/^\/dashboard\/clients\/[0-9a-f-]{36}$/i.test(p)) return "person";
  if (p === "/dashboard/participants") return "add-people";
  if (p === "/dashboard/requests") return "asks";
  if (p === "/dashboard/referrals") return "referrals";
  if (p === "/dashboard/notes") return "notes";
  if (p === "/dashboard/search") return "search";
  if (p === "/dashboard/insights") return "insights";
  if (p === "/dashboard/employers") return "employers";
  if (p === "/dashboard/resources") return "local-help";
  if (p === "/dashboard/directory") return "directory";
  if (p === "/dashboard/team") return "team";
  if (p === "/dashboard/settings") return "settings";
  return "other";
}

/** The person on screen: the id from a person page's path, else none. */
export function personOnScreen(pathname: string | null | undefined): string | null {
  const m = String(pathname ?? "").match(/^\/dashboard\/clients\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

export interface StaffOffer {
  /** Stable per screen and person, so a dismissed offer stays dismissed. */
  id: string;
  /** The chip's words. */
  label: string;
  /** One line of why, shown under an unasked-for offer. */
  why: string;
  /** Put in the message box when tapped. Never sent on its own. */
  prompt: string;
  /** Or: open this skill (about this person) instead of a typed prompt. */
  skill?: StaffSkillId;
  clientId?: string;
}

export interface OfferInput {
  screen: StaffScreen;
  /** The person on screen, or the one the panel is about. */
  person?: { id: string; firstName?: string | null } | null;
  capabilities?: Iterable<string>;
  /** Org module switches (referrals off means no referral offers). */
  modules?: Readonly<Record<string, boolean>> | null;
}

/**
 * What t.ROY can do HERE, best first. Three to five for the empty panel;
 * the first one is the unasked-for offer at a pause.
 */
export function offersFor(input: OfferInput): StaffOffer[] {
  const caps = new Set(input.capabilities ?? []);
  const can = (c: string) => caps.size === 0 || caps.has(c);
  const referralsOn = input.modules?.referrals !== false;
  const who = input.person?.id ? input.person : null;
  const first = (who?.firstName ?? "").trim().split(/\s+/)[0] || "";
  const them = first || "them";
  const out: StaffOffer[] = [];
  const add = (o: StaffOffer) => { if (!out.some((x) => x.id === o.id)) out.push(o); };
  switch (input.screen) {
    case "person":
      if (who) {
        add({ id: `prep:${who.id}`, label: first ? `Prep me for ${first}` : "Prep me for this person", why: "One read: where they are, what is open, what your team wrote.", prompt: "", skill: "staff-prep-me", clientId: who.id });
        add({ id: `changed:${who.id}`, label: "What changed this week", why: `Dated changes for ${them}, newest first.`, prompt: "", skill: "staff-what-changed", clientId: who.id });
        if (can("org.note.write")) add({ id: `bullets:${who.id}`, label: "Note from my bullets", why: "Type the bullets; you review and save the note.", prompt: "", skill: "staff-note-from-bullets", clientId: who.id });
        add({ id: `checkin:${who.id}`, label: "Draft a check-in", why: "A short message you send yourself.", prompt: "", skill: "staff-check-in", clientId: who.id });
      }
      add({ id: "person:employers", label: "Employers that hire people with records", why: "Name a state and the kind of work; I show the mark and when we checked.", prompt: "Find employers that hire people with records in " });
      break;
    case "add-people":
      if (can("org.participant.invite")) add({ id: "add:fill", label: "Fill this in from my words", why: "Tell me their name and email. I fill the form; you press Send invite.", prompt: "Fill in Add people for " });
      add({ id: "add:welcome", label: "Draft a welcome message", why: "Words for your first message once they join. You send it.", prompt: "Draft a short welcome message for someone I am adding today. Their first name is " });
      break;
    case "today":
      add({ id: "today:triage", label: "Triage my Today", why: "Who needs you first, and why, from your Today list.", prompt: "Triage my Today: who needs me first, and why?" });
      add({ id: "today:stale", label: "Who is slipping?", why: "Stale cases with a plain reason each.", prompt: "Flag the stale cases on my caseload, with reasons." });
      if (can("org.participant.invite")) add({ id: "today:add", label: "Add someone new", why: "Tell me the name; I open Add people filled in.", prompt: "Open Add people for " });
      break;
    case "people":
    case "search":
      add({ id: "people:digest", label: "Weekly caseload digest", why: "Everyone you work with, what is open, who went quiet.", prompt: "Give me my weekly caseload digest." });
      add({ id: "people:stale", label: "Flag stale cases", why: "Reasons to look, not judgments.", prompt: "Flag the stale cases on my caseload, with reasons." });
      if (can("org.participant.invite")) add({ id: "people:add", label: "Add someone new", why: "Tell me the name; I open Add people filled in.", prompt: "Open Add people for " });
      break;
    case "referrals":
      if (referralsOn) add({ id: "referrals:open", label: "Which referrals need me?", why: "Open referrals, overdue first.", prompt: "Which of my open referrals are overdue or need a follow-up?" });
      add({ id: "referrals:help", label: "Find local help", why: "Checked listings first, with the date we checked.", prompt: "Find local help. The place and need: " });
      break;
    case "notes":
      add({ id: "notes:bullets", label: "Turn bullets into a note", why: "Open the person first, then give me your bullets.", prompt: "Turn my bullets into a case note. The person and my bullets: " });
      break;
    case "asks":
      add({ id: "asks:triage", label: "Triage my Today", why: "Answers to your asks show there too.", prompt: "Triage my Today: who needs me first, and why?" });
      break;
    case "insights":
      if (can("org.insights.view") || can("org.outcome.write")) add({ id: "insights:funder", label: "Funder narrative from these numbers", why: "Only real numbers, with where each came from.", prompt: "Draft a funder narrative from our real numbers for last quarter." });
      break;
    case "employers":
    case "directory":
      add({ id: "dir:employers", label: "Employers for someone", why: "Name a state and the kind of work.", prompt: "Find employers that hire people with records in " });
      add({ id: "dir:help", label: "Local help for a need", why: "Name the place and the need.", prompt: "Find local help. The place and need: " });
      break;
    case "local-help":
      add({ id: "dir:help", label: "Local help for a need", why: "Name the place and the need.", prompt: "Find local help. The place and need: " });
      break;
    default:
      add({ id: "any:triage", label: "Triage my Today", why: "Who needs you first, and why.", prompt: "Triage my Today: who needs me first, and why?" });
      add({ id: "any:goto", label: "Take me to a page", why: "Say where; I show a button to it.", prompt: "Take me to " });
      break;
  }
  return out.slice(0, 5);
}

/* ------------------------------------------------------------ dead ends -- */

const REFUSAL = /\b(?:I can(?:not|'t)|I(?:'m| am) (?:not able|unable)|I do(?:n't| not) have (?:a |any )?(?:tool|way)|not part of (?:your|their) role|is not something I can)\b/i;

/**
 * The closest useful offer after t.ROY could not do what was asked, or null.
 * `userText` is what the staff member asked; `refused` is true when a tool
 * said no or the answer reads as a refusal.
 */
export function deadEndOffer(userText: string, answer: string, refused: boolean, input: OfferInput): StaffOffer | null {
  if (!refused && !REFUSAL.test(answer)) return null;
  const t = userText.toLowerCase();
  const caps = new Set(input.capabilities ?? []);
  const can = (c: string) => caps.size === 0 || caps.has(c);
  if (/\b(?:add|invite|enroll|sign (?:up|in)|new (?:person|participant|client))\b/.test(t) && can("org.participant.invite")) {
    return { id: "dead:add", label: "Open Add people filled in", why: "I can fill the form from your words. You press Send invite.", prompt: "Open Add people filled in for " };
  }
  if (/\b(?:take me|go to|open|where is|show me)\b/.test(t)) {
    return { id: "dead:goto", label: "Show me a button to the page", why: "Name the page; I show a Go to button.", prompt: "Show me a button to " };
  }
  if (/\b(?:send|text|email|message)\b/.test(t)) {
    return { id: "dead:draft", label: "Draft it for me to send", why: "I write it; you send it yourself.", prompt: "Draft that message for me to send myself." };
  }
  if (/\b(?:employer|job|hiring|hire)\b/.test(t)) {
    return { id: "dead:employers", label: "Search employers that hire people with records", why: "Name a state and the kind of work.", prompt: "Find employers that hire people with records in " };
  }
  return offersFor(input)[0] ?? null;
}

/**
 * The one obvious next step after a finished answer, from the tools that ran,
 * or null. Most answers get nothing: an offer after every answer is nagging.
 */
export function nextStepOffer(toolNames: readonly string[], input: OfferInput): StaffOffer | null {
  const has = (n: string) => toolNames.includes(n);
  const who = input.person?.id ? input.person : null;
  const first = (who?.firstName ?? "").trim().split(/\s+/)[0];
  if (has("read_participant_overview") && who && !has("offer_staff_draft")) {
    return { id: `next:checkin:${who.id}`, label: first ? `Draft a check-in to ${first}` : "Draft a check-in", why: "A short message from what you just read. You send it.", prompt: "", skill: "staff-check-in", clientId: who.id };
  }
  if (has("open_add_person")) return { id: "next:welcome", label: "Draft a welcome message", why: "For once they join. You send it yourself.", prompt: "Draft a short welcome message for the person I am adding. Keep it warm and short." };
  if (has("find_employers") && !has("find_local_help")) return { id: "next:help", label: "Local help near there too", why: "Rides, ID, clothes for work: name the need.", prompt: "Find local help near there. The need is: " };
  if (has("find_local_help") && !has("find_employers")) return { id: "next:employers", label: "Employers near there too", why: "Employers that hire people with records, with the date we checked.", prompt: "Find employers that hire people with records near there, for this kind of work: " };
  if (has("read_today_queue") && !has("read_caseload_digest")) return { id: "next:stale", label: "Who is slipping?", why: "Stale cases with a plain reason each.", prompt: "Flag the stale cases on my caseload, with reasons." };
  return null;
}

/** True when a finished answer's tool results include a refusal. */
export function hasRefusedTool(results: readonly unknown[]): boolean {
  return results.some((r) => {
    const s = (r as { status?: unknown } | null)?.status;
    return s === "refused" || s === "unavailable" || s === "needs_name";
  });
}

/* --------------------------------------------------------------- timing -- */

export const IDLE_MS = 5_000;
export const SPACING_MS = 20_000;

export interface DiscoveryState {
  /** Last keypress, click or scroll anywhere (ms). */
  lastActivityAt: number;
  /** Last keypress (ms). */
  lastTypedAt: number;
  /** When the last unasked-for offer showed (ms), or null. */
  lastShownAt: number | null;
  /** Offers shown or dismissed this session: never again. */
  seen: ReadonlySet<string>;
  /** Answers that already had an offer. */
  answersWithOffer: ReadonlySet<string>;
  /** Screen visits (path plus arrival time) that already had an offer. */
  screensWithOffer: ReadonlySet<string>;
}

export function initialDiscoveryState(now = 0): DiscoveryState {
  return { lastActivityAt: now, lastTypedAt: -Infinity, lastShownAt: null, seen: new Set(), answersWithOffer: new Set(), screensWithOffer: new Set() };
}

export interface DiscoveryMoment {
  now: number;
  /** The off switch (suggestionsOn). */
  enabled: boolean;
  /** t.ROY is working on an answer. */
  busy: boolean;
  /** Text sitting in the message box, or focus in a field with text in it. */
  typing: boolean;
  /** This screen visit's key. */
  screenKey: string;
  /** The newest finished answer, if the last thing that happened was one. */
  answerId?: string | null;
  /** That answer was a dead end. Skips the 5 second wait, nothing else. */
  deadEnd?: boolean;
  /** Candidate offers, best first. */
  offers: readonly StaffOffer[];
}

/** The one offer to show now, or null. Every rule in the header is here. */
export function pickOffer(state: DiscoveryState, m: DiscoveryMoment): StaffOffer | null {
  if (!m.enabled || m.busy || m.typing) return null;
  if (m.now - state.lastTypedAt < IDLE_MS) return null;
  if (!m.deadEnd && m.now - state.lastActivityAt < IDLE_MS) return null;
  if (state.lastShownAt !== null && m.now - state.lastShownAt < SPACING_MS) return null;
  if (m.answerId && state.answersWithOffer.has(m.answerId)) return null;
  if (!m.answerId && state.screensWithOffer.has(m.screenKey)) return null;
  return m.offers.find((o) => !state.seen.has(o.id)) ?? null;
}

/** Record that an offer showed. */
export function markShown(state: DiscoveryState, offer: StaffOffer, m: Pick<DiscoveryMoment, "now" | "screenKey" | "answerId">): DiscoveryState {
  return {
    ...state,
    lastShownAt: m.now,
    seen: new Set([...state.seen, offer.id]),
    answersWithOffer: m.answerId ? new Set([...state.answersWithOffer, m.answerId]) : state.answersWithOffer,
    screensWithOffer: new Set([...state.screensWithOffer, m.screenKey]),
  };
}

/* -------------------------------------------------------- the off switch -- */

/** The staff preference field (S3 adds it to StaffPrefs; default on). */
export const SUGGESTIONS_PREF = "troySuggestions";

/**
 * Whether unasked-for suggestions are on, from GET /api/org/prefs (or its
 * `effective` object). Default on: absent, unreadable or not yet a field
 * means on. Only an explicit false turns them off.
 */
export function suggestionsOn(prefs: unknown): boolean {
  if (!prefs || typeof prefs !== "object") return true;
  const p = prefs as Record<string, unknown>;
  const eff = p.effective && typeof p.effective === "object" ? (p.effective as Record<string, unknown>) : p;
  return eff[SUGGESTIONS_PREF] !== false;
}
