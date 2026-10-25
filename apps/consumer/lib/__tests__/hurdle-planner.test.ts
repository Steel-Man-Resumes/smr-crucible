/**
 * Hurdle planner: decision graph, reducer (branching, back, skip, several
 * hurdles), coverage (not length), the fact-strip checker, filters and the
 * phrasing pipeline. All pure; the model is a fake.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HURDLES, HURDLE_IDS, NODES, getNode, resolveNext } from "../hurdles/graph";
import { INITIAL_STATE, plannerReducer, walk, fullPath, reachedAnswers, hurdlesOf, type PlannerState, type PlannerAction } from "../hurdles/reducer";
import { coverageOf } from "../hurdles/coverage";
import { stripUnsupported } from "../hurdles/fact-check";
import { applyConstraints, mergeConstraints } from "../hurdles/filters";
import { buildHurdlePlan, supportHref } from "../hurdles/plan";
import { buildPhrasePrompt, phraseHurdlePlan, readPhraseRequest, mockPhraseReply, hasRecordContent, withoutRecordContent, type PhraseRequest } from "../hurdles/phrase";
import { mergeAcrossHurdles } from "../hurdles/filters";
import { buildRehearsalSystemOverride, RECORD_WORDS_HEADER } from "../rehearsal-personas";
import { legalFloorFor } from "../hurdles/legal-floor";

const run = (actions: PlannerAction[], from: PlannerState = INITIAL_STATE) => actions.reduce(plannerReducer, from);
const pick = (...hurdles: string[]) => hurdles.map((h) => ({ type: "toggle", hurdle: h }) as PlannerAction);
const ans = (nodeId: string, ...choices: string[]): PlannerAction => ({ type: "answer", nodeId, choices });
const txt = (nodeId: string, text: string): PlannerAction => ({ type: "answer", nodeId, text });

describe("graph", () => {
  it("every next points at a real node, and every hurdle has a real start", () => {
    for (const h of HURDLE_IDS) assert.ok(getNode(HURDLES[h].start), `start of ${h}`);
    for (const node of Object.values(NODES)) {
      const nexts = [node.next, ...(node.choices ?? []).map((c) => c.next)];
      for (const n of nexts) {
        const r = resolveNext(node.hurdle, n);
        if (r) assert.ok(getNode(r), `${node.id} -> ${r}`);
        if (r) assert.equal(getNode(r)!.hurdle, node.hurdle, `${node.id} crosses hurdles`);
      }
    }
  });
  it("no question asks for a diagnosis, an offense, a case number or an SSN", () => {
    const bad = /(diagnos|what (were you|was the) charge|case number|docket|ssn|social security number|what happened)/i;
    for (const node of Object.values(NODES)) assert.ok(!bad.test(node.question + " " + (node.help ?? "")), node.id);
  });
  it("no copy uses a dash as punctuation", () => {
    for (const node of Object.values(NODES)) {
      const blob = [node.question, node.help ?? "", node.placeholder ?? "", ...(node.choices ?? []).flatMap((c) => [c.label, c.fact ?? "", c.action ?? "", c.ask ?? ""])].join(" ");
      assert.ok(!/[—–]| -- /.test(blob), node.id);
    }
  });
  it("only the record hurdle has no tell node; the rest end in a tell choice", () => {
    assert.ok(!getNode("record.tell"));
    assert.ok(getNode("transport.tell"));
    assert.ok(!getNode("not_sure.tell"));
  });
});

describe("reducer", () => {
  it("bus hours leads to shift fit, not to a disclosure script", () => {
    const s = run([...pick("transport"), { type: "start" }, ans("transport.what", "bus_hours")]);
    assert.equal(s.cursor, "transport.bus_when");
    const s2 = run([ans("transport.bus_when", "late")], s);
    assert.equal(s2.cursor, "transport.shift_fit");
    const s3 = run([ans("transport.shift_fit", "day", "weekend"), ans("transport.distance", "5to15"), ans("transport.tell", "job_only")], s2);
    assert.equal(s3.phase, "done");
    assert.ok(!fullPath(s3).some((id) => id.startsWith("record.")));
    const plan = buildHurdlePlan(s3);
    assert.equal(plan.record, null);
    assert.deepEqual(plan.constraints.shifts?.sort(), ["day", "weekend"]);
    assert.equal(plan.constraints.radiusMiles, 15);
  });
  it("different answers lead to different next questions", () => {
    const base = run([...pick("transport"), { type: "start" }]);
    assert.equal(run([ans("transport.what", "no_car")], base).cursor, "transport.options");
    assert.equal(run([ans("transport.what", "license")], base).cursor, "transport.license");
    assert.equal(run([ans("transport.what", "cost")], base).cursor, "transport.cost");
  });
  it("a many answer queues each branch, and a shared question waits for all of them", () => {
    const s = run([...pick("transport"), { type: "start" }, ans("transport.what", "no_car", "bus_hours")]);
    assert.equal(s.cursor, "transport.options");
    const s2 = run([ans("transport.options", "walk")], s);
    assert.equal(s2.cursor, "transport.bus_when", "the bus branch comes before the shared distance question");
    const s3 = run([ans("transport.bus_when", "early"), ans("transport.shift_fit", "day")], s2);
    assert.equal(s3.cursor, "transport.distance");
  });
  it("back steps to the previous question, then to the picker; answers survive", () => {
    let s = run([...pick("transport"), { type: "start" }, ans("transport.what", "no_car")]);
    s = run([{ type: "back" }], s);
    assert.equal(s.cursor, "transport.what");
    assert.deepEqual(s.answers["transport.what"].choices, ["no_car"]);
    s = run([{ type: "back" }], s);
    assert.equal(s.phase, "pick");
    assert.deepEqual(s.answers["transport.what"].choices, ["no_car"]);
  });
  it("changing an earlier answer re-routes, and the old branch drops out of the plan", () => {
    let s = run([...pick("transport"), { type: "start" }, ans("transport.what", "license"), ans("transport.license", "suspended")]);
    s = run([{ type: "goto", nodeId: "transport.what" }, ans("transport.what", "cost")], s);
    assert.equal(s.cursor, "transport.cost");
    assert.ok(s.answers["transport.license"], "kept in memory");
    assert.ok(!reachedAnswers(s)["transport.license"], "not used by the plan");
  });
  it("skip moves on and the question stays open", () => {
    const s = run([...pick("gaps"), { type: "start" }, { type: "skip", nodeId: "gaps.length" }]);
    assert.equal(s.cursor, "gaps.filled");
    const cov = coverageOf(s);
    assert.equal(cov.skipped, 1);
    assert.ok(cov.byHurdle[0].open.includes("how long the gap is"));
  });
  it("several hurdles run one after another, and back crosses between them", () => {
    let s = run([...pick("money", "record"), { type: "start" }]);
    assert.deepEqual(s.selected, ["record", "money"], "planner order");
    assert.equal(s.cursor, "record.where");
    s = run([{ type: "skip", nodeId: "record.where" }], s);
    for (const id of ["record.kind", "record.when", "record.supervision", "record.state", "record.worry", "record.lead", "record.own_words", "record.now_words"]) {
      assert.equal(s.cursor, id);
      s = run([{ type: "skip", nodeId: id }], s);
    }
    assert.equal(s.cursor, "money.what");
    s = run([{ type: "back" }], s);
    assert.equal(s.cursor, "record.now_words");
  });
  it("not sure adds the hurdles the person recognizes", () => {
    let s = run([...pick("not_sure"), { type: "start" }, ans("not_sure.signs", "ride", "papers")]);
    assert.deepEqual(s.selected, ["not_sure"], "the person's own picks stay theirs");
    assert.deepEqual(hurdlesOf(s), ["not_sure", "transport", "documents"]);
    assert.equal(s.cursor, "transport.what");
  });
  it("ignores answers for a node that is not on screen, and unknown choices", () => {
    const s = run([...pick("transport"), { type: "start" }]);
    assert.equal(run([ans("money.what", "fast")], s), s);
    assert.equal(run([ans("transport.what", "teleport")], s), s);
  });
  it("restore rebuilds from saved choices and lands on the first open question", () => {
    const s = plannerReducer(INITIAL_STATE, { type: "restore", selected: ["transport"], answers: { "transport.what": { choices: ["cost"] }, "bogus.node": { choices: ["x"] } } });
    assert.equal(s.cursor, "transport.cost");
    assert.ok(!("bogus.node" in s.answers));
  });
});

describe("coverage", () => {
  it("does not reward length: twelve 'I do not know' is not stronger than one concrete line", () => {
    const s1 = run([...pick("other"), { type: "start" }, txt("other.what", "I do not know. ".repeat(12))]);
    const s2 = run([...pick("other"), { type: "start" }, txt("other.what", "Bus stops before my shift ends.")]);
    assert.deepEqual([coverageOf(s1).answered, coverageOf(s1).onPath], [coverageOf(s2).answered, coverageOf(s2).onPath]);
    assert.match(coverageOf(s2).line, /counts answers, not words/);
  });
  it("counts not sure as answered but still open", () => {
    const s = run([...pick("schedule"), { type: "start" }, ans("schedule.what", "not_sure")]);
    const c = coverageOf(s);
    assert.equal(c.answered, 1);
    assert.equal(c.notSure, 1);
    assert.ok(c.byHurdle[0].open.includes("what shapes your hours"));
  });
});

describe("plan", () => {
  it("a skipped sensitive node's decision stays on screen but never in the saved plan (review S2, 2026-10-25)", () => {
    // gaps.inside is reached only after the "Time inside" pick, so its decision line says what the gap was.
    const s = run([...pick("gaps"), { type: "start" }, ans("gaps.length", "1to3"), ans("gaps.filled", "inside", "family"), { type: "skip", nodeId: "gaps.inside" },
      { type: "skip", nodeId: "gaps.proof" }, ans("gaps.asked", "no"), ans("gaps.tell", "nothing")]);
    const plan = buildHurdlePlan(s);
    const onScreen = plan.hurdles.find((h) => h.hurdle === "gaps")!;
    const line = "Whether to plan the record conversation too.";
    assert.ok(onScreen.open.includes(line), "the person sees their own skipped question");
    assert.deepEqual(onScreen.fromSensitive.open, [line], "and the plan knows where that line came from");
    assert.ok(recordAndSensitiveText().includes(line), "the forbidden set carries every sensitive node's decision");
    const saved = planForSave(plan, s);
    const gaps = saved.hurdles.find((h) => h.hurdle === "gaps")!;
    assert.ok(!gaps.open.includes(line));
    assert.ok(!("fromSensitive" in gaps));
    assert.ok(gaps.known.includes("You were caring for family."), "ordinary lines stay");
    const payload = JSON.stringify(buildSavePayload(plan, s, { summaries: {}, strippedCount: 0, wording: "off", targetJob: "Cook" })).toLowerCase();
    assert.deepEqual(recordAndSensitiveText().filter((t) => payload.includes(t.toLowerCase())), []);
    assert.ok(!payload.includes("record conversation") && !payload.includes("time inside"));
  });
  it("unresolved stays unresolved: no backup ride is listed as a step, never as solved", () => {
    const s = run([...pick("transport"), { type: "start" }, ans("transport.what", "ride"), ans("transport.backup", "no"), ans("transport.distance", "not_sure")]);
    const p = buildHurdlePlan(s).hurdles[0];
    assert.ok(p.known.includes("There is no backup ride yet."));
    assert.ok(p.doNow.some((d) => /backup way/.test(d)));
    assert.ok(p.open.some((o) => /how far/i.test(o)));
  });
  it("help links carry the category and the location", () => {
    assert.equal(supportHref("transportation", "Libby, MT"), "/dashboard/resources?category=transportation&location=Libby%2C+MT#support");
    const s = run([...pick("housing"), { type: "start" }, ans("housing.now", "shelter")]);
    const links = buildHurdlePlan(s, { location: "Helena, MT" }).hurdles[0].whoCanHelp;
    assert.ok(links.every((l) => l.href.includes("location=Helena")));
    assert.ok(links.some((l) => l.category === "housing"));
  });
  it("record plan uses the person's words, says coaching not legal advice, and pulls dated sources", () => {
    const s = run([...pick("record"), { type: "start" }, ans("record.where", "interview"), ans("record.raise", "me"),
      { type: "skip", nodeId: "record.kind" }, { type: "skip", nodeId: "record.when" }, ans("record.supervision", "no"),
      txt("record.state", "mt"), ans("record.worry", "too_much"), ans("record.lead", "work"), txt("record.own_words", "I have a felony from 2019."), { type: "skip", nodeId: "record.now_words" }]);
    const r = buildHurdlePlan(s).record!;
    assert.equal(r.open, 'I\'d say: "I have a felony from 2019."');
    assert.ok(r.fromYou);
    assert.match(r.next, /current or recent work/);
    assert.match(r.disclaimer, /coaching, not legal advice/);
    assert.equal(r.legalFloor.state, "MT");
    assert.ok(r.legalFloor.sources.length > 0 && r.legalFloor.sources.every((x) => x.label === "Verify before relying"));
    assert.match(r.whenToBringItUp.join(" "), /chose to bring it up yourself/);
  });
  it("without words the record opening is a blank to fill, never an invented sentence", () => {
    const s = run([...pick("record"), { type: "start" }]);
    const r = buildHurdlePlan(s).record!;
    assert.match(r.open, /\[one plain sentence/);
    assert.equal(r.fromYou, false);
  });
  it("legal floor with an unknown state says so", () => {
    assert.match(legalFloorFor("ZZ").note, /don't have checked sources for ZZ/);
    assert.equal(legalFloorFor("lower").state, null);
  });
});

describe("filters", () => {
  it("merges constraints and lays them over saved filters", () => {
    const c = mergeConstraints([{ shifts: ["day"] }, { shifts: ["weekend"], radiusMiles: 30 }, { radiusMiles: 15 }, { partTime: true }]);
    const f = applyConstraints(undefined, c);
    assert.deepEqual(f.shifts.value.sort(), ["day", "weekend"]);
    assert.equal(f.radiusMiles.value, 15);
    assert.deepEqual(f.employmentTypes.value, ["part_time"]);
    assert.equal(f.postedWithinDays.value, 30, "untouched fields kept");
  });
  it("remote replaces distance", () => {
    const f = applyConstraints(undefined, { remote: true, radiusMiles: 5 });
    assert.deepEqual(f.arrangements.value, ["remote"]);
    assert.equal(f.radiusMiles.value, 25);
  });
});

describe("fact-strip checker", () => {
  const sources = ["No car right now", "You do not have a car right now.", "Bus or train hours", "Late nights", "Warehouse Associate"];
  it("keeps sentences built from the answers", () => {
    const r = stripUnsupported("You do not have a car right now. Late night buses are a problem for a Warehouse Associate job.", sources);
    assert.equal(r.stripped.length, 0);
  });
  it("strips invented numbers, names and claims", () => {
    const r = stripUnsupported("You do not have a car right now. The 14 bus runs until 11. Try Metro Transit. Your transportation is handled it seems. You are a reliable worker who is never late.", sources);
    assert.equal(r.text, "You do not have a car right now.");
    assert.equal(r.stripped.length, 4);
  });
  it("strips resolution and record-status claims", () => {
    const r = stripUnsupported("I have a felony from 2019. I completed probation and it was expunged.", ["I have a felony from 2019."]);
    assert.equal(r.text, "I have a felony from 2019.");
    assert.equal(r.stripped.length, 1);
  });
});

describe("phrasing pipeline", () => {
  const state = run([...pick("transport", "record"), { type: "start" }, ans("record.where", "interview"), ans("record.raise", "wait"),
    ans("record.kind", "felony"), ans("record.when", "3to7"), ans("record.supervision", "no"), txt("record.state", "WI"),
    ans("record.worry", "details"), ans("record.lead", "work"), txt("record.own_words", "I have a felony from 2019."), txt("record.now_words", "I've loaded trucks for a year."),
    ans("transport.what", "bus_hours")]);
  const withConsent = (b: unknown): PhraseRequest => ({ ...readPhraseRequest(b)!, recordConsent: true });
  it("the body cannot turn record consent on", () => {
    const req = readPhraseRequest({ selected: state.selected, answers: state.answers, recordConsent: true })!;
    assert.equal(req.recordConsent, false);
    const p = buildPhrasePrompt(req);
    assert.ok(!/felony|2019|Felony/.test(p.user));
    assert.deepEqual(p.hurdles, ["transport"]);
  });
  it("record content is detected, and the page can strip it before sending", () => {
    assert.ok(hasRecordContent({ answers: state.answers }));
    assert.ok(!hasRecordContent({ answers: withoutRecordContent(state.answers) }));
    const gaps = { "gaps.length": { choices: ["1to3"] }, "gaps.filled": { choices: ["inside", "family"] } };
    assert.ok(hasRecordContent({ answers: gaps }), "time inside counts as record content");
    assert.deepEqual(withoutRecordContent(gaps)["gaps.filled"], { choices: ["family"] });
  });
  it("time inside never reaches the prompt without consent", () => {
    const req = readPhraseRequest({ selected: ["gaps"], answers: { "gaps.length": { choices: ["1to3"] }, "gaps.filled": { choices: ["inside", "family"] } } })!;
    assert.doesNotMatch(buildPhrasePrompt(req).user, /inside/i);
  });
  it("with stored consent the record hurdle gets a reading, never a rewritten opening", async () => {
    const req = withConsent({ selected: state.selected, answers: state.answers });
    const p = buildPhrasePrompt(req);
    assert.ok(p.hurdles.includes("record"));
    assert.doesNotMatch(p.user, /"open"|"next"/);
    const r = await phraseHurdlePlan(req, async () => JSON.stringify({ summaries: { record: "You want to wait until they ask." }, record: { open: "AI words", next: "AI words" } }));
    assert.equal((r.phrasing as any).record, undefined);
    assert.equal(r.phrasing.summaries.record, "You want to wait until they ask.");
  });
  it("a model that adds facts gets them stripped and counted, per hurdle", async () => {
    const req = withConsent({ selected: state.selected, answers: state.answers });
    const r = await phraseHurdlePlan(req, async () => JSON.stringify({
      summaries: { transport: "Bus or train hours don't always line up with work. Route 12 stops at 10 pm. Your record is a Felony from 2019.", record: "You want to wait until they ask. You have been sober for 2 years." },
    }));
    assert.equal(r.phrasing.summaries.transport, "Bus or train hours don't always line up with work.", "a record fact cannot support a transport sentence");
    assert.equal(r.phrasing.summaries.record, "You want to wait until they ask.");
    assert.equal(r.stripped.length, 3);
  });
  it("a model reply that is not JSON throws (the route reports it, the plan stays)", async () => {
    const req = readPhraseRequest({ selected: ["transport"], answers: { "transport.what": { choices: ["cost"] } } })!;
    await assert.rejects(() => phraseHurdlePlan(req, async () => "Sorry, I cannot help."));
  });
  it("the mock reply always passes the checker", async () => {
    const req = withConsent({ selected: state.selected, answers: state.answers });
    const r = await phraseHurdlePlan(req, async () => mockPhraseReply(req));
    assert.equal(r.stripped.length, 0);
  });
  it("request reader drops unknown hurdles, nodes and choices", () => {
    const req = readPhraseRequest({ selected: ["transport", "zzz"], answers: { "transport.what": { choices: ["cost", "x"] }, "x.y": { text: "hi" } } })!;
    assert.deepEqual(req.selected, ["transport"]);
    assert.deepEqual(req.answers, { "transport.what": { choices: ["cost"] } });
    assert.equal(readPhraseRequest({ selected: [] }), null);
  });
  it("walk ends at the first open question", () => {
    assert.deepEqual(walk("money", {}).path, ["money.what"]);
  });
});

describe("reviewer's lines that passed the old checker must strip", () => {
  const recordSources = ["You are on supervision right now.", "Yes", "Your conditions touch work.", "I have a felony from 2019.", "Felony", "Your record includes a felony."];
  const transportSources = ["No car right now", "You don't have a car right now.", "No license, or it is suspended", "Your license is a problem right now.", "Suspended or revoked", "Your license is suspended or revoked.", "Under 5 miles", "You can get to work within about 5 miles."];
  const record = ["I'm not on supervision right now.", "My conditions don't touch work.", "My record will not show up on the check.", "I did two years for it.", "I owned it and I have grown since then."];
  const transport = ["You have a car right now.", "Your license is valid now.", "Your license was reinstated.", "You own a dependable truck.", "You can get to work within two miles.", "Walmart is close to the bus line.", "Most employers do not mind a suspended license.", "Your employer will be flexible about this."];
  for (const line of record) it(`strips: ${line}`, () => assert.equal(stripUnsupported(line, recordSources).text, "", line));
  for (const line of transport) it(`strips: ${line}`, () => assert.equal(stripUnsupported(line, transportSources).text, "", line));
  it("still keeps true lines", () => {
    assert.equal(stripUnsupported("You don't have a car right now.", transportSources).stripped.length, 0);
    assert.equal(stripUnsupported("Your license is suspended or revoked.", transportSources).stripped.length, 0);
  });
});

describe("fix round 1", () => {
  it("a hurdle added on the way leaves the list when the answer changes (S3)", () => {
    let s = run([...pick("gaps"), { type: "start" }, ans("gaps.length", "1to3"), ans("gaps.filled", "inside"), ans("gaps.inside", "yes")]);
    assert.deepEqual(hurdlesOf(s), ["gaps", "record"]);
    s = run([{ type: "back" }, ans("gaps.inside", "no")], s);
    assert.deepEqual(hurdlesOf(s), ["gaps"]);
    assert.ok(!fullPath(s).some((id) => id.startsWith("record.")));
  });
  it("not sure keeps at most three signs, in the order picked (S4)", () => {
    const s = run([...pick("not_sure"), { type: "start" }, ans("not_sure.signs", "money", "ride", "papers", "check", "gap")]);
    assert.deepEqual(s.answers["not_sure.signs"].choices, ["money", "ride", "papers"]);
    assert.deepEqual(hurdlesOf(s), ["not_sure", "money", "transport", "documents"]);
  });
  it("shift filters narrow across hurdles, never add up (S5)", () => {
    const s = run([...pick("transport", "schedule"), { type: "start" },
      ans("schedule.what", "job"), ans("schedule.hours", "night", "day"), ans("schedule.total", "full"), ans("schedule.tell", "nothing"),
      ans("transport.what", "bus_hours"), ans("transport.bus_when", "late"), ans("transport.shift_fit", "day")]);
    assert.deepEqual(buildHurdlePlan(s).constraints.shifts, ["day"]);
    const none = mergeAcrossHurdles([[{ shifts: ["day"] }], [{ shifts: ["night"] }]]);
    assert.equal(none.shifts, undefined);
    assert.equal(none.shiftConflict, true);
  });
  it("health links only to what the person picked (S7)", () => {
    const lift = run([...pick("health"), { type: "start" }, ans("health.impact", "lifting")]);
    assert.ok(!buildHurdlePlan(lift).hurdles[0].whoCanHelp.some((l) => l.category === "mental_health"));
    const focus = run([...pick("health"), { type: "start" }, ans("health.impact", "focus")]);
    assert.ok(buildHurdlePlan(focus).hurdles[0].whoCanHelp.some((l) => l.category === "mental_health"));
  });
  it("legal floor warns when a source is older than 180 days (N2)", () => {
    assert.equal(legalFloorFor("MT", new Date("2026-10-23")).staleNote, null);
    assert.match(legalFloorFor("MT", new Date("2027-06-01")).staleNote ?? "", /more than 180 days ago/);
  });
  it("practice marks record words so the assistant route can check the stored consent", () => {
    const o = buildRehearsalSystemOverride({ personaId: "hiring_warm", gentlenessId: "balanced", recordWords: "I'd say: \"I have a felony.\"" });
    assert.ok(o.includes(RECORD_WORDS_HEADER));
    assert.ok(!buildRehearsalSystemOverride({ personaId: "hiring_warm", gentlenessId: "balanced", preparedScript: "Housing: nothing" }).includes(RECORD_WORDS_HEADER));
  });
});

import { INITIAL_SAVE, runSave, saveLine, saveReducer, type SaveEvent, type SaveState } from "../hurdles/save-state";
import { saveArtifactReceipt } from "../artifact-save";
import { planForSave, buildSavePayload, recordAndSensitiveText } from "../hurdles/plan";

describe("save truth", () => {
  async function attempt(response: Response): Promise<SaveState> {
    let s = saveReducer(INITIAL_SAVE, { type: "changed" });
    const dispatch = (e: SaveEvent) => { s = saveReducer(s, e); };
    const fake = (async () => response) as unknown as typeof fetch;
    await runSave(s, () => saveArtifactReceipt({ type: "disclosure_plan" }, "acct-1", fake), dispatch);
    return s;
  }
  it("a 500 never shows Saved, and offers a retry", async () => {
    const s = await attempt(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    assert.equal(s.status, "failed");
    assert.doesNotMatch(saveLine(s), /^Saved/);
    assert.match(saveLine(s), /Try saving again/);
  });
  it("a 200 without a real artifact id is not a save", async () => {
    const s = await attempt(new Response(JSON.stringify({ data: { id: "nope" } }), { status: 200 }));
    assert.equal(s.status, "failed");
  });
  it("a 200 with an id is saved", async () => {
    const s = await attempt(new Response(JSON.stringify({ data: { id: "123e4567-e89b-12d3-a456-426614174000" } }), { status: 200 }));
    assert.equal(s.status, "saved");
    assert.match(saveLine(s), /^Saved to your Library/);
  });
  it("a late receipt for an older plan does not mark the new plan saved", () => {
    let s = saveReducer(INITIAL_SAVE, { type: "changed" });
    s = saveReducer(s, { type: "begin", version: s.version });
    const old = s.version;
    s = saveReducer(s, { type: "changed" });
    s = saveReducer(s, { type: "ok", version: old, id: "x" });
    assert.equal(s.status, "idle");
  });
  it("retry after failure can save once; a second begin after saved is ignored", () => {
    let s = saveReducer(INITIAL_SAVE, { type: "changed" });
    s = saveReducer(s, { type: "begin", version: s.version });
    s = saveReducer(s, { type: "fail", version: s.version });
    s = saveReducer(s, { type: "begin", version: s.version });
    assert.equal(s.status, "saving");
    s = saveReducer(s, { type: "ok", version: s.version, id: "id" });
    assert.equal(saveReducer(s, { type: "begin", version: s.version }).status, "saved");
  });
  it("a not-sure path that found a background check saves nothing that reveals it", () => {
    const st = run([...pick("not_sure"), { type: "start" }, ans("not_sure.signs", "check", "ride")]);
    const payload = buildSavePayload(buildHurdlePlan(st), st, { summaries: {}, strippedCount: 0, wording: "off", targetJob: null });
    const blob = JSON.stringify(payload).toLowerCase();
    for (const line of recordAndSensitiveText()) assert.ok(!blob.includes(line.toLowerCase()), `saved: ${line}`);
    assert.ok(!/background check/.test(blob));
  });
  it("the saved artifact and any snapshot of it hold nothing from the record (B1)", () => {
    const st = run([...pick("record", "gaps", "other"), { type: "start" }, ans("record.where", "form", "check"), txt("record.form_question", "Have you been convicted of a felony in the last 7 years?"),
      ans("record.check_stage", "notice"), ans("record.kind", "pending"), ans("record.when", "lt1"), ans("record.supervision", "yes"), ans("record.conditions", "yes"),
      txt("record.state", "WI"), ans("record.worry", "details"), ans("record.lead", "work"), txt("record.own_words", "I did three years for armed robbery in 2019."), txt("record.now_words", "I work days at the yard."),
      ans("gaps.length", "1to3"), ans("gaps.filled", "inside", "family"), ans("gaps.inside", "no"), { type: "skip", nodeId: "gaps.proof" }, ans("gaps.asked", "no"), ans("gaps.tell", "nothing"),
      txt("other.what", "my private words")]);
    const plan = buildHurdlePlan(st);
    assert.ok(plan.record, "the record plan exists on screen");
    const payload = buildSavePayload(plan, st, { summaries: { record: "You want to wait.", gaps: "You were caring for family." }, strippedCount: 0, wording: "done", targetJob: "Driver", applicationId: "123e4567-e89b-12d3-a456-426614174000" });
    // The application_document snapshot copies payload.content as is, so one check covers both.
    // Generated forbidden set: every record and sensitive fact, label, action and ask in the graph.
    const blob = JSON.stringify(payload).toLowerCase();
    const forbidden = recordAndSensitiveText();
    assert.ok(forbidden.length > 40, `forbidden set has ${forbidden.length} lines`);
    for (const line of forbidden) assert.ok(!blob.includes(JSON.stringify(line).slice(1, -1).toLowerCase()), `saved: ${line}`);
    for (const typed of ["armed robbery", "convicted of a felony", "work days at the yard", "my private words", "\"wi\""]) assert.ok(!blob.includes(typed), typed);
    assert.equal((payload.content.hurdlePlan as any).record, undefined);
    assert.equal(payload.content.script, null);
    assert.equal(payload.content.timing_advice, null);
    assert.equal(payload.content.hurdlePlan.recordPlanSaved, false);
    assert.ok(payload.content.hurdlePlan.hurdles.some((h) => h.hurdle === "gaps"));
  });
});
