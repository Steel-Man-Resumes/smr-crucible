/**
 * Phase 6, lane S2: the writer under rewording A (Troy 2026-10-11, "reword
 * freely, facts locked") and the traditional page.
 *
 *  - the writer prompt: strong verbs, duty phrasing always rewritten, no
 *    objective, real skills only, dates copied exactly, a CHANGES block;
 *  - the change list: split off the reply, kept only where the server can
 *    stand behind it (old line is the person's, new line is on the final page);
 *  - dates: a shortened date range goes back to the person's own form;
 *  - the truth check traces FACTS, not words: rewording passes, every kind of
 *    invention is still caught, and the model verifier's unflagged rewrites of
 *    reworded lines are put back;
 *  - the page: every heading styled the same, every line under a job a bullet,
 *    the same in PDF, Word and HTML.
 *
 * Mock AI only (fetch is stubbed for the verifier; no real model call).
 * Fixtures are fictional.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";

import { buildForgeResumePrompts, selfDisclosureDirective } from "../forge-resume-prompt";
import { CHANGES_MARKER, CHANGES_MAX, isUsableResume, splitWriterOutput, validateWriterChanges } from "../writer-changes";
import { restoreDateForms } from "../date-form";
import { untracedFacts, traceDocument, factsTraceBack, onlyRewordedFrom } from "../fact-trace";
import { verifyGrounding, flagKindOf } from "../grounding-verify";
import { plainPunctuation } from "../legal-sanitize";
import { stripUnsupportedJobCities } from "../job-line-truth";
import { withholdRecordLines } from "../record-lines";
import { parseResume } from "../resume-render/model";
import { renderDocx, renderHtml, renderPdf } from "../resume-render";
import { runMintCheck } from "@crucible/core/src/resumeMintCheckShared";
import { scopeAllNotTheirsAnswered } from "@crucible/core/src/resumeStatus";
import { parseResumeBlocks, isSectionHeader } from "@crucible/core/src/pageFitShared";
import { resumeTextToDocument, documentKeepsText } from "../revision-to-doc";
import { readFileSync } from "node:fs";
import { WEAK_PAGE, MOCK_WRITER_RESUME, MOCK_WRITER_CHANGES, mockWriterReply } from "./fixtures/weak-page";

// ---- the writer prompt ------------------------------------------------------

const PROMPT_INPUT = {
  narrative: { headline: "Forklift driver", summary: "Warehouse work." },
  skills: [{ name: "Forklift", category: "hard" }],
  resumeText: WEAK_PAGE,
};

test("prompt: rewording A, strong verbs, duty phrasing always rewritten, facts locked", () => {
  const { system, user } = buildForgeResumePrompts(PROMPT_INPUT);
  const all = `${system}\n${user}`;
  assert.match(system, /REWORDING \(reword freely, facts locked\)/);
  assert.match(system, /every bullet starts with a strong, specific action verb, then what was done, with any amount or size only in the person's own numbers and words/);
  assert.doesNotMatch(`${system}\n${user}`, /its scale/);
  assert.match(system, /Rewrite every duty line \("responsible for", "duties included", "did", "dealt with", "in charge of"/);
  assert.match(system, /"In charge of the guys on my shift\." becomes "Supervised the shift crew\."/);
  // CC ruling H1: supervising people is scope, tied to that job's title or people in their own words.
  assert.match(system, /SUPERVISING PEOPLE IS SCOPE/);
  assert.match(system, /under the title Production Supervisor may become "Supervised third-shift production", but under the title Machine Operator it stays about the work/);
  assert.match(system, /"Responsible for" a shift, an area, a task or a thing never becomes supervising/);
  assert.match(system, /Facts belong to their own job/);
  assert.doesNotMatch(system, /"Responsible for 3rd shift\." becomes "Supervised/);
  assert.match(system, /Locked in every reworded line: numbers, job titles, employers, dates, credentials \(type and status\) and scope/);
  assert.match(system, /Anything NEW \(a number, a result, a tool, a skill the person never named\) is never added/);
  assert.doesNotMatch(all, /turn duty phrasing into plain action verbs only where/);
  assert.match(user, /Reword every weak line into strong plain words that say what it means; keep every fact/);
});

test("prompt: no objective ever, headline + summary, real skills only, never soft-skill words", () => {
  const { system, user } = buildForgeResumePrompts(PROMPT_INPUT);
  assert.match(system, /NO OBJECTIVE, EVER/);
  assert.match(system, /Never an objective, never a slogan/);
  assert.match(system, /CAREER SUMMARY \(2-4 plain sentences/);
  assert.match(system, /Never list soft-skill words \("hard worker", "team player", "fast learner", "detail oriented", "good communication"/);
  assert.match(system, /never soft-skill words/);
  assert.match(user, /No objective\. No soft-skill words in the skills section\./);
});

test("prompt: dates copied exactly as given; never the year-only job line format", () => {
  const { system, user } = buildForgeResumePrompts(PROMPT_INPUT);
  const all = `${system}\n${user}`;
  assert.doesNotMatch(all, /Start Year - End Year/);
  assert.doesNotMatch(all, /use years only/i);
  assert.match(all, /"8\/2021 - 12\/2022" stays "8\/2021 - 12\/2022" \(never "2021 - 2022" and never "Aug 2021"\)/);
  assert.match(user, /Dates copied exactly as the person wrote them: 8\/2021 - 12\/2022 stays 8\/2021 - 12\/2022/);
  // The gaps worry used to say "use years only (never months)"; dates are locked now.
  const gaps = selfDisclosureDirective({ resumeWorries: ["gaps"] });
  assert.match(gaps, /keep every date exactly as they gave it/);
  assert.doesNotMatch(gaps, /years only/);
});

test("prompt: the writer ends with a CHANGES block the server can check", () => {
  const { system, user } = buildForgeResumePrompts(PROMPT_INPUT);
  assert.ok(user.includes(CHANGES_MARKER));
  assert.match(user, new RegExp(`At most ${CHANGES_MAX} entries`));
  for (const rule of ["objective", "soft_skill_list", "duty_phrasing", "bullet", "heading", "summary", "date_format"]) {
    assert.ok(user.includes(`"${rule}"`), rule);
  }
  assert.match(user, /"old" and "new" must be copied character for character/);
  assert.match(system, /The one exception is the CHANGES block after the resume/);
  assert.match(user, /never change the date itself/);
});

// ---- the change list --------------------------------------------------------

test("changes: split off the reply; the resume never carries the block", () => {
  const { resume, changes } = splitWriterOutput(mockWriterReply());
  assert.equal(resume, MOCK_WRITER_RESUME);
  assert.ok(Array.isArray(changes) && (changes as unknown[]).length === MOCK_WRITER_CHANGES.length);
  assert.doesNotMatch(resume, /CHANGES|"old"/);
  // No marker, but a trailing list: still cut from the resume.
  const noMarker = splitWriterOutput(`${MOCK_WRITER_RESUME}\n\n${JSON.stringify(MOCK_WRITER_CHANGES)}`);
  assert.equal(noMarker.resume, MOCK_WRITER_RESUME);
  assert.ok(Array.isArray(noMarker.changes) && (noMarker.changes as unknown[]).length > 0);
  // Broken JSON after the marker: no reveal, resume intact.
  const broken = splitWriterOutput(`${MOCK_WRITER_RESUME}\n${CHANGES_MARKER}\n[{"old": "Did safety`);
  assert.equal(broken.resume, MOCK_WRITER_RESUME);
  assert.deepEqual(broken.changes, []);
  // No block at all.
  assert.deepEqual(splitWriterOutput(MOCK_WRITER_RESUME), { resume: MOCK_WRITER_RESUME, changes: [] });
  // A marker wrapped in markdown is still the marker.
  assert.equal(splitWriterOutput(`${MOCK_WRITER_RESUME}\n**${CHANGES_MARKER}**\n[]`).resume, MOCK_WRITER_RESUME);
});

test("changes: kept only where old is the person's line and new is on the final resume", () => {
  const { changes } = splitWriterOutput(mockWriterReply());
  const kept = validateWriterChanges(changes, { ownResumeText: WEAK_PAGE, finalResume: MOCK_WRITER_RESUME });
  assert.deepEqual(kept.map((c) => c.rule), ["objective", "soft_skill_list", "duty_phrasing", "duty_phrasing", "duty_phrasing", "heading"]);
  assert.ok(!kept.some((c) => c.old === "Ran the whole warehouse."), "old not on the person's page");
  assert.ok(!kept.some((c) => /entire store/.test(c.new)), "new not on the final resume");
  const duty = kept.find((c) => c.old === "In charge of the guys on my shift.")!;
  assert.equal(duty.new, "Supervised the shift crew.");
  assert.match(duty.why, /reads like a job description/);
  for (const c of kept) {
    assert.ok(Object.keys(c).sort().join() === "new,old,rule,why", JSON.stringify(c));
    assert.doesNotMatch(`${c.new} ${c.why}`, /[\u2013\u2014]|--/);
  }
});

test("changes: shape, caps and junk", () => {
  const ctx = { ownResumeText: WEAK_PAGE, finalResume: MOCK_WRITER_RESUME };
  for (const junk of [undefined, null, "x", 3, {}, [null, 1, "a", { old: 1 }]]) assert.deepEqual(validateWriterChanges(junk, ctx), []);
  // Unchanged lines are not changes; unknown rule ids become "reword"; dashes in why are swept.
  const out = validateWriterChanges(
    [
      { old: "Stocked shelves.", new: "Stocked shelves.", why: "same", rule: "duty_phrasing" },
      { old: "Did safety audits.", new: "Ran safety audits.", why: "Did is weak \u2014 Ran is strong.", rule: "Weird Rule!" },
    ],
    ctx
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].rule, "reword");
  assert.doesNotMatch(out[0].why, /\u2014/);
  // The writer's copy with an em dash still matches the final line the dash sweep fixed.
  const swept = validateWriterChanges([{ old: "Did safety audits.", new: "Ran safety audits.", why: "ok", rule: "duty_phrasing" }], {
    ownResumeText: WEAK_PAGE,
    finalResume: MOCK_WRITER_RESUME,
  });
  assert.equal(swept.length, 1);
  // At most CHANGES_MAX, deduplicated.
  const many = Array.from({ length: 60 }, () => ({ old: "Did safety audits.", new: "Ran safety audits.", why: "w", rule: "duty_phrasing" }));
  assert.equal(validateWriterChanges(many, ctx).length, 1);
  const lines = Array.from({ length: 60 }, (_, i) => `Line number ${i} here.`);
  const own = lines.join("\n");
  const fin = lines.map((l) => l.replace("here", "now")).join("\n");
  const big = lines.map((l) => ({ old: l, new: l.replace("here", "now"), why: "w", rule: "reword" }));
  assert.equal(validateWriterChanges(big, { ownResumeText: own, finalResume: fin }).length, CHANGES_MAX);
  // Withheld lines are not the person's resume text the writer saw.
  const page = `${WEAK_PAGE}\nKitchen Worker | State Correctional Facility | 2019 - 2020`;
  const seen = withholdRecordLines(page, false).kept;
  assert.deepEqual(
    validateWriterChanges([{ old: "Kitchen Worker | State Correctional Facility | 2019 - 2020", new: "Ran safety audits.", why: "w", rule: "reword" }], {
      ownResumeText: seen,
      finalResume: MOCK_WRITER_RESUME,
    }),
    []
  );
  // A reason that talks about a record never ships (unless the person kept those lines).
  const rec = [{ old: "Did safety audits.", new: "Ran safety audits.", why: "Your parole officer will like this.", rule: "reword" }];
  assert.deepEqual(validateWriterChanges(rec, ctx), []);
});

// ---- dates ----------------------------------------------------------------------

test("dates: a job line shortened to years gets the person's own form back", () => {
  const shortened = MOCK_WRITER_RESUME.replace("8/2021 - 12/2022", "2021 - 2022");
  const r = restoreDateForms(shortened, WEAK_PAGE);
  assert.equal(r.restored, 1);
  assert.ok(r.text.includes("FORKLIFT DRIVER | Northgate Supply | Libby, MT | 8/2021 - 12/2022"));
  assert.equal(r.text, MOCK_WRITER_RESUME);
  // Same months in another form go back too, on the same entry; a different month is a changed date.
  assert.ok(restoreDateForms("FORKLIFT DRIVER | Northgate Supply | Aug 2021 - Dec 2022", WEAK_PAGE).text.endsWith("8/2021 - 12/2022"));
  assert.equal(restoreDateForms("FORKLIFT DRIVER | Northgate Supply | Mar 2021 - 2022", WEAK_PAGE).restored, 0);
  // An entry that is not theirs (another title or employer) never takes their dates.
  assert.equal(restoreDateForms("A | B | Aug 2021 - Dec 2022", WEAK_PAGE).restored, 0);
  // Year-only ranges the person wrote year-only are untouched; bullets and sentences are never touched.
  assert.equal(restoreDateForms(MOCK_WRITER_RESUME, WEAK_PAGE).restored, 0);
  assert.equal(restoreDateForms("- Ran the 2021 - 2022 audits.", WEAK_PAGE).restored, 0);
  // A long dash in their range comes back as a plain hyphen.
  assert.equal(restoreDateForms("PICKER | Valley Foods | 2019 - Present", "Picker | Valley Foods | Jan 2019 \u2013 Present").text, "PICKER | Valley Foods | Jan 2019 - Present");
});

// ---- fact trace: rewording passes, inventions are caught -------------------------

test("fact trace: rewording that keeps every fact passes", () => {
  for (const line of [
    "- Supervised the shift crew.",
    "- Ran safety audits.",
    "- Drove a forklift and loaded 6 trucks a night.",
    "- Helped the lead with inventory counts.",
    "- Served customers at the register.",
    "FORKLIFT DRIVER | Northgate Supply | Libby, MT | 8/2021 - 12/2022",
  ]) {
    assert.deepEqual(untracedFacts(line, WEAK_PAGE), [], line);
  }
  assert.deepEqual(untracedFacts("Supervised the shift crew.", "In charge of the guys on my shift."), []);
  assert.deepEqual(untracedFacts("Forklift operation, Truck loading, Inventory counts", WEAK_PAGE, { section: "skills" }), []);
  for (const row of traceDocument(MOCK_WRITER_RESUME, WEAK_PAGE)) assert.deepEqual(row.untraced, [], row.line);
});

test("fact trace: every kind of invention is caught", () => {
  const cases: Array<[string, string, "skills" | undefined]> = [
    ["number", "- Supervised a 12-person crew.", undefined],
    ["number", "- Loaded 9 trucks a night.", undefined],
    ["result", "- Ran safety audits, cutting errors by half.", undefined],
    ["result", "- Ran safety audits with a clean safety record.", undefined],
    ["tool", "- Drove a reach truck and loaded trucks.", undefined],
    ["name", "- Counted inventory in Oracle.", undefined],
    ["skill", "Forklift operation, Python, Truck loading", "skills"],
    ["credential", "- Holds a forklift certification.", undefined],
    ["credential", "OSHA 10, 2022", undefined],
    ["name", "FORKLIFT DRIVER | Amazon | Libby, MT | 8/2021 - 12/2022", undefined],
    ["name", "WAREHOUSE MANAGER | Northgate Supply | Libby, MT | 8/2021 - 12/2022", undefined],
    ["date", "FORKLIFT DRIVER | Northgate Supply | Libby, MT | 3/2021 - 12/2022", undefined],
    ["date", "STOCKER | Corner Mart | 2014 - 2018", undefined],
    ["scope", "- Led inventory counts.", undefined],
    ["scope", "- Supervised the plant floor.", undefined],
    ["scope", "- Stocked shelves for the entire store.", undefined],
    ["character", "- Reliable worker with perfect attendance.", undefined],
  ];
  for (const [kind, line, section] of cases) {
    const found = untracedFacts(line, WEAK_PAGE, { section });
    assert.ok(found.some((f) => f.kind === kind), `${kind}: ${line} -> ${JSON.stringify(found)}`);
    assert.equal(factsTraceBack(line, WEAK_PAGE, { section }), false, line);
  }
});

// ---- the model verifier, with a stubbed reply -------------------------------------

async function withVerifierReply<T>(reply: unknown, run: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const realKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-token-not-a-key";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = realKey;
  }
}

test("verifier: a wording flag on a provable rewording is not a fabrication; the page stands as written", async () => {
  const reply = {
    hasFabrication: true,
    flags: [
      { claim: "Ran safety audits.", why: "source says did", kind: "wording" },
      { claim: "Served customers at the register.", why: "source says dealt with", kind: "rephrased" },
    ],
    cleaned: MOCK_WRITER_RESUME.replace("- Ran safety audits.", "- Did safety audits.").replace("- Served customers at the register.", "- Dealt with customers at the register."),
  };
  const r = await withVerifierReply(reply, () => verifyGrounding({ sourceText: WEAK_PAGE, output: MOCK_WRITER_RESUME, kind: "resume" }));
  assert.equal(r.verifierRan, true);
  assert.equal(r.hasFabrication, false);
  assert.equal(r.applied, false);
  assert.deepEqual(r.flags, []);
  assert.equal(r.text, MOCK_WRITER_RESUME);
});

test("H2: the verifier's quiet fixes are never undone (no restore of unflagged lines)", async () => {
  // Reviewer probe: four inventions the verifier fixed without flagging, plus one flagged line.
  const source = "Rory Example\nResponsible for the crew's safety gear.\nHelped the lead with inventory counts.\nHad a forklift card until 2019.\nAnswered phones.\nStocked shelves.";
  const written = "RORY EXAMPLE\n\nEXPERIENCE\nSTOCKER | Corner Mart | 2016 - 2018\n- Supervised the crew.\n- Ran inventory counts.\n- Hold a forklift card.\n- Resolved customer complaints by phone.\n- Stocked shelves and cut shrink by 30%.";
  const cleaned = "RORY EXAMPLE\n\nEXPERIENCE\nSTOCKER | Corner Mart | 2016 - 2018\n- Kept the crew's safety gear in order.\n- Helped the lead with inventory counts.\n- Had a forklift card until 2019.\n- Answered phones.\n- Stocked shelves.";
  const reply = { hasFabrication: true, flags: [{ claim: "cut shrink by 30%", why: "no number in source", kind: "result" }], cleaned };
  const r = await withVerifierReply(reply, () => verifyGrounding({ sourceText: source, output: written, kind: "resume" }));
  assert.equal(r.applied, true);
  assert.equal(r.text, cleaned, "the whole rewrite stands");
  for (const bad of ["Supervised the crew", "Ran inventory counts", "Hold a forklift card", "Resolved customer complaints", "30%"]) assert.ok(!r.text.includes(bad), bad);
  const src = readFileSync(new URL("../grounding-verify.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /keepRewordedLines/);
  // Each probe line is also not a provable rewording, so a "wording" label on it would not drop it.
  for (const line of ["Supervised the crew.", "Ran inventory counts.", "Hold a forklift card.", "Resolved customer complaints by phone."]) {
    assert.equal(onlyRewordedFrom(line, source), false, line);
  }
});

test("M1: a 'rephrased' flag on a plain-words invention stays a flag and the cut is applied", async () => {
  const source = "Rory Example\nMopped floors. Answered phones. Took out trash on 3rd shift.";
  const written = "RORY EXAMPLE\n\nEXPERIENCE\nCUSTODIAN | Acme Plant | 2019 - 2021\n- Mopped floors.\n- Kept the plant floors clean and organized.\n- Answered phones.";
  const cleaned = "RORY EXAMPLE\n\nEXPERIENCE\nCUSTODIAN | Acme Plant | 2019 - 2021\n- Mopped floors.\n- Answered phones.";
  const reply = { hasFabrication: true, flags: [{ claim: "Kept the plant floors clean and organized.", why: "not stated", kind: "rephrased" }], cleaned };
  const r = await withVerifierReply(reply, () => verifyGrounding({ sourceText: source, output: written, kind: "resume" }));
  assert.equal(r.hasFabrication, true);
  assert.equal(r.applied, true);
  assert.equal(r.flags.length, 1);
  assert.doesNotMatch(r.text, /organized/);
  // A wording flag past a truncated list (more than 25 flags) is never dropped either.
  const many = Array.from({ length: 26 }, (_, i) => ({ claim: i === 0 ? "Answered phones." : `phrase number ${i}`, why: "w", kind: "wording" }));
  const r2 = await withVerifierReply({ hasFabrication: true, flags: many, cleaned }, () => verifyGrounding({ sourceText: source, output: written, kind: "resume" }));
  assert.ok(r2.flags.some((f) => f.claim === "Answered phones."));
});

test("M1: what counts as a provable rewording", () => {
  const src = "Did safety audits.\nHelped the lead with inventory counts.\nHad a forklift card until 2019.\nIn charge of the guys on my shift.\nDealt with customers at the register.\nLoaded 6 trucks a night.";
  for (const ok of ["Ran safety audits.", "Served customers at the register.", "Helped the lead run inventory counts."]) assert.equal(onlyRewordedFrom(ok, src), true, ok);
  for (const bad of [
    "Ran inventory counts.", // helped -> solo
    "Hold a forklift card.", // credential status
    "Supervised the shift crew.", // a new noun: asked, not dropped
    "Handled a large shift crew.", // size word
    "Loaded 9 trucks a night.", // number
    "Kept the floors clean and organized.", // new duty
  ]) assert.equal(onlyRewordedFrom(bad, src), false, bad);
});

test("verifier: kinds are read leniently and the prompt traces facts, not words", async () => {
  assert.equal(flagKindOf("Wording"), "wording");
  assert.equal(flagKindOf("paraphrase"), "wording");
  assert.equal(flagKindOf("number"), "number");
  assert.equal(flagKindOf("anything else"), "other");
  assert.equal(flagKindOf(undefined), "other");
  // A "wording" flag on a phrase with an untraced fact still counts.
  const reply = { hasFabrication: true, flags: [{ claim: "Supervised a 12-person crew.", why: "w", kind: "wording" }], cleaned: "RORY\n- Supervised the crew.\nmore lines here to pass the length floor" };
  const r = await withVerifierReply(reply, () => verifyGrounding({ sourceText: WEAK_PAGE, output: "RORY\n- Supervised a 12-person crew.\nmore lines here to pass the length floor", kind: "resume" }));
  assert.equal(r.hasFabrication, true);
  const src = (await import("node:fs")).readFileSync(new URL("../grounding-verify.ts", import.meta.url), "utf8");
  assert.match(src, /TRACE FACTS, NOT WORDS/);
  assert.match(src, /Never flag a line only because its words differ from SOURCE/);
  assert.match(src, /Change ONLY the lines you flagged/);
  assert.match(src, /SUPERVISING PEOPLE IS SCOPE/);
  assert.match(src, /"Responsible for 3rd shift" under the job title "Production Supervisor" written as "Supervised third-shift production"/);
  assert.match(src, /"Responsible for 3rd shift" under the title "Machine Operator" written as "Supervised third-shift production" FAILS/);
  assert.doesNotMatch(src, /SOURCE "Responsible for 3rd shift" written as "Supervised the 3rd shift crew"/);
});

// ---- the whole server path on the mock writer's reply -------------------------------

/** The generate-docs steps after the writer, with the verifier unavailable (no key): what the route ships. */
async function serverPath(reply: string, source: string) {
  const { resume: written, changes: raw } = splitWriterOutput(reply);
  const check = await verifyGrounding({ sourceText: source, output: written, kind: "resume" });
  const swept = plainPunctuation(check.text);
  const city = stripUnsupportedJobCities(swept, source);
  const dated = restoreDateForms(city.text, source);
  const changes = validateWriterChanges(raw, { ownResumeText: withholdRecordLines(source, false).kept, finalResume: dated.text });
  return { resume: dated.text, changes, verifierRan: check.verifierRan };
}

test("server path: the weak page becomes a traditional resume, true to the person's facts", async () => {
  const realKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    // The live writer once shortened the dates; the server puts them back.
    const out = await serverPath(mockWriterReply(MOCK_WRITER_RESUME.replace("8/2021 - 12/2022", "2021 - 2022")), WEAK_PAGE);
    assert.equal(out.resume, MOCK_WRITER_RESUME);
    assert.equal(out.changes.length, 6);
    assert.doesNotMatch(out.resume, /objective|hard worker|team player|fast learner|good communication|Responsible for|Did safety|Dealt with/i);
    assert.match(out.resume, /8\/2021 - 12\/2022/);
    // The deterministic mint check finds no invented number, year, scope or skill.
    const mint = runMintCheck({ output: out.resume, source: WEAK_PAGE, kind: "resume" });
    assert.equal(mint.blockCount, 0, JSON.stringify(mint.findings));
    assert.ok(!mint.findings.some((f) => ["grid_term", "grid_scope_term", "dropped_number", "added_number", "sole_actor"].includes(f.kind ?? "")), JSON.stringify(mint.findings));
  } finally {
    if (realKey !== undefined) process.env.OPENAI_API_KEY = realKey;
  }
});

// ---- the page: traditional, the same in every format ----------------------------------

function readZipEntry(buf: Buffer, want: string): string {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    if (name === want) {
      const lnlen = buf.readUInt16LE(lho + 26);
      const lelen = buf.readUInt16LE(lho + 28);
      const raw = buf.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
      return (method === 8 ? inflateRawSync(raw) : Buffer.from(raw)).toString("utf8");
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error(`no ${want}`);
}

test("page: every known heading is a heading, in any case", () => {
  const m = parseResume(WEAK_PAGE);
  const sections = m.blocks.filter((b) => b.kind === "section").map((b) => (b as { text: string }).text);
  assert.deepEqual(sections, ["OBJECTIVE", "SKILLS", "WORK EXPERIENCE", "EDUCATION"]);
  const written = parseResume(MOCK_WRITER_RESUME);
  assert.deepEqual(
    written.blocks.filter((b) => b.kind === "section").map((b) => (b as { text: string }).text),
    ["CAREER SUMMARY", "CORE COMPETENCIES", "PROFESSIONAL EXPERIENCE", "EDUCATION"]
  );
  for (const h of ["Experience", "Work History", "Employment History", "Certifications", "Licenses and Certifications", "Summary", "Professional Summary"]) {
    const b = parseResume(`Pat Example\nCity, ST\n\n${h}\nSomething here.`).blocks[0];
    assert.equal(b.kind, "section", h);
  }
});

test("page: every line under a job is a bullet, even when the person typed no bullet mark", () => {
  const m = parseResume(WEAK_PAGE);
  const i = m.blocks.findIndex((b) => b.kind === "job" && b.title === "Forklift Driver");
  const job = m.blocks[i] as { kind: "job"; title: string; rest: string[]; years: string };
  assert.deepEqual(job.rest, ["Northgate Supply", "Libby, MT"]);
  assert.equal(job.years, "8/2021 - 12/2022");
  const under = m.blocks.slice(i + 1, i + 5);
  assert.deepEqual(under.map((b) => b.kind), ["bullet", "bullet", "bullet", "bullet"]);
  assert.equal((under[0] as { text: string }).text, "In charge of the guys on my shift.");
  // The second job's lines too; the school line is an entry with nothing turned into bullets.
  const j2 = m.blocks.findIndex((b) => b.kind === "job" && b.title === "Stocker");
  assert.deepEqual(m.blocks.slice(j2 + 1, j2 + 3).map((b) => b.kind), ["bullet", "bullet"]);
  assert.ok(!m.blocks.some((b) => b.kind === "para" && b.role === "overview"));
  // A date line right under a job with no dates moves beside the title.
  const d = parseResume("Pat Example\nCity, ST\n\nEXPERIENCE\nCook | Harbor Diner\n2019 - 2021\nRan the grill.").blocks;
  assert.deepEqual(d.map((b) => b.kind), ["section", "job", "bullet"]);
  assert.equal((d[1] as { years: string }).years, "2019 - 2021");
  // Outside a jobs section nothing becomes a bullet.
  const e = parseResume("Pat Example\nCity, ST\n\nEDUCATION\nLincoln County High School | 2015\nHonor roll.").blocks;
  assert.deepEqual(e.map((b) => b.kind), ["section", "job", "para"]);
});

test("page: the traditional order and look, the same in HTML, Word and PDF", async () => {
  const m = parseResume(MOCK_WRITER_RESUME);
  assert.equal(m.header.name, "RORY EXAMPLE");
  assert.equal(m.header.contact, "Libby, MT | (406) 555-0147 | rory@example.com");
  assert.equal(m.header.headline, "Forklift Driver and Stocker");
  const shape = m.blocks.map((b) => (b.kind === "section" ? b.text : b.kind));
  assert.deepEqual(shape, [
    "CAREER SUMMARY", "para",
    "CORE COMPETENCIES", "skills",
    "PROFESSIONAL EXPERIENCE", "job", "bullet", "bullet", "bullet", "bullet", "job", "bullet", "bullet",
    "EDUCATION", "job",
  ]);
  // HTML: every heading the same element and class, every job line a list item.
  const html = renderHtml({ text: WEAK_PAGE });
  for (const h of ["OBJECTIVE", "SKILLS", "WORK EXPERIENCE", "EDUCATION"]) assert.ok(html.includes(`<h2>${h}</h2>`), h);
  for (const l of ["In charge of the guys on my shift.", "Did safety audits.", "Stocked shelves.", "Dealt with customers at the register."]) {
    assert.ok(html.includes(`<li>${l}</li>`), l);
  }
  // Word: each heading paragraph carries the same run formatting.
  const xml = readZipEntry(Buffer.from(await renderDocx({ text: WEAK_PAGE })), "word/document.xml");
  const runProps = (h: string) => {
    const at = xml.indexOf(`>${h}</w:t>`);
    assert.ok(at > 0, h);
    const start = xml.lastIndexOf("<w:r>", at);
    return xml.slice(start, at).replace(/<w:t[^>]*$/, "");
  };
  const props = ["OBJECTIVE", "SKILLS", "WORK EXPERIENCE", "EDUCATION"].map(runProps);
  assert.ok(props.every((p) => p === props[0]), props.join("\n"));
  // PDF: the same words in the same order as the HTML and Word builds read them.
  const pdf = Buffer.from(await renderPdf({ text: WEAK_PAGE })).toString("latin1");
  assert.ok(pdf.startsWith("%PDF"));
});

// ---- Round 2 (review r1): one regression test per finding, the reviewer's fictional probes ----------

test("H1: fact trace, finish-gate scope cards and the mint check agree on supervising people", () => {
  const cases: Array<[string, string, boolean]> = [
    // [page line, source, flagged?]
    ["Supervised the crew.", "Responsible for the crew's safety gear.", true],
    ["Supervised the kitchen.", "Responsible for cleaning the kitchen.", true],
    ["Supervised the line crew.", "Ran the line.", true],
    ["Supervised the 3rd shift crew.", "Responsible for 3rd shift.", true],
    ["Supervised third-shift production.", "Machine Operator | Acme | 2019 - 2021\nResponsible for 3rd shift.", true],
    ["Supervised third-shift production.", "Production Supervisor | Acme | 2019 - 2021\nResponsible for 3rd shift.", false],
    ["Supervised the shift crew.", "In charge of employees on my shift.", false],
    ["Supervised the crew.", "I ran a crew of 4.", false],
  ];
  for (const [line, src, flagged] of cases) {
    const trace = untracedFacts(`- ${line}`, src).some((f) => f.kind === "scope");
    const card = scopeAllNotTheirsAnswered(line, src, []).length > 0;
    assert.equal(trace, flagged, `fact trace: ${line} <= ${src}`);
    assert.equal(card, flagged, `scope card: ${line} <= ${src}`);
  }
});

test("M2: a date range goes back only on the same entry, never by years alone", () => {
  const a = restoreDateForms("CUSTODIAN | Acme Plant | 2021 - 2022\nCASHIER | Corner Mart | 2021 - 2022", "Custodian | Acme Plant | 8/2021 - 12/2022\nCashier | Corner Mart | 2021 - 2022");
  assert.equal(a.text, "CUSTODIAN | Acme Plant | 8/2021 - 12/2022\nCASHIER | Corner Mart | 2021 - 2022");
  assert.equal(a.restored, 1);
  const b = restoreDateForms("GED | Lincoln Adult Ed | 2015 - 2016", "Worked at Mill 6/2015 - 2/2016\nGED 2015 - 2016");
  assert.equal(b.restored, 0);
  assert.equal(b.text, "GED | Lincoln Adult Ed | 2015 - 2016");
  // A dates line under its header belongs to that header, on both sides.
  assert.equal(restoreDateForms("COOK | Harbor Diner\n2019 - 2021", "Cook | Harbor Diner\n3/2019 - 5/2021").text, "COOK | Harbor Diner\n3/2019 - 5/2021");
  // Two entries of theirs with the same names and years but different months: ambiguous, left alone.
  assert.equal(restoreDateForms("COOK | Harbor Diner | 2019 - 2021", "Cook | Harbor Diner | 1/2019 - 3/2021\nCook | Harbor Diner | 5/2019 - 9/2021").restored, 0);
});

test("M3: every shape of change block is cut; the resume is never emptied or truncated", () => {
  const R = "RORY EXAMPLE\nLibby, MT\n\nCAREER SUMMARY\nDrove forklifts.\n\nEDUCATION\nLincoln County High School | 2015";
  const L = [{ old: "Did safety audits.", new: "Ran safety audits.", why: "w", rule: "duty_phrasing" }];
  const J = JSON.stringify(L);
  const P = JSON.stringify(L, null, 2);
  const shapes: Record<string, string> = {
    fenced: `${R}\n\n\`\`\`json\n${P}\n\`\`\``,
    pretty: `${R}\n\n${P}`,
    sameLine: `${R}\n===CHANGES=== ${J}`,
    spaced: `${R}\n\n=== CHANGES ===\n${J}`,
    colon: `${R}\n\nCHANGES:\n${J}`,
    bold: `${R}\n\n**CHANGES**\n${J}`,
    first: `===CHANGES===\n${J}\n\n${R}`,
    mid: `RORY EXAMPLE\nLibby, MT\n\nCAREER SUMMARY\nDrove forklifts.\n===CHANGES===\n${J}\n\nEDUCATION\nLincoln County High School | 2015`,
  };
  for (const [name, reply] of Object.entries(shapes)) {
    const out = splitWriterOutput(reply);
    assert.equal(out.resume, R, name);
    assert.equal((out.changes as unknown[]).length, 1, name);
  }
  for (const [name, reply] of Object.entries({ emptyList: `${R}\n===CHANGES===\n[]`, labelOnly: `${R}\n\nCHANGES:`, broken: `${R}\n===CHANGES===\n[{"old": "Did safety` })) {
    const out = splitWriterOutput(reply);
    assert.equal(out.resume, R, name);
    assert.deepEqual(out.changes, [], name);
  }
  // A reply that is only the block leaves nothing to sign; the route refuses it before any check or receipt.
  assert.equal(isUsableResume(splitWriterOutput(`===CHANGES===\n${J}`).resume), false);
  assert.equal(isUsableResume(R), true);
  const route = readFileSync(new URL("../../app/api/forge/generate-docs/route.ts", import.meta.url), "utf8");
  const guard = route.indexOf("if (!isUsableResume(resumeRaw))");
  assert.ok(guard > 0 && guard < route.indexOf("verifyGrounding(") && guard < route.indexOf("writerReceipt("), "guard runs before the check and the receipt");
  assert.match(route.slice(guard, guard + 400), /status: 502/);
});

test("M4: the headline never takes a contact, place or inside-work line", () => {
  for (const line of ["rory@example.com", "Libby, MT", "(406) 555-0147", "Kitchen Worker, State Correctional Facility", "www.example.com/rory"]) {
    const m = parseResume(`RORY EXAMPLE\n\n${line}\n\nCAREER SUMMARY\nDrove forklifts.`);
    assert.equal(m.header.headline, "", line);
    const pf = parseResumeBlocks(`RORY EXAMPLE\n\n${line}\n\nCAREER SUMMARY\nDrove forklifts.`);
    assert.ok(!pf.some((b) => b.type === "headline"), `page fit: ${line}`);
  }
  assert.equal(parseResume("RORY EXAMPLE\nLibby, MT\n\nForklift Driver and Stocker\n\nSKILLS\nForklift, Loading").header.headline, "Forklift Driver and Stocker");
});

test("M5: a job header without pipes, or on two lines, stays a job header", () => {
  const page = `Pat Example\nCity, ST\n\nWork Experience\nForklift Driver | Northgate Supply | 2019 - 2021\nDrove forklift.\nSTOCKER\nCorner Mart, Libby MT\n2016 - 2018\nStocked shelves.\nCashier at Quick Stop (2014 - 2015)\nRan the register.`;
  const m = parseResume(page);
  const shape = m.blocks.map((b) => (b.kind === "job" ? `job:${b.title}|${b.rest.join("/")}|${b.years}` : b.kind === "section" ? b.text : `${b.kind}:${"text" in b ? b.text : ""}`));
  assert.deepEqual(shape, [
    "WORK EXPERIENCE",
    "job:Forklift Driver|Northgate Supply|2019 - 2021",
    "bullet:Drove forklift.",
    "job:STOCKER|Corner Mart, Libby MT|2016 - 2018",
    "bullet:Stocked shelves.",
    "job:Cashier at Quick Stop||2014 - 2015",
    "bullet:Ran the register.",
  ]);
});

test("L1: a line with a digit or a pipe is never a heading", () => {
  assert.equal(isSectionHeader("Volunteer | 2019 - 2020"), false);
  assert.equal(isSectionHeader("Volunteer 2019"), false);
  assert.equal(isSectionHeader("Volunteer"), true);
  const m = parseResume("Pat Example\nCity, ST\n\nEXPERIENCE\nVolunteer | Food Bank | 2019 - 2020\nSorted donations.");
  assert.equal(m.blocks[1].kind, "job");
});

test("L2: a change's old line is a whole line of theirs, never a fragment", () => {
  const ctx = { ownResumeText: WEAK_PAGE, finalResume: MOCK_WRITER_RESUME };
  assert.deepEqual(validateWriterChanges([{ old: "safety audits", new: "Ran safety audits.", why: "w", rule: "duty_phrasing" }], ctx), []);
  assert.deepEqual(validateWriterChanges([{ old: "the", new: "Ran safety audits.", why: "w", rule: "duty_phrasing" }], ctx), []);
  assert.equal(validateWriterChanges([{ old: "Did safety audits.", new: "Ran safety audits.", why: "w", rule: "duty_phrasing" }], ctx).length, 1);
  // A "Label:" in front of their line is not part of it.
  assert.equal(validateWriterChanges([{ old: "To find steady work.", new: "Ran safety audits.", why: "w", rule: "objective" }], { ownResumeText: "Objective: To find steady work.", finalResume: MOCK_WRITER_RESUME }).length, 1);
});

test("L3: the page-fit estimate reads the same headline and bullets the renderer draws", () => {
  const blocks = parseResumeBlocks(MOCK_WRITER_RESUME);
  assert.equal(blocks.find((b) => b.type === "headline")?.text, "Forklift Driver and Stocker");
  const weak = parseResumeBlocks(WEAK_PAGE);
  for (const l of ["In charge of the guys on my shift.", "Did safety audits.", "Stocked shelves."]) {
    assert.equal(weak.find((b) => b.text === l)?.type, "bullet", l);
  }
  const drawn = parseResume(WEAK_PAGE).blocks.filter((b) => b.kind === "bullet").length;
  assert.equal(weak.filter((b) => b.type === "bullet").length, drawn);
});

test("L4: size words are facts the person must have said", () => {
  for (const line of ["- Loaded heavy freight.", "- Handled major accounts.", "- Supervised a large crew.", "- Ran daily safety audits."]) {
    assert.ok(untracedFacts(line, WEAK_PAGE).some((f) => f.kind === "scope"), line);
  }
  assert.deepEqual(untracedFacts("- Ran daily safety audits.", "Did daily safety audits.").filter((f) => f.kind === "scope"), []);
});

test("L6: the document guard checks the headline and job dates again", () => {
  const text = MOCK_WRITER_RESUME.replace("Forklift Driver and Stocker", "Forklift Driver and Yard Hand");
  const doc = resumeTextToDocument(text);
  assert.ok(documentKeepsText(text, doc));
  // The headline's own words are checked (they are drawn in the header since Phase 6).
  const dropped = JSON.parse(JSON.stringify(doc).replace(/Yard Hand/g, ""));
  assert.equal(documentKeepsText(text, dropped), false);
  // A job's dates are checked too.
  const noYears = JSON.parse(JSON.stringify(doc).replace(/2016/g, ""));
  assert.equal(documentKeepsText(text, noYears), false);
});
