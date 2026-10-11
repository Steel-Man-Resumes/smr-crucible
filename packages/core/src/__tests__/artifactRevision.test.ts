/**
 * Saved resume revisions (migration 081, Phase 5 lane R1): the pure parts.
 * The PGlite suite (outside the repo, own port) runs these SQL constants
 * against the real migration. Invented data only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  revisionContentHash,
  revisionProblem,
  stableJson,
  publicRevision,
  REVISION_INSERT_SQL,
  REVISION_GET_SQL,
  REVISION_LATEST_SQL,
  REVISION_LIST_SQL,
  REVISION_DELETE_ALL_SQL,
  type NewRevision,
  type ArtifactRevision,
} from "../artifactRevision";
import { RLS_PROTECTED_TABLES } from "../rlsHealth";

const ART = "00000000-0000-4000-8000-00000000a7a7";
const base: NewRevision = {
  artifactId: ART,
  source: "forge_finish",
  docKind: "resume",
  resumeText: "MORGAN SAMPLE\nLine cook\n- Ran the grill.",
  letterText: "Dear hiring manager,",
  keptTerms: ["Grill"],
  confirmedCredentials: [],
  defendAnswers: [{ line: "- Ran the grill.", answer: "Yes, most shifts.", verdict: "stands" }],
  evidence: { ownWords: "I ran the grill." },
  checkerVersion: "gate-1",
  status: "finished",
  pageCount: 1,
  pageLimit: 2,
  lengthChoice: "auto",
  openItems: [],
};

const MIG = readFileSync(join(import.meta.dirname, "..", "..", "migrations", "081_artifact_revision.sql"), "utf8");

test("stableJson: key order never changes the text", () => {
  assert.equal(stableJson({ b: 1, a: [{ d: 2, c: 3 }] }), stableJson({ a: [{ c: 3, d: 2 }], b: 1 }));
});

test("content hash: same content, same hash; any change (text, a kept term, the letter, status) a new one", () => {
  const h = revisionContentHash(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, revisionContentHash({ ...base, evidence: { ownWords: "I ran the grill." } }));
  assert.notEqual(h, revisionContentHash({ ...base, resumeText: base.resumeText + " Daily." }));
  assert.notEqual(h, revisionContentHash({ ...base, letterText: "Dear team," }));
  assert.notEqual(h, revisionContentHash({ ...base, keptTerms: [] }));
  assert.notEqual(h, revisionContentHash({ ...base, status: "draft", openItems: ["x"] }));
  assert.notEqual(h, revisionContentHash({ ...base, lengthChoice: "one_page", pageLimit: 1 }));
});

test("content hash ignores where it was saved from (the import and the page save one version)", () => {
  assert.equal(revisionContentHash(base), revisionContentHash({ ...base, source: "forge_import" } as NewRevision));
});

test("a finished revision over its page limit is refused before the database (and by its CHECK)", () => {
  assert.equal(revisionProblem({ ...base, pageCount: 3 }), "finished over the page limit");
  assert.equal(revisionProblem({ ...base, pageCount: 2, pageLimit: 1, lengthChoice: "one_page" }), "finished over the page limit");
  assert.equal(revisionProblem({ ...base, status: "draft", pageCount: 3, openItems: ["Runs 3 pages"] }), null);
  // An academic CV has no limit.
  assert.equal(revisionProblem({ ...base, docKind: "cv_academic", pageLimit: null, pageCount: 9 }), null);
  assert.match(MIG, /CONSTRAINT artifact_revision_finished_fits\s+CHECK \(status <> 'finished' OR \(page_count >= 1 AND \(page_limit IS NULL OR page_count <= page_limit\)\)\)/);
});

test("a finished revision with open items is refused (and by its CHECK)", () => {
  assert.equal(revisionProblem({ ...base, openItems: ["Fix before you send"] }), "finished with open items");
  assert.match(MIG, /CHECK \(status <> 'finished' OR open_items = '\[\]'::jsonb\)/);
});

test("revisionProblem: bad ids, kinds, sources and sizes", () => {
  assert.equal(revisionProblem({ ...base, artifactId: "nope" }), "bad artifact id");
  assert.equal(revisionProblem({ ...base, source: "client" as never }), "bad source");
  assert.equal(revisionProblem({ ...base, docKind: "novel" as never }), "bad kind");
  assert.equal(revisionProblem({ ...base, resumeText: "   " }), "bad resume text");
  assert.equal(revisionProblem({ ...base, resumeText: "x".repeat(60_001) }), "bad resume text");
  assert.equal(revisionProblem({ ...base, status: "approved" as never }), "bad status");
});

test("every SQL statement is scoped to the owner", () => {
  for (const sql of [REVISION_GET_SQL, REVISION_LATEST_SQL, REVISION_LIST_SQL, REVISION_DELETE_ALL_SQL]) assert.match(sql, /user_id = \$\d/);
  assert.match(REVISION_INSERT_SQL, /r\.user_id = \$1/);
  assert.match(REVISION_INSERT_SQL, /ON CONFLICT \(artifact_id, revision_number\) DO NOTHING/);
  // The duplicate check compares with the newest revision only.
  assert.match(REVISION_INSERT_SQL, /ORDER BY r\.revision_number DESC LIMIT 1/);
});

test("migration 081: owner-only, FORCE, no UPDATE, composite owner key, add-only, documented rollback", () => {
  assert.match(MIG, /ALTER TABLE %I FORCE ROW LEVEL SECURITY/);
  assert.match(MIG, /FOREIGN KEY \(artifact_id, user_id\) REFERENCES refinery_artifact \(id, user_id\) ON DELETE CASCADE/);
  assert.match(MIG, /GRANT SELECT, INSERT, DELETE ON artifact_revision TO smr_app;/);
  assert.doesNotMatch(MIG, /CREATE POLICY[^;]*FOR UPDATE/);
  // Add only: nothing outside the ROLLBACK comment drops anything.
  assert.doesNotMatch(MIG, /^\s*(DROP TABLE|ALTER TABLE \S+ DROP)/m);
  assert.match(MIG, /CREATE TABLE IF NOT EXISTS artifact_revision/);
  assert.match(MIG, /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'refinery_artifact_id_user_key'\)/);
  assert.match(MIG, /--\s+DROP TABLE IF EXISTS artifact_revision;/);
  assert.match(MIG, /--\s+ALTER TABLE refinery_artifact DROP CONSTRAINT IF EXISTS refinery_artifact_id_user_key;/);
  assert.match(MIG, /--\s+DELETE FROM _migrations WHERE filename = '081_artifact_revision.sql';/);
});

test("the table is on the RLS list and the restricted-grants list, with no UPDATE", () => {
  assert.ok((RLS_PROTECTED_TABLES as readonly string[]).includes("artifact_revision"));
  const src = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "scripts", "lib", "restricted-grants.mjs"), "utf8");
  assert.match(src, /artifact_revision: \["SELECT", "INSERT", "DELETE"\]/);
});

test("publicRevision never carries the owner id", () => {
  const row = { ...base, id: ART, user_id: "00000000-0000-4000-8000-0000000000a1", artifact_id: ART, revision_number: 1, doc_kind: "resume", resume_text: "x", letter_text: "", kept_terms: [], confirmed_credentials: [], defend_answers: [], evidence: {}, checker_version: "g", page_count: 1, page_limit: 2, length_choice: "auto", open_items: [], content_hash: "0".repeat(64), created_at: "now" } as unknown as ArtifactRevision;
  assert.equal(JSON.stringify(publicRevision(row)).includes("0000000000a1"), false);
});

// ---- review round 1: kind and limit, sizes, pruning, parent links ----

import { pageLimitAllowed, REVISION_PRUNE_SQL, REVISION_KEEP_PER_ARTIFACT, REVISION_JSON_LIMITS } from "../artifactRevision";
import { ARTIFACT_SET_PARENT_SQL } from "../refineryArtifact";

test("M1: the page limit follows the kind, in code and in the CHECK", () => {
  assert.equal(revisionProblem({ ...base, docKind: "cv_academic", pageLimit: 2 }), "page limit does not fit the kind");
  assert.equal(revisionProblem({ ...base, docKind: "resume", pageLimit: null, pageCount: 3 }), "page limit does not fit the kind");
  assert.equal(revisionProblem({ ...base, docKind: "performer_resume", pageLimit: null }), "page limit does not fit the kind");
  assert.equal(pageLimitAllowed("artist_resume", 4), true);
  assert.equal(pageLimitAllowed("artist_resume", 3), false);
  assert.match(MIG, /CONSTRAINT artifact_revision_limit_by_kind CHECK/);
  assert.match(MIG, /doc_kind IN \('resume', 'cv_international'\) AND COALESCE\(page_limit, 0\) IN \(1, 2\)/);
  assert.match(MIG, /doc_kind IN \('cv_academic', 'cv_clinical'\) AND page_limit IS NULL/);
});

test("L8: evidence over the table's size CHECK is refused with a plain reason before the database", () => {
  const big = "x".repeat(REVISION_JSON_LIMITS.evidence);
  assert.equal(revisionProblem({ ...base, evidence: { ownWords: big } }), "too large");
  assert.equal(revisionProblem({ ...base, defendAnswers: [{ line: "x", answer: "y".repeat(REVISION_JSON_LIMITS.defendAnswers) }] }), "too large");
});

test("L6: pruning keeps the newest 50 and never the newest finished one", () => {
  assert.equal(REVISION_KEEP_PER_ARTIFACT, 50);
  assert.match(REVISION_PRUNE_SQL, /r\.id IS DISTINCT FROM \(\s*SELECT f\.id FROM artifact_revision f\s+WHERE f\.artifact_id = \$1 AND f\.user_id = \$2 AND f\.status = 'finished'\s+ORDER BY f\.revision_number DESC LIMIT 1\)/);
  assert.match(REVISION_PRUNE_SQL, /ORDER BY r\.revision_number DESC\s+OFFSET \$3/);
});

test("M3: a parent link joins two rows of the same person only", () => {
  assert.match(ARTIFACT_SET_PARENT_SQL, /a\.user_id = \$3/);
  assert.match(ARTIFACT_SET_PARENT_SQL, /p\.user_id = \$3/);
  assert.match(ARTIFACT_SET_PARENT_SQL, /a\.parent_artifact_id IS NULL/);
});

test("L1 and L7: the migration names the real lock and the data left behind", () => {
  assert.match(MIG, /ACCESS EXCLUSIVE/);
  assert.doesNotMatch(MIG, /SHARE lock \(writes wait; reads do not\)/);
  assert.match(MIG, /--\s+UPDATE refinery_artifact SET content = content - '_revision' WHERE content \? '_revision';/);
});
