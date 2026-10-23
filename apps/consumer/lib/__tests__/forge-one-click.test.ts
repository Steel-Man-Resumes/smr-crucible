/**
 * Troy 2026-10-20, first live run on a fresh account: the first fix ended in
 * "That's the same as before", 44 cards took ten taps each, the record choice
 * replayed the whole animation, and a button was live before the scan was done.
 * The fixes: the AI makes the fix, one pass settles what it can, the rewrite is
 * quiet, and nothing is clickable before it can work. Fictional person only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveFix } from "../../components/forge/markup/LiveFix";
import { pageLines } from "../showstopper-tour";
import { applyFirstFix, pickFirstFix } from "../first-fix";

(globalThis as { React?: unknown }).React = React;
const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(CONSUMER, p), "utf8");

const PAGE = `Morgan Sample
morgan@example.com
Work History
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.`;

test("first fix: the reward screen makes the fix itself and never waits on a button or a same-line refusal", () => {
  const src = read("components/forge/lanes/FirstSave.tsx");
  const reward = src.slice(src.indexOf("export function FirstReward"), src.indexOf("const EMPTY: FirstSection"));
  assert.doesNotMatch(reward, /first-fix-continue|first-fix-skip|Skip this fix|Use this fix and build/);
  assert.match(reward, /\/api\/forge\/suggest-fix/, "a flagged line gets the verified, source-bound draft");
  assert.match(reward, /useEffect\(\(\) => \{[\s\S]*void go\(null, onBuild\)/, "goes on by itself when nothing is owed");
  assert.match(reward, /AUTO_KEY/, "coming back from the writer does not loop forward");
  // Only a missing phone or email asks, and Build works with the box empty.
  assert.equal(pickFirstFix("Morgan Sample\nWork History\nLINE COOK | Harbor Street Diner | 2019 - 2023\n- Ran the grill.").kind, "add_contact");
  assert.match(reward, /\(optional\)/);
});

test("first fix: a draft that changes nothing is simply not applied, and a real one lands", () => {
  const fix = pickFirstFix(`Morgan Sample\nmorgan@example.com\nWork History\nLINE COOK | Harbor Street Diner | 2019 - \n- Ran the grill.`, Date.parse("2026-10-10"));
  assert.equal(fix.kind, "edit_line");
  const same = applyFirstFix(`Morgan Sample\nmorgan@example.com\nWork History\nLINE COOK | Harbor Street Diner | 2019 - \n- Ran the grill.`, fix, fix.line!);
  assert.equal(same.ok, false);
  const draft = applyFirstFix(`Morgan Sample\nmorgan@example.com\nWork History\nLINE COOK | Harbor Street Diner | 2019 - \n- Ran the grill.`, fix, "LINE COOK | Harbor Street Diner | 2019 - 2023");
  assert.ok(draft.ok);
});

test("finish page: one pass settles the cards t.ROY may settle and leaves record, credential, title and scope cards", () => {
  const panel = read("components/forge/finish/DefendPanel.tsx");
  const eligible = panel.slice(panel.indexOf("function bulkEligible"), panel.indexOf("async function fetchSuggestion"));
  assert.match(eligible, /g\.credentialName \|\| g\.scope \|\| g\.terms/, "credential, scope and skills cards wait for the person");
  assert.match(eligible, /g\.title && actions\.onTitleYes/, "a title the page never used waits for the person");
  assert.match(panel, /Fix all with t\.ROY \(\$\{eligible\.length\}\)/);
  const page = read("app/(forge)/output/page.tsx");
  const bulk = page.slice(page.indexOf("const onBulk"), page.indexOf("const onCut = (group"));
  assert.match(bulk, /applyAssistedRewrite\(text, answers, p\.group\.line, p\.text, view\.source\)/, "each draft goes through the same gate as a tap");
  assert.match(bulk, /recordJobOk\(answers, p\.group\.line\)/);
  assert.match(page, /onBulk=\{onBulk\}/);
});

test("record choice: rewrites quietly, with no replay of the animation", () => {
  const page = read("app/(forge)/output/page.tsx");
  assert.match(page, /onChoose=\{\(next\) => \{\s+setQuiet\(true\);/);
  assert.match(page, /data-testid="quiet-rebuild"/);
  assert.match(page, /setRevealing\(checked\.length > 0 && !quietRef\.current\)/);
});

test("live fix: the finished-page button is not live until the scan is done", () => {
  const lines = pageLines(PAGE);
  const changes = [{ old: "- Ran the grill on the breakfast line.", new: "- Ran the grill on the breakfast line, start to finish.", why: "Plainer.", rule: "x" }];
  const html = renderToStaticMarkup(React.createElement(LiveFix, { lines, changes: changes as never, reduced: true, pending: true, onDone: () => {} }));
  assert.match(html, /<button[^>]*disabled[^>]*data-testid="live-fix-done"|<button[^>]*data-testid="live-fix-done"[^>]*disabled/);
  assert.match(html, /Checking your documents/);
  const ready = renderToStaticMarkup(React.createElement(LiveFix, { lines, changes: changes as never, reduced: true, pending: false, onDone: () => {} }));
  assert.doesNotMatch(ready, /<button[^>]*data-testid="live-fix-done"[^>]*disabled/);
  assert.match(ready, /Done\. See my finished page/);
});

// ---- 2026-10-20 (second pass): the Forge finishes its own page ---------------------------------

import { cardPosition } from "../../components/forge/finish/FinishTour";
import { ReviewSteps } from "../../components/forge/markup/ReviewSteps";

test("tour: the card sits beside, above or below the framed part and never over it", () => {
  const overlap = (b: { top: number; left: number; width: number; height: number }, c: { top: number; left: number }, w = 340, h = 190) =>
    c.left < b.left + b.width && c.left + w > b.left && c.top < b.top + b.height && c.top + h > b.top;
  const cases = [
    { top: 100, left: 40, width: 500, height: 300 },
    { top: 500, left: 40, width: 900, height: 120 },
    { top: 20, left: 20, width: 300, height: 200 },
  ];
  for (const b of cases) assert.equal(overlap(b, cardPosition(b, 1280, 800)), false, JSON.stringify(b));
  // A part that fills the screen: the card goes to the corner (and can be dragged).
  const full = { top: 0, left: 0, width: 1280, height: 800 };
  const c = cardPosition(full, 1280, 800);
  assert.ok(c.left >= 0 && c.top >= 0 && c.left + 340 <= 1280 && c.top + 190 <= 800);
});

test("review steps: names the two parts and the end, and marks where you are", () => {
  const one = renderToStaticMarkup(React.createElement(ReviewSteps, { step: 1 }));
  assert.match(one, /Writing and checking/);
  assert.match(one, /What changed/);
  assert.match(one, /Your first stronger draft/);
  assert.match(one, /aria-current="step"/);
  const two = renderToStaticMarkup(React.createElement(ReviewSteps, { step: 2 }));
  assert.match(two, /\(done\)/);
});

test("auto finish: the Forge settles its own page; check mode and the demo keep the cards; the safety net stays", () => {
  const page = read("app/(forge)/output/page.tsx");
  assert.match(page, /const autoFinish = !checkMode && !isDemo;/);
  assert.match(page, /settleFinishPage\(/);
  assert.match(page, /draft=\{view\.state !== "finished" && !settling\}/);
  // If the gate still holds something nothing could clear, the cards come back as the safety net.
  assert.match(page, /!finished && \(!autoFinish \|\| \(!settling && settle\.status === "done"\)\)/);
});

test("lanes-first path includes the story questions again", () => {
  const path = read("lib/forge-path.ts");
  assert.match(path, /\["resume", "goals", "story",/);
});
