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
