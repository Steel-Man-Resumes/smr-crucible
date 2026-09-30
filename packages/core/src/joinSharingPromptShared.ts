/**
 * The one-time "share your progress?" question a participant is asked right
 * after they join an organization. Pure: no database, safe for a client bundle.
 *
 * It asks for the SAME consent the Settings switch sets (the 'sharing' layer in
 * consumer_consent). There is no second consent store. This file holds the
 * words, the version recorded with a yes, and the rule for when to ask.
 *
 * THE WORDS ARE THE PROMISE. Each line in `sees` is something staff are shown
 * for a person with progress sharing on (the console's client table and its
 * export). Change a word here and JOIN_SHARING_TEXT_VERSION must change too,
 * so a stored yes can always be matched to the words that were on screen.
 */
export const JOIN_SHARING_TEXT_VERSION = "2026-09-30-join-v2";

/** How a yes from this prompt is labelled in the consent history. */
export const JOIN_SHARING_COLLECTION_METHOD = "join_prompt";

export const JOIN_SHARING_PROMPT_TEXT = {
  title: (orgName: string) => `Let ${orgName} see your progress?`,
  sees:
    "They'll see your name, email, your step, jobs applied to, when you were last on, and if you got hired.",
  never: "Never your resume, your record plan or your interview answers.",
  control: "Change it any time in Settings.",
  yes: "Yes, share",
  notNow: "Not now",
  saved: "Saved. Your progress is shared.",
  failed: "That did not save. Turn it on in Settings.",
} as const;

/**
 * The Settings switch for the same consent. Same promise, same words for the
 * same things, and its own version: a yes given in Settings is recorded with
 * SETTINGS_SHARING_TEXT_VERSION so it can be matched to what was on screen.
 * Change a word here and the version must change too.
 *
 * "Record plan" is what the app's Disclosure Planner makes. One term, used in
 * the prompt, here and on the security page.
 */
export const SETTINGS_SHARING_TEXT_VERSION = "2026-09-30-settings-v2";

export const SETTINGS_SHARING_TEXT = {
  heading: "Share your progress",
  title: "Let your program see your progress",
  sees:
    "If a program gave you a code, its staff will see your name, email, your step, jobs applied to, when you were last on, and if you got hired.",
  never: "Never your resume, your record plan or your interview answers.",
  more: "Sharing anything more is its own choice, one item at a time, under \"Who can see what\" below, if your program offers it.",
  control: "Turn this off any time.",
  switchLabel: "Share my progress with my program",
  on: "On. Your program can see your progress.",
  off: "Off. You are not sharing your progress.",
} as const;

export interface JoinPromptMembership {
  orgId: string;
  orgName: string;
  /** Somebody at the organization can actually look: the code has an owner. */
  hasOwner: boolean;
  /** This person owns the code or is on its staff. Staff are not asked. */
  isOwnOrg: boolean;
}

export interface JoinPromptInput {
  memberships: JoinPromptMembership[];
  /** The person's 'sharing' consent row: null when they have never chosen. */
  sharingStatus: "granted" | "revoked" | null;
  /** Organizations that REQUIRE some sharing. Those are handled by the
   *  acknowledgement screen in Settings, in its own reviewed words. */
  requiredPolicyOrgIds: readonly string[];
}

export type JoinPromptDecision = { show: false } | { show: true; orgId: string; orgName: string };

/**
 * Ask only when the answer is simple and the words are true:
 *   - the person has never made this choice (a past yes OR a past no is an answer);
 *   - they belong to exactly one organization that can see progress, because the
 *     consent covers every organization they are in and the prompt names one;
 *   - that organization does not require sharing (its own screen explains that).
 */
export function decideJoinSharingPrompt(input: JoinPromptInput): JoinPromptDecision {
  if (input.sharingStatus !== null) return { show: false };
  const eligible = input.memberships.filter((m) => m.hasOwner && !m.isOwnOrg);
  if (eligible.length !== 1) return { show: false };
  const org = eligible[0];
  if (input.requiredPolicyOrgIds.includes(org.orgId)) return { show: false };
  const orgName = (org.orgName || "").trim();
  if (!orgName) return { show: false };
  return { show: true, orgId: org.orgId, orgName };
}
