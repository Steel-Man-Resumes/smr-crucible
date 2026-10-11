/**
 * The finished package, emailed by itself (lib/email-package-auto.ts, lane 3a
 * Part 2 item 2). Every dependency is a fake: no database, and the mail
 * transport is a recorder, so no real email provider is ever reached.
 * Fictional people, example.com addresses only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFinishView, recordAnswer, type DefendAnswer } from "../finish-gate";
import {
  AUTO_ENDPOINT,
  autoResultLine,
  revisionVersion,
  sendFinishedPackage,
  type AutoDeps,
} from "../email-package-auto";
import { EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY, RECIPIENT_ENDPOINT, recipientKey } from "../email-package-guard";
import type { PackageMail } from "../email-package-send";
import { cleanRevisionInput, computeRevision, revisionRecord } from "../revision-status";
import { revisionContentHash, type ArtifactRevision } from "@crucible/core/src/artifactRevision";
import { packageFiles } from "../email-package-files";
import { writerReceipt } from "../writer-receipt";

const UID = "00000000-0000-4000-8000-0000000000aa";
const OWN = "morgan@example.com";
const ART = "00000000-0000-4000-8000-00000000a7a7";

const SOURCE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
The owner asked me to show new cooks the grill.`;

const RESUME = `MORGAN SAMPLE
Toledo, OH | morgan@example.com

Line cook

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.
- Showed incoming culinary staff the equipment.

CORE COMPETENCIES
Grill, Breakfast line, Vegetable prep, Kitchen closing`;
const LETTER = "Dear hiring manager,\n\nI ran the grill at Harbor Street Diner.\n\nMorgan Sample";

// The finish gate (round 2 on) asks nothing about lines already in the
// person's own words, so the fixture's last bullet is reworded away from
// them: without an answer the page is a draft; explained, it is finished.
const EXPLAINED = "Yes, I did that myself at that job, most shifts.";

function allAnswered(resume = RESUME): DefendAnswer[] {
  let answers: DefendAnswer[] = [];
  const view = buildFinishView({ resumeText: resume, ownWords: SOURCE, defendAnswers: [] });
  for (const d of view.status.defendLines) answers = recordAnswer(answers, d.line, EXPLAINED, "stands");
  return answers;
}

let revSeq = 0;
/**
 * A saved revision, made the way the server makes one: the finish state is
 * cleaned, the gate and the page count run, the verdict stored. `force`
 * overwrites the stored status (a row saved under an older checker).
 */
function revision(extra: Record<string, unknown> = {}, force?: "finished", artifactId = ART, createdAt = "2026-10-10T09:00:00Z"): ArtifactRevision {
  const resume = (extra.resumeText as string) ?? RESUME;
  const letter = (extra.coverLetterText as string) ?? LETTER;
  const c = cleanRevisionInput({
    resumeText: resume,
    coverLetterText: letter,
    defendAnswers: allAnswered(resume),
    ownWords: SOURCE,
    written: { resume, letter },
    grounding: null,
    runId: "2026-10-08T12:00:00.000Z",
    writerReceipt: writerReceipt({ resume, letter }, null, {
      userId: null,
      runId: "2026-10-08T12:00:00.000Z",
      source: { ownWords: (extra.ownWords as string) ?? SOURCE, ownResumeText: "", credentialsAnswer: "", credentialRows: [] },
      nonce: "1".repeat(32),
      now: 0,
    }),
    keptTerms: [],
    ...extra,
  });
  if (!c.ok) throw new Error(c.reason);
  void artifactId;
  const v = computeRevision(c.input);
  const rec = revisionRecord(artifactId, "forge_finish", c.input, v);
  if (force) Object.assign(rec, { status: force, openItems: [] });
  return {
    id: `00000000-0000-4000-8000-00000000f${(++revSeq).toString(16).padStart(3, "0")}`,
    user_id: UID, artifact_id: artifactId, revision_number: revSeq, source: rec.source, doc_kind: rec.docKind,
    resume_text: rec.resumeText, letter_text: rec.letterText, kept_terms: rec.keptTerms, confirmed_credentials: rec.confirmedCredentials,
    defend_answers: rec.defendAnswers, evidence: rec.evidence, checker_version: rec.checkerVersion, status: rec.status,
    page_count: rec.pageCount, page_limit: rec.pageLimit, length_choice: rec.lengthChoice, open_items: rec.openItems,
    content_hash: revisionContentHash(rec), created_at: createdAt,
  } as ArtifactRevision;
}

const FINISHED = revision();
function finishedBody(extra: Record<string, unknown> = {}, rev: ArtifactRevision = FINISHED) {
  return { revisionId: rev.id, narrativeHeadline: "A cook who runs the line", ...extra };
}

/** Fake world: an account row, saved revisions, a durable claim table, daily counters, and a recording transport. */
function world(opts: {
  target?: { email: string | null; proven: boolean; on: boolean } | null;
  claimTable?: "ready" | "missing";
  transportOk?: boolean;
  transportThrows?: boolean;
  noTransport?: boolean;
  countThrows?: boolean;
  revisions?: ArtifactRevision[];
  filesThrow?: boolean;
  now?: number;
} = {}) {
  const sent: PackageMail[] = [];
  const claims = new Set<string>();
  const counts = new Map<string, number>();
  const released: string[] = [];
  const revs = opts.revisions ?? [FINISHED];
  const deps: AutoDeps = {
    target: async () => (opts.target === undefined ? { email: OWN, proven: true, on: true } : opts.target),
    count: async (key, endpoint) => {
      if (opts.countThrows && endpoint === RECIPIENT_ENDPOINT) throw new Error("db down");
      const k = `${endpoint}|${key}`;
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return n;
    },
    claim: async (userId, version) => {
      if (opts.claimTable === "missing") return null;
      const k = `${userId}|${version}`;
      if (claims.has(k)) return false;
      claims.add(k);
      return true;
    },
    release: async (userId, version) => {
      released.push(version);
      claims.delete(`${userId}|${version}`);
    },
    // Owner only, like the real read.
    getRevision: async (userId, id) => (userId === UID ? revs.find((r) => r.id === id) ?? null : null),
    getLatestRevision: async (userId, artifactId) =>
      userId === UID ? revs.filter((r) => r.artifact_id === artifactId).sort((a, b) => a.revision_number - b.revision_number).at(-1) ?? null : null,
    now: () => opts.now ?? Date.parse("2026-10-10T12:00:00Z"),
    files: async (resume, letter) => {
      if (opts.filesThrow) throw new Error("render");
      return [{ filename: "Morgan-Sample.pdf", content: "UERG" }, { filename: "Morgan-Sample.docx", content: "UEs=" }, ...(letter.trim() ? [{ filename: "Morgan-Sample-CoverLetter.docx", content: "UEs=" }] : [])];
    },
    transport: opts.noTransport
      ? null
      : async (msg) => {
          if (opts.transportThrows) throw new Error("network");
          sent.push(msg);
          return { ok: opts.transportOk !== false, status: opts.transportOk === false ? 500 : 200 };
        },
    from: "Steel Man Resumes <noreply@example.com>",
  };
  return { deps, sent, claims, counts, released };
}

test("the fixture really is finished (and without answers, a draft)", () => {
  assert.equal(buildFinishView({ resumeText: RESUME, ownWords: SOURCE, defendAnswers: allAnswered() }).state, "finished");
  assert.equal(buildFinishView({ resumeText: RESUME, ownWords: SOURCE, defendAnswers: [] }).state, "draft");
});

test("a finished resume is sent once, to the account's own proven address", async () => {
  const w = world();
  const r = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.deepEqual(r, { sent: true, to: OWN, revision: FINISHED.revision_number });
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].to, OWN);
  assert.match(w.sent[0].text, /LINE COOK \| Harbor Street Diner/);
  assert.equal(w.sent[0].subject, "Your finished resume from The Forge");
  assert.equal(autoResultLine(r), `We sent it to ${OWN}.`);
});

test("a draft sends nothing and claims nothing", async () => {
  const draft = revision({ defendAnswers: [] });
  assert.equal(draft.status, "draft");
  const w = world({ revisions: [draft] });
  const r = await sendFinishedPackage(UID, finishedBody({}, draft), w.deps);
  assert.deepEqual(r, { sent: false, reason: "draft" });
  assert.equal(w.sent.length, 0);
  assert.equal(w.claims.size, 0);
  assert.equal(w.counts.size, 0);
});

test("no revision id (raw text only), nothing sent; someone else's revision is not found", async () => {
  const w = world();
  assert.deepEqual(await sendFinishedPackage(UID, { resumeText: RESUME }, w.deps), { sent: false, reason: "no_resume" });
  assert.deepEqual(await sendFinishedPackage("00000000-0000-4000-8000-0000000000bb", finishedBody(), w.deps), { sent: false, reason: "not_found" });
  assert.equal(w.sent.length, 0);
});

test("an address in the request body is ignored: the email goes only to the account's address", async () => {
  const w = world();
  const r = await sendFinishedPackage(
    UID,
    finishedBody({ email: "someone.else@example.com", to: "someone.else@example.com", recipient: "x@example.com" }),
    w.deps
  );
  assert.equal(r.sent, true);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].to, OWN);
  assert.ok(!JSON.stringify(w.sent[0]).includes("someone.else@example.com"));
});

test("an unproven address gets nothing", async () => {
  const w = world({ target: { email: OWN, proven: false, on: true } });
  const r = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.deepEqual(r, { sent: false, reason: "unproven" });
  assert.equal(w.sent.length, 0);
  assert.equal(w.claims.size, 0);
});

test("turned off: nothing is sent", async () => {
  const w = world({ target: { email: OWN, proven: true, on: false } });
  const r = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.deepEqual(r, { sent: false, reason: "off" });
  assert.equal(w.sent.length, 0);
  assert.equal(autoResultLine(r), null);
});

test("no account row or no address: nothing is sent", async () => {
  for (const target of [null, { email: null, proven: true, on: true }]) {
    const w = world({ target });
    assert.deepEqual(await sendFinishedPackage(UID, finishedBody(), w.deps), { sent: false, reason: "no_address" });
    assert.equal(w.sent.length, 0);
  }
});

test("idempotent: the same finished version is never sent twice, even days apart", async () => {
  const w = world();
  assert.equal((await sendFinishedPackage(UID, finishedBody(), w.deps)).sent, true);
  // A new day: the daily counters reset, the claim does not.
  w.counts.clear();
  const again = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.deepEqual(again, { sent: false, reason: "already", to: OWN });
  assert.equal(w.sent.length, 1);
  assert.equal(autoResultLine(again), `We sent it to ${OWN}.`);
});

test("a changed finished resume is a new revision and is sent", async () => {
  // Still all theirs: one bullet split into two lines in their own words.
  const edited = RESUME.replace(
    "- Prepped vegetables before open and closed the kitchen at night.",
    "- Prepped vegetables before open.\n- Closed the kitchen at night."
  );
  assert.notEqual(edited, RESUME);
  const v2 = revision({ resumeText: edited });
  assert.equal(v2.status, "finished");
  // The next day (one automatic email per resume per day).
  const w1 = world({ revisions: [FINISHED] });
  await sendFinishedPackage(UID, finishedBody(), w1.deps);
  const w = world({ revisions: [FINISHED, v2], now: Date.parse("2026-10-11T12:00:00Z") });
  w.claims.forEach(() => {});
  for (const k of w1.claims) w.claims.add(k);
  const r = await sendFinishedPackage(UID, finishedBody({}, v2), w.deps);
  assert.equal(r.sent, true);
  assert.equal(w1.sent.length + w.sent.length, 2);
});

test("versioned by revision: a changed letter alone is a new version (it was not)", async () => {
  const v2 = revision({ coverLetterText: "Dear hiring manager,\n\nI ran the grill at Harbor Street Diner, most mornings.\n\nMorgan Sample" });
  assert.equal(v2.status, "finished");
  assert.equal(v2.resume_text, FINISHED.resume_text);
  assert.notEqual(revisionVersion(UID, v2), revisionVersion(UID, FINISHED));
  // Asked for the older one, the newest finished version (v2) is what goes out.
  const w = world({ revisions: [FINISHED, v2] });
  assert.equal((await sendFinishedPackage(UID, finishedBody(), w.deps)).sent, true);
  assert.match(w.sent[0].text, /most mornings/);
});

test("two tabs at once: one send", async () => {
  const w = world();
  const [a, b] = await Promise.all([
    sendFinishedPackage(UID, finishedBody(), w.deps),
    sendFinishedPackage(UID, finishedBody(), w.deps),
  ]);
  assert.equal([a, b].filter((r) => r.sent).length, 1);
  assert.equal(w.sent.length, 1);
});

test("the version is a SHA-256 hex of the person, the revision and its content hash, never the text", () => {
  const v = revisionVersion(UID, FINISHED);
  assert.match(v, /^[0-9a-f]{64}$/);
  assert.notEqual(v, revisionVersion("00000000-0000-4000-8000-0000000000bb", FINISHED), "another person, another version");
  assert.ok(!v.includes("MORGAN"));
});

test("a failed send gives the claim back, so a later visit can send it", async () => {
  const w = world({ transportOk: false });
  const r = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.deepEqual(r, { sent: false, reason: "failed", to: OWN });
  assert.equal(w.released.length, 2, "the revision claim and the day claim");
  assert.equal(w.claims.size, 0);
});

test("a transport that throws gives the claim back too", async () => {
  const w = world({ transportThrows: true });
  assert.equal((await sendFinishedPackage(UID, finishedBody(), w.deps)).sent, false);
  assert.equal(w.claims.size, 0);
});

test("a counter error after the claim gives the claim back and is not swallowed", async () => {
  const w = world({ countThrows: true });
  await assert.rejects(sendFinishedPackage(UID, finishedBody(), w.deps));
  assert.equal(w.claims.size, 0);
  assert.equal(w.sent.length, 0);
});

test("the existing per-address daily cap applies, and a capped send is given back", async () => {
  const w = world();
  // The address already had its sends today (from the package box, say).
  for (let i = 0; i < EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY; i++) await w.deps.count(recipientKey(OWN), RECIPIENT_ENDPOINT);
  const r = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.deepEqual(r, { sent: false, reason: "limit", to: OWN });
  assert.equal(w.sent.length, 0);
  assert.equal(w.claims.size, 0, "given back: tomorrow it can still go out");
});

test("before 079 is applied: once a day by the durable counter", async () => {
  const w = world({ claimTable: "missing" });
  assert.equal((await sendFinishedPackage(UID, finishedBody(), w.deps)).sent, true);
  assert.deepEqual(await sendFinishedPackage(UID, finishedBody(), w.deps), { sent: false, reason: "already_today", to: OWN });
  assert.equal(w.sent.length, 1);
  assert.ok(Array.from(w.counts.keys()).some((k) => k.startsWith(`${AUTO_ENDPOINT}|auto:`)));
});

test("email not configured: nothing sent, and the line says so plainly", async () => {
  const w = world({ noTransport: true });
  const r = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.equal(r.sent, false);
  assert.equal(r.reason, "not_configured");
  assert.match(autoResultLine(r) ?? "", /download is right here/);
});

test("the route takes no address from the request and wires the real claim", () => {
  const src = readFileSync(join(__dirname, "..", "..", "app", "api", "forge", "email-package", "auto", "route.ts"), "utf8");
  assert.doesNotMatch(src, /body\.(email|to|recipient)/);
  assert.match(src, /forgeSessionUser\(await auth\(\)\)/);
  assert.match(src, /claim: claimPackageEmailVersion/);
  assert.match(src, /release: releasePackageEmailVersion/);
  assert.match(src, /mode: "user"/);
  assert.match(src, /getRevision,/);
  assert.match(src, /files: packageFiles/);
  assert.match(src, /isSameOriginJsonPost\(request\.headers\)/);
  assert.doesNotMatch(src, /originAllowed/);
});

test("the finished email says why it came and how to turn it off, with no price", async () => {
  const w = world();
  await sendFinishedPackage(UID, finishedBody(), w.deps);
  const m = w.sent[0];
  assert.match(m.text, /You can turn these emails off in Settings/);
  assert.doesNotMatch(m.text + m.html, /\$\d|price|per month/i);
  assert.doesNotMatch(m.html, /<script/i);
});

// ---- Phase 5 R1: the email and the page agree, the letter counts, files go out ----

test("A5 repro 1: a kept skill (D3) the page finished is emailed (the old email said draft)", async () => {
  const withSkill = RESUME.replace("Kitchen closing", "Kitchen closing, Inventory control");
  const kept = revision({ resumeText: withSkill, keptTerms: ["Inventory control"] });
  assert.equal(kept.status, "finished", "the server, with the kept term, agrees with the page");
  const w = world({ revisions: [kept] });
  const r = await sendFinishedPackage(UID, finishedBody({}, kept), w.deps);
  assert.equal(r.sent, true);
  assert.match(w.sent[0].text, /Inventory control/);
});

test("A5 repro 2: an unsupported letter is never emailed, even on a row stored as finished", async () => {
  const bad = "Dear hiring manager,\n\nI ran the grill at Harbor Street Diner. I managed 900 employees and hold a PhD in culinary science.\n\nMorgan Sample";
  const honest = revision({ coverLetterText: bad });
  assert.equal(honest.status, "draft", "the server stores it as a draft");
  const forged = revision({ coverLetterText: bad }, "finished");
  for (const rev of [honest, forged]) {
    const w = world({ revisions: [rev] });
    const r = await sendFinishedPackage(UID, finishedBody({}, rev), w.deps);
    assert.deepEqual(r, { sent: false, reason: "draft" });
    assert.equal(w.sent.length, 0);
    assert.equal(w.claims.size, 0);
  }
  assert.match(autoResultLine({ sent: false, reason: "draft" }) ?? "", /still has something to fix/);
});

test("the actual files go out: resume PDF and Word, the letter in Word, attached", async () => {
  const w = world();
  await sendFinishedPackage(UID, finishedBody(), w.deps);
  const names = (w.sent[0].attachments ?? []).map((a) => a.filename);
  assert.deepEqual(names, ["Morgan-Sample.pdf", "Morgan-Sample.docx", "Morgan-Sample-CoverLetter.docx"]);
  assert.match(w.sent[0].text, /attached as a PDF and a Word file, with your cover letter in Word/);
});

test("files that fail to build: nothing sent, the claim given back, a retry can send it", async () => {
  const w = world({ filesThrow: true });
  assert.deepEqual(await sendFinishedPackage(UID, finishedBody(), w.deps), { sent: false, reason: "failed", to: OWN });
  assert.equal(w.claims.size, 0);
});

test("the real file builder makes a real PDF and real Word files from the revision", async () => {
  const files = await packageFiles(FINISHED.resume_text, FINISHED.letter_text);
  assert.equal(files.length, 3);
  assert.equal(Buffer.from(files[0].content, "base64").subarray(0, 5).toString(), "%PDF-");
  assert.equal(Buffer.from(files[1].content, "base64").subarray(0, 2).toString(), "PK");
  assert.equal(files[0].filename, "Morgan-Sample.pdf");
});

// ---- review L4: settle, newest only, one per resume per day, "Email me the latest" ----

test("L4: a version saved under five minutes ago waits (settling), unless the person asks now", async () => {
  const fresh = revision({}, undefined, ART, "2026-10-10T11:58:00Z");
  const w = world({ revisions: [fresh], now: Date.parse("2026-10-10T12:00:00Z") });
  const r = await sendFinishedPackage(UID, finishedBody({}, fresh), w.deps);
  assert.equal(r.sent, false);
  assert.equal(!r.sent && r.reason, "settling");
  assert.ok(!r.sent && (r.retryInMs ?? 0) > 2 * 60 * 1000);
  assert.equal(w.sent.length, 0);
  assert.equal(w.claims.size, 0, "nothing claimed while it settles");
  assert.equal((await sendFinishedPackage(UID, finishedBody({ now: true }, fresh), w.deps)).sent, true, "Email me the latest");
});

test("L4: one automatic email per resume per day, the button included; a different resume is its own", async () => {
  const v2 = revision({ coverLetterText: "Dear hiring manager,\n\nI ran the grill at Harbor Street Diner, most mornings.\n\nMorgan Sample" });
  assert.equal(v2.status, "finished");
  const w = world({ revisions: [FINISHED] });
  assert.equal((await sendFinishedPackage(UID, finishedBody(), w.deps)).sent, true);
  const w2 = world({ revisions: [FINISHED, v2] });
  for (const k of w.claims) w2.claims.add(k);
  const again = await sendFinishedPackage(UID, finishedBody({ now: true }, v2), w2.deps);
  assert.deepEqual(again, { sent: false, reason: "already_today", to: OWN });
  assert.match(autoResultLine(again) ?? "", /already emailed this resume today/);
  const other = revision({}, undefined, "00000000-0000-4000-8000-00000000a7a8");
  const w3 = world({ revisions: [other] });
  for (const k of w.claims) w3.claims.add(k);
  assert.equal((await sendFinishedPackage(UID, finishedBody({}, other), w3.deps)).sent, true);
});

test("L4: a newer draft means nothing goes out (never an older version)", async () => {
  const draft = revision({ defendAnswers: [] });
  const w = world({ revisions: [FINISHED, draft] });
  assert.deepEqual(await sendFinishedPackage(UID, finishedBody(), w.deps), { sent: false, reason: "draft" });
});
