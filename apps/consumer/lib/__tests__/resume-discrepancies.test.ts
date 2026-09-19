/**
 * The claims check, tested in both directions.
 *
 * The false-positive cases matter at least as much as the catches. Telling
 * someone "you did not tell us that" about something they DID tell us is
 * insulting, and it teaches people to close the panel -- after which the real
 * catches go unread too. Every "allows" case below is a person's own words
 * licensing their own claim.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findDiscrepancies } from "../resume-discrepancies";

const claims = (output: string, source: string) =>
  findDiscrepancies(output, { sourceText: source }).filter(
    (d) => d.kind === "unsupported_claim"
  );

describe("claims the person never made", () => {
  it("catches the attendance line the tool actually invented in production", () => {
    // Verbatim from a real run: two sentences about washing dishes produced a
    // claim about showing up on time every shift.
    const source =
      "Dishwasher, Sunrise Diner, 2025 - present\nWashed dishes, cleaned the kitchen, took out trash";
    const output =
      "- Reliability and consistent attendance across every shift, on time and ready to work.";
    assert.equal(claims(output, source).length, 1);
  });

  it("flags a safety record invented from nothing", () => {
    assert.equal(claims("- Clean safety record.", "Washed dishes").length, 1);
  });

  it("flags supervision invented from nothing", () => {
    assert.equal(claims("- Supervised a team of four.", "Washed dishes").length, 1);
  });

  it("flags a certification invented from nothing", () => {
    assert.equal(claims("- OSHA certified.", "Washed dishes").length, 1);
  });

  it("flags work-ethic filler invented from nothing", () => {
    assert.equal(
      claims("- Strong work ethic and takes initiative.", "Washed dishes").length,
      1
    );
  });
});

describe("claims the person DID make are left alone", () => {
  const cases: Array<[string, string, string]> = [
    ["attendance", "- Consistent attendance every shift.", "perfect attendance, never late"],
    ["a safety record", "- Clean safety record.", "no lost time accidents on my shift for two years"],
    ["leading a crew", "- Supervised a crew of six.", "Ran a three man crew when the foreman was off"],
    ["a certification", "- Forklift certified.", "forklift certification, MSHA Part 46"],
    ["customer service", "- Customer service at peak times.", "Helped out at the front desk on weekends"],
  ];
  for (const [name, output, source] of cases) {
    it(`allows ${name} when their own words support it`, () => {
      assert.deepEqual(claims(output, source), []);
    });
  }

  it("does not flag ordinary duty prose", () => {
    assert.deepEqual(
      claims("- Operated a forklift and loaded trucks.", "Operated forklift, loaded trucks"),
      []
    );
  });
});

describe("no source, no accusation", () => {
  it("stays silent when there is nothing to check against", () => {
    const found = findDiscrepancies("- Clean safety record.", {});
    assert.equal(found.filter((d) => d.kind === "unsupported_claim").length, 0);
  });
});

describe("vocabulary is not evidence (reviewer counterexamples)", () => {
  // Every one of these previously returned ZERO findings: a related WORD in the
  // source licensed a much stronger claim in the output.
  const mustFlag: Array<[string, string, string]> = [
    ["training is not a record", "- Clean safety record.", "Completed safety training"],
    ["being on a crew is not running one", "- Supervised a crew of six.", "Worked on a crew"],
    ["one credential does not license another", "- Licensed electrician.", "CPR certification"],
  ];
  for (const [name, output, source] of mustFlag) {
    it(name, () => {
      assert.ok(claims(output, source).length > 0, `${output} vs ${source}`);
    });
  }

  it("catches a claim that CONTRADICTS the source, and says so", () => {
    // The worst case in the report: the source said the opposite and the
    // checker called the claim supported.
    const found = claims(
      "- Perfect attendance every shift.",
      "I was often late and had poor attendance"
    );
    assert.equal(found.length, 1);
    assert.match(found[0].label, /contradicts/i);
  });

  it("still allows a credential the source actually names", () => {
    assert.deepEqual(claims("- CPR certified.", "CPR certification, 2024"), []);
    assert.deepEqual(claims("- Forklift certified.", "forklift certification"), []);
  });

  it("still allows a safety record the source actually states", () => {
    assert.deepEqual(
      claims("- Clean safety record.", "no lost time accidents on my shift for two years"),
      []
    );
  });

  it("still allows supervision the source actually states", () => {
    assert.deepEqual(
      claims("- Supervised a crew of six.", "Ran a three man crew when the foreman was off"),
      []
    );
  });

  it("is honest about its own limits", () => {
    // "Won employee of the year" is in no enumerated pattern. This check
    // narrows a known-dangerous class; it is not a proof of truth, and the
    // panel copy no longer claims otherwise.
    assert.deepEqual(claims("- Won employee of the year.", "Washed dishes"), []);
  });
});
