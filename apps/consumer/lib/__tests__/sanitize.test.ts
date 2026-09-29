/**
 * Blank answers stay blank where they are saved or shown.
 *
 * sanitizeForPrompt labels an empty field "not specified" for a model reading a
 * prompt. That label leaked into saved bullet-workshop answers and could sign a
 * cover letter. sanitizeOrEmpty is the version for anything stored, shown to a
 * person, sent to an employer, or tested for emptiness.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeForPrompt, sanitizeOrEmpty, sanitizeArrayOrEmpty } from "../sanitize";

describe("sanitizeOrEmpty", () => {
  it("keeps blank blank", () => {
    assert.equal(sanitizeOrEmpty(undefined), "");
    assert.equal(sanitizeOrEmpty(null), "");
    assert.equal(sanitizeOrEmpty(""), "");
    assert.equal(sanitizeOrEmpty("   \n  "), "");
  });

  it("treats anything that is not text as blank", () => {
    assert.equal(sanitizeOrEmpty(42), "");
    assert.equal(sanitizeOrEmpty({ name: "x" }), "");
  });

  it("cleans real text the same way as the prompt version", () => {
    assert.equal(sanitizeOrEmpty("  loaded\ttrucks \n every shift "), "loaded trucks every shift");
    assert.equal(sanitizeOrEmpty("abcdef", 3), "abc");
  });
});

describe("sanitizeForPrompt keeps its prompt label", () => {
  it("labels an empty field for the model", () => assert.equal(sanitizeForPrompt(""), "not specified"));
  it("does not throw on something that is not text", () =>
    assert.equal(sanitizeForPrompt(42 as unknown as string), "not specified"));
});

describe("sanitizeArrayOrEmpty", () => {
  it("drops blank items and returns blank for no list", () => {
    assert.equal(sanitizeArrayOrEmpty(["forklift", "", "  ", "RF scanner"]), "forklift, RF scanner");
    assert.equal(sanitizeArrayOrEmpty(undefined), "");
    assert.equal(sanitizeArrayOrEmpty([]), "");
    assert.equal(sanitizeArrayOrEmpty("not a list"), "");
  });
});
