/** Saved revisions must agree with the working document after retries and races. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { revisionContentHash, stableJson } from "@crucible/core/src/artifactRevision";
import { ARTIFACT_CONTENT_UPDATE_SQL } from "@crucible/core/src/refineryArtifact";
import { saveFinishRevision, type ArtifactLite } from "../revision-save";
import { saveCheckRevision } from "../revision-check";
import { artifactText, ensureExportRevision, withRevisionMarker } from "../revision-current";
import { resumeTextToDocument } from "../revision-to-doc";
import { fakeRevisionStore } from "./fixtures/fake-revision-store";
import { finishState, FIXTURE_USER, RESUME } from "./fixtures/revision-run";

const cutState = () => finishState({
  resumeText: RESUME.replace(", Inventory control", ""),
  keptTerms: [],
});

/**
 * Stateful writes and snapshot reads matter here: a recorder that returns
 * "updated" without changing content cannot reproduce a partial save.
 */
function world(initial: ArtifactLite[] = []) {
  const f = fakeRevisionStore(FIXTURE_USER, structuredClone(initial));
  let failure: "throw" | "not_found" | "locked" | "conflict" | null = null;
  let attempts = 0;
  let beforeWrite: (() => void | Promise<void>) | null = null;
  const insert = f.store.insertRevision;
  f.store.insertRevision = async (userId, input) => {
    const latest = f.revs.filter((r) => r.artifact_id === input.artifactId).at(-1);
    if (latest?.content_hash === revisionContentHash(input)) {
      return { status: "saved", revision: latest, reused: true };
    }
    return insert(userId, input);
  };
  f.store.getArtifact = async (userId, id) => userId === FIXTURE_USER
    ? structuredClone(f.arts.find((a) => a.id === id) ?? null)
    : null;
  f.store.listResumeArtifacts = async (userId) => userId === FIXTURE_USER
    ? structuredClone(f.arts)
    : [];
  f.store.updateArtifactContent = async (userId, id, content, expectedContent) => {
    attempts++;
    if (failure === "throw") throw new Error("Synthetic working-copy outage");
    if (failure) return failure;
    if (beforeWrite) {
      const run = beforeWrite;
      beforeWrite = null;
      await run();
    }
    const artifact = userId === FIXTURE_USER ? f.arts.find((a) => a.id === id) : null;
    if (!artifact) return "not_found";
    if (artifact.is_locked) return "locked";
    // JSONB compares object content independently of key insertion order.
    if (expectedContent !== undefined && stableJson(artifact.content) !== stableJson(expectedContent)) return "conflict";
    artifact.content = structuredClone(content);
    return "updated";
  };
  return {
    ...f,
    fail(value: typeof failure) { failure = value; },
    attempts: () => attempts,
    beforeWrite(run: () => void | Promise<void>) { beforeWrite = run; },
  };
}

const save = (f: ReturnType<typeof world>, state = finishState()) =>
  saveFinishRevision(FIXTURE_USER, state, { source: "forge_finish" }, f.store);

test("a failed finish write is retryable; retry reuses the revision and exports the cut page", async () => {
  const f = world();
  assert.ok((await save(f)).ok);
  f.fail("throw");
  assert.deepEqual(await save(f, cutState()), { ok: false, status: 503, reason: "working_copy_not_saved" });
  assert.equal(f.revs.length, 2, "the cut revision was stored before the working-copy write failed");
  assert.match(artifactText(f.arts[0].content), /Inventory control/);

  f.fail(null);
  const before = f.attempts();
  const retried = await save(f, cutState());
  assert.ok(retried.ok);
  assert.equal(retried.revision.reused, true);
  assert.equal(f.revs.length, 2, "retry must not manufacture another version");
  assert.equal(f.attempts() - before, 1);
  const exported = await ensureExportRevision(FIXTURE_USER, f.arts[0].id, f.store);
  assert.ok(exported.ok);
  assert.equal(exported.revision.id, retried.revision.id);
  assert.doesNotMatch(exported.revision.resume_text, /Inventory control/);
  assert.doesNotMatch(artifactText(f.arts[0].content), /Inventory control/);
});

test("check-and-finish retries its pending cut without demanding a new model check", async () => {
  const f = world();
  assert.ok((await save(f)).ok);
  const artifactId = f.arts[0].id;
  // A stored, server-verified check for this artifact; no provider is called.
  (f.revs[0].evidence as Record<string, unknown>).runId = `artifact:${artifactId}`;
  f.fail("throw");
  assert.deepEqual(await saveCheckRevision(FIXTURE_USER, artifactId, cutState(), f.store),
    { ok: false, status: 503, reason: "working_copy_not_saved" });

  f.fail(null);
  const before = f.attempts();
  const retried = await saveCheckRevision(FIXTURE_USER, artifactId, cutState(), f.store);
  assert.ok(retried.ok);
  assert.equal(retried.revision.reused, true);
  assert.equal(f.attempts() - before, 1);
  const exported = await ensureExportRevision(FIXTURE_USER, artifactId, f.store);
  assert.ok(exported.ok);
  assert.equal(exported.revision.id, retried.revision.id);
  assert.doesNotMatch(exported.revision.resume_text, /Inventory control/);
});

test("export repairs a failed first finish over an untouched derived artifact", async () => {
  const document = resumeTextToDocument(RESUME) as unknown as Record<string, unknown>;
  const f = world([{
    id: "00000000-0000-4000-8000-000000000099",
    artifact_type: "resume",
    target_context: { source: "forge" },
    content: withRevisionMarker(document, "", { kind: "derived" }),
  }]);
  f.fail("throw");
  assert.deepEqual(await save(f, cutState()), { ok: false, status: 503, reason: "working_copy_not_saved" });
  f.fail(null);
  const exported = await ensureExportRevision(FIXTURE_USER, f.arts[0].id, f.store);
  assert.ok(exported.ok);
  assert.equal(f.revs.length, 1, "the stale derived copy must not become a new editor revision");
  assert.equal(exported.revision.id, f.revs[0].id);
  assert.doesNotMatch(exported.revision.resume_text, /Inventory control/);
  assert.doesNotMatch(artifactText(f.arts[0].content), /Inventory control/);
});

test("finish save preserves a locked baseline while saving the adjacent revision", async () => {
  const f = world();
  assert.ok((await save(f)).ok);
  f.arts[0].is_locked = true;
  const original = structuredClone(f.arts[0].content);
  const before = f.attempts();
  assert.ok((await save(f, cutState())).ok);
  assert.deepEqual(f.arts[0].content, original);
  assert.equal(f.attempts(), before, "do not try to replace the approved baseline");
  assert.doesNotMatch(f.revs.at(-1)!.resume_text, /Inventory control/);
});

test("finish save preserves intentional Refinery changes with valid or invalidated markers", async () => {
  for (const markAsEdit of [true, false]) {
    const f = world();
    assert.ok((await save(f)).ok);
    const doc = f.arts[0].content as Record<string, unknown>;
    doc.summary = "Available for Saturday shifts.";
    if (markAsEdit) {
      f.arts[0].content = withRevisionMarker(doc, f.revs[0].id, { formatted: artifactText(doc), kind: "edit" });
    }
    const original = artifactText(f.arts[0].content);
    const result = await save(f, cutState());
    assert.ok(result.ok);
    assert.equal(result.revision.accountCopy, "kept_refinery");
    // A repair may add a revision marker; visible words must not change.
    assert.equal(artifactText(f.arts[0].content), original);
    assert.match(original, /Saturday shifts/);
  }
});

test("finish CAS refuses an editor change arriving after its snapshot", async () => {
  const f = world();
  assert.ok((await save(f)).ok);
  f.beforeWrite(() => {
    (f.arts[0].content as Record<string, unknown>).summary = "Another tab saved Saturday availability.";
  });
  assert.deepEqual(await save(f, cutState()), { ok: false, status: 503, reason: "working_copy_not_saved" });
  assert.match(artifactText(f.arts[0].content), /Saturday availability/);
  assert.doesNotMatch(f.revs.at(-1)!.resume_text, /Inventory control/, "the cut revision remains recoverable");
});

test("a delayed older finish writer cannot overwrite a newer completed save", { timeout: 5000 }, async () => {
  const f = world();
  assert.ok((await save(f)).ok);
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { started = resolve; });
  f.beforeWrite(() => { started(); return blocked; });
  const older = save(f, cutState());
  await ready;
  try {
    const newer = await save(f, finishState({
      resumeText: RESUME.replace(", Inventory control", "").replace(", Vegetable prep", ""),
      keptTerms: [],
    }));
    assert.ok(newer.ok);
  } finally {
    release();
  }
  assert.deepEqual(await older, { ok: false, status: 503, reason: "working_copy_not_saved" });
  assert.doesNotMatch(artifactText(f.arts[0].content), /, Vegetable prep/);
});

test("CAS uses the actual UPDATE predicate with owner and baseline protection", () => {
  const sql = ARTIFACT_CONTENT_UPDATE_SQL("", 4);
  assert.match(sql, /WHERE id = \$2 AND user_id = \$3 AND is_locked = false/);
  assert.match(sql, /artifact_type NOT IN/);
  assert.match(sql, /AND content IS NOT DISTINCT FROM \$4::jsonb\s+RETURNING/);
  const withScaffold = ARTIFACT_CONTENT_UPDATE_SQL(", scaffold_level = $4", 5);
  assert.match(withScaffold, /scaffold_level = \$4/);
  assert.match(withScaffold, /AND content IS NOT DISTINCT FROM \$5::jsonb\s+RETURNING/);
  assert.doesNotMatch(ARTIFACT_CONTENT_UPDATE_SQL(""), /IS NOT DISTINCT FROM/);
});

test("returned write failures cannot masquerade as a successful finish save", async () => {
  for (const status of ["not_found", "conflict", "locked"] as const) {
    const f = world();
    assert.ok((await save(f)).ok);
    f.fail(status);
    assert.deepEqual(await save(f, cutState()), {
      ok: false,
      status: status === "locked" ? 409 : 503,
      reason: status === "locked" ? "locked" : "working_copy_not_saved",
    });
  }
});


test("an unchanged historical finished revision is downgraded on export when its check was incomplete", async () => {
  const f = world();
  assert.ok((await save(f)).ok);
  f.revs[0].status = "finished";
  (f.revs[0].evidence as Record<string, unknown>).grounding = { verifierRan: false };
  const exported = await ensureExportRevision(FIXTURE_USER, f.arts[0].id, f.store);
  assert.ok(exported.ok);
  assert.equal(exported.revision.status, "draft");
  assert.match(JSON.stringify(exported.revision.open_items), /truth check again/);
  assert.equal(f.revs[0].status, "finished", "historical row remains intact");
});
