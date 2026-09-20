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
export const SHARING_TEXT_VERSION = "2026-09-20.2";

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


/* ------------------------------------------------------ required by a program -- */

/** What a program may require. Disclosure, practice and vault files never appear here. */
export const REQUIRABLE_SCOPES = ["applications", "resume", "documents"] as const satisfies readonly SharingScope[];

export const POLICY_AUDIENCES = ["assigned_staff", "assigned_staff_and_admins"] as const;
export type PolicyAudience = (typeof POLICY_AUDIENCES)[number];
export const POLICY_AUDIENCE_TEXT: Record<PolicyAudience, string> = {
  assigned_staff: "Only the case manager assigned to you.",
  assigned_staff_and_admins: "The case manager assigned to you, and the people who run the program.",
};

/**
 * Starting points for the organization's OWN stated reason. They are offered
 * because an owner facing an empty box writes "policy", and a participant
 * deserves a real sentence. The organization edits the words; what it saves is
 * shown to participants verbatim, under the organization's name, as THEIR rule.
 */
export const POLICY_PURPOSE_PRESETS: { label: string; text: string }[] = [
  { label: "A contract or grant requires it", text: "Our funding agreement requires us to verify each participant's job-search activity. Your case manager reviews it with you; it is not used to penalize you." },
  { label: "A condition of the program", text: "Sharing your job-search materials with your case manager is a condition of enrolling in this program, so that they can coach you on real applications rather than in general." },
  { label: "Court or supervision reporting", text: "Some participants must show documented job-search effort to a court or supervising officer. We review your activity with you so that what is reported is accurate and complete." },
  { label: "Reporting outcomes to a funder", text: "We report job placements and retention to the funder that pays for this program. Your case manager confirms those outcomes from your applications." },
];

/** Shown around the organization's words whenever a requirement is presented. Our sentences, not theirs. */
export const SHARING_REQUIRED_TEXT = {
  heading: "This program requires some sharing",
  notConsent:
    "This is the program's rule, not a choice we are asking you to make freely, and we will not describe it as your consent. What follows is exactly what they require and why, in their words.",
  acknowledging:
    "Acknowledging means your case manager can open the items listed. They can read them and cannot change them. You will see every time they open one.",
  coversExisting: "This covers what you have already made here, not only what you make from now on.",
  coversFuture: "This covers only what you make from today on. What you made before today stays private unless you choose to share it.",
  neverRequired: "Your disclosure plan, your interview practice and your stored documents can never be required by any program. Those stay yours to share or not.",
  notLockedOut:
    "You can keep using Steel Man Resumes whether or not you acknowledge this. Your account, your resumes and your work are yours either way. Until you acknowledge, your case manager sees only that you have not.",
  stopping:
    "You can stop sharing a required item. We will not prevent you. Your program will see that you stopped, and we cannot tell you what their rules say happens then. Ask them first.",
  changes: "If the program changes what it requires, nothing new opens until you have seen the change and acknowledged it.",
} as const;
