/**
 * Phase 5 R5.2, FU1: a 401 on the Forge upload from a half-finished sign-in
 * goes to the step it is waiting on and comes back to the file step, which
 * asks for the file once more. Nothing about the file is stored.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORGE_UPLOAD_PICK_AGAIN_MESSAGE,
  FORGE_UPLOAD_RETURN_PATH,
  FORGE_UPLOAD_SIGN_IN_MESSAGE,
  forgeUploadAuthAction,
  isUploadReturn,
} from "../forge-upload-error";
import { safeCallbackPath, safeLoginReturn } from "../session-policy";

const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(CONSUMER, p), "utf8");
const back = encodeURIComponent(FORGE_UPLOAD_RETURN_PATH);

describe("FU1: where a 401 on upload goes", () => {
  it("a pending second step goes to verification and back to the file step", () => {
    assert.deepEqual(
      forgeUploadAuthAction(401, { error: "Enter your two-step code to finish signing in.", mfaRequired: true }),
      { kind: "go", url: `/login/verify?callbackUrl=${back}` }
    );
  });

  it("the first-proof password choice is the same hold (mfaRequired) and goes the same way", () => {
    const a = forgeUploadAuthAction(401, { error: "Confirm your password to finish signing in.", mfaRequired: true });
    assert.equal(a?.kind, "go");
  });

  it("terms owed goes to the terms page and back", () => {
    assert.deepEqual(forgeUploadAuthAction(401, { termsRequired: true }), { kind: "go", url: `/login/terms?callbackUrl=${back}` });
  });

  it("signed out with the wall up goes to the Forge sign-in and back", () => {
    assert.deepEqual(forgeUploadAuthAction(401, { signInRequired: true }), { kind: "go", url: `/login?from=forge&callbackUrl=${back}` });
  });

  it("a revoked session keeps the plain message; other statuses are not this path", () => {
    assert.deepEqual(forgeUploadAuthAction(401, { error: "Session revoked" }), { kind: "message", message: FORGE_UPLOAD_SIGN_IN_MESSAGE });
    assert.deepEqual(forgeUploadAuthAction(401, null), { kind: "message", message: FORGE_UPLOAD_SIGN_IN_MESSAGE });
    assert.equal(forgeUploadAuthAction(413, { mfaRequired: true }), null);
  });

  it("the way back is a safe return the sign-in pages accept", () => {
    assert.equal(safeLoginReturn(FORGE_UPLOAD_RETURN_PATH), FORGE_UPLOAD_RETURN_PATH);
    assert.equal(safeCallbackPath(FORGE_UPLOAD_RETURN_PATH), FORGE_UPLOAD_RETURN_PATH, "the verify page keeps it");
    assert.equal(isUploadReturn("?upload=again"), true);
    assert.equal(isUploadReturn("?upload=nope"), false);
    assert.equal(isUploadReturn(""), false);
  });

  it("the prompt is plain, with no dash", () => {
    assert.match(FORGE_UPLOAD_PICK_AGAIN_MESSAGE, /Pick your file again/);
    assert.doesNotMatch(FORGE_UPLOAD_PICK_AGAIN_MESSAGE, /[–—]|--/);
  });
});

describe("FU1: the file step uses it", () => {
  const page = read("app/(forge)/resume/page.tsx");
  it("a 401 that names a step navigates there instead of showing an error", () => {
    const at = page.indexOf("forgeUploadAuthAction(res.status, data)");
    assert.ok(at > 0);
    assert.ok(page.indexOf('window.location.assign(next.url)', at) > at);
    assert.ok(page.indexOf("window.location.assign(next.url)", at) < page.indexOf("setUploadError(forgeUploadErrorMessage", at));
  });
  it("coming back opens the file step and asks for the file again", () => {
    assert.match(page, /if \(typeof window === "undefined" \|\| !isUploadReturn\(window\.location\.search\)\) return;\s*setActivePath\("upload"\);\s*setPickAgain\(true\);/);
    assert.match(page, /data-testid="upload-pick-again"/);
  });
  it("nothing about the file is stored for the trip", () => {
    const fn = page.slice(page.indexOf("const handleFile = useCallback"), page.indexOf("const handleDrop"));
    assert.doesNotMatch(fn, /localStorage|sessionStorage|indexedDB/);
  });
});
