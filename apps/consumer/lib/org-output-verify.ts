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
  /** Active in the last two weeks: caseload minus stalled, given not derived. */
  activeRecently?: number;
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
  /** The organization's own name, whose words are not people. */
  orgName?: string;
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
    facts.activeRecently ?? facts.caseload - facts.stalled,
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
  // A template's blanks are not claims. "[Your Name]" names nobody and "[X] min"
  // counts nothing; both were being reported to the reader as unsupported.
  text = text.replace(/\[[^\]\n]{0,80}\]/g, " ");

  // Every standalone integer must be one we can account for. Money, dates and
  // percentages are skipped -- they are reported elsewhere and are not the
  // class of claim that gets copied into a headcount.
  // Durations, clock times and ordinals are not headcounts: "first 15 minutes",
  // "a 2-minute check-in", "by 9am", "the 3rd".
  const numbers =
    text.match(
      /(?<![$\d.,%/-])\b\d{1,4}\b(?![\d.,%/]|-?\s?(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|am|pm|a\.m|p\.m)\b|(?:st|nd|rd|th)\b|:\d)/gi
    ) ?? [];
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
  // A capitalized word is only a candidate NAME if it is not an ordinary word.
  // The first version listed forty stopwords and flagged everything else, so a
  // heading ("Caseload Snapshot"), the organization's own name, and the second
  // word of any email draft ("Hi Colton, Just checking in") were all reported
  // as people outside the viewer's access. Layer 1 is the layer that "cannot
  // fail", and a check that objects to true answers has failed.
  //
  // THE TRADE, stated: a first name that is also a common word (Will, Grace,
  // Mark, Hope) is not caught here. Layer 2 is given the allowed people and
  // still is. Missing those here is cheaper than crying wolf on every heading.
  const STOPWORDS = new Set(
    (
      "the this that these those your you they their them and but for with from who what when how why where which " +
      "today tomorrow yesterday week weeks month months year day days monday tuesday wednesday thursday friday saturday sunday " +
      "january february march april may june july august september october november december " +
      "forge refinery troy steel man resumes i it if no not yes one two three four five six seven eight nine ten none " +
      "someone nobody everyone anyone here there now right next first last then also just still only both each every all any some " +
      "most more less few many much other another same such own new old good great best better quick quickly " +
      "caseload snapshot summary overview status update updates report note notes draft subject message email text call check " +
      "checking attention needs need needed priority priorities outreach follow followup step steps action actions plan plans " +
      "participant participants client clients staff team member members organization program services service reentry " +
      "started never inactive active unassigned assigned hired work working job jobs application applications resume interview " +
      "hi hello hey dear thanks thank regards sincerely best warmly cheers please let want would could should can will may might " +
      "we our us he she his her him its is are was were be been have has had do does did done get got make made take took " +
      "know think hope see look looking going go come back out up down over about after before since until while because so " +
      "bright spot heads flagged flag also bottom line big picture key point points total across whats what's here's heres second third"
    ).split(/\s+/)
  );
  for (const w of (facts.orgName ?? "").toLowerCase().split(/[^a-z]+/)) if (w) STOPWORDS.add(w);
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
  facts: OrgFacts,
  /** What the staff member just said. Things THEY told us are not our claims. */
  userSaid?: string
): Promise<string[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const prompt = `You are verifying a message that is about to be shown to a case manager at a reentry organization. They may copy it into a report that goes to a funder, so an unsupported claim is expensive.

ESTABLISHED FACTS (each of these is TRUE and may be stated or paraphrased):
- This viewer's caseload is ${facts.caseload} people: ${facts.visibleNames.join(", ") || "(no names)"}.
- ${facts.activeRecently ?? facts.caseload - facts.stalled} of them have been active in the last two weeks.
- ${facts.stalled} of them have had no activity in the last two weeks.
- ${facts.neverStarted} of them have never started. These are INCLUDED in the ${facts.stalled} with no activity, not in addition to them. A message that presents the never-started as additional, separate people beyond the ${facts.stalled} is making an UNSUPPORTED claim.
- ${facts.hired} of them have started work.
- ${facts.unassigned} of them are assigned to nobody.
${(facts.needsAttention ?? []).map((n) => `- ${n} has been inactive for two weeks or more (or has never been active) and needs attention. Saying ${n} "went quiet", "is stalled", "needs a check-in", or "is a dropout risk" is SUPPORTED.`).join("\n") || "- Nobody is currently flagged as needing attention."}
${
  (facts.needsAttention ?? []).length > 0 && (facts.needsAttention ?? []).length >= facts.stalled
    ? `- The people named as needing attention ARE the ${facts.stalled} with no activity -- the same ${facts.stalled === 1 ? "person" : "people"}. A message that refers to them AND to some other inactive or quiet person is counting somebody twice, and that is an UNSUPPORTED claim.`
    : "- (The needs-attention names are only some of the inactive people.)"
}
- Staff in this organization: ${facts.staffNames.join(", ") || "(none)"}.
Nothing else is known about any person: no employers, interviews, application counts, dates, reasons, or trends.

THE STAFF MEMBER'S OWN MESSAGE, which this is a reply to. Anything they stated or asked about is THEIR information; a reply that repeats it or asks about it is not making a new claim:
"""
${(userSaid ?? "(not provided)").slice(0, 1500)}
"""

MESSAGE:
"""
${text.slice(0, 4000)}
"""

Go through the message sentence by sentence. For EACH sentence output one object:
  "text": the sentence, shortened if long
  "kind": "claim" if it asserts a fact about the caseload, a person, a number, an outcome, a date, or a trend. Otherwise "other" -- questions, offers to help, advice, suggested wording or drafts, opinions about priority, and general statements about how the product works are all "other". So is any blank template line whose content is bracketed placeholders for the staff member to fill in ("[Name] reported [situation]"). So is the assistant describing its OWN knowledge or limits ("I don't have their phone numbers", "I can see activity status but not dates"). EXCEPTION: a question or offer that PRESUPPOSES a fact about a person or the caseload ("congratulate Nadia on her new job" presupposes Nadia got a job) is a "claim" about that presupposed fact.
  "supported": for a claim, true if it restates or paraphrases an established fact above, false if the established facts do not support it. For "other", true.

Reply with JSON only: {"sentences":[{"text":"...","kind":"claim","supported":true}]}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 900,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    // Classified per sentence and filtered HERE rather than asking the model
    // for a free-form list of problems: asked for a list, it listed questions,
    // offers and true statements alike, and every answer carried a warning.
    const parsed = JSON.parse(raw) as { sentences?: unknown };
    if (!Array.isArray(parsed?.sentences)) return null;
    return (parsed.sentences as Array<{ text?: unknown; kind?: unknown; supported?: unknown }>)
      .filter((x) => x?.kind === "claim" && x?.supported === false && typeof x?.text === "string")
      .map((x) => x.text as string);
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
export async function verifyOrgOutput(
  text: string,
  facts: OrgFacts,
  userSaid?: string
): Promise<OrgVerdict> {
  const deterministic = checkOrgClaimsDeterministic(text, facts);
  const model = await checkOrgClaimsWithModel(text, facts, userSaid);
  return {
    ok: deterministic.length === 0 && (model?.length ?? 0) === 0,
    problems: [...deterministic, ...(model ?? [])],
    modelChecked: model !== null,
  };
}
