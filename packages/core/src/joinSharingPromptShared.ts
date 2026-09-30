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
export const JOIN_SHARING_TEXT_VERSION = "2026-09-30-join-v1";

/** How a yes from this prompt is labelled in the consent history. */
export const JOIN_SHARING_COLLECTION_METHOD = "join_prompt";

export const JOIN_SHARING_PROMPT_TEXT = {
  title: (orgName: string) => `Want ${orgName} to see your progress?`,
  sees:
    "They'll see your name and email, your step, how many jobs you applied to, when you were last on and if you got hired.",
  never: "This never shows them your resume, your record plan or your interview answers.",
  control: "You can change this any time in Settings.",
  yes: "Yes, share my progress",
  notNow: "Not now",
  saved: "Done. Your progress is shared. You can turn it off in Settings.",
  failed: "That did not save. You can turn it on in Settings.",
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
