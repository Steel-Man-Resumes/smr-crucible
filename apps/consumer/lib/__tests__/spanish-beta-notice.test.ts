/** The "Beta en español" notice: only in Spanish, honest about what it is, reports go to the existing support route. */
import { test } from "node:test";
import React, { createElement } from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { intlMarkup, MESSAGES } from "./helpers/intl";
import { SpanishBetaNotice } from "../../components/SpanishBetaNotice";

// Components here rely on the automatic JSX runtime; tests run the classic one, so give them React (as org-brand does).
(globalThis as { React?: unknown }).React = React;

const src = readFileSync(new URL("../../components/SpanishBetaNotice.tsx", import.meta.url), "utf8");

test("in Spanish the notice shows a labelled pill; in English it renders nothing", () => {
  const es = intlMarkup(createElement(SpanishBetaNotice), "es");
  assert.match(es, /Beta en español/);
  assert.match(es, /data-testid="spanish-beta-notice"/);
  assert.equal(intlMarkup(createElement(SpanishBetaNotice), "en"), "");
});

test("the explanation is honest: machine-assisted, not person-reviewed, resumes in English, and claims nothing more", () => {
  const es = MESSAGES.es.ui.betaNotice.intro;
  assert.match(es, /computadora ayudó a escribirla/);
  assert.match(es, /todavía no la ha revisado una persona/);
  assert.match(es, /currículum sigue en inglés/);
  for (const banned of [/revisad[oa] por (?:un|una) (?:experto|profesional|persona)\b(?! )/i, /fluido/i, /perfecto/i, /garantiz/i]) {
    for (const v of Object.values(MESSAGES.es.ui.betaNotice)) assert.doesNotMatch(String(v), banned);
  }
});

test("a report goes to the existing support route as a [Español] 'confusing' report, with no extra context, and never invents a store", () => {
  assert.match(src, /fetch\("\/api\/support-request"/);
  assert.match(src, /message: `\[Español\] \$\{text\.trim\(\)\}`/);
  assert.match(src, /category: "confusing"/);
  assert.match(src, /includeContext: false/);
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/);
  assert.match(src, /res\.status === 401\) setStatus\("signin"\)/);
});

test("the English side of the catalog has the same keys (parity) and the notice is mounted once, in the root layout", () => {
  assert.deepEqual(Object.keys(MESSAGES.en.ui.betaNotice).sort(), Object.keys(MESSAGES.es.ui.betaNotice).sort());
  const layout = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
  assert.equal((layout.match(/<SpanishBetaNotice \/>/g) ?? []).length, 1);
});
