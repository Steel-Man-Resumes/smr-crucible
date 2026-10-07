/**
 * Sample postings for the keyword check (lib/sample-postings.ts): generic,
 * written by SMR, no real employer, no pay, no numbers, clearly labelled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_POSTINGS, SAMPLE_POSTING_LABEL, pickSamplePostings } from "../sample-postings";

const EMPLOYERS = [
  "amazon", "walmart", "target", "costco", "home depot", "lowe's", "fedex", "ups", "usps", "kroger",
  "mcdonald's", "starbucks", "tyson", "ford", "general motors", "tesla", "goodwill", "dollar general",
  "sysco", "aramark", "cintas", "uline", "walgreens", "cvs", "chick-fil-a", "wendy's", "taco bell",
];

test("the label says it is a sample written by SMR, not a real job", () => {
  assert.equal(SAMPLE_POSTING_LABEL, "Sample posting written by SMR, not a real job.");
});

test("the expected samples are there, ids unique", () => {
  const ids = SAMPLE_POSTINGS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["warehouse-associate", "production-operator", "cna", "line-cook", "customer-service", "maintenance-tech", "general-labor", "office-assistant"]) {
    assert.ok(ids.includes(id), id);
  }
});

test("no sample carries a digit, a dollar sign, a pay word or an employer name", () => {
  for (const s of SAMPLE_POSTINGS) {
    const all = `${s.title}\n${s.text}`;
    assert.doesNotMatch(all, /\d/, `${s.id} has a digit`);
    assert.doesNotMatch(all, /\$|\bper hour\b|\bsalary\b|\bwage|\bpay\b|\bbenefits\b/i, `${s.id} mentions pay`);
    assert.doesNotMatch(all, /\b(?:inc|llc|corp|corporation|company|co\.)\b/i, `${s.id} names a company`);
    for (const e of EMPLOYERS) assert.ok(!new RegExp(`\\b${e}\\b`, "i").test(all), `${s.id} names ${e}`);
    assert.doesNotMatch(all, /[–—]/, `${s.id} has a long dash`);
  }
});

test("the person's career paths come first when a sample matches", () => {
  const picked = pickSamplePostings(["Line Cook", "Forklift Operator"], 4);
  assert.equal(picked.length, 4);
  assert.equal(picked[0].id, "line-cook");
  assert.ok(picked.slice(0, 3).some((s) => s.id === "warehouse-associate"));
  assert.equal(new Set(picked.map((s) => s.id)).size, picked.length);
});

test("with no match, the default order is used", () => {
  assert.deepEqual(
    pickSamplePostings(["Astronaut"], 3).map((s) => s.id),
    SAMPLE_POSTINGS.slice(0, 3).map((s) => s.id)
  );
  assert.deepEqual(pickSamplePostings([], 0), []);
});
