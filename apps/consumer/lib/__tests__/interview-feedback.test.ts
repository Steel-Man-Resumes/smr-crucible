import { test } from "node:test";
import assert from "node:assert/strict";
import { interviewFeedbackMessages, parseInterviewFeedback, screenInterviewExamples } from "../interview-feedback";

test("ended interview becomes quoted source, with an explicit feedback task", () => {
  const transcript = [{ role: "assistant", content: "What did you do?" }, { role: "user", content: "I packed orders. I never drove a forklift." }];
  const messages = interviewFeedbackMessages(transcript);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
  assert.ok(messages[0].content.includes(JSON.stringify(transcript)));
  assert.ok(messages[0].content.includes("Do not ask another interview question"));
});

test("continued questions, broken JSON and malformed scorecards cannot count as completed feedback", () => {
  for (const output of ["Can you walk me through a safety audit?", '{"feedback":', JSON.stringify({ closing: "Thanks", feedback: { strengths: "good", improvements: [], overall: "Good effort" } })]) {
    assert.equal(parseInterviewFeedback(output), null);
  }
});

test("specific feedback parses; invalid nested answers are rejected", () => {
  const result = { closing: "Thanks for practicing.", feedback: { strengths: ["You named your actual duties."], improvements: ["Describe one audit you remember."], overall: "One answer gives us a starting point.", better_answers: [], disclosure_notes: null } };
  assert.deepEqual(parseInterviewFeedback(JSON.stringify(result)), result);
  assert.equal(parseInterviewFeedback(JSON.stringify({ ...result, feedback: { ...result.feedback, better_answers: [{ question: "What did you do?", model_answer: {} }] } })), null);
});

test("unsupported or unchecked suggested answers are withheld while feedback remains", () => {
  const feedback = { strengths: ["You named your duties."], improvements: ["Describe one audit."], overall: "A useful start.", better_answers: [{ question: "What did you do?", model_answer: "I audited the warehouse every day." }] };
  for (const check of [
    { verifierRan: false, hasFabrication: false, applied: false },
    { verifierRan: true, hasFabrication: true, applied: true },
    { verifierRan: true, hasFabrication: false, applied: true },
  ]) {
    const screened = screenInterviewExamples(feedback, check);
    assert.deepEqual(screened.better_answers, []);
    assert.deepEqual(screened.improvements, feedback.improvements);
  }
  assert.deepEqual(screenInterviewExamples(feedback, { verifierRan: true, hasFabrication: false, applied: false }), feedback);
});
