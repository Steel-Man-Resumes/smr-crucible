/**
 * Saved record checks (D11): sealing and binding, pure (no DB). The PGlite
 * suite runs the SQL constants against migration 079. Invented data only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decryptJSON, encryptJSON } from "../crypto";
import {
  openRecordCheckRow,
  recordCheckAad,
  sealRecordCheck,
  RECORD_CHECK_INSERT_SQL,
  RECORD_CHECK_LIST_SQL,
  RECORD_CHECK_EXPORT_SQL,
  RECORD_CHECK_DELETE_ONE_SQL,
  RECORD_CHECK_DELETE_ALL_SQL,
  RECORD_CHECK_REVOKE_SQL,
  RECORD_CHECK_CONSENT_LAYER,
  RECORD_CHECK_MAX_SAVED,
  RECORD_CHECK_TX,
  type RecordCheckPicks,
} from "../recordCheck";
import { consentDefaultFor } from "../consent";
import { RLS_PROTECTED_TABLES } from "../rlsHealth";

const KEY = Buffer.alloc(32, 7).toString("base64");
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const ROW = "00000000-0000-4000-8000-00000000c0c0";
const PICKS: RecordCheckPicks = { v: 2, sourceIds: ["oh-licensing-law"], questionIds: ["q-pre-1"], generatedBy: "ai" };
const TYPED = { job: "quillwright license", offense: "zorbin fraud felony, 2014" };

test("seal: ids sealed; nothing typed is stored unless passed", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = KEY;
  const plain = sealRecordCheck(A, ROW, PICKS, null);
  assert.equal(plain.typedSealed, null);
  assert.deepEqual(decryptJSON(plain.picksSealed, recordCheckAad(A, ROW, "picks")), PICKS);
  const kept = sealRecordCheck(A, ROW, PICKS, TYPED);
  assert.ok(!/zorbin|quillwright|oh-licensing-law|q-pre-1/i.test(JSON.stringify(kept)));
  assert.deepEqual(decryptJSON(kept.typedSealed!, recordCheckAad(A, ROW, "typed")), TYPED);
});

test("seal: a sealed value will not open under another person, row or field", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = KEY;
  const s = sealRecordCheck(A, ROW, PICKS, TYPED);
  assert.throws(() => decryptJSON(s.typedSealed!, recordCheckAad(B, ROW, "typed")));
  assert.throws(() => decryptJSON(s.typedSealed!, recordCheckAad(A, "00000000-0000-4000-8000-00000000d0d0", "typed")));
  assert.throws(() => decryptJSON(s.typedSealed!, recordCheckAad(A, ROW, "picks")));
});

test("open: a row that cannot be opened throws (callers count and skip it)", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = KEY;
  const s = sealRecordCheck(A, ROW, PICKS, null);
  const ok = openRecordCheckRow(A, { id: ROW, state: "OH", picks_sealed: s.picksSealed, typed_sealed: null, created_at: "t" });
  assert.equal(ok.keptTyped, false);
  const wrong = encryptJSON(PICKS, "some-other-binding");
  assert.throws(() => openRecordCheckRow(A, { id: ROW, state: "OH", picks_sealed: wrong, typed_sealed: null, created_at: "t" }));
});

test("SQL: owner-scoped, conditional on the current yes and the cap, no export limit", () => {
  assert.match(RECORD_CHECK_INSERT_SQL, /WHERE EXISTS \(SELECT 1 FROM consumer_consent c[\s\S]*consent_text_version = \$6[\s\S]*FOR SHARE\)/);
  assert.match(RECORD_CHECK_INSERT_SQL, /< \$7/);
  assert.equal(RECORD_CHECK_MAX_SAVED, 50);
  assert.ok(!/sealed/.test(RECORD_CHECK_LIST_SQL.replace("typed_sealed IS NOT NULL", "")), "the list reads nothing sealed");
  assert.ok(!/LIMIT/i.test(RECORD_CHECK_EXPORT_SQL));
  assert.match(RECORD_CHECK_DELETE_ONE_SQL, /WHERE id = \$1 AND user_id = \$2/);
  assert.match(RECORD_CHECK_DELETE_ALL_SQL, /WHERE user_id = \$1/);
  assert.match(RECORD_CHECK_REVOKE_SQL, /status = 'revoked', revoked_at = now\(\)/);
});

test("consent layer: declined by default, table on the protected list", () => {
  assert.equal(consentDefaultFor(RECORD_CHECK_CONSENT_LAYER), "declined");
  assert.ok((RLS_PROTECTED_TABLES as readonly string[]).includes("record_check_saved"));
});

test("recordCheck.ts reads and writes only as the owner; revoke is one transaction", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "recordCheck.ts"), "utf8");
  assert.ok(!/(?<![\w.])(query|getOne|insert)\s*(<[^>(]*>)?\s*\(/.test(src.replace(/queryAsUser/g, "")), "no unscoped helper");
  assert.match(src, /runAsUser<unknown\[\]\[\]>\(userId, \(c\) => \{[\s\S]*RECORD_CHECK_REVOKE_SQL[\s\S]*RECORD_CHECK_DELETE_ALL_SQL[\s\S]*RECORD_CHECK_REVOKE_EVENT_SQL/);
});

test("restricted grants list the saved table with no UPDATE", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "scripts", "lib", "restricted-grants.mjs"), "utf8");
  assert.match(src, /record_check_saved: \["SELECT", "INSERT", "DELETE"\]/);
});

test("isolation: save and revoke name READ COMMITTED instead of trusting the default (r2 N6)", () => {
  assert.deepEqual(RECORD_CHECK_TX, { isolationLevel: "ReadCommitted" });
  const src = readFileSync(join(import.meta.dirname, "..", "recordCheck.ts"), "utf8");
  const save = src.slice(src.indexOf("export async function saveRecordCheck"), src.indexOf("export async function listRecordCheckSummaries"));
  assert.match(save, /await writeAsOwner</, "the save insert runs through the pinned transaction");
  assert.ok(!/queryAsUser<[^>]*>\(userId, RECORD_CHECK_INSERT_SQL/.test(save));
  assert.match(src, /async function writeAsOwner[\s\S]*?RECORD_CHECK_TX\s*\)/);
  const revoke = src.slice(src.indexOf("export async function revokeRecordCheckConsent"), src.indexOf("export async function exportRecordChecks"));
  assert.match(revoke, /\}, RECORD_CHECK_TX\);/);
  // runAsUser hands the level to the driver's transaction.
  const db = readFileSync(join(import.meta.dirname, "..", "db.ts"), "utf8");
  assert.match(db, /client\.transaction\(queries, \{ isolationLevel: opts\.isolationLevel \}\)/);
});
