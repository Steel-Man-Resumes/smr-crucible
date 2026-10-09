/**
 * Saved record checks (D11): sealing and binding, pure (no DB). The PGlite
 * suite runs the SQL constants against migration 079. Invented data only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decryptJSON, decryptString } from "../crypto";
import {
  recordCheckAad,
  sealRecordCheck,
  RECORD_CHECK_INSERT_SQL,
  RECORD_CHECK_LIST_SQL,
  RECORD_CHECK_DELETE_ONE_SQL,
  RECORD_CHECK_DELETE_ALL_SQL,
  RECORD_CHECK_CONSENT_LAYER,
} from "../recordCheck";
import { consentDefaultFor } from "../consent";
import { RLS_PROTECTED_TABLES } from "../rlsHealth";

const KEY = Buffer.alloc(32, 7).toString("base64");
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const ROW = "00000000-0000-4000-8000-00000000c0c0";
const OFFENSE = "zorbin fraud felony, 2014";

test("seal: nothing typed is readable in what is stored", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = KEY;
  const s = sealRecordCheck(A, ROW, { job: "quillwright license", checklist: { steps: ["Find the board"] } }, OFFENSE);
  const stored = JSON.stringify(s);
  assert.ok(!/zorbin|quillwright|Find the board/i.test(stored));
  assert.equal(decryptString(s.offenseSealed!, recordCheckAad(A, ROW, "offense")), OFFENSE);
  assert.equal(decryptJSON<{ job: string }>(s.checklistSealed, recordCheckAad(A, ROW, "checklist")).job, "quillwright license");
});

test("seal: no offense passed, none stored", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = KEY;
  const s = sealRecordCheck(A, ROW, { job: "x", checklist: {} }, null);
  assert.equal(s.offenseSealed, null);
});

test("seal: a sealed value will not open under another person, row or field", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = KEY;
  const s = sealRecordCheck(A, ROW, { job: "x", checklist: {} }, OFFENSE);
  assert.throws(() => decryptString(s.offenseSealed!, recordCheckAad(B, ROW, "offense")));
  assert.throws(() => decryptString(s.offenseSealed!, recordCheckAad(A, "00000000-0000-4000-8000-00000000d0d0", "offense")));
  assert.throws(() => decryptString(s.offenseSealed!, recordCheckAad(A, ROW, "checklist")));
});

test("SQL: every statement is scoped to the owner", () => {
  assert.match(RECORD_CHECK_INSERT_SQL, /INSERT INTO record_check_saved \(id, user_id, state, checklist_sealed, offense_sealed\)/);
  assert.match(RECORD_CHECK_LIST_SQL, /WHERE user_id = \$1/);
  assert.match(RECORD_CHECK_DELETE_ONE_SQL, /WHERE id = \$1 AND user_id = \$2/);
  assert.match(RECORD_CHECK_DELETE_ALL_SQL, /WHERE user_id = \$1/);
});

test("consent layer: declined by default, table on the protected list", () => {
  assert.equal(consentDefaultFor(RECORD_CHECK_CONSENT_LAYER), "declined");
  assert.ok((RLS_PROTECTED_TABLES as readonly string[]).includes("record_check_saved"));
});

test("recordCheck.ts reads and writes only as the owner", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "recordCheck.ts"), "utf8");
  assert.ok(!/(?<![\w.])(query|getOne|insert)\s*(<[^>(]*>)?\s*\(/.test(src.replace(/queryAsUser/g, "")), "no unscoped helper");
  assert.ok(/queryAsUser/.test(src));
});
