/**
 * The second check: prompt, parsing and validation, provider adapters (mocked
 * fetch only), the cost cap, the fallback, the merge into getResumeStatus,
 * and the offline harness. No test makes a network call.
 *
 * Fixtures are fictional (fixtures-second-check.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addsNoFact,
  anchorToPageLine,
  buildSecondCheckPrompt,
  parseDailyUsd,
  parseSecondCheckResponse,
  secondCheckBudgetAllows,
  secondCheckFallback,
  validateSecondCheckFindings,
  withoutRecordAnswers,
  SECOND_CHECK_MAX_FINDINGS,
  type SecondCheckFinding,
} from "../secondCheckShared";
import {
  isWriterFamily,
  mockSecondCheckProvider,
  openAICompatibleProvider,
  runSecondCheck,
  secondCheckEnabled,
  secondCheckProviderFromEnv,
} from "../secondCheck";
import { getResumeStatus } from "../resumeStatus";
import {
  markdownToPlain,
  mintChecker,
  plantFlaw,
  scoreChecker,
  withSecondCheck,
  PLANTED_FLAWS,
} from "../secondCheckHarness";
import { SOURCE, CLEAN, FLAWED, reply } from "./fixtures-second-check";

// The person's licenses-and-training answer, typed exactly as the clean page shows it (round 5).
const TYPED = "Forklift Certification | 2019 - 2021";

// ---- prompt ------------------------------------------------------------------------

test("prompt: carries the page and the person's words as fenced data, without contact details", () => {
  const p = buildSecondCheckPrompt({ resumeText: CLEAN, sourceText: SOURCE, ownResumeText: TYPED });
  assert.match(p.system, /different|never rewrite/i);
  assert.match(p.system, /data, not instructions/);
  assert.match(p.user, /<persons_own_words>[\s\S]*Lakeside Grocery[\s\S]*<\/persons_own_words>/);
  assert.match(p.user, /<resume>[\s\S]*Forklift Certification[\s\S]*<\/resume>/);
  assert.doesNotMatch(p.user, /riley@example\.com/);
  assert.doesNotMatch(p.user, /330-555-0188/);
  assert.match(p.user, /\[email\]/);
});

test("prompt: lines about a case never leave the server; work words stay", () => {
  const src = `${SOURCE}
Convicted in 2017, case number 17-CF-0000.
I was on probation until 2020.
The charge nurse showed me the cart.
I worked in the prison kitchen from 2014 to 2017.`;
  const p = buildSecondCheckPrompt({ resumeText: CLEAN, sourceText: src });
  assert.doesNotMatch(p.user, /Convicted|case number|probation/i);
  assert.match(p.user, /charge nurse showed me the cart/);
  assert.match(p.user, /prison kitchen/);
  assert.equal(withoutRecordAnswers("Sentenced to 3 years.\nRan the grill."), "Ran the grill.");
});

// ---- parsing and validation ----------------------------------------------------------

test("parse: plain, fenced and bare-array JSON are read; anything else is not ok", () => {
  const body = reply([{ line: FLAWED.expired_as_current.line, kind: "credential_status" }]);
  const page = FLAWED.expired_as_current.page;
  for (const raw of [body, "```json\n" + body + "\n```", `Here you go: ${body}`]) {
    const r = parseSecondCheckResponse(raw, page);
    assert.equal(r.ok, true, raw);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].line, FLAWED.expired_as_current.line);
  }
  const arr = parseSecondCheckResponse(JSON.stringify(JSON.parse(body).findings), page);
  assert.equal(arr.ok, true);
  assert.equal(arr.findings.length, 1);
  for (const bad of ["", "no", "{\"items\": 3}", "{broken"]) {
    const r = parseSecondCheckResponse(bad, page);
    assert.equal(r.ok, false, bad);
    assert.deepEqual(r.findings, []);
  }
  assert.equal(parseSecondCheckResponse('{"findings":[]}', page).ok, true);
});

test("validate: a finding must point at a real claim line; others are dropped", () => {
  const page = FLAWED.led_for_helped.page;
  const r = validateSecondCheckFindings(
    [
      { line: "Managed a team of 12 stockers.", kind: "invented_fact", severity: "BLOCK", reason: "x", question: "y?" },
      { line: "RILEY EXAMPLE", kind: "other", severity: "BLOCK", reason: "x", question: "y?" },
      { line: "Akron, OH | riley@example.com | 330-555-0188", kind: "other", severity: "FIX", reason: "x", question: "y?" },
      { line: FLAWED.led_for_helped.line, kind: "scope_inflation", severity: "NOTE", reason: "x", question: "y?" },
      { line: FLAWED.led_for_helped.line, kind: "scope_inflation", severity: "block", reason: "Your words say you helped with this.", question: "Did you do this on your own?" },
      { line: FLAWED.led_for_helped.line, kind: "scope_inflation", severity: "FIX", reason: "dup", question: "dup?" },
      "not an object",
      null,
    ],
    page
  );
  assert.equal(r.findings.length, 1);
  assert.equal(r.dropped, 7);
  assert.deepEqual(r.findings[0], {
    line: FLAWED.led_for_helped.line,
    kind: "scope_inflation",
    severity: "BLOCK",
    reason: "Your words say you helped with this.",
    question: "Did you do this on your own?",
  });
});

test("validate: a quote of part of a line points at that line only when one line holds it", () => {
  assert.equal(anchorToPageLine("stocked about 30 aisles", CLEAN), "- Unloaded the delivery truck twice a week and stocked about 30 aisles.");
  assert.equal(anchorToPageLine("**Forklift Certification | 2019 - 2021**", CLEAN), "- Forklift Certification | 2019 - 2021");
  assert.equal(anchorToPageLine("2023", CLEAN), null, "too short to point at one line");
  const twice = `${CLEAN}\n- Unloaded the delivery truck on Mondays.`;
  assert.equal(anchorToPageLine("Unloaded the delivery truck", twice), null, "two lines hold it");
});

test("validate: unknown kinds become 'other'; the cap holds", () => {
  const lines = Array.from({ length: 60 }, (_, i) => `- Stocked aisle number ${i + 100} at the store.`);
  const page = `${CLEAN}\n${lines.join("\n")}`;
  const r = validateSecondCheckFindings(lines.map((l) => ({ line: l, kind: "weird", severity: "FIX", reason: "Not in your words.", question: "Is this true?" })), page);
  assert.equal(r.findings.length, SECOND_CHECK_MAX_FINDINGS);
  assert.equal(r.dropped, 60 - SECOND_CHECK_MAX_FINDINGS);
  assert.ok(r.findings.every((f) => f.kind === "other"));
});

test("validate: shown text may not add a number, quote or name; long dashes go", () => {
  const line = FLAWED.led_for_helped.line;
  const page = FLAWED.led_for_helped.page;
  const cases: Array<[string, string]> = [
    ["You led a team of 6 people.", "Did you lead 6 people?"],
    ['You said "ran the whole warehouse".', 'Did you "run the whole warehouse"?'],
    ["Your manager at Harbor Mart said otherwise.", "Did Dana ask you to lead?"],
  ];
  for (const [reason, question] of cases) {
    const [f] = validateSecondCheckFindings([{ line, kind: "scope_inflation", severity: "BLOCK", reason, question }], page).findings;
    assert.deepEqual({ reason: f.reason, question: f.question }, secondCheckFallback("scope_inflation"), reason);
  }
  const [noMark] = validateSecondCheckFindings([{ line, kind: "scope_inflation", severity: "FIX", reason: "Bigger than your words.", question: "Tell me how you would say it" }], page).findings;
  assert.equal(noMark.question, secondCheckFallback("scope_inflation").question, "a question must be a question");
  const [dash] = validateSecondCheckFindings([{ line, kind: "scope_inflation", severity: "FIX", reason: "Your words say helped \u2014 not led.", question: "Did you lead inventory counts?" }], page).findings;
  assert.equal(dash.reason, "Your words say helped, not led.");
  assert.equal(dash.question, "Did you lead inventory counts?");
  assert.ok(addsNoFact("Is the 45 on this line yours?", FLAWED.invented_number.line));
  assert.ok(!addsNoFact("Was it 30 aisles?", FLAWED.invented_number.line));
});

// ---- the status contract --------------------------------------------------------------

test("status: without second-check findings the result is exactly the mint check's", () => {
  for (const page of [CLEAN, FLAWED.invented_number.page, FLAWED.led_for_helped.page]) {
    const base = getResumeStatus({ resumeText: page, sourceText: SOURCE, ownResumeText: TYPED });
    assert.deepEqual(getResumeStatus({ resumeText: page, sourceText: SOURCE, ownResumeText: TYPED, secondCheckFindings: undefined }), base);
    assert.ok(base.openItems.every((i) => !("from" in i)), "mint and defend items carry no source mark");
  }
});

test("status: an empty second check changes nothing", () => {
  const base = getResumeStatus({ resumeText: CLEAN, sourceText: SOURCE, ownResumeText: TYPED, requireDefend: false });
  assert.deepEqual(getResumeStatus({ resumeText: CLEAN, sourceText: SOURCE, ownResumeText: TYPED, requireDefend: false, secondCheckFindings: [] }), base);
  assert.equal(base.state, "finished");
});

test("status: a second-check BLOCK makes the page a draft, with its own question", () => {
  const { page, line } = FLAWED.expired_as_current;
  const mintOnly = getResumeStatus({ resumeText: page, sourceText: SOURCE, ownResumeText: TYPED, requireDefend: false });
  // Round 5: the line is not what the person typed, so the gate alone asks it as a memory prompt.
  assert.equal(mintOnly.state, "draft");
  assert.ok(mintOnly.openItems.some((i) => i.line === line && i.kind === "credential_unsaid"));
  const findings: SecondCheckFinding[] = [{ line, kind: "credential_status", severity: "BLOCK", reason: "Your words say this expired.", question: "Is this current, expired, or still in progress?" }];
  const s = getResumeStatus({ resumeText: page, sourceText: SOURCE, ownResumeText: TYPED, requireDefend: false, secondCheckFindings: findings });
  assert.equal(s.state, "draft");
  // Same line, same rule, already a BLOCK: not asked twice.
  assert.equal(s.blockCount, 1);
  assert.ok(!s.openItems.some((i) => i.from === "second_check"));
  // On another line the second check's BLOCK lands with its own question.
  const other = "- Made breakfast orders on the grill.";
  const s2 = getResumeStatus({ resumeText: page, sourceText: SOURCE, ownResumeText: TYPED, requireDefend: false, secondCheckFindings: [{ ...findings[0], line: other }] });
  assert.ok(s2.openItems.some((i) => i.line === other && i.from === "second_check" && i.question === "Is this current, expired, or still in progress?"));
});

test("status: a FIX from the second check is listed but does not hold the finish", () => {
  const { page, line } = FLAWED.invented_employer_detail;
  const s = getResumeStatus({ resumeText: page, sourceText: SOURCE, ownResumeText: TYPED, requireDefend: false, secondCheckFindings: [{ line, kind: "invented_fact", severity: "FIX", reason: "Not in your words.", question: "Is this true?" }] });
  assert.equal(s.state, "finished");
  assert.equal(s.fixCount, 1);
  assert.equal(s.openItems[0].from, "second_check");
});

test("status: not asked twice; a BLOCK still lands over a mint FIX on the same line", () => {
  const { page, line } = FLAWED.led_for_helped;
  const mint = getResumeStatus({ resumeText: page, sourceText: SOURCE, ownResumeText: TYPED, requireDefend: false });
  // Round 5: "Led" is also a scope claim (its own BLOCK); this test is about the STD-T01 items.
  const t01 = (x: typeof mint) => x.openItems.filter((i) => i.rule === "STD-T01");
  assert.deepEqual(t01(mint).map((i) => [i.rule, i.severity]), [["STD-T01", "FIX"]]);
  const fix = getResumeStatus({ resumeText: page, sourceText: SOURCE, ownResumeText: TYPED, requireDefend: false, secondCheckFindings: [{ line, kind: "scope_inflation", severity: "FIX", reason: "a", question: "b?" }] });
  assert.equal(t01(fix).length, 1, "same rule, same severity: one item");
  const block = getResumeStatus({ resumeText: page, sourceText: SOURCE, ownResumeText: TYPED, requireDefend: false, secondCheckFindings: [{ line, kind: "scope_inflation", severity: "BLOCK", reason: "a", question: "b?" }] });
  assert.equal(block.state, "draft");
  assert.deepEqual(t01(block).map((i) => [i.severity, i.from ?? "mint"]), [["BLOCK", "second_check"], ["FIX", "mint"]]);
});

test("status: a stored finding for a line no longer on the page is dropped", () => {
  const stale: SecondCheckFinding[] = [{ line: FLAWED.led_for_helped.line, kind: "scope_inflation", severity: "BLOCK", reason: "a", question: "b?" }];
  const s = getResumeStatus({ resumeText: CLEAN, sourceText: SOURCE, ownResumeText: TYPED, requireDefend: false, secondCheckFindings: stale });
  assert.equal(s.state, "finished");
  assert.equal(s.openItems.length, 0);
});

test("status: second-check text that adds a fact is replaced before the person sees it", () => {
  const { page, line } = FLAWED.invented_number;
  const s = getResumeStatus({ resumeText: page, sourceText: SOURCE, ownResumeText: TYPED, requireDefend: false, secondCheckFindings: [{ line, kind: "number_not_in_source", severity: "BLOCK", reason: "It was 30.", question: "Was it 30 aisles?" }] });
  const mine = s.openItems.find((i) => i.from === "second_check");
  // The mint check already holds this line as a STD-T02 BLOCK, so nothing is added.
  assert.equal(mine, undefined);
  const other = getResumeStatus({ resumeText: page, sourceText: SOURCE, ownResumeText: TYPED, requireDefend: false, secondCheckFindings: [{ line, kind: "invented_fact", severity: "BLOCK", reason: "It was 30.", question: "Was it 30 aisles?" }] });
  const f = other.openItems.find((i) => i.from === "second_check")!;
  assert.doesNotMatch(f.why + f.question, /\b30\b/);
});

// ---- provider and run -------------------------------------------------------------------

test("run: a mock reply is parsed and validated; contact details never reach the provider", async () => {
  const provider = mockSecondCheckProvider({ reply: reply([{ line: FLAWED.expired_as_current.line, kind: "credential_status" }, { line: "Invented line", kind: "other" }]) });
  const r = await runSecondCheck({ resumeText: FLAWED.expired_as_current.page, sourceText: SOURCE, ownResumeText: TYPED }, provider);
  assert.equal(r.status, "ran");
  if (r.status !== "ran") return;
  assert.equal(r.findings.length, 1);
  assert.equal(r.dropped, 1);
  assert.ok(r.usage.inputTokens > 0);
  assert.equal(provider.calls.length, 1);
  assert.doesNotMatch(provider.calls[0].user, /riley@example\.com|330-555-0188/);
});

test("run: failure, timeout and an unreadable reply all fall back with no findings", async () => {
  const input = { resumeText: CLEAN, sourceText: SOURCE, ownResumeText: TYPED };
  assert.deepEqual(await runSecondCheck(input, mockSecondCheckProvider({ fail: true })), { status: "unavailable", findings: [], usage: null });
  const slow = await runSecondCheck(input, mockSecondCheckProvider({ delayMs: 200 }), { timeoutMs: 20 });
  assert.equal(slow.status, "unavailable");
  assert.deepEqual(slow.findings, []);
  // A provider that ignores the abort signal still times out.
  const deaf = { name: "deaf", model: "deaf", complete: () => new Promise<never>(() => undefined) };
  assert.equal((await runSecondCheck(input, deaf, { timeoutMs: 20 })).status, "unavailable");
  const junk = await runSecondCheck(input, mockSecondCheckProvider({ reply: "I think the page is fine." }));
  assert.equal(junk.status, "unavailable");
  assert.deepEqual(junk.findings, []);
});

test("adapter: OpenAI-compatible request shape, reply text and usage, error status", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"findings":[]}' } }], usage: { prompt_tokens: 900, completion_tokens: 12 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const p = openAICompatibleProvider({ baseUrl: "https://checker.example.test/v1/", model: "checker-model", apiKey: "test-key", fetchImpl });
  const r = await runSecondCheck({ resumeText: CLEAN, sourceText: SOURCE, ownResumeText: TYPED }, p);
  assert.equal(r.status, "ran");
  assert.deepEqual(r.usage, { inputTokens: 900, outputTokens: 12 });
  assert.equal(seen[0].url, "https://checker.example.test/v1/chat/completions");
  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer test-key");
  const body = JSON.parse(String(seen[0].init.body));
  assert.equal(body.model, "checker-model");
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.deepEqual(body.messages.map((m: { role: string }) => m.role), ["system", "user"]);

  const failing = openAICompatibleProvider({ baseUrl: "https://checker.example.test/v1", model: "m", apiKey: "k", fetchImpl: (async () => new Response("no", { status: 503 })) as unknown as typeof fetch });
  assert.equal((await runSecondCheck({ resumeText: CLEAN, sourceText: SOURCE, ownResumeText: TYPED }, failing)).status, "unavailable");
});

test("config: off by default; all three settings needed; never the writer's family", () => {
  assert.equal(secondCheckEnabled({}), false);
  assert.equal(secondCheckEnabled({ SECOND_CHECK_ENABLED: "yes" }), false);
  assert.equal(secondCheckEnabled({ SECOND_CHECK_ENABLED: "true" }), true);
  assert.equal(secondCheckEnabled({ SECOND_CHECK_ENABLED: "1" }), true);
  const full = { SECOND_CHECK_BASE_URL: "https://checker.example.test/v1", SECOND_CHECK_MODEL: "checker-model", SECOND_CHECK_API_KEY: "k" };
  assert.ok(secondCheckProviderFromEnv(full).provider);
  for (const missing of ["SECOND_CHECK_BASE_URL", "SECOND_CHECK_MODEL", "SECOND_CHECK_API_KEY"] as const) {
    const got = secondCheckProviderFromEnv({ ...full, [missing]: "" });
    assert.equal(got.provider, null);
    assert.equal("reason" in got && got.reason, "not_configured");
  }
  const same = secondCheckProviderFromEnv({ ...full, SECOND_CHECK_MODEL: "claude-sonnet-5" });
  assert.equal("reason" in same && same.reason, "same_family");
  assert.ok(isWriterFamily("x", "https://api.anthropic.com/v1"));
  assert.ok(!isWriterFamily("gemini-2.5-pro", "https://generativelanguage.googleapis.com/v1beta/openai"));
});

test("cost cap: no cap means no spend; a call runs only inside the cap", () => {
  assert.equal(parseDailyUsd(undefined), 0);
  assert.equal(parseDailyUsd("abc"), 0);
  assert.equal(parseDailyUsd("-3"), 0);
  assert.equal(parseDailyUsd("2.5"), 2.5);
  assert.equal(secondCheckBudgetAllows(0, 0, 0.01), false);
  assert.equal(secondCheckBudgetAllows(0, 1, 0.01), true);
  assert.equal(secondCheckBudgetAllows(0.99, 1, 0.01), true);
  assert.equal(secondCheckBudgetAllows(0.995, 1, 0.01), false);
  assert.equal(secondCheckBudgetAllows(Number.NaN, 1, 0.01), false);
});

// ---- harness ----------------------------------------------------------------------------

test("harness: markdown pages read as plain lines", () => {
  const md = "# RILEY EXAMPLE\n**STOCKER** | Lakeside Grocery | 2018 - 2023  \n*Neighborhood grocery.*\n---\n- Stocked *about* 30 aisles.";
  assert.equal(markdownToPlain(md), "RILEY EXAMPLE\nSTOCKER | Lakeside Grocery | 2018 - 2023\nNeighborhood grocery.\n- Stocked about 30 aisles.");
});

test("harness: each flaw type plants one changed line on the fixture page", () => {
  for (const flaw of PLANTED_FLAWS) {
    const p = plantFlaw(CLEAN, SOURCE, flaw);
    assert.ok(p, flaw);
    const before = CLEAN.split("\n");
    const after = p!.page.split("\n");
    assert.equal(after.length, before.length, flaw);
    assert.equal(after.filter((l, i) => l !== before[i]).length, 1, flaw);
    assert.ok(after.includes(p!.line), flaw);
  }
  assert.match(plantFlaw(CLEAN, SOURCE, "scope_inflation")!.line, /^- Led inventory counts\.$/);
  assert.match(plantFlaw(CLEAN, SOURCE, "credential_current")!.line, /Present, current/);
  const noCreds = CLEAN.split("\n").slice(0, -2).join("\n");
  assert.equal(plantFlaw(noCreds, SOURCE, "credential_current"), null, "no credential line: no place to plant");
});

test("harness: the mint check alone catches the invented number and misses the rest; a checker that flags the line catches all", async () => {
  const pairs = [{ source: SOURCE, page: CLEAN, ownResumeText: TYPED }];
  const mint = await scoreChecker(pairs, mintChecker);
  assert.equal(mint.flaws.invented_number.caughtBlock, 1);
  // Round 5: every credential not typed exactly is a memory prompt, so the mint check alone now catches it.
  assert.equal(mint.flaws.credential_current.caughtBlock, 1);
  assert.equal(mint.flaws.invented_employer_detail.missed, 1);
  assert.equal(mint.clean.items, 0, "no false alarm on the clean page");

  // A stand-in second model that flags exactly the changed line (scoring plumbing only).
  const flagChanged = withSecondCheck(async (page) => {
    const changed = page.split("\n").filter((l) => !CLEAN.split("\n").includes(l));
    return changed.map((line) => ({ line: line.trim(), kind: "other" as const, severity: "BLOCK" as const, reason: "Not in your words.", question: "Is this true?" }));
  });
  const both = await scoreChecker(pairs, flagChanged);
  for (const flaw of PLANTED_FLAWS) assert.equal(both.flaws[flaw].caughtBlock, 1, flaw);
  assert.equal(both.clean.fromSecondCheck, 0);

  const noisy = await scoreChecker(pairs, withSecondCheck(async () => [{ line: "- Made breakfast orders on the grill.", kind: "other", severity: "FIX", reason: "Hmm.", question: "Sure?" }]));
  assert.equal(noisy.clean.fromSecondCheck, 1);
  assert.equal(noisy.clean.secondCheckFix, 1);
});
