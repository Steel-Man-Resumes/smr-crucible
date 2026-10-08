/**
 * Creative lanes in the Refinery: the words the screens show and small pure
 * helpers. No server imports. Job-seeker voice: plain, second person, one
 * idea per line. Never labels the person.
 */

import type { ProofMark, TitleMode } from "@crucible/core/src/practiceRecordShared";
import type { BioPronoun } from "@crucible/core/src/creativeLaneShared";

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

export const CV_TABS = [
  { key: "record", label: "Your record" },
  { key: "cv", label: "CV" },
] as const;

export const CV_INTRO =
  "Your schooling, teaching, research, talks, clinical work and licenses, in one record. Your CV is built from it, dated line by line.";

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
  venue_only: { label: "Just the venue", body: "Only the kind of entry and the venue, like \"Teaching, the venue\". The title stays off every page on this lane." },
  leave_out: { label: "Leave it off", body: "Not on any page in this lane. It stays in your record." },
};

export const TITLE_MODE_WHY =
  "This one names a facility. You pick how it shows on this lane. We never rename it or soften it.";

export const PRONOUN_COPY: Record<BioPronoun, string> = {
  name: "Use my name",
  they: "They / them",
  she: "She / her",
  he: "He / him",
};

export const BIO_HOW =
  "t.ROY builds sentences from your record, one entry at a time. Nothing gets in until you keep it. Rewrite any of them, or write your own.";

export const STATEMENT_HOW =
  "This one is yours. t.ROY asks questions and points out spelling. It never writes a word of it, and nothing you write here goes to an AI.";

export const STATEMENT_SPELLING_HOW = "Tap Fix to change that one word. Nothing else moves.";

export const SPELLING_CAPPED =
  "That's a lot of words to check at once. Spelling was checked on the first part only. Fix those, then check again.";

export const SAMPLES_HOW =
  "Put your strongest work first. Every line is what you typed in your record.";

export const PLAIN_TEXT_HOW =
  "For application boxes. The count includes spaces, the way most forms count.";

export const PLAIN_TEXT_DRAFT =
  "Still a draft. Something on this one needs your answer first. You can look at the text, but answer the open items before you paste it anywhere.";

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
