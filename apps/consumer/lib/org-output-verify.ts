/**
 * Nothing unverified reaches a staff member or an admin. Two layers, in order.
 *
 * THE HARM THIS EXISTS TO PREVENT. A case manager asks t.ROY how their caseload
 * is doing, gets a confident number, and puts it in a board packet or a grant
 * report. Nobody checks it, because why would you -- it came from the system of
 * record. A wrong figure then travels further than any wrong resume line ever
 * could, and it lands on the organization rather than on us.
 *
 * So org-facing output is held to a harder standard than participant-facing
 * output, and deliberately a different one:
 *
 *   LAYER 1, DETERMINISTIC, CANNOT FAIL. Every number in the answer must be a
 *   number we actually computed. Every person named must be inside this
 *   viewer's reach. No model involved, no network, no failure mode -- if this
 *   layer says a claim is unsupported, it is unsupported.
 *
 *   LAYER 2, A SECOND MODEL. Catches what arithmetic cannot: a plausible
 *   sentence about a trend, a status, or an outcome that nobody established.
 *
 * WHY LAYER 1 COMES FIRST AND IS NEVER SKIPPED. The resume verifier fails OPEN
 * on purpose -- a verifier outage must not stop someone getting their resume.
 * That trade is wrong here. If layer 2 cannot run, layer 1 still holds and the
 * answer is marked unverified rather than passed off as checked. "Never push
 * bad data to staff" has to survive the verifier being down, which means the
 * load-bearing half cannot depend on a model at all.
 */

/** The only facts an org-facing answer is allowed to assert. */
export interface OrgFacts {
  caseload: number;
  stalled: number;
  neverStarted: number;
  hired: number;
  unassigned: number;
  /** First names inside this viewer's reach. Anyone else is out of bounds. */
  visibleNames: string[];
  /** Staff names in this org, which staff may legitimately mention. */
  staffNames: string[];
  /**
   * First names with no activity in two weeks. The generator is told these, so
   * the checker must be too -- otherwise every true "Colton has gone quiet" is
   * flagged as unsupported and the warning trains people to ignore it.
   */
  needsAttention?: string[];
}

export interface OrgVerdict {
  ok: boolean;
  /** Claims we could not support, in plain language, for logging and display. */
  problems: string[];
  /** True when layer 2 ran. False means layer 1 only. */
  modelChecked: boolean;
}

/** Numbers that are always safe: years, small ordinals in prose, percentages of nothing. */
const ALWAYS_FINE = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "10", "12", "14", "24", "30"]);

/**
 * Numbers a sentence is allowed to contain, derived from the facts.
 *
 * Deliberately generous about arithmetic a person would do out loud -- "3 of
 * your 5" needs both, and a difference or a sum of two real figures is still
 * grounded. It is NOT generous about a number that appears from nowhere.
 */
function allowedNumbers(facts: OrgFacts): Set<string> {
  const base = [
    facts.caseload,
    facts.stalled,
    facts.neverStarted,
    facts.hired,
    facts.unassigned,
  ];
  const allowed = new Set<string>();
  for (const n of base) {
    allowed.add(String(n));
    for (const m of base) {
      allowed.add(String(n + m));
      if (n - m >= 0) allowed.add(String(n - m));
    }
  }
  for (const n of Array.from(ALWAYS_FINE)) allowed.add(n);
  return allowed;
}

/**
 * LAYER 1. Arithmetic and identity. No model, no network, no excuses.
 */
export function checkOrgClaimsDeterministic(text: string, facts: OrgFacts): string[] {
  const problems: string[] = [];
  const allowed = allowedNumbers(facts);

  // Every standalone integer must be one we can account for. Money, dates and
  // percentages are skipped -- they are reported elsewhere and are not the
  // class of claim that gets copied into a headcount.
  const numbers = text.match(/(?<![$\d.,%/-])\b\d{1,4}\b(?![\d.,%/-])/g) ?? [];
  for (const n of numbers) {
    if (!allowed.has(n)) {
      problems.push(`the figure "${n}" is not one of this caseload's numbers`);
    }
  }

  // Anyone named must be someone this viewer is allowed to see. This is the
  // check that stops one organization's participant being discussed inside
  // another's conversation, and it is the reason names are worth parsing at all.
  const known = new Set(
    [...facts.visibleNames, ...facts.staffNames].map((n) => n.toLowerCase())
  );
  const STOPWORDS = new Set([
    "the", "this", "that", "your", "you", "they", "their", "and", "but", "for",
    "with", "from", "who", "what", "when", "how", "why", "today", "week", "monday",
    "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "forge",
    "refinery", "troy", "steel", "man", "resumes", "i", "it", "if", "no", "not",
    "one", "two", "three", "four", "five", "none", "someone", "nobody", "everyone",
  ]);
  // Capitalized words mid-sentence are the candidates; sentence-initial words
  // are excluded because capitalization there means nothing.
  const candidates = text.match(/(?<=[a-z,;:]\s)[A-Z][a-z]{2,}/g) ?? [];
  for (const c of Array.from(new Set(candidates))) {
    const low = c.toLowerCase();
    if (STOPWORDS.has(low) || known.has(low)) continue;
    problems.push(`"${c}" is not somebody you have access to`);
  }

  return problems;
}

/**
 * LAYER 2. A cheap second model, for claims arithmetic cannot reach.
 *
 * Returns null when it could not run, which the caller must treat as "not
 * checked" rather than "checked and clean" -- the distinction the resume
 * pipeline got wrong and had to be fixed.
 */
export async function checkOrgClaimsWithModel(
  text: string,
  facts: OrgFacts
): Promise<string[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const prompt = `You are verifying a message that is about to be shown to a case manager at a reentry organization. They may copy it into a report that goes to a funder, so an unsupported claim is expensive.

THE ONLY FACTS THAT EXIST:
- caseload: ${facts.caseload}
- not active in two weeks: ${facts.stalled}
- never started: ${facts.neverStarted}
- started work: ${facts.hired}
- assigned to nobody: ${facts.unassigned}
- people this viewer may discuss: ${facts.visibleNames.join(", ") || "(none)"}
- of those, no activity in two weeks or never active (needs attention): ${(facts.needsAttention ?? []).join(", ") || "(none)"}
- staff in this organization: ${facts.staffNames.join(", ") || "(none)"}

MESSAGE:
"""
${text.slice(0, 4000)}
"""

List any statement of FACT the message makes that those facts do not support: a count, an outcome, a date, a trend, a claim about a specific person, or a claim about what happened. Ignore advice, suggested wording, questions, and offers to help -- those are not factual claims. Ignore general statements about how the product works.

Reply with a JSON array of short strings, one per unsupported claim. Reply with [] if everything checks out. JSON only.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}

/**
 * Run both layers. Layer 1 always runs; layer 2 is best-effort.
 *
 * `modelChecked: false` means layer 2 did not run, and the caller must say so
 * rather than implying the answer was fully verified.
 */
export async function verifyOrgOutput(text: string, facts: OrgFacts): Promise<OrgVerdict> {
  const deterministic = checkOrgClaimsDeterministic(text, facts);
  const model = await checkOrgClaimsWithModel(text, facts);
  return {
    ok: deterministic.length === 0 && (model?.length ?? 0) === 0,
    problems: [...deterministic, ...(model ?? [])],
    modelChecked: model !== null,
  };
}
