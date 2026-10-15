/**
 * The "Impact and evidence" lens does not punish a true page with no numbers,
 * does not reward digits alone, and never asks the person to add a number.
 * Fixtures are fictional.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreResume, lineSpecificity } from "../ats/lenses";

const impact = (text: string, source?: string) => scoreResume(text, undefined, source).lenses.find((l) => l.id === "impact_evidence")!;

const NO_NUMBERS = `MORGAN SAMPLE
Toledo, OH | morgan@example.com | 555-010-0199

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.
- Asked by the owner to show new cooks the grill.

SKILLS
Grill, Breakfast line, Vegetable prep

EDUCATION
GED, Toledo Adult Center | 2018`;

const DIGITS_ONLY = `MORGAN SAMPLE
Toledo, OH | morgan@example.com | 555-010-0199

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Worked hard every day for 4 years.
- Did many different things 100 percent of the time.
- Handled various duties about 50 times.

SKILLS
Grill, Breakfast line, Vegetable prep

EDUCATION
GED, Toledo Adult Center | 2018`;

describe("impact and evidence lens", () => {
  it("a true, specific page with no numbers scores well", () => {
    const l = impact(NO_NUMBERS);
    assert.ok(l.score! >= 75, `score ${l.score}`);
    assert.equal(l.summary, "Your lines show real, specific work.");
  });

  it("digits alone do not beat specific work", () => {
    assert.ok(impact(NO_NUMBERS).score! > impact(DIGITS_ONLY).score!, `${impact(NO_NUMBERS).score} vs ${impact(DIGITS_ONLY).score}`);
    assert.equal(lineSpecificity("Did many things 100 times."), 0.5);
    assert.equal(lineSpecificity("Ran the grill on the breakfast line."), 1);
  });

  it("adding a number to an already specific line adds nothing", () => {
    const withNumber = NO_NUMBERS.replace("Ran the grill on the breakfast line.", "Ran the grill on the breakfast line for 4 years.");
    assert.equal(impact(withNumber).score, impact(NO_NUMBERS).score);
  });

  it("no finding asks the person to add a number", () => {
    const vague = NO_NUMBERS.replace(
      "- Ran the grill on the breakfast line.",
      "- Responsible for various duties as assigned.\n- Duties included helping out."
    );
    for (const text of [NO_NUMBERS, DIGITS_ONLY, vague]) {
      for (const f of impact(text).findings) {
        assert.doesNotMatch(f.message, /\bnumber\b|how much|how often|how many|quantif|measur|percentage|dollar/i, f.message);
      }
    }
  });

  it("still names a detail the person gave that the page dropped, without asking for new ones", () => {
    const source = "Line cook at Harbor Street Diner. Cooked about 80 breakfasts on a Saturday.";
    const l = impact(NO_NUMBERS, source);
    const dropped = l.findings.find((f) => /You gave us this detail/.test(f.message));
    assert.ok(dropped, JSON.stringify(l.findings));
    assert.match(dropped!.evidence!, /80 breakfasts/);
  });

  it("the other lenses are still there", () => {
    const ids = scoreResume(NO_NUMBERS).lenses.map((l) => l.id);
    assert.deepEqual(ids, ["parse_integrity", "impact_evidence", "format_discipline", "completeness", "keyword_coverage"]);
  });
});
