/**
 * Staff directory contributions: the PURE, client-safe half (flows, words,
 * the same validation the 112 intake function applies, credit weights).
 * The database half is ./directoryContribution.
 *
 * Staff "know people who know people." Four ways in, inside the work; every
 * submission lands in the SMR data owner's review queue (the data charter's
 * one-owner rule); nothing publishes on its own. A logged live call is the
 * documented interaction behind employer Tier 2 and resource R3 (073);
 * hearsay never is. A person's own contact stays private. Credit is recorded
 * for the program (and the staff member only if they opt in) and is NOT shown
 * publicly: the listing wording is Troy's decision 5, still open.
 */

export const CONTRIBUTION_FLOWS = ["new_place", "correction", "called_today", "knows_someone"] as const;
export type ContributionFlow = (typeof CONTRIBUTION_FLOWS)[number];
export const CONTRIBUTION_KINDS = ["employer", "resource"] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];
export const CONTACT_METHODS = ["phone_call", "in_person", "email_reply", "site_visit", "website", "heard_from_someone"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];
/** The methods that make a call a documented interaction (073: hearsay never confirms). */
export const DOCUMENTED_METHODS: readonly ContactMethod[] = ["phone_call", "in_person", "email_reply", "site_visit"];
export const CONTRIBUTION_STATUSES = ["received", "approved", "needs_more", "not_used", "withdrawn"] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];
export const CONTRIBUTION_OUTCOMES = ["verified_call", "warm_intro", "correction", "new_row"] as const;
export type ContributionOutcome = (typeof CONTRIBUTION_OUTCOMES)[number];

/** Same weights as 112 decide_directory_contribution: a live check counts most, a new row least. */
export const CONTRIBUTION_CREDIT: Readonly<Record<ContributionOutcome, number>> = {
  verified_call: 3, warm_intro: 3, correction: 2, new_row: 1,
};
/** Which outcomes fit which flow (the 112 CHECK). */
export const OUTCOMES_FOR_FLOW: Readonly<Record<ContributionFlow, ContributionOutcome[]>> = {
  new_place: ["new_row"],
  correction: ["correction"],
  called_today: ["verified_call", "correction"],
  knows_someone: ["warm_intro"],
};

export const FLOW_LABELS: Record<ContributionFlow, { title: string; help: string; button: string }> = {
  new_place: { title: "Add a place we are missing", help: "An employer or a local help program people should know about.", button: "Add a place" },
  correction: { title: "Something here is wrong", help: "Hours, phone, address, closed or moved. Tell us what you saw.", button: "Suggest a fix" },
  called_today: { title: "I checked with them", help: "You called, visited, or they emailed you back. What did they say, and when?", button: "I called them" },
  knows_someone: { title: "I know someone who hires there", help: "Tell us privately who you know. We never publish a person's name or number.", button: "I know someone there" },
};
export const METHOD_LABELS: Record<ContactMethod, string> = {
  phone_call: "I called them",
  in_person: "I talked with them in person",
  email_reply: "They emailed me back",
  site_visit: "I visited",
  website: "I saw it on their website",
  heard_from_someone: "Someone told me",
};
export const STATUS_WORDS: Record<ContributionStatus, string> = {
  received: "Received. Waiting for review.",
  approved: "Approved. Thank you.",
  needs_more: "We need a little more.",
  not_used: "Not used this time.",
  withdrawn: "You took this back.",
};

export interface ContributionDetails { name?: string; city?: string; state?: string; website?: string; phone?: string; change?: string; said?: string }
export interface ContributionInput {
  flow: ContributionFlow;
  targetKind: ContributionKind;
  targetId?: string | null;
  details?: ContributionDetails;
  interactionOn?: string | null;
  interactionMethod?: ContactMethod | null;
  sourceUrl?: string | null;
  privateNote?: string | null;
  creditOrgOk?: boolean;
  creditPersonOk?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]+/g;
const FIELD_CAP: Record<keyof ContributionDetails, number> = { name: 200, city: 200, state: 2, website: 200, phone: 30, change: 600, said: 600 };
const clean = (v: unknown) => String(v ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;

/** Days between two YYYY-MM-DD dates (b minus a), UTC. */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

/**
 * The 112 intake's rules, in the app, so a staff member hears what is missing
 * before anything is sent. The database checks all of it again.
 * `today` is the staff member's YYYY-MM-DD (tests pass it in).
 */
export function normalizeContribution(raw: unknown, today: string):
  | { ok: true; value: ContributionInput & { details: ContributionDetails } }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Nothing to send." };
  const r = raw as Record<string, unknown>;
  const flow = oneOf(CONTRIBUTION_FLOWS, r.flow);
  const targetKind = oneOf(CONTRIBUTION_KINDS, r.targetKind);
  if (!flow || !targetKind) return { ok: false, error: "Pick what kind of update this is." };
  const d = (r.details && typeof r.details === "object" && !Array.isArray(r.details) ? r.details : {}) as Record<string, unknown>;
  const details: ContributionDetails = {};
  for (const key of Object.keys(FIELD_CAP) as (keyof ContributionDetails)[]) {
    const v = clean(d[key]);
    if (!v) continue;
    if (key === "state" && !/^[A-Z]{2}$/.test(v.toUpperCase())) return { ok: false, error: "Use the two-letter state, like MI." };
    if (key === "website" && !/^https?:\/\//i.test(v)) return { ok: false, error: "A website starts with http:// or https://." };
    details[key] = key === "state" ? v.toUpperCase() : v.slice(0, FIELD_CAP[key]);
  }
  const targetId = r.targetId ? String(r.targetId) : null;
  if (targetId && !UUID.test(targetId)) return { ok: false, error: "That listing was not found." };
  const interactionOn = r.interactionOn ? String(r.interactionOn) : null;
  if (interactionOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(interactionOn) || Number.isNaN(Date.parse(interactionOn))) return { ok: false, error: "Pick the date." };
    const ago = dayDiff(interactionOn, today);
    if (ago < 0 || ago > 30) return { ok: false, error: "The date has to be in the last 30 days." };
  }
  const interactionMethod = r.interactionMethod ? oneOf(CONTACT_METHODS, r.interactionMethod) : null;
  if (r.interactionMethod && !interactionMethod) return { ok: false, error: "Pick how you heard." };
  const sourceUrl = clean(r.sourceUrl) || null;
  if (sourceUrl && (!/^https?:\/\//i.test(sourceUrl) || sourceUrl.length > 500)) return { ok: false, error: "A link starts with http:// or https://." };
  const privateNote = clean(r.privateNote) || null;
  if (privateNote && privateNote.length > 1000) return { ok: false, error: "Keep the private note under 1000 characters." };

  if (flow === "new_place" && (targetId || !details.name || !details.state)) return { ok: false, error: "A new place needs its name and state." };
  if (flow === "correction" && (!targetId || !details.change)) return { ok: false, error: "Say what should change." };
  if (flow === "called_today") {
    if (!targetId || !details.said) return { ok: false, error: "Say what they told you." };
    if (!interactionOn) return { ok: false, error: "Pick the day you reached them." };
    if (!interactionMethod || !DOCUMENTED_METHODS.includes(interactionMethod)) return { ok: false, error: "Pick how you reached them: a call, a visit, or their email back." };
  }
  if (flow === "knows_someone") {
    if (targetKind !== "employer") return { ok: false, error: "This one is for employers." };
    if (!privateNote) return { ok: false, error: "Tell us, privately, who you know there." };
    if (!targetId && !details.name) return { ok: false, error: "Which employer?" };
  }
  return {
    ok: true,
    value: {
      flow, targetKind, targetId, details, interactionOn, interactionMethod, sourceUrl, privateNote,
      creditOrgOk: r.creditOrgOk === undefined ? true : r.creditOrgOk === true,
      creditPersonOk: r.creditPersonOk === true,
    },
  };
}

/** The jsonb the 112 intake function takes. */
export function intakePayload(v: ContributionInput & { details: ContributionDetails }): Record<string, unknown> {
  return {
    flow: v.flow,
    target_kind: v.targetKind,
    target_id: v.targetId ?? null,
    details: v.details,
    interaction_on: v.interactionOn ?? null,
    interaction_method: v.interactionMethod ?? null,
    source_url: v.sourceUrl ?? null,
    private_note: v.privateNote ?? null,
    credit_org_ok: v.creditOrgOk !== false,
    credit_person_ok: v.creditPersonOk === true,
  };
}

/** Free text a staff member typed that the app must put through the record-word gate. */
export function contributionFreeText(v: ContributionInput): string[] {
  return [v.details?.change, v.details?.said, v.details?.name].filter((s): s is string => !!s);
}
