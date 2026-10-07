/**
 * The resume rulebook: one versioned set of rules for everything that writes,
 * checks or fixes resume text.
 *
 * The Forge writer, Rush, the shared context library, the mint check and the
 * draft/finished status all read their rules from here, so the writer can
 * never be told one thing while the checker grades another. Change a rule
 * here, bump RESUME_RULES_VERSION, and every prompt and check moves together.
 *
 * Scopes
 * - "truth": what may go on the page at all. Every writer gets these.
 * - "page":  how the resume page is laid out. Only writers that produce a
 *            whole plain-text page (the Forge writer) get these.
 * - "fix":   what a repair step may do.
 *
 * Pure: no imports, no I/O, safe in the browser and on the server.
 */

export const RESUME_RULES_VERSION = "resume-rules/2026-10-06.1";

export type ResumeRuleScope = "truth" | "page" | "fix";

export interface ResumeRule {
  /** Stable id, used in tests and in the status contract. */
  id: string;
  scope: ResumeRuleScope;
  /** Standard rule ids the checker reports this rule under. */
  std: readonly string[];
  /** The rule as the writer reads it. Plain words. */
  text: string;
}

/** Words that read as machine-written or as hype. Never on the page. */
export const BANNED_RESUME_WORDS: readonly string[] = [
  "utilize", "facilitate", "leverage", "comprehensive", "streamline", "synergy",
  "innovative", "dynamic", "proactive", "dedicated", "motivated", "passionate",
  "proven track record", "results-driven", "detail-oriented", "team player",
];

export const RESUME_RULES: readonly ResumeRule[] = [
  {
    id: "source-only",
    scope: "truth",
    std: ["STD-T01"],
    text:
      "Use only facts the person gave: their own resume text, their answers and their confirmed words. A summary written by an earlier step is not a source; when it differs from the person's words, the person's words win. Never invent a number, tool, credential, employer, title, date, result, setting or skill. If a detail is missing, write the line true without it. A true plain line beats an impressive false one.",
  },
  {
    id: "numbers-as-given",
    scope: "truth",
    std: ["STD-T02"],
    text:
      "Numbers only as the person gave them, with the same unit, the same scope and the same \"about\". A range stays a range. Never estimate, round up, or borrow a typical figure, and never turn their arithmetic into a figure they did not say. Every number the person gave stays on the resume: dropping one is as bad as inventing one. A page with no numbers is complete when every line is true; never push for a number.",
  },
  {
    id: "true-scope",
    scope: "truth",
    std: ["STD-T01", "STD-C03"],
    text:
      "Keep every line at its true size: the same actor, action, scope and conditions as the person's words. Shared or supervised work stays shared or supervised: \"helped with X under the operator\" stays that way when that is what the person said. Never make a shared task a sole one, a one-time ask a title, \"when assigned\" an always, or one an all. Never add main, lead, head, senior, all, every, only, sole or entire unless the person said it.",
  },
  {
    id: "plain-verbs",
    scope: "truth",
    std: ["STD-A01"],
    text:
      "Turn duty phrasing (\"responsible for\", \"duties included\", \"tasked with\") into a plain action verb only when the person's words support that action. Use the verb the person would say out loud. Never use a bigger verb (led, managed, supervised, trained) than their words support.",
  },
  {
    id: "dates-as-given",
    scope: "truth",
    std: ["STD-T05", "STD-C01"],
    text:
      "Keep every employer, title and date exactly as the person gave them. Never move a title to another employer, and never change, merge, shift or guess a date. For gaps, use years only and never explain a gap.",
  },
  {
    id: "dated-page",
    scope: "truth",
    std: ["STD-F01"],
    text:
      "Dated history in reverse order, never a dateless functional page. With little or no work history, lead with what the person does have (education, training, programs, volunteer or informal work), each with the years the person gave. Never guess a year and never invent an entry. Every entry shows the calendar years it ran (2019 - 2023); never replace dates with how long a job lasted or a count of years worked.",
  },
  {
    id: "credential-truth",
    scope: "truth",
    std: ["STD-T03"],
    text:
      "Name each credential at its true type (license, certification, training certificate, course, card) with the issuer, year and status the person gave. A finished course or training is not a certification or license unless the person says they passed or are certified. An expired, suspended or revoked credential, and an inactive or in-progress one, is never called current, active, valid or renewable, and a past credential is never written in the present tense.",
  },
  {
    id: "results-as-given",
    scope: "truth",
    std: ["STD-T07"],
    text:
      "Results, settings and character only as given. No added benefit or ending the person did not give, no \"fast-paced\", \"high-volume\", \"busy\" or \"peak\", and no \"dependable\", \"reliable\", \"hard worker\" or \"consistent\" unless the person said it. Never widen what a duty covered beyond what they said. Keep every result they did give, in their own terms.",
  },
  {
    id: "posting-asks",
    scope: "truth",
    std: ["STD-T06"],
    text:
      "A job posting tells you what to ask the person about, never what to claim. A posting term goes on the page only when the person's own words show they did it.",
  },
  {
    id: "record-never-added",
    scope: "truth",
    std: ["STD-C07"],
    text:
      "Never add, infer or hint at a record, incarceration, supervision or justice involvement the person's words do not state, and never add charges, a sentence or a legal status. What happens to the person's own lines about it follows the request's own rule.",
  },
  {
    id: "plain-words",
    scope: "truth",
    std: ["STD-A01", "STD-A02"],
    text: `Plain words a coworker would use. Never these: ${BANNED_RESUME_WORDS.join(", ")}. No first person on the resume. Never use a dash as punctuation: no em dash, no en dash and no "--"; use a period or a comma, or reword. Hyphens inside words (part-time, first-piece) are fine.`,
  },
  {
    id: "length-follows-truth",
    scope: "truth",
    std: ["STD-F07"],
    text:
      "Two pages when the person's true history fills them, one page when it doesn't. Never add filler to reach a second page, and never more than two pages. Include every true, relevant role and qualification the person gave. The person can choose one page: then lead with the strongest true lines and shorten older roles to title, employer and years, never dropping a role or changing a fact to make room.",
  },
  {
    id: "skills-one-column",
    scope: "page",
    std: ["STD-T01", "STD-T06"],
    text:
      "Skills go in one column: either one comma-separated line, or a few short labeled lines (for example \"Equipment: forklift, pallet jack\"). Never a grid, columns or pipes between skills. Every term names something the person said they did, used or learned; no soft-skill filler they did not claim. Never invent a term to fill space, and never drop a real one.",
  },
  {
    id: "dated-format",
    scope: "page",
    std: ["STD-F01"],
    text:
      "Format: reverse-chronological with years on every entry. A hybrid (a short skills block above the full dated history) fits only when both are true in the person's own words: their work history is uneven, and they are changing fields on the strength of their skills. Long stretches at one place or strong skills are examples of those two conditions, never extra conditions and never reasons on their own. In a hybrid every dated entry keeps its bullets and the skills block stays short labels.",
  },
  {
    id: "one-column-page",
    scope: "page",
    std: ["STD-F02", "STD-F05"],
    text:
      "One column, plain text. No tables, boxes, columns, icons or graphics. Leave a section off when the person gave nothing for it; never print an empty section or a placeholder.",
  },
  {
    id: "fix-adds-nothing",
    scope: "fix",
    std: [],
    text:
      "A fix only removes a line, puts it back in the person's words, or asks the person. A fix never adds a fact, a number, a title or a credential.",
  },
];

/** The rules for one scope, in rulebook order. */
export function rulesFor(scope: ResumeRuleScope): ResumeRule[] {
  return RESUME_RULES.filter((r) => r.scope === scope);
}

/** The rulebook rule(s) a checker finding id belongs to. */
export function rulesForStd(std: string): ResumeRule[] {
  return RESUME_RULES.filter((r) => r.std.includes(std));
}

const SCOPE_TITLE: Record<ResumeRuleScope, string> = {
  truth: "RESUME TRUTH RULES",
  page: "RESUME PAGE RULES",
  fix: "RESUME FIX RULES",
};

/**
 * The prompt text for one scope. Each block carries the rulebook version, so a
 * prompt can be checked against the rulebook it was built from.
 */
export function resumeRulesBlock(scope: ResumeRuleScope): string {
  const rules = rulesFor(scope);
  return [
    `${SCOPE_TITLE[scope]} (${RESUME_RULES_VERSION}). Breaking any of these is a failure:`,
    ...rules.map((r, i) => `${i + 1}. ${r.text}`),
  ].join("\n");
}
