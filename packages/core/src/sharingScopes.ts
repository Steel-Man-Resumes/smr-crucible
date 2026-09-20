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
export const SHARING_TEXT_VERSION = "2026-09-20.3";

/**
 * Wording versions under which sharing applications ALSO means their dates may
 * appear on a case manager's daily work list. Anyone who shared under earlier
 * words agreed to their applications being OPENED, not to that, so the work
 * queue ignores their grant until they share again under current words.
 * Append here when the version changes and the sentence is still in it.
 */
export const WORK_QUEUE_TEXT_VERSIONS: readonly string[] = ["2026-09-20.3"];

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
      "The jobs you are tracking: job title, company, location, where each one stands, the dates, your follow-up date and the link to apply. Your interview and follow-up dates also show up on your case manager's daily work list, so they can help you get ready in time.",
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
  log: "Every time someone at your organization opens something you shared, or your dates appear on their daily work list, it is recorded, and you can see that record here.",
  staffNotes:
    "Your case manager keeps their own notes about working with you. Your organization manages those notes. This screen shows only notes they choose to share with you; it does not determine any right you may have to request their records.",
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
  { label: "A contract or grant requires it", text: "Our funding agreement requires us to verify job-search activity. Before publishing, we must identify the agreement, the information it requires, who receives it, and what happens if you decline or stop sharing." },
  { label: "A condition of the program", text: "Sharing your job-search materials with your case manager is a condition of enrolling in this program, so that they can coach you on real applications rather than in general." },
  { label: "Court or supervision reporting", text: "Some participants must show documented job-search effort to a court or supervising officer. We review your activity with you so that what is reported is accurate and complete." },
  { label: "Reporting outcomes to a funder", text: "We report job placements and retention to the funder that pays for this program. Your case manager confirms those outcomes from your applications." },
];

/** Shown around the organization's words whenever a requirement is presented. Our sentences, not theirs. */
export const SHARING_REQUIRED_TEXT = {
  heading: "This program requires some sharing",
  notConsent:
    "This is the program's rule, not a choice we are asking you to make freely, and we will not describe it as your consent. Below are the items the program requires and its stated reason. Steel Man has not verified that a law, court order or funding agreement requires this sharing. This acknowledgement does not replace any separate permission required by law.",
  acknowledging:
    "Acknowledging opens the listed items to the staff described below, which may include program administrators. They can read these items here but cannot edit them here. Their access through this sharing feature is logged for you to see. Stopping sharing cannot take back information they already read or copied.",
  coversExisting: "This covers what you have already made here, not only what you make from now on.",
  coversFuture: "This requirement opens only items created after you acknowledge it. Earlier items are not opened by this requirement. Anything you already chose to share stays shared until you turn that sharing off.",
  neverRequired: "This sharing feature does not let programs require access to your disclosure plan, interview practice or vault files. Resumes and cover letters are separate items and can be listed above. Sensitive information you put into a shared resume, letter or application may still be visible there.",
  notLockedOut:
    "Declining this acknowledgement does not close your Steel Man account or delete your work. It does not open the listed items under this requirement. Your program can see that you have not acknowledged; information you already shared and program membership records may still be visible. Ask the program what declining means for its services or any court or supervision requirements.",
  stopping:
    "You can stop sharing a required item here at any time. That stops new viewing through this sharing feature, but does not erase copies or program records already made. Your program can see which required items you stopped sharing. Steel Man cannot promise that declining or stopping has no effect on services, benefits or court or supervision requirements. Ask the program to explain its rules and any alternatives; you do not need its permission to use this stop control.",
  changes: "If the program changes what it requires, nothing new opens until you have seen the change and acknowledged it.",
} as const;
