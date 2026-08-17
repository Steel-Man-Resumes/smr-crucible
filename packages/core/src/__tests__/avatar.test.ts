/**
 * Phase 7.7 avatar photo path -- pure adversarial tests (no DB).
 *
 * Covers: avatar kind validation (mirrors the migration 043 CHECK), the image
 * MIME allowlist + content-sniff (declared vs sniffed mismatch), selection
 * normalization (photoAssetId round-trips + illustrated default preserved), the
 * HEADSHOT_DAILY_CAP constant, and the usage-exclusion INVARIANT (headshot
 * uploads are excluded from the AI-usage display while headshot generation is
 * NOT). DB-backed ownership/IDOR is exercised live by scripts/verify-7-avatar.mjs
 * (a pure suite cannot touch R2/Postgres).
 *
 * Run: npm test  (node --import tsx --test, no extra deps)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AVATAR_ASSET_KINDS,
  AVATAR_MIME_ALLOWLIST,
  isAvatarAssetKind,
  isAllowedAvatarMime,
  normalizeAvatarMime,
  sniffAvatarMime,
  decideAvatarMime,
  MAX_PHOTO_BYTES,
  HEADSHOT_DAILY_CAP,
  HEADSHOT_GENERATE_ENDPOINT,
  HEADSHOT_UPLOAD_ENDPOINT,
} from "../avatarAssetShared";
import { normalizeAvatar, normalizePhotoAssetId } from "../uiPrefsShared";

// --- kind CHECK validation (mirrors the migration 043 CHECK) ---
test("avatar kind: the two kinds are exactly the CHECK set", () => {
  assert.deepEqual([...AVATAR_ASSET_KINDS].sort(), ["generated_headshot", "original_photo"]);
});

test("avatar kind: isAvatarAssetKind accepts only known keys", () => {
  assert.ok(isAvatarAssetKind("original_photo"));
  assert.ok(isAvatarAssetKind("generated_headshot"));
  assert.equal(isAvatarAssetKind("photo"), false);
  assert.equal(isAvatarAssetKind(""), false);
  assert.equal(isAvatarAssetKind(null), false);
  assert.equal(isAvatarAssetKind("ORIGINAL_PHOTO"), false); // case-sensitive
});

// --- MIME allowlist + sniff ---
test("avatar mime: allowlist is headshots-only (no pdf/gif/heic/office)", () => {
  assert.ok(isAllowedAvatarMime("image/jpeg"));
  assert.ok(isAllowedAvatarMime("image/png"));
  assert.ok(isAllowedAvatarMime("image/webp; charset=binary")); // params stripped
  assert.equal(isAllowedAvatarMime("application/pdf"), false);
  assert.equal(isAllowedAvatarMime("image/gif"), false);
  assert.equal(isAllowedAvatarMime("image/heic"), false);
  assert.equal(isAllowedAvatarMime(""), false);
  assert.equal(isAllowedAvatarMime(null), false);
});

test("normalizeAvatarMime strips parameters and lowercases", () => {
  assert.equal(normalizeAvatarMime("IMAGE/JPEG; charset=x"), "image/jpeg");
  assert.equal(normalizeAvatarMime(undefined), "");
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP"),
  Buffer.from([0, 0, 0, 0]),
]);
const GIF = Buffer.from("GIF89a....", "utf8");
const PDF = Buffer.from("%PDF-1.4\n...", "utf8");
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]); // "MZ" -- a PE header

test("sniffAvatarMime detects the three image signatures, rejects others", () => {
  assert.equal(sniffAvatarMime(PNG), "image/png");
  assert.equal(sniffAvatarMime(JPEG), "image/jpeg");
  assert.equal(sniffAvatarMime(WEBP), "image/webp");
  assert.equal(sniffAvatarMime(GIF), null); // gif is NOT allowlisted for headshots
  assert.equal(sniffAvatarMime(PDF), null);
  assert.equal(sniffAvatarMime(EXE), null);
});

test("decideAvatarMime: honest uploads pass", () => {
  assert.deepEqual(decideAvatarMime("image/png", PNG), { ok: true, mime: "image/png" });
  assert.deepEqual(decideAvatarMime("image/jpeg", JPEG), { ok: true, mime: "image/jpeg" });
  assert.deepEqual(decideAvatarMime("image/webp", WEBP), { ok: true, mime: "image/webp" });
});

test("decideAvatarMime: a mislabeled file is rejected (declared != sniffed)", () => {
  const r = decideAvatarMime("image/png", JPEG);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "content_type_mismatch");
});

test("decideAvatarMime: an executable disguised as an image is rejected (sniff fails)", () => {
  const r = decideAvatarMime("image/png", EXE);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "content_type_unrecognized");
});

test("decideAvatarMime: an unsupported declared type is rejected outright", () => {
  const r = decideAvatarMime("application/pdf", PDF);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "unsupported_type");
});

test("MAX_PHOTO_BYTES is 8 MB", () => {
  assert.equal(MAX_PHOTO_BYTES, 8 * 1024 * 1024);
});

test("AVATAR_MIME_ALLOWLIST has no duplicates", () => {
  assert.equal(new Set(AVATAR_MIME_ALLOWLIST).size, AVATAR_MIME_ALLOWLIST.length);
});

// --- selection normalization ---
const UUID = "11111111-2222-4333-8444-555555555555";

test("normalizePhotoAssetId: accepts a plausible UUID, rejects junk", () => {
  assert.equal(normalizePhotoAssetId(UUID), UUID);
  assert.equal(normalizePhotoAssetId(UUID.toUpperCase()), UUID); // lowercased
  assert.equal(normalizePhotoAssetId("not-a-uuid"), null);
  assert.equal(normalizePhotoAssetId(""), null);
  assert.equal(normalizePhotoAssetId(null), null);
  assert.equal(normalizePhotoAssetId(123), null);
  // A path-traversal-y string is not a UUID -> null (never trusted as a grant).
  assert.equal(normalizePhotoAssetId("../../etc/passwd"), null);
});

test("normalizeAvatar: photoAssetId round-trips on a valid choice", () => {
  const av = normalizeAvatar({ shape: "hex", color: "teal", accent: "ring", initial: "t", photoAssetId: UUID });
  assert.equal(av?.photoAssetId, UUID);
  assert.equal(av?.shape, "hex");
});

test("normalizeAvatar: illustrated default preserved when no photo is set", () => {
  const av = normalizeAvatar({ shape: "circle", color: "slate", accent: "solid", initial: "A" });
  assert.ok(av);
  assert.equal(av?.photoAssetId, null); // absent -> null, stays illustrated
});

test("normalizeAvatar: a garbage photoAssetId is dropped to null (no access via a forged id)", () => {
  const av = normalizeAvatar({ shape: "circle", color: "slate", accent: "solid", initial: "A", photoAssetId: "hacker" });
  assert.equal(av?.photoAssetId, null);
});

test("normalizeAvatar: a non-object stays null (backward compatible default)", () => {
  assert.equal(normalizeAvatar(null), null);
  assert.equal(normalizeAvatar(undefined), null);
  assert.equal(normalizeAvatar("nope"), null);
});

test("normalizeAvatar: an old stored choice with no photoAssetId still normalizes", () => {
  // Simulates a value written before Phase 7.7 added the field.
  const legacy = { shape: "square", color: "amber", accent: "corner", initial: "Z" };
  const av = normalizeAvatar(legacy);
  assert.ok(av);
  assert.equal(av?.shape, "square");
  assert.equal(av?.photoAssetId, null);
});

// --- daily-cap constant + usage-exclusion invariant ---
test("HEADSHOT_DAILY_CAP is 3", () => {
  assert.equal(HEADSHOT_DAILY_CAP, 3);
});

test("usage endpoints: generate counts toward AI display, upload does not", () => {
  // The invariant getUserDailyUsage relies on: uploads are excluded (name is
  // exactly the excluded string), generation is NOT (not prefixed vault_, not the
  // excluded upload string).
  assert.equal(HEADSHOT_UPLOAD_ENDPOINT, "headshot_upload"); // excluded by getUserDailyUsage
  assert.equal(HEADSHOT_GENERATE_ENDPOINT, "headshot_generate");
  assert.ok(!HEADSHOT_GENERATE_ENDPOINT.startsWith("vault_"));
  assert.notEqual(HEADSHOT_GENERATE_ENDPOINT, "headshot_upload");
});
