/**
 * What a participant can choose to show their organization, and the exact
 * words they are shown when they choose.
 *
 * AN ALLOWLIST, like org capabilities: a scope string that is not in this file
 * does not exist, whatever a database row says. Rows are filtered against it.
 *
 * THE WORDS ARE THE PROMISE. `SHARING_TEXT_VERSION` is stored on every grant,
 * so it is always possible to say what somebody agreed to. Change any `shows`
 * or `never` line below and the version MUST change with it. A grant made under
 * older words is never read as agreement to newer, wider ones.
 *
 * A scope appears here only when its staff-side projection exists. Listing a
 * scope the product cannot yet honour precisely would be a promise with nothing
 * behind it; practice, disclosure and single vault documents are deliberately
 * absent until theirs are built.
 */
export const SHARING_TEXT_VERSION = "2026-09-20.1";

export const SHARING_SCOPES = ["applications", "resume", "documents"] as const;
export type SharingScope = (typeof SHARING_SCOPES)[number];

const SCOPE_SET: ReadonlySet<string> = new Set(SHARING_SCOPES);
export function isSharingScope(value: unknown): value is SharingScope {
  return typeof value === "string" && SCOPE_SET.has(value);
}

export interface SharingScopeText {
  label: string;
  /** What your case manager will be able to see. */
  shows: string;
  /** What stays private even with this on. */
  never: string;
  /** Said once, at the moment of turning it on. */
  firstTime: string;
}

export const SHARING_SCOPE_TEXT: Record<SharingScope, SharingScopeText> = {
  applications: {
    label: "Your job applications",
    shows:
      "The jobs you are tracking: job title, company, location, where each one stands, the dates, your follow-up date and the link to apply.",
    never: "Your private notes on a job, the pay you wrote down, and the full job description you saved.",
    firstTime: "This includes the applications already in your tracker, not only new ones.",
  },
  resume: {
    label: "Your resume",
    shows: "The resumes in your library as they are right now, including ones you tailored to a job, to read. They cannot change them.",
    never: "The edit history of a resume, your disclosure plan, and anything you said to the coach while building it.",
    firstTime: "This includes the resumes you have already made, not only new ones.",
  },
  documents: {
    label: "Your cover letters",
    shows: "Your cover letters as they are right now, to read. They cannot change them.",
    never: "The edit history of a letter, your disclosure plan, and your interview practice.",
    firstTime: "This includes the letters you have already written, not only new ones.",
  },
};

/** Shown on the sharing page whatever is switched on. Part of the same promise. */
export const SHARING_ALWAYS_TEXT = {
  control:
    "You decide this, and you can turn any of it off at any time. Turning it off stops new viewing from that moment. It cannot take back something a person already read or wrote down.",
  log: "Every time someone at your organization opens something you shared, it is recorded, and you can see that record here.",
  staffNotes:
    "Your case manager keeps their own notes about working with you. Those notes belong to your organization. You will see a note here only if they choose to show it to you.",
  leaving:
    "Leaving your organization on Steel Man turns all of this off and keeps your account, your resumes and all your work with you. We cannot tell you what your program's own rules are about leaving. Ask them.",
} as const;
