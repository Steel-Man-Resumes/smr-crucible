/**
 * Demo-eve lane L4 (2026-10-28): the Tailor and the tracker say only what is
 * known. Walkthrough 2026-10-27 findings W09, W10, W13. Fictional cast only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasBaseContact, tailoredContact } from "../document-contact";
import {
  CHECK_OPENING_LINE,
  CHECK_SLOW_LINE,
  CHECK_SLOW_LINK,
  NO_LINK_SAVED_LINE,
  TRACKER_DRAFT_LINE,
  TRACKER_FINISHED_LINE,
  revisionStatusOf,
  tailorStartNotice,
  trackerReadinessLine,
} from "../tailor-readiness";
import { STEP_COPY } from "../progression-policy";
import { ASK_TROY_ACTION, ASK_TROY_HINT } from "../refinery-nav";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PROFILE = { name: "Marqus Relly", email: "marqus.signin@example.test", phone: "414-555-0100", city: "Milwaukee", state: "WI" };

// ---- W10 (1): the tailored contact block follows the base resume ----------------

test("W10: a base with name, city and state only never gets the sign-in email or phone added", () => {
  const base = { name: "Marqus Relly", phone: "", email: "", city: "Milwaukee", state: "WI" };
  assert.deepEqual(tailoredContact(base, PROFILE), { name: "Marqus Relly", phone: "", email: "", city: "Milwaukee", state: "WI" });
});

test("W10: a base that carries an email keeps its own, not the account's", () => {
  const base = { name: "Marqus Relly", email: "marqus.resume@example.test", city: "Milwaukee", state: "WI" };
  assert.equal(tailoredContact(base, PROFILE).email, "marqus.resume@example.test");
  assert.equal(tailoredContact(base, PROFILE).phone, "");
});

test("W10: city and state fill from the profile only for the same person", () => {
  const same = tailoredContact({ name: "Marqus Relly" }, PROFILE);
  assert.equal(same.city, "Milwaukee");
  assert.equal(same.state, "WI");
  assert.equal(same.email, "");
  const other = tailoredContact({ name: "John Valjean" }, PROFILE);
  assert.deepEqual(other, { name: "John Valjean", phone: "", email: "", city: "", state: "" });
});

test("W10: with no base contact block the profile is used as before", () => {
  assert.equal(hasBaseContact(null), false);
  assert.equal(hasBaseContact({ name: "  " }), false);
  assert.deepEqual(tailoredContact(null, PROFILE), PROFILE);
});

test("W10: the Tailor, the batch queue and the generator all apply the base rule", () => {
  const ws = code(read("components/resume/ResumeWorkspace.tsx"));
  assert.match(ws, /contactInfo = tailoredContact\(parentContact \?\? baseDocContact, contactInfo\)/);
  assert.doesNotMatch(ws, /fill\.email|fill\.phone/);
  const ctx = code(read("lib/tailor-context.ts"));
  assert.match(ctx, /tailoredContact\(/);
  assert.doesNotMatch(ctx, /fill\.email|fill\.phone/);
  const route = code(read("app/api/resume-generate-full/route.ts"));
  assert.match(route, /approvedContact = approvedDoc\?\.contact/);
  assert.match(route, /const docContact = hasBaseContact\(approvedContact\) \? tailoredContact\(approvedContact, contact\) : contact;/);
  // Every contact field in the prompt and in the document reads the followed block.
  assert.doesNotMatch(route, /\bcontact\?\.(name|phone|email|city|state)/);
  assert.match(route, /email: docContact\?\.email \|\| ""/);
});

// ---- W10 (2): a missing link is not a fact about the employer -------------------

test("W10: no saved link says so, and never claims the job has no online application", () => {
  assert.match(NO_LINK_SAVED_LINE, /^No application link was saved for this job\./);
  const apply = read("components/apply/ApplyActions.tsx");
  assert.doesNotMatch(apply, /has no online application/);
  assert.match(apply, /\{NO_LINK_SAVED_LINE\}/);
  const prompt = read("app/api/apply-email/route.ts");
  assert.doesNotMatch(prompt, /because the employer offers no online application/);
  assert.match(prompt, /no online application link was saved for this job/);
});

// ---- W09: the Tailor button never fails silently -------------------------------

test("W09: a locked tailor explains itself with the existing early-access wording", () => {
  const n = tailorStartNotice("progression_locked", "Choose a job and a resume so the changes have a clear purpose. Ask t.ROY in the progress bar to open it early.");
  assert.equal(n.kind, "locked");
  assert.ok(n.body.startsWith(STEP_COPY.tailor.reason));
  assert.equal(n.action, ASK_TROY_ACTION);
  assert.equal(n.hint, ASK_TROY_HINT);
});

test("W09: any other failure shows the server's own message, or a plain fallback", () => {
  assert.deepEqual(tailorStartNotice(null, "Career lane unavailable"), { kind: "error", heading: "Your resume was not tailored.", body: "Career lane unavailable" });
  assert.match(tailorStartNotice(undefined, "").body, /Try again\.$/);
});

test("W09: the setup screen shows the notice at the button and opens the early-access request", () => {
  const ws = code(read("components/resume/ResumeWorkspace.tsx"));
  // The run's catch keeps the server code and returns to the setup screen...
  assert.match(ws, /setGenErrorCode\(typeof err\?\.code === "string" \? err\.code : null\);\s*setShowSetup\(true\);/);
  assert.match(ws, /code: typeof errData\.code === "string" \? errData\.code : null/);
  // ...and the setup screen now renders it (it used to render only when showSetup was false).
  assert.equal(ws.match(/\{tailorNotice\}/g)?.length, 2, "under both start buttons");
  assert.match(ws, /role="alert"/);
  assert.match(ws, /onClick=\{\(\) => progression\.ask\(tailorStep\)\}/);
  assert.match(ws, /scrollIntoView\(/);
});

// ---- W13: the tracker says what the Tailor says ----------------------------------

test("W13: tracker readiness follows the newest revision, draft unless finished", () => {
  assert.equal(revisionStatusOf({ revision: { status: "finished" } }), "finished");
  assert.equal(revisionStatusOf({ revision: { status: "draft" } }), "draft");
  assert.equal(revisionStatusOf({ revision: null }), "draft");
  assert.equal(revisionStatusOf(null), "draft");
  assert.equal(trackerReadinessLine("finished"), TRACKER_FINISHED_LINE);
  assert.equal(trackerReadinessLine("draft"), TRACKER_DRAFT_LINE);
  assert.equal(trackerReadinessLine(null), null);
  assert.doesNotMatch(TRACKER_DRAFT_LINE, /ready/i);
});

test("W13: the tracker no longer calls every tailored resume ready", () => {
  const page = read("app/(dashboard)/dashboard/applications/page.tsx");
  assert.doesNotMatch(page, /Your tailored resume is ready/);
  assert.match(page, /<TailoredReadiness artifactId=\{app\.resume_artifact_id\} \/>/);
  assert.match(page, /\/api\/revisions\?artifactId=/);
  assert.match(page, /status === "draft" && <CheckAndFinish artifactId=\{artifactId\} status="draft" showBadge=\{false\} \/>/);
});

test("W13: Check and finish always answers the click", () => {
  const src = code(read("components/lanes/CheckAndFinish.tsx"));
  assert.match(src, /onClick=\{\(\) => setOpening\(true\)\}/);
  assert.match(src, /role="status"/);
  assert.match(src, /setTimeout\(\(\) => setSlow\(true\), CHECK_SLOW_MS\)/);
  // The slow fallback is a plain link that loads the same check page.
  assert.match(src, /<a href=\{checkAndFinishHref\(artifactId\)\}/);
});

test("new copy: no em dashes, no double hyphen, plain words", () => {
  const lines = [NO_LINK_SAVED_LINE, TRACKER_FINISHED_LINE, TRACKER_DRAFT_LINE, CHECK_OPENING_LINE, CHECK_SLOW_LINE, CHECK_SLOW_LINK,
    ...Object.values(tailorStartNotice("progression_locked", "")).filter((v): v is string => typeof v === "string"),
    ...Object.values(tailorStartNotice(null, "")).filter((v): v is string => typeof v === "string")];
  for (const l of lines) {
    assert.doesNotMatch(l, /—|–|--/, l);
    assert.doesNotMatch(l, /felon/i, l);
  }
});
