/**
 * Phase 6 S3: the live markup on the finish page.
 *
 * Built against the shared contract (lane S2 emits it): the generate-docs
 * JSON gains `changes: Array<{ old, new, why, rule }>`. These tests use a
 * mocked response; no model, no network. Fictional person only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readChanges, planReveal, paceFor, pickForReplay, typedChars, stepMs, readMs, MAX_CHANGES, CHAR_MS, TYPE_MAX_MS, REPLAY_MAX, MIN_STEP_MS, type MarkupChange } from "../markup-changes";
import { pageLines, buildResumeTour } from "../showstopper-tour";
import { LiveFix } from "../../components/forge/markup/LiveFix";
import { ChangesList } from "../../components/forge/markup/ChangesList";
import { MarkupWalk } from "../../components/forge/markup/MarkupWalk";

(globalThis as { React?: unknown }).React = React;

const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(CONSUMER, p), "utf8");

// The person's page, as sent to the writer.
const PERSON = `Dana Whitfield
Lakeview, OH | dana.whitfield@example.com

OBJECTIVE
Seeking a position with a growing company where I can use my skills and grow.

WORK EXPERIENCE
Shift Lead | Copperline Foods | Lakeview, OH | 8/2021 - 12/2022
- Responsible for 3rd shift.
- Did safety audits.

SKILLS
Hard worker, team player, forklift`;

// What a writer under rewording A could hand back (mocked).
const FINAL = `Dana Whitfield
Lakeview, OH | dana.whitfield@example.com

Shift Lead, Food Production
Shift lead at Copperline Foods running third shift.

SKILLS
Forklift

EXPERIENCE
Shift Lead | Copperline Foods | Lakeview, OH | 8/2021 - 12/2022
- Supervised the 3rd shift crew.
- Ran safety audits on the floor.`;

const MOCK_RESPONSE = {
  resume: FINAL,
  coverLetter: "",
  changes: [
    { old: "Responsible for 3rd shift.", new: "Supervised the 3rd shift crew.", why: "\"Responsible for\" is the job description \u2014 this says what you did.", rule: "duty_phrasing" },
    { old: "Did safety audits.", new: "Ran safety audits on the floor.", why: "A strong verb shows the work.", rule: "duty_phrasing" },
    { old: "Seeking a position with a growing company where I can use my skills and grow.", new: "Shift lead at Copperline Foods running third shift.", why: "An objective says what you want; a summary says what you bring.", rule: "objective" },
    // Dropped: the new line is not in the finished resume (the truth check cut it).
    { old: "Hard worker, team player, forklift", new: "Forklift, team leadership", why: "Real skills only.", rule: "soft_skill_list" },
    // Dropped: the old line is not the person's.
    { old: "Managed a crew of 20.", new: "Supervised the 3rd shift crew.", why: "x", rule: "duty_phrasing" },
    // Dropped: wrong shape, empty, or no change at all.
    { old: 5, new: "Ran safety audits on the floor.", why: "x", rule: "x" },
    { old: "Did safety audits.", new: "", why: "x", rule: "x" },
    { old: "SKILLS", new: "SKILLS", why: "same", rule: "heading" },
    null,
    "nope",
  ],
};

const verified = () => readChanges(MOCK_RESPONSE.changes, PERSON, MOCK_RESPONSE.resume);

test("only verified changes survive: old is the person's, new is in the finished resume", () => {
  const ch = verified();
  assert.deepEqual(
    ch.map((c) => [c.old, c.new]),
    [
      ["Responsible for 3rd shift.", "Supervised the 3rd shift crew."],
      ["Did safety audits.", "Ran safety audits on the floor."],
      ["Seeking a position with a growing company where I can use my skills and grow.", "Shift lead at Copperline Foods running third shift."],
    ]
  );
  for (const c of ch) {
    assert.ok(FINAL.includes(c.new), "every typed line is in the finished resume");
    assert.ok(PERSON.includes(c.old));
  }
});

test("missing, empty or malformed changes mean no reveal, never an error", () => {
  for (const raw of [undefined, null, [], {}, "changes", 42, [{}], [{ old: "a" }]]) {
    assert.deepEqual(readChanges(raw, PERSON, FINAL), []);
  }
  assert.deepEqual(readChanges(MOCK_RESPONSE.changes, "", FINAL), []);
  assert.deepEqual(readChanges(MOCK_RESPONSE.changes, PERSON, ""), []);
});

test("whitespace is normalized as the server compares; long dashes leave the why", () => {
  const ch = readChanges(
    [{ old: "  Responsible   for 3rd shift. ", new: "Supervised  the 3rd shift crew.", why: "Job description \u2014 not the work -- say the work.", rule: "duty_phrasing" }],
    PERSON,
    FINAL
  );
  assert.equal(ch.length, 1);
  assert.equal(ch[0].old, "Responsible for 3rd shift.");
  assert.doesNotMatch(ch[0].why, /[\u2013\u2014]|-{2}/);
});

test("at most forty changes, no repeats of the same old line", () => {
  const lines = Array.from({ length: 60 }, (_, k) => `- Did task ${k + 1}.`);
  const person = lines.join("\n");
  const final = lines.map((l) => l.replace("Did", "Finished")).join("\n");
  const raw = lines.map((l) => ({ old: l.slice(2), new: l.slice(2).replace("Did", "Finished"), why: "Lead with the action.", rule: "duty_phrasing" }));
  const ch = readChanges([...raw, raw[0]], person, final);
  assert.equal(ch.length, MAX_CHANGES);
  assert.equal(new Set(ch.map((c) => c.old)).size, ch.length);
});

test("each change lands on its own line of the page, top to bottom, bullet mark kept", () => {
  const lines = pageLines(PERSON);
  const steps = planReveal(lines, verified());
  assert.deepEqual(
    steps.map((s) => lines[s.lineIndex].trim()),
    ["Seeking a position with a growing company where I can use my skills and grow.", "- Responsible for 3rd shift.", "- Did safety audits."]
  );
  const duty = steps[1];
  assert.equal(duty.before, "- ");
  assert.equal(duty.after, "");
  assert.equal(duty.before + duty.change.old + duty.after, lines[duty.lineIndex].trim());
});

test("a change that sits on no single line is still shown, after the page", () => {
  const change: MarkupChange = { old: "3rd shift. - Did", new: "x", why: "y", rule: "z" };
  const steps = planReveal(["- Responsible for 3rd shift.", "- Did safety audits."], [change]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].lineIndex, -1);
});

test("the pace is readable and bounded", () => {
  const c = verified()[0];
  assert.equal(typedChars(c.new, 0), 0);
  assert.equal(typedChars(c.new, CHAR_MS * 3), 3);
  assert.equal(typedChars(c.new, 60_000), c.new.length);
  const long = "x".repeat(400);
  assert.equal(typedChars(long, TYPE_MAX_MS), long.length, "long lines type within the cap");
  assert.ok(readMs("short") >= 2000);
  assert.ok(readMs("y".repeat(1000)) <= 5000);
  assert.ok(stepMs(c) >= 3000 && stepMs(c) <= 10_000);
});

test("live fix, playing: the person's page with the first change marked, and a Skip", () => {
  const html = renderToStaticMarkup(
    React.createElement(LiveFix, { lines: pageLines(PERSON), changes: verified(), reduced: false, onDone: () => {} })
  );
  assert.match(html, /data-mode="play"/);
  assert.match(html, /Skip/);
  assert.match(html, /1 of 3/);
  assert.match(html, /Hard worker, team player, forklift/, "the person's own page is on screen");
  assert.doesNotMatch(html, /Supervised the 3rd shift crew/, "no new line shows before its turn");
});

test("live fix, reduced motion: no animation, the before and after list", () => {
  const html = renderToStaticMarkup(
    React.createElement(LiveFix, { lines: pageLines(PERSON), changes: verified(), reduced: true, onDone: () => {} })
  );
  assert.match(html, /data-mode="list"/);
  assert.doesNotMatch(html, /animate-/);
  for (const c of verified()) {
    assert.ok(html.includes(c.new.replace(/"/g, "&quot;")));
    assert.ok(html.includes(c.why.replace(/"/g, "&quot;")));
  }
  assert.match(html, /See my finished page/);
});

test("no changes: the live fix renders nothing and the recap is not shown", () => {
  assert.equal(renderToStaticMarkup(React.createElement(LiveFix, { lines: pageLines(PERSON), changes: [], reduced: false, onDone: () => {} })), "");
  assert.equal(renderToStaticMarkup(React.createElement(ChangesList, { changes: [], open: true })), "");
});

test("the walk while the writer works shows the person's page and t.ROY's marks", () => {
  const tour = buildResumeTour(PERSON)!;
  assert.ok(tour.steps.length >= 3);
  const html = renderToStaticMarkup(React.createElement(MarkupWalk, { tour, reduced: true }));
  assert.match(html, /data-testid="markup-walk"/);
  assert.match(html, /here(&#x27;|')s what I see/);
  assert.doesNotMatch(html, /fixing/, "the walk describes, it does not promise (r1 L4)");
  assert.match(html, /Seeking a position/);
  assert.ok(tour.steps.some((s) => /what you want/i.test(s.note)), "the objective gets its note");
});

test("the finish page plays only verified changes, after the documents arrive", () => {
  const src = read("app/(forge)/output/page.tsx");
  // Changes are read from the response only through the verifier, against the finished resume.
  assert.match(src, /readChanges\(data\.changes, session\.resumeText \?\? "", data\.resume \|\| ""\)/);
  // The reveal never starts while generating, only once the documents are done.
  assert.match(src, /const liveFixOn = docState === "done" && revealing && !checkMode && changes\.length > 0;/);
  // While it plays, the finished page waits; reduced motion never plays it.
  assert.match(src, /docState === "done" && !liveFixOn/);
  assert.match(src, /setRevealing\(verified\.length > 0 && reducedRef\.current === false\)/);
  // The tour and the celebration wait for the finished page.
  assert.match(src, /if \(!ready \|\| revealing\) return;/);
  assert.match(src, /docsReady: ready && !revealing/);
});

test("copy a job seeker reads in the markup has no long dashes", () => {
  for (const f of ["components/forge/markup/LiveFix.tsx", "components/forge/markup/ChangesList.tsx", "components/forge/markup/MarkupWalk.tsx"]) {
    const visible = read(f)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(visible, /[\u2013\u2014]/, f);
  }
});

// ---- Round 2 (review s3 r1) -----------------------------------------------

test("r1 L1: only whole lines match, so nothing is typed that sits on neither page", () => {
  const person = "Pat Example\n- Responsible for running the roller and paver on 3 crews";
  const final = "Pat Example\n- Ran the roller and paver on 3 crews.";
  // Part of a line, old or new: dropped.
  assert.deepEqual(readChanges([{ old: "Responsible for", new: "Ran the roller", why: "w", rule: "r" }], person, final), []);
  assert.deepEqual(readChanges([{ old: "Pat", new: "Ran", why: "w", rule: "r" }], person, final), []);
  // Whole lines (bullet mark aside): kept, and the mark stays on the page.
  const ok = readChanges(
    [{ old: "- Responsible for running the roller and paver on 3 crews", new: "Ran the roller and paver on 3 crews.", why: "w", rule: "r" }],
    person,
    final
  );
  assert.equal(ok.length, 1);
  const steps = planReveal(pageLines(person), ok);
  assert.equal(steps[0].lineIndex, 1);
  assert.equal(steps[0].before, "- ");
  assert.equal(steps[0].after, "");
});

test("r1 L7 / r2 L1: at most a dozen play, each readable, the whole replay under ninety seconds", () => {
  const rules = ["duty_phrasing", "objective", "soft_skill_list", "heading", "summary"];
  const many: MarkupChange[] = Array.from({ length: MAX_CHANGES }, (_, k) => ({
    old: `Did task number ${k} on the floor.`,
    new: `Finished task number ${k} on the floor for the morning crew and logged it for the next shift lead.`,
    why: "A strong verb shows the work, and a reader skims for the action first, so the line now leads with it.".repeat(2),
    rule: rules[k % 5] === "summary" && k > 30 ? "summary" : k > 30 ? rules[k % 4] : "duty_phrasing",
  }));
  const lines = many.map((c) => `- ${c.old}`);
  const steps = pickForReplay(planReveal(lines, many));
  assert.equal(steps.length, REPLAY_MAX);
  // Every kind of fix is in the replay, and it still reads top to bottom.
  for (const r of new Set(many.map((c) => c.rule))) assert.ok(steps.some((s) => s.change.rule === r), r);
  for (let k = 1; k < steps.length; k++) assert.ok(steps[k].lineIndex > steps[k - 1].lineIndex);
  const pace = paceFor(steps.map((s) => s.change));
  for (const p of pace) {
    assert.ok(p.total >= MIN_STEP_MS, "at least about four seconds each");
    assert.ok(p.read >= 2200, "the reason is never squeezed");
  }
  const total = pace.reduce((a, p) => a + p.total, 0);
  assert.ok(total <= 90_000, `replay takes ${total} ms`);
  // A short replay plays everything.
  assert.equal(pickForReplay(planReveal(lines, many.slice(0, 3))).length, 3);
  // The finish says the rest are in the list.
  const html = renderToStaticMarkup(React.createElement(LiveFix, { lines, changes: many, reduced: false, onDone: () => {} }));
  assert.match(html, /1 of 12/);
  assert.match(html, /and 28 more/);
});

test("r1 L5: the strike is a real line-through, so wrapped lines are struck on every row", () => {
  const src = read("components/forge/markup/LiveFix.tsx");
  assert.match(src, /line-through/);
  assert.doesNotMatch(src, /top-1\/2 h-\[2px\]/);
});

test("r1 L7: Skip is the obvious button while the replay plays", () => {
  const html = renderToStaticMarkup(
    React.createElement(LiveFix, { lines: pageLines(PERSON), changes: verified(), reduced: false, onDone: () => {} })
  );
  assert.match(html, /Skip to my finished page/);
  assert.match(html, /data-testid="live-fix-skip"[^>]*>|class="[^"]*bg-t-amber[^"]*"[^>]*data-testid="live-fix-skip"/);
});

test("r1 L2: 'Show me around' is hidden while the live fix plays", () => {
  const src = read("app/(forge)/output/page.tsx");
  assert.match(src, /\{ready && !liveFixOn && \(\s*<button\s+onClick=\{\(\) => setTourOpen\(true\)\}/);
});

test("r3 L1: the end line says where the list really is (above the page)", () => {
  const live = read("components/forge/markup/LiveFix.tsx");
  assert.match(live, /in the list above your page/);
  assert.doesNotMatch(live, /under your page/);
  const page = read("app/(forge)/output/page.tsx");
  const list = page.indexOf("<ChangesList changes={changes}");
  const resume = page.indexOf('id="finish-resume"');
  assert.ok(list > 0 && resume > list, "the recap list renders above the resume");
});
