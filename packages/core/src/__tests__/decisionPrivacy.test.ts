/**
 * The Forge promises "Without an account, we keep none of your words." A
 * decision_log row with no user id must not carry anything the visitor typed:
 * not in the explanation, not in output_summary, not hidden in the page or
 * session fields. Signed-in rows are stored as written.
 *
 * Run: npm test  (node --import tsx --test, no extra deps, no database)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decisionFieldsForStorage, ANONYMOUS_EXPLANATION } from "../decisionPrivacy";

// What a visitor might type into the Forge, as the routes write it today.
const TYPED_JOB = "Forklift Operator";
const TYPED_COMPANY = "Acme Freight";
const TYPED_CITY = "Racine, WI";

const anonymousRow = () =>
  decisionFieldsForStorage({
    userId: null,
    sessionId: "2026-10-01T15:04:05.000Z",
    contextPage: "rush",
    explanation: `Rush resume rewrite for target job: ${TYPED_JOB} at ${TYPED_COMPANY}`,
    outputSummary: {
      target_job: TYPED_JOB,
      location: TYPED_CITY,
      bullets: [TYPED_COMPANY],
      nested: { company: TYPED_COMPANY },
      bullet_count: 5,
      response_length: 812,
      used_fallback: false,
      finish_reason: "stop",
      not_a_number: Number.NaN,
    },
  });

describe("no account: none of the visitor's words are stored", () => {
  it("replaces the explanation with a fixed line", () => {
    assert.equal(anonymousRow().explanation, ANONYMOUS_EXPLANATION);
  });

  it("keeps only counts, lengths and flags in output_summary", () => {
    assert.deepEqual(anonymousRow().outputSummary, {
      bullet_count: 5,
      response_length: 812,
      used_fallback: false,
    });
  });

  it("no typed word survives anywhere in the stored fields", () => {
    const stored = JSON.stringify(anonymousRow());
    for (const typed of [TYPED_JOB, TYPED_COMPANY, TYPED_CITY]) {
      assert.equal(stored.includes(typed), false, `${typed} was stored`);
    }
  });

  it("keeps a page id and a timestamp session id", () => {
    const row = anonymousRow();
    assert.equal(row.contextPage, "rush");
    assert.equal(row.sessionId, "2026-10-01T15:04:05.000Z");
  });

  it("drops text that arrives in the page or session fields", () => {
    const row = decisionFieldsForStorage({
      userId: undefined,
      sessionId: "my name is Jordan and I work at Acme",
      contextPage: "Forklift Operator at Acme Freight",
      explanation: "x",
    });
    assert.equal(row.contextPage, "unknown");
    assert.equal(row.sessionId, null);
    assert.deepEqual(row.outputSummary, {});
  });

  it("treats an empty user id as no account", () => {
    const row = decisionFieldsForStorage({ userId: "", contextPage: "rush", explanation: `for ${TYPED_JOB}` });
    assert.equal(row.explanation, ANONYMOUS_EXPLANATION);
  });
});

describe("signed in: the row is stored as written", () => {
  it("keeps the explanation, summary, page and session", () => {
    const summary = { target_job: TYPED_JOB, bullet_count: 5 };
    const row = decisionFieldsForStorage({
      userId: "user-1",
      sessionId: "s-1",
      contextPage: "dashboard/jobs",
      explanation: `Generated resume for ${TYPED_JOB} at ${TYPED_COMPANY}.`,
      outputSummary: summary,
    });
    assert.equal(row.explanation, `Generated resume for ${TYPED_JOB} at ${TYPED_COMPANY}.`);
    assert.deepEqual(row.outputSummary, summary);
    assert.equal(row.contextPage, "dashboard/jobs");
    assert.equal(row.sessionId, "s-1");
  });
});
