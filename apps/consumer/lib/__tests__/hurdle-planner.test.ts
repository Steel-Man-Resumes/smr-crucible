/**
 * Hurdle planner: decision graph, reducer (branching, back, skip, several
 * hurdles), coverage (not length), the fact-strip checker, filters and the
 * phrasing pipeline. All pure; the model is a fake.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HURDLES, HURDLE_IDS, NODES, getNode, resolveNext } from "../hurdles/graph";
import { INITIAL_STATE, plannerReducer, walk, fullPath, reachedAnswers, type PlannerState, type PlannerAction } from "../hurdles/reducer";
import { coverageOf } from "../hurdles/coverage";
import { stripUnsupported } from "../hurdles/fact-check";
import { applyConstraints, mergeConstraints } from "../hurdles/filters";
import { buildHurdlePlan, supportHref } from "../hurdles/plan";
import { buildPhrasePrompt, checkPhraseReply, phraseHurdlePlan, readPhraseRequest, mockPhraseReply } from "../hurdles/phrase";
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
    assert.deepEqual(s.selected, ["not_sure", "transport", "documents"]);
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
  it("without record consent no record detail reaches the prompt", () => {
    const req = readPhraseRequest({ selected: state.selected, answers: state.answers, recordConsent: false })!;
    const p = buildPhrasePrompt(req);
    assert.ok(!/felony|2019|Felony/.test(p.user));
    assert.deepEqual(p.hurdles, ["transport"]);
  });
  it("with consent the record words are there to phrase", () => {
    const req = readPhraseRequest({ selected: state.selected, answers: state.answers, recordConsent: true })!;
    const p = buildPhrasePrompt(req);
    assert.match(p.user, /felony from 2019/);
    assert.ok(p.hurdles.includes("record"));
  });
  it("a model that adds facts gets them stripped and counted", async () => {
    const req = readPhraseRequest({ selected: state.selected, answers: state.answers, recordConsent: true })!;
    const r = await phraseHurdlePlan(req, async () => JSON.stringify({
      summaries: { transport: "Bus or train hours do not always line up with work. Route 12 stops at 10 pm.", record: "You want to wait until they ask. You have been sober for 2 years." },
      record: { open: "I have a felony from 2019. I took full responsibility and it is behind me now, all resolved.", next: "I've loaded trucks for a year." },
    }));
    assert.equal(r.phrasing.summaries.transport, "Bus or train hours do not always line up with work.");
    assert.equal(r.phrasing.summaries.record, "You want to wait until they ask.");
    assert.equal(r.phrasing.record?.open, "I have a felony from 2019.");
    assert.equal(r.stripped.length, 3);
  });
  it("a model reply that is not JSON throws (the route reports it, the plan stays)", async () => {
    const req = readPhraseRequest({ selected: ["transport"], answers: { "transport.what": { choices: ["cost"] } }, recordConsent: false })!;
    await assert.rejects(() => phraseHurdlePlan(req, async () => "Sorry, I cannot help."));
  });
  it("the mock reply always passes the checker", async () => {
    const req = readPhraseRequest({ selected: state.selected, answers: state.answers, recordConsent: true })!;
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

import { INITIAL_SAVE, runSave, saveLine, saveReducer, type SaveEvent, type SaveState } from "../hurdles/save-state";
import { saveArtifactReceipt } from "../artifact-save";
import { planForSave } from "../hurdles/plan";

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
  it("a save keeps no record detail and no free text but the state code", () => {
    const st = run([...pick("record", "other"), { type: "start" }, ans("record.where", "check"), ans("record.check_stage", "notice"), ans("record.kind", "felony"),
      ans("record.when", "lt1"), ans("record.supervision", "yes"), ans("record.conditions", "yes"), txt("record.state", "WI"), ans("record.worry", "details"),
      ans("record.lead", "work"), txt("record.own_words", "I have a felony."), txt("record.now_words", "I work days."), txt("other.what", "my private words")]);
    const saved = planForSave(buildHurdlePlan(st), st);
    const blob = JSON.stringify(saved.choices) + JSON.stringify(saved.hurdles);
    assert.ok(!/felony|private words|record\.kind|record\.supervision/.test(blob), blob);
    assert.deepEqual(saved.choices["record.state"], { text: "WI" });
    assert.ok(saved.hurdles.find((h) => h.hurdle === "record")!.doNow.some((d) => /officer/.test(d)));
  });
});
