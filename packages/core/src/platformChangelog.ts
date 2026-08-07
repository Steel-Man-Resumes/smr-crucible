/**
 * PLATFORM_CHANGELOG -- the curated, user-facing record of recent Steel Man
 * changes that t.ROY is allowed to know about (Troy 2026-08-07: "when we're doing
 * major upgrades that might affect how he operates, he should know it... he should
 * be aware of everything").
 *
 * Hand-maintained on purpose (no DB): each entry is written in the user's terms,
 * with a plain "what this means for you" line and an optional take_me_there page.
 * t.ROY may reference ONLY what is listed here -- never invent a change (honest-
 * freshness doctrine, [[feedback-troy-ai-chatbot-doctrine]]). Add an entry here
 * whenever a shipped change alters what a user can do or how a flow behaves.
 *
 * Keep it short and current; oldest entries can be pruned as they stop mattering.
 */

export interface ChangelogEntry {
  /** ISO date the change shipped to prod. */
  date: string;
  /** What changed, in the user's words. */
  title: string;
  /** Why it matters to the person using the tool. */
  meaning: string;
  /** Optional take_me_there page the change relates to. */
  page?: string;
}

export const PLATFORM_CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-08-07",
    title:
      "You can now paste a job link or description and get a resume tailored to that exact posting.",
    meaning:
      "You no longer need live job search to move forward. Tailor a resume to one real job and it unlocks Disclosure planning, Interview Practice, Applications, and Progress.",
    page: "application-tailor",
  },
  {
    date: "2026-08-07",
    title:
      "Your Materials vault is a real home base now: pin your current resume, search everything, and download any document as Word or PDF in one click.",
    meaning:
      "Keep your active resume pinned and grab a Word copy the moment an application asks for one.",
    page: "vault",
  },
  {
    date: "2026-08-07",
    title: "You can hide any employer so their listings never show up in your search again.",
    meaning:
      "If there is a company you never want to see, hide it once and it is gone from your board. Manage the list in Settings.",
    page: "settings",
  },
  {
    date: "2026-08-07",
    title:
      "Fair-chance employers are now verified against a hand-checked list (starting in Grand Rapids / Kent County, MI) instead of a guess.",
    meaning:
      "A fair-chance badge now means a real person confirmed it from the employer's own words. The list is small and growing.",
    page: "employers",
  },
];

/**
 * Render the changelog as a system-prompt section. `sinceISO` (optional, for a
 * future "since you were last here" signal) filters to changes after that date;
 * omit it to surface all recent changes.
 */
export function buildWhatsNewSection(sinceISO?: string): string {
  const entries = (sinceISO
    ? PLATFORM_CHANGELOG.filter((e) => e.date > sinceISO)
    : PLATFORM_CHANGELOG
  ).slice(0, 6);
  if (!entries.length) return "";
  const lines = entries.map(
    (e) =>
      `- (${e.date}) ${e.title} For the user: ${e.meaning}${e.page ? ` [offer take_me_there: ${e.page}]` : ""}`
  );
  return `

## WHAT'S NEW ON THE PLATFORM
Recent, real changes to Steel Man. If one is relevant to what the user is doing or asking -- especially if it unblocks them or changes how something works -- mention it in a sentence, honestly ("we just added..."), and offer to show them. Reference ONLY the changes listed here; if they ask about something not on this list, say you are not sure it changed rather than guessing.
${lines.join("\n")}`;
}
