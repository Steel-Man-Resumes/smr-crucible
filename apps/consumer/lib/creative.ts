/**
 * Creative lanes in the Refinery: the words the screens show and small pure
 * helpers. No server imports. Job-seeker voice: plain, second person, one
 * idea per line. Never labels the person.
 */

import type { ProofMark, TitleMode } from "@crucible/core/src/practiceRecordShared";
import type { BioDisclosureMode, BioPronoun } from "@crucible/core/src/creativeLaneShared";

export const CREATIVE_TABS = [
  { key: "record", label: "Your record" },
  { key: "resume", label: "Artist resume" },
  { key: "bio", label: "Bio" },
  { key: "statement", label: "Statement" },
  { key: "samples", label: "Work samples" },
  { key: "text", label: "Plain text" },
  { key: "plan", label: "Two paths" },
] as const;
export type CreativeTab = (typeof CREATIVE_TABS)[number]["key"];

export const CREATIVE_INTRO =
  "Your shows, gigs, programs and work, in one record. Your artist resume, bio and sample list are built from it. Your statement stays yours.";

export const TROY_CREATIVE_LINE =
  "Put in what you've done, the way you'd say it. I build the pages from that and nothing else.";

export const PROOF_COPY: Record<ProofMark, { label: string; body: string }> = {
  checked: { label: "Checked", body: "I have something that shows it: a flyer, a program, a letter, a link." },
  remembered: { label: "Remembered", body: "I remember it well. No paper on hand." },
  need_to_find: { label: "Still finding proof", body: "It happened. I'm tracking down the paper." },
};

export const TITLE_MODE_COPY: Record<TitleMode, { label: string; body: string }> = {
  true_title: { label: "Show the real title", body: "Exactly as it was. Some people want it seen." },
  venue_only: { label: "Just the venue", body: "\"Group exhibition, the venue, the city.\" The title stays off this page." },
  leave_out: { label: "Leave it off", body: "Not on this lane. It stays in your record." },
};

export const TITLE_MODE_WHY =
  "This one names a facility. You pick how it shows on this lane. We never rename it or soften it.";

export const DISCLOSURE_COPY: Record<BioDisclosureMode, { label: string; body: string }> = {
  include: { label: "Include it", body: "t.ROY can draft from those entries like any other." },
  context: { label: "In my own words", body: "t.ROY leaves them out of the draft. You write that sentence yourself." },
  leave_out: { label: "Leave it out", body: "Your bio covers everything else." },
};

export const PRONOUN_COPY: Record<BioPronoun, string> = {
  name: "Use my name",
  they: "They / them",
  she: "She / her",
  he: "He / him",
};

export const BIO_HOW =
  "t.ROY drafts from your record only. Nothing gets in until you keep it. Cut anything that doesn't sound like you, or write your own.";

export const STATEMENT_HOW =
  "This one is yours. t.ROY asks questions and points out spelling. It never writes a word of it.";

export const STATEMENT_SPELLING_HOW = "Tap Fix to change that one word. Nothing else moves.";

export const SAMPLES_HOW =
  "Put your strongest work first. Every line is what you typed in your record.";

export const PLAIN_TEXT_HOW =
  "For application boxes. The count includes spaces, the way most forms count.";

export const PAGE_CAP_COPY = {
  label: "This call allows up to 4 pages",
  body: "Leave it off unless the call says so. Most want 1 to 2 pages.",
};

export const PAIR_OFFER =
  "Want a realistic lane next to your dream? A job you can get now, while you build toward this. Same facts underneath.";

export const PLAN_HOW =
  "Just for you. This card never goes on any page.";

export const CREATIVE_ERRORS = {
  failed: "That didn't save. Try again.",
  loadFailed: "Couldn't load your creative lane. Refresh the page.",
};

/** A character limit check for a portal box: over by how much, or null. */
export function overLimit(chars: number, limit: number | null): number | null {
  if (!limit || limit <= 0) return null;
  return chars > limit ? chars - limit : null;
}

/** Same-origin JSON write. Returns the parsed body and whether it worked. */
export async function sendJson<T = Record<string, unknown>>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown
): Promise<{ ok: boolean; status: number; data: T & { message?: string; error?: string } }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { message: CREATIVE_ERRORS.failed } as T & { message?: string } };
  }
}
