/**
 * Hotfix: a forge_session row that belongs to one account is never updated or
 * reassigned by another account's save. (Independent review 2026-10-10, A9.)
 * The behavior was also checked on a real Postgres engine (PGlite) outside the repo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORGE_SESSION_UPSERT_SQL, ownedSessionId } from "../forgeSession";

test("the conflict update only runs for an unowned row or the caller's own row", () => {
  const sql = FORGE_SESSION_UPSERT_SQL.replace(/\s+/g, " ");
  assert.match(sql, /ON CONFLICT \(session_id\) DO UPDATE SET/);
  assert.match(sql, /WHERE forge_session\.user_id IS NULL OR forge_session\.user_id = EXCLUDED\.user_id/);
  assert.match(sql, /user_id = COALESCE\(forge_session\.user_id, EXCLUDED\.user_id\)/, "an existing owner is kept");
  assert.match(sql, /RETURNING session_id/, "the caller can tell when nothing was saved");
});

test("a taken session id falls back to the caller's own namespaced id", () => {
  const id = ownedSessionId("2026-10-10T00:00:00.000Z", "00000000-0000-4000-8000-00000000000b");
  assert.equal(id, "2026-10-10T00:00:00.000Z#00000000-0000-4000-8000-00000000000b");
  assert.notEqual(id, ownedSessionId("2026-10-10T00:00:00.000Z", "00000000-0000-4000-8000-00000000000a"));
});
