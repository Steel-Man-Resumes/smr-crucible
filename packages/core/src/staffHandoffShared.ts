/**
 * Handoffs from a staff member to one participant, and "connections the
 * client missed" (migration 110, staff pass lane S5): the pure, browser-safe
 * half. Validation, words, and the matching rules, so they are tested without
 * a database and the screens say exactly what the server checks.
 *
 * THE PROMISE. A handoff is a suggestion, never a change to the person's own
 * work. They answer each item. What they take goes to places they already
 * have: an employer or a job to their saved jobs, a place for help to their
 * saved help, a next step to their "From your case manager" list. Staff see
 * only waiting, taken or passed. Nothing about the person's record is read,
 * matched on or sent.
 */

/* ------------------------------------------------------------ the packet -- */

export const HANDOFF_ITEM_KINDS = ["employer", "resource", "next_step", "job"] as const;
export type HandoffItemKind = (typeof HANDOFF_ITEM_KINDS)[number];
export const HANDOFF_MAX_ITEMS = 10;
export const HANDOFF_NOTE_MIN = 3;
export const HANDOFF_NOTE_MAX = 1000;
export const HANDOFF_WHY_MAX = 1500;

/** One item as a staff member (or t.ROY's draft) hands it in. */
export type HandoffItemInput =
  | { kind: "employer"; employerId: string; name: string; role: string; location?: string | null; applyUrl?: string | null; why: string }
  | { kind: "resource"; resourceId: string; name: string; why: string }
  | { kind: "next_step"; step: string; dueOn?: string | null; why: string }
  | { kind: "job"; jobTitle: string; company: string; location?: string | null; applyUrl?: string | null; why: string };

export interface HandoffInput {
  note: string;
  items: HandoffItemInput[];
  draftedByAssistant?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max + 1) : "");
/** The note keeps its line breaks; only the ends are trimmed. */
const cleanNote = (v: unknown): string => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim() : "");

export function isHandoffItemKind(v: unknown): v is HandoffItemKind {
  return typeof v === "string" && (HANDOFF_ITEM_KINDS as readonly string[]).includes(v);
}

/** A due date that is a real calendar day, from today to a year out. */
export function cleanDueOn(v: unknown, now = Date.now()): string | null | "bad" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !DAY.test(v)) return "bad";
  const t = Date.parse(`${v}T12:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== v) return "bad";
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
  if (t < today.getTime() || t > today.getTime() + 366 * 86400000) return "bad";
  return v;
}

export type HandoffCheck = { ok: true; value: { note: string; items: HandoffItemInput[]; draftedByAssistant: boolean } } | { ok: false; error: string };

/**
 * Check a whole handoff before it is sent. Plain words for every refusal; the
 * database repeats the shape rules (staff_suggestion_shape, 110).
 */
export function checkHandoff(raw: unknown, now = Date.now()): HandoffCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Nothing to send." };
  const b = raw as Record<string, unknown>;
  const note = cleanNote(b.note);
  if (note.length < HANDOFF_NOTE_MIN) return { ok: false, error: "Write a short note to go with it. They will read it first." };
  if (note.length > HANDOFF_NOTE_MAX) return { ok: false, error: `Keep the note under ${HANDOFF_NOTE_MAX} characters.` };
  const list = Array.isArray(b.items) ? b.items : [];
  if (list.length === 0) return { ok: false, error: "Add at least one thing to send: an employer, a place for help, a next step or a job." };
  if (list.length > HANDOFF_MAX_ITEMS) return { ok: false, error: `Send at most ${HANDOFF_MAX_ITEMS} things at a time.` };
  const items: HandoffItemInput[] = [];
  const seen = new Set<string>();
  for (const [i, x] of list.entries()) {
    const n = i + 1;
    if (!x || typeof x !== "object") return { ok: false, error: `Item ${n} is empty.` };
    const it = x as Record<string, unknown>;
    const why = clean(it.why, HANDOFF_WHY_MAX);
    if (why.length < 3) return { ok: false, error: `Say why item ${n} might help them. They will read it.` };
    if (why.length > HANDOFF_WHY_MAX) return { ok: false, error: `Keep the reason for item ${n} shorter.` };
    let key: string;
    if (it.kind === "employer") {
      const employerId = String(it.employerId ?? "");
      const name = clean(it.name, 200), role = clean(it.role, 200);
      if (!UUID.test(employerId)) return { ok: false, error: `Item ${n}: pick the employer from the directory.` };
      if (!name || name.length > 200) return { ok: false, error: `Item ${n}: the employer needs its name.` };
      if (!role || role.length > 200) return { ok: false, error: `Item ${n}: name a kind of job to look at there. It goes on their saved jobs list.` };
      const applyUrl = cleanUrl(it.applyUrl);
      if (applyUrl === "bad") return { ok: false, error: `Item ${n}: the link has to start with https://` };
      const location = clean(it.location, 200) || null;
      items.push({ kind: "employer", employerId: employerId.toLowerCase(), name, role, location, applyUrl, why });
      key = `employer:${employerId.toLowerCase()}`;
    } else if (it.kind === "resource") {
      const resourceId = String(it.resourceId ?? "");
      const name = clean(it.name, 200);
      if (!UUID.test(resourceId)) return { ok: false, error: `Item ${n}: pick the place from the directory.` };
      if (!name || name.length > 200) return { ok: false, error: `Item ${n}: the place needs its name.` };
      items.push({ kind: "resource", resourceId: resourceId.toLowerCase(), name, why });
      key = `resource:${resourceId.toLowerCase()}`;
    } else if (it.kind === "next_step") {
      const step = clean(it.step, 200);
      if (step.length < 2 || step.length > 200) return { ok: false, error: `Item ${n}: write the next step in a few words (up to 200 characters).` };
      const dueOn = cleanDueOn(it.dueOn, now);
      if (dueOn === "bad") return { ok: false, error: `Item ${n}: pick a date from today to a year out, or leave it blank.` };
      items.push({ kind: "next_step", step, dueOn, why });
      key = `step:${step.toLowerCase()}`;
    } else if (it.kind === "job") {
      const jobTitle = clean(it.jobTitle, 200), company = clean(it.company, 200);
      if (!jobTitle || !company || jobTitle.length > 200 || company.length > 200) return { ok: false, error: `Item ${n}: a job needs a title and an employer.` };
      const applyUrl = cleanUrl(it.applyUrl);
      if (applyUrl === "bad") return { ok: false, error: `Item ${n}: the link has to start with https://` };
      items.push({ kind: "job", jobTitle, company, location: clean(it.location, 200) || null, applyUrl, why });
      key = `job:${jobTitle.toLowerCase()}@${company.toLowerCase()}`;
    } else {
      return { ok: false, error: `Item ${n}: that is not something a handoff can carry.` };
    }
    if (seen.has(key)) return { ok: false, error: `Item ${n} is already in this handoff.` };
    seen.add(key);
  }
  return { ok: true, value: { note, items, draftedByAssistant: b.draftedByAssistant === true } };
}

function cleanUrl(v: unknown): string | null | "bad" {
  if (v === undefined || v === null || v === "") return null;
  const t = String(v).trim();
  return /^https:\/\/\S+$/.test(t) && t.length <= 1000 ? t : "bad";
}

/** The columns one item becomes (staff_suggestion, 110). Exported for the SQL test. */
export function itemColumns(it: HandoffItemInput): {
  kind: HandoffItemKind; job_title: string | null; company: string | null; location: string | null; apply_url: string | null;
  employer_ref: string | null; resource_ref: string | null; ref_name: string | null; step_title: string | null; due_on: string | null; body: string;
} {
  const none = { job_title: null, company: null, location: null, apply_url: null, employer_ref: null, resource_ref: null, ref_name: null, step_title: null, due_on: null };
  switch (it.kind) {
    case "employer": return { ...none, kind: "employer", job_title: it.role, company: it.name, location: it.location ?? null, apply_url: it.applyUrl ?? null, employer_ref: it.employerId, body: it.why };
    case "resource": return { ...none, kind: "resource", resource_ref: it.resourceId, ref_name: it.name, body: it.why };
    case "next_step": return { ...none, kind: "next_step", step_title: it.step, due_on: it.dueOn ?? null, body: it.why };
    case "job": return { ...none, kind: "job", job_title: it.jobTitle, company: it.company, location: it.location ?? null, apply_url: it.applyUrl ?? null, body: it.why };
  }
}

/* ----------------------------------------------------------------- words -- */

export type ItemStatus = "open" | "saved" | "dismissed" | "withdrawn";
export type HandoffStatus = "sent" | "seen" | "withdrawn";

/** What staff see per item. "saved" is 057's word for taken. */
export const ITEM_STATUS_WORDS: Record<ItemStatus, string> = { open: "Waiting", saved: "Taken", dismissed: "Passed", withdrawn: "Withdrawn" };
export const HANDOFF_STATUS_WORDS: Record<HandoffStatus, string> = { sent: "Sent, not opened yet", seen: "Opened", withdrawn: "Withdrawn" };

/** The button a participant presses to take an item, by kind. */
export const TAKE_WORDS: Record<HandoffItemKind, string> = {
  employer: "Save to my jobs",
  job: "Save to my jobs",
  resource: "Save to my help list",
  next_step: "Add to my list",
};
/** Where a taken item went, said back to the participant. */
export const TAKEN_WORDS: Record<HandoffItemKind, string> = {
  employer: "Saved to your jobs.",
  job: "Saved to your jobs.",
  resource: "Saved to your help list.",
  next_step: "Added to your list from your case manager.",
};
export const PASS_WORDS = "Not for me";
export const HANDOFF_PROMISE = "These are suggestions. What you do with each one is up to you. Your case manager sees only whether you took it or passed.";

/** "Alma" from "Alma Reyes"; a fallback when there is no name to use. */
export function firstNameOf(name: string | null | undefined, fallback = "them"): string {
  const t = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return t && /[A-Za-z]/.test(t) ? t.slice(0, 40) : fallback;
}

/** The label on every "send this to a person" button. */
export function sendToLabel(name: string | null | undefined): string {
  return `Send to ${firstNameOf(name, "this person")}`;
}

/** One line naming an item, for lists and t.ROY. */
export function itemTitle(it: { kind: string; job_title?: string | null; company?: string | null; ref_name?: string | null; step_title?: string | null }): string {
  if (it.kind === "employer") return `${it.job_title ?? "Work"} at ${it.company ?? "an employer"}`;
  if (it.kind === "job") return `${it.job_title ?? "A job"} at ${it.company ?? "an employer"}`;
  if (it.kind === "resource") return it.ref_name ?? "A place for help";
  if (it.kind === "next_step") return it.step_title ?? "A next step";
  return "A comment on a document you shared";
}

/* ---------------------------------------------------------- connections -- */

/** What a participant SHARED that matching may use. Nothing else goes in. */
export interface SharedForMatching {
  /** From the applications scope: their tracked jobs. */
  applications: { jobTitle: string | null; company: string | null; location: string | null }[];
  /** From the resume scope: what each shared resume is aimed at. */
  resumeTargets: (string | null)[];
}

export interface MatchPlace { state: string; city: string | null; label: string }
export interface MatchInputs {
  /** Words to search employers' roles and trades by, each with the shared title it came from. */
  terms: { term: string; from: string; source: "applications" | "resume" }[];
  places: MatchPlace[];
}

const STATE_BY_NAME: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};
const STATE_CODES = new Set(Object.values(STATE_BY_NAME));

/** "Lansing, MI" / "Lansing, Michigan 48933" / "MI" -> { state: "MI", city: "Lansing" }; anything else -> null. */
export function parsePlace(location: string | null | undefined): MatchPlace | null {
  const t = String(location ?? "").replace(/\s+/g, " ").trim();
  if (!t || /^remote\b/i.test(t)) return null;
  const parts = t.split(",").map((p) => p.trim()).filter(Boolean);
  const tail = (parts[parts.length - 1] ?? "").replace(/\s+\d{5}(?:-\d{4})?$/, "").replace(/\.$/, "").trim();
  const code = tail.length === 2 && STATE_CODES.has(tail.toUpperCase()) ? tail.toUpperCase() : STATE_BY_NAME[tail.toLowerCase()] ?? null;
  if (!code) return null;
  const city = parts.length > 1 ? parts[parts.length - 2].replace(/[^A-Za-z .'-]/g, "").trim().slice(0, 80) || null : null;
  return { state: code, city, label: city ? `${city}, ${code}` : code };
}

/** Words that say nothing about the kind of work. */
const GENERIC = new Set([
  "associate", "associates", "worker", "workers", "specialist", "assistant", "entry", "level", "part", "full", "time", "i", "ii", "iii",
  "and", "or", "of", "the", "a", "an", "to", "for", "in", "at", "with", "job", "jobs", "position", "role", "team", "member", "members",
  "staff", "employee", "general", "senior", "junior", "sr", "jr", "lead", "trainee", "apprentice", "helper", "temp", "seasonal",
  "day", "night", "shift", "first", "second", "third", "1st", "2nd", "3rd", "remote", "hybrid", "onsite", "new", "hiring", "now", "immediate",
]);

/** The distinctive words of a job title: "Warehouse Associate II" -> ["warehouse"]. At most three. */
export function titleTerms(title: string | null | undefined): string[] {
  const words = String(title ?? "").toLowerCase().replace(/[^a-z0-9 -]/g, " ").split(/[\s-]+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) if (w.length >= 3 && !GENERIC.has(w) && !out.includes(w)) out.push(w);
  return out.slice(0, 3);
}

/**
 * Turn what was shared into search terms and places. Deterministic and capped,
 * so the same sharing always asks the directory the same few questions.
 */
export function matchInputs(shared: SharedForMatching, caps = { terms: 4, places: 2 }): MatchInputs {
  const terms: MatchInputs["terms"] = [];
  const add = (from: string | null, source: "applications" | "resume") => {
    for (const term of titleTerms(from)) {
      if (terms.length >= caps.terms) return;
      if (!terms.some((t) => t.term === term)) terms.push({ term, from: String(from).replace(/\s+/g, " ").trim().slice(0, 120), source });
    }
  };
  for (const a of shared.applications) add(a.jobTitle, "applications");
  for (const r of shared.resumeTargets) add(r, "resume");
  const places: MatchPlace[] = [];
  const count = new Map<string, { place: MatchPlace; n: number }>();
  for (const a of shared.applications) {
    const p = parsePlace(a.location);
    if (!p) continue;
    const k = `${p.state}|${(p.city ?? "").toLowerCase()}`;
    const c = count.get(k);
    if (c) c.n++; else count.set(k, { place: p, n: 1 });
  }
  for (const { place } of [...count.values()].sort((x, y) => y.n - x.n)) {
    if (places.length >= caps.places) break;
    if (!places.some((p) => p.state === place.state && p.city === place.city)) places.push(place);
  }
  return { terms, places };
}

const SOURCE_WORDS = { applications: "a job they saved and shared with you", resume: "a resume they shared with you" } as const;

/** Why an employer matched, in words staff can repeat. Built only from the listing and what was shared. */
export function employerMatchReason(e: { band: string; checkedAt?: string | null; state: string }, term: { term: string; from: string; source: "applications" | "resume" }, place: MatchPlace | null): string {
  const mark = e.band === "A" ? "carries the hiring mark" : "has reported hiring evidence, below the mark";
  const where = place ? ` in ${place.state}` : "";
  const checked = e.checkedAt ? `, checked ${String(e.checkedAt).slice(0, 10)}` : "";
  return `Hires for ${term.term} work${where} and ${mark}${checked}. Matches "${term.from}", ${SOURCE_WORDS[term.source]}.`;
}

/** Why a place for help matched. */
export function resourceMatchReason(r: { band: string; area_label?: string | null }, place: MatchPlace): string {
  const band = r.band === "A" ? "checked" : r.band === "B" ? "listed, not yet checked by us" : "found in a public list, unconfirmed";
  return `${r.area_label ?? "Job help"} for ${place.label} (${band}). Matches where the jobs they shared are.`;
}

/** Normalized company name, for "already on their list". */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/\b(inc|llc|co|corp|corporation|company|the)\b/g, "").replace(/[^a-z0-9]+/g, "");
  const x = n(a), y = n(b);
  return !!x && x === y;
}

/** When nothing was shared, what staff could ask for, and why. */
export const NOTHING_SHARED_LINE = "They have not shared their job applications or resumes with you, so there is nothing to match on. Matching never uses anything they have not shared. You can ask them to share from their page.";
export const MATCH_LIMITS_LINE = "Matches come only from what they shared: the jobs they saved and the resumes they made. Their record, their address and their private plans are never used.";
