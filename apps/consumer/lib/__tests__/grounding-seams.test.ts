/**
 * The seams a truth-check rewrite leaves behind. A sample resume came back with
 * "Operated sit-down and stand-up forklifts for five years. " (a trailing space
 * where a clause was cut). Tidying must never move indentation or words.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tidySeams } from "../grounding-verify";

describe("tidySeams", () => {
  it("drops the space left at the end of a line", () =>
    assert.equal(tidySeams("- Operated forklifts for five years. "), "- Operated forklifts for five years."));
  it("closes a double space where words were taken out", () =>
    assert.equal(tidySeams("Loaded trailers  and ran cycle counts."), "Loaded trailers and ran cycle counts."));
  it("removes a space before punctuation", () =>
    assert.equal(tidySeams("Trained new hires , then ran the line ."), "Trained new hires, then ran the line."));
  it("keeps indentation and blank lines", () =>
    assert.equal(tidySeams("PROFESSIONAL EXPERIENCE\n\n   - Ran presses.  "), "PROFESSIONAL EXPERIENCE\n\n   - Ran presses."));
  it("leaves clean text alone", () => {
    const t = "LINE COOK | Harbor Street Grill | 2019 - Present\n- Trains new cooks on the line.";
    assert.equal(tidySeams(t), t);
  });
});
