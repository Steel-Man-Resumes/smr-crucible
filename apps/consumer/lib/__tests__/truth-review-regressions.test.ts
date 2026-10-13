/** Truth-gate regression cases. Synthetic receipts and mocked AI; no external calls. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyGrounding } from "../grounding-verify";
import { writerReceipt } from "../writer-receipt";
import { cleanRevisionInput, gateRevision } from "../revision-status";
import { handleDownloadPost } from "../forge-download-handler";
import { jobHeaderLines, recordJobOk, type DefendAnswer } from "../finish-gate";

process.env.AUTH_SECRET = "synthetic-truth-regression-signing-secret";
process.env.OPENAI_API_KEY = "synthetic-never-sent";

const UID = "00000000-0000-4000-8000-0000000000a1";
const RUN = "synthetic-truth-regression-run";
const NONCE = "0".repeat(32);
const RESUME = "Alex Example\nalex@example.test\nEXPERIENCE\nCleaner | Example Services | 2021 - 2024\n- Cleaned floors and took out trash.";
const CHECKED = {
  rewordingA: true,
  verifierRan: true,
  verifierRanByDoc: { resume: true, cover_letter: true },
  flags: [],
  outcomes: [],
};

function finish(resume: string, letter: string, grounding: unknown = CHECKED) {
  const source = { ownWords: resume, ownResumeText: resume, credentialsAnswer: "", credentialRows: [] };
  const written = { resume, letter };
  const defendAnswers = jobHeaderLines(resume).reduce<DefendAnswer[]>((a, h) => recordJobOk(a, h), []);
  return {
    ...source, resumeText: resume, coverLetterText: letter, written, grounding,
    runId: RUN, defendAnswers, keptTerms: [], addedTerms: [], confirmedCredentials: [],
    credentialCutRemnants: [], withheldLines: [], keepInsideLines: false,
    lengthChoice: "auto", docKind: "resume",
    writerReceipt: writerReceipt(written, grounding, { userId: UID, runId: RUN, source, nonce: NONCE }),
  };
}

function verdict(state: ReturnType<typeof finish>) {
  const c = cleanRevisionInput(state, { receipt: { userId: UID, runId: RUN, newestNonce: NONCE, runLinked: true } });
  assert.ok(c.ok, c.ok ? "" : c.reason);
  assert.equal(c.input.evidence.writerVerified, true, "the receipt is genuine; the truth gate must decide");
  return gateRevision(c.input, 1);
}

async function download(state: ReturnType<typeof finish>) {
  return handleDownloadPost(new Request("http://fixture.invalid/download", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ finish: state, type: "cover_letter", format: "txt" }),
  }), {
    userId: async () => UID,
    getRevision: async () => null,
    receiptState: async () => ({ newestNonce: NONCE, linked: true }),
  });
}

async function verify(sourceText: string, output: string, reply: unknown) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
  try {
    return await verifyGrounding({ sourceText, output, kind: "resume" });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const CLAIMS = [
  "I supervised staff every day and would value discussing the role.",
  "I would welcome the chance to bring my experience operating forklifts to your company.",
];

test("genuine receipts cannot finish or export unmarked letters during full, partial or unknown verification", async () => {
  const checks = [
    { ...CHECKED, verifierRan: false, verifierRanByDoc: { resume: false, cover_letter: false } },
    { ...CHECKED, verifierRan: false, verifierRanByDoc: { resume: true, cover_letter: false } },
    { rewordingA: true, flags: [], outcomes: [] },
  ];
  for (const grounding of checks) {
    for (const letter of [...CLAIMS, "I would welcome the chance to discuss the role."]) {
      const state = finish(RESUME, letter, grounding);
      assert.equal(verdict(state).status, "draft");
      const response = await download(state);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-smr-status"), "draft");
      assert.match(await response.text(), /^DRAFT\n\n/);
    }
  }
});

test("courtesy words cannot hide an unsupported supervision claim even after a clean model response", async () => {
  const state = finish(RESUME, CLAIMS[0]);
  assert.equal(verdict(state).status, "draft");
  const response = await download(state);
  assert.equal(response.headers.get("x-smr-status"), "draft");
  assert.match(await response.text(), /^DRAFT\n\n/);
});

const SOURCE = "Alex Example\nalex@example.test\nEXPERIENCE\nCleaner | Example Services | 2021 - 2024\n- Did safety audits.\n- Cleaned floors.";
const OUTPUT = SOURCE.replace("Did safety audits.", "Ran safety audits.").replace("Cleaned floors.", "Cleaned floors with zero incidents.");
const FLAGS = [
  { claim: "Ran safety audits.", why: "Different words", kind: "wording" },
  { claim: "zero incidents", why: "Unsourced result", kind: "result" },
];

test("malformed verifier decisions and flag rows are unavailable checks, never clean passes", async () => {
  const replies = [
    { flags: [] },
    { hasFabrication: true, flags: [{ claim: 99, why: "Wrong", kind: "number" }], cleaned: SOURCE },
    { hasFabrication: false, flags: [null], cleaned: OUTPUT },
    { hasFabrication: true, flags: [{ claim: "zero incidents", why: "Wrong" }], cleaned: SOURCE },
    { hasFabrication: true, flags: [{ claim: "zero incidents", why: "Wrong", kind: "unknown-kind" }], cleaned: SOURCE },
  ];
  for (const reply of replies) {
    const result = await verify(SOURCE, OUTPUT, reply);
    assert.equal(result.verifierRan, false);
    assert.equal(result.text, OUTPUT, "keep useful draft text without claiming verification");
  }
});

test("stronger truthful wording survives separate factual corrections and removal of an invented line", async () => {
  for (const extra of [false, true]) {
    const output = OUTPUT + (extra ? "\n- Reduced injuries by 50%." : "");
    const flags = [...FLAGS, ...(extra ? [{ claim: "50%", why: "Invented number", kind: "number" }] : [])];
    const result = await verify(SOURCE, output, { hasFabrication: true, flags, cleaned: SOURCE });
    assert.equal(result.verifierRan, true);
    assert.equal(result.text, SOURCE.replace("Did safety audits.", "Ran safety audits."));
    assert.doesNotMatch(result.text, /zero incidents|50%/);
  }
});

const JOBS = "Alex Example\nalex@example.test\nEXPERIENCE\nAuditor | Sample Checks | 2018 - 2020\n- Did safety audits.\nCleaner | Example Services | 2021 - 2024\n- Cleaned floors.";

test("a wording-typed flag cannot transfer a duty to another job", async () => {
  const output = JOBS.replace("- Cleaned floors.", "- Ran safety audits.");
  const result = await verify(JOBS, output, {
    hasFabrication: true,
    flags: [{ claim: "Ran safety audits.", why: "Unsupported at Cleaner role", kind: "wording" }],
    cleaned: JOBS,
  });
  assert.equal(result.hasFabrication, true);
  assert.equal(result.text, JOBS);
});

test("duplicate flagged text preserves the true job's stronger wording and removes the other occurrence", async () => {
  const output = JOBS.replace("Did safety audits.", "Ran safety audits.").replace("Cleaned floors.", "Ran safety audits.");
  const result = await verify(JOBS, output, {
    hasFabrication: true,
    flags: [{ claim: "Ran safety audits.", why: "Only supported at Auditor role", kind: "wording" }],
    cleaned: JOBS,
  });
  assert.equal(result.hasFabrication, true);
  assert.equal(result.text, JOBS.replace("Did safety audits.", "Ran safety audits."));
});

test("checked truthful letter paraphrases finish, but new facts edited afterward do not inherit that pass", () => {
  const resume = RESUME.replace("Cleaned floors and took out trash.", "Answered phones and helped customers.");
  const state = finish(resume, "I handled telephone calls and assisted customers.");
  assert.equal(verdict(state).status, "finished");
  assert.equal(verdict({ ...state, coverLetterText: "I handled telephone calls and operated forklifts." }).status, "draft");
});

// The deterministic fact lock still applies when a model misses a tool claim.
test("a clean model verdict cannot clear an invented tool hidden in a courtesy sentence", () => {
  assert.equal(verdict(finish(RESUME, CLAIMS[1])).status, "draft");
});
