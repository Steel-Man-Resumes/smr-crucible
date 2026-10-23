import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVoiceWork, type VoiceWorkStore } from "../voice-work-context";
import { buildVoiceInstructions } from "../voice-instructions";
import { saveArtifactReceipt } from "../artifact-save";
import { readSavedVoiceReport } from "../saved-voice-report";
const job = "11111111-1111-1111-1111-111111111111";
const resume = "22222222-2222-2222-2222-222222222222";
const alternate = "33333333-3333-3333-3333-333333333333";
const revision = "44444444-4444-4444-4444-444444444444";
function store(overrides: Partial<VoiceWorkStore> = {}): VoiceWorkStore {
  return {
    application: async () => ({ application: { id: job, job_title: "Warehouse associate", company: "Example", resume_artifact_id: resume, jd_full_text: "Inventory and packing", jd_excerpt: null, jd_fetched_at: "2026-10-20", jd_truncated: false }, resumeSnapshot: { content_snapshot: { text: "Submitted packing experience" } }, revision: null }) as any,
    resume: async (_user, id) => ({ text: id === alternate ? "Selected welding experience" : "Current packing experience", revisionId: revision }),
    snapshotText: () => "Submitted packing experience",
    ...overrides,
  };
}
test("voice uses owned application attachment and posting instead of forged browser text", async () => {
  const seen: string[] = [];
  const result = await resolveVoiceWork("actual-owner", { applicationId: job, config: { targetRole: "Forged role" }, jobDescription: "Forged posting", resume: { text: "Forged resume" }, userId: "other" } as any, store({ application: async (owner, id) => { seen.push(owner, id); return store().application(owner, id); } }));
  assert.deepEqual(seen, ["actual-owner", job]);
  assert.equal(result.body.config?.targetRole, "Warehouse associate at Example");
  assert.equal(result.work.resumeText, "Submitted packing experience");
  assert.equal(result.work.jobDescription, "Inventory and packing");
  assert.equal(result.work.resumeSource, "application_snapshot");
  assert(!("resume" in result.body));
  const prompt = buildVoiceInstructions(result.body, result.work);
  assert.match(prompt, /Submitted packing experience/);
  assert.match(prompt, /Inventory and packing/);
  assert.doesNotMatch(prompt, /Forged/);
});
test("explicit general practice does not borrow saved attachment or focused lane", async () => {
  const result = await resolveVoiceWork("owner", { applicationId: job, resumeArtifactId: null }, store({ resume: async () => { throw new Error("must not read"); } }));
  assert.equal(result.work.resumeSource, "none");
  assert.equal(result.work.resumeText, "");
  const empty = await resolveVoiceWork("owner", {}, store({ application: async () => { throw new Error("must not choose a job"); }, resume: async () => { throw new Error("must not choose a resume"); } }));
  assert.equal(empty.work.resumeSource, "none");
});
test("an explicit alternative is owned and freezes its resolved revision", async () => {
  const result = await resolveVoiceWork("owner", { applicationId: job, resumeArtifactId: alternate }, store());
  assert.equal(result.work.resumeText, "Selected welding experience");
  assert.equal(result.work.resumeSource, "saved_revision");
  assert.equal(result.selection.resumeRevisionId, revision);
  await assert.rejects(resolveVoiceWork("owner", { resumeArtifactId: alternate }, store({ resume: async () => null })), /unavailable/);
});
test("missing or foreign saved selections fail instead of falling back", async () => {
  await assert.rejects(resolveVoiceWork("owner", { applicationId: job }, store({ application: async () => null })), /unavailable/);
  await assert.rejects(resolveVoiceWork("owner", { applicationId: "invalid" }, store()), /invalid_selection/);
  await assert.rejects(resolveVoiceWork("owner", { resumeArtifactId: null, resumeRevisionId: revision }, store()), /selection_mismatch/);
});
test("pasted posting is bounded and labelled separately from saved evidence", async () => {
  const result = await resolveVoiceWork("owner", { jobDescription: "x".repeat(13000) }, store());
  assert.equal(result.work.jobDescription.length, 12000);
  assert.equal(result.work.jobTruncated, true);
  assert.equal(result.work.jobSource, "pasted_posting");
});
test("artifact save success requires HTTP success and an actual saved ID", async () => {
  for (const response of [new Response(JSON.stringify({ data: { id: resume } }), { status: 500 }), new Response("{}", { status: 201 }), new Response("oops", { status: 201 })]) {
    await assert.rejects(saveArtifactReceipt({ type: "disclosure_plan" }, "expected-owner", (async () => response) as typeof fetch), /could not be confirmed/);
  }
  assert.equal(await saveArtifactReceipt({}, "expected-owner", (async () => new Response(JSON.stringify({ data: { id: resume } }), { status: 201 })) as typeof fetch), resume);
});
test("full report reopening requires an exact session reference and valid stored feedback", () => {
  const feedback = { strengths: ["Specific example"], improvements: ["Add the result"], overall: "A useful start", frame: "Explain your own role", disclosure_notes: null, better_answers: [{ question: "What did you do?", model_answer: "I packed orders." }] };
  const row = { id: resume, artifact_type: "interview_prep", target_context: { voiceSessionId: job }, content: { mode: "voice", feedback, completedAt: "2026-10-23" } };
  assert.deepEqual(readSavedVoiceReport(row, job)?.feedback, feedback);
  assert.equal(readSavedVoiceReport(row, alternate), null);
  assert.equal(readSavedVoiceReport({ ...row, content: { ...row.content, mode: "text" } }, job), null);
  assert.equal(readSavedVoiceReport({ ...row, content: { ...row.content, feedback: {} } }, job), null);
  assert.equal(readSavedVoiceReport(null, job), null);
});

test("an edited selected document cannot silently replace a practice source on the next call", async () => {
  const first = await resolveVoiceWork("owner", { resumeArtifactId: resume }, store());
  await assert.rejects(resolveVoiceWork("owner", first.body, store({ resume: async () => ({ text: "Changed after reservation", revisionId: revision }) })), /selected_work_changed/);
  const jobFirst = await resolveVoiceWork("owner", { applicationId: job }, store());
  await assert.rejects(resolveVoiceWork("owner", jobFirst.body, store({ snapshotText: () => "Different attachment" })), /selected_work_changed/);
});

test("delayed artifact saves keep the original owner header and reject an unknown owner", async () => {
  const calls: RequestInit[] = [];
  const send = (async (_url: unknown, init: RequestInit) => {
    calls.push(init);
    return new Response(JSON.stringify({ data: { id: resume } }), { status: 201 });
  }) as typeof fetch;
  await saveArtifactReceipt({ type: "interview_prep" }, "original-owner", send);
  assert.equal(new Headers(calls[0].headers).get("x-expected-account-id"), "original-owner");
  await assert.rejects(saveArtifactReceipt({}, "", send), /account could not be confirmed/);
  assert.equal(calls.length, 1);
  await assert.rejects(saveArtifactReceipt({}, "original-owner", (async () => new Response(JSON.stringify({ error: "Account changed" }), { status: 409 })) as typeof fetch), /could not be confirmed/);
});
