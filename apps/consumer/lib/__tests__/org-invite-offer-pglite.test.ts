/**
 * Real SQL for the Invited list and resend once offers share it (security
 * review 3, SF-8; CRM re-check): an open offer and a new invite are listed
 * alike, and a resend inside the day is refused with one message for both.
 * Skipped unless SMR_PGLITE_DIR points at a node_modules folder holding
 * @electric-sql/pglite (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PENDING_INVITE_LIST_SQL, RESEND_TOO_SOON, touchOrgInviteResend } from "@crucible/core/src/orgInvite";

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, "@electric-sql/pglite")) ? "set SMR_PGLITE_DIR to run the pglite invite test" : false;
const MIG = join(__dirname, "..", "..", "..", "..", "packages", "core", "migrations") + "/";

test("offers and invites: one list shape, one resend window, one refusal", { skip }, async () => {
  const { PGlite } = await import(join(dir!, "@electric-sql/pglite/dist/index.js"));
  const { pgcrypto } = await import(join(dir!, "@electric-sql/pglite/dist/contrib/pgcrypto.js"));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 97).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, "utf8") + ";COMMIT;"); }
    catch { await db.exec("ROLLBACK").catch(() => {}); }
  }
  const q = async (t: string, p: unknown[] = []) => (await db.query(t, p)).rows as Record<string, any>[];
  const deps = { getOne: async <T,>(t: string, p: unknown[] = []) => ((await q(t, p))[0] ?? null) as T | null };
  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const U = { owner: id(1), offered: id(2), shell: id(3), joined: id(4), oldOffer: id(5), oldShell: id(6) };
  for (const [k, u] of Object.entries(U)) await q(`INSERT INTO users(id, email, name, tier) VALUES ($1, $2, $3, 'client')`, [u, `${k}@x.test`, `Own ${k}`]);
  // Accounts that have signed in: the offered ones and the joined invitee.
  await q(`UPDATE users SET "emailVerified" = now() WHERE id IN ($1, $2, $3, $4)`, [U.owner, U.offered, U.joined, U.oldOffer]);
  const org = (await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, max_redemptions) VALUES ('PGINV0001', 'PG inv', 'client', $1, true, 5) RETURNING id`, [U.owner]))[0].id;
  const add = (u: string, typed: string, status: string | null, ago: string) =>
    q(`INSERT INTO org_invite (access_code_id, user_id, invited_by, invited_name, invited_email, offer_status, last_sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() - $7::interval)`, [org, u, U.owner, typed, `${typed.toLowerCase().replace(/ /g, "")}@typed.test`, status, ago]);
  await add(U.offered, "Typed Offer", "offered", "5 minutes");
  await add(U.shell, "Typed Shell", null, "5 minutes");
  await add(U.joined, "Typed Joined", null, "5 minutes");
  await add(U.oldOffer, "Old Offer", "offered", "25 hours");
  await add(U.oldShell, "Old Shell", null, "25 hours");

  // The list: both open kinds, the joined invitee not; an offer shows what the org typed, never the account's own name.
  const list = await q(PENDING_INVITE_LIST_SQL, [org]);
  const byId = new Map(list.map((r) => [r.user_id, r]));
  assert.deepEqual([...byId.keys()].sort(), [U.offered, U.shell, U.oldOffer, U.oldShell].sort());
  assert.equal(byId.get(U.offered)!.name, "Typed Offer");
  assert.equal(byId.get(U.offered)!.email, "typedoffer@typed.test");
  assert.deepEqual(Object.keys(byId.get(U.offered)!).sort(), Object.keys(byId.get(U.shell)!).sort());

  // Too early: the same answer for an offer and an invite.
  const early = [await touchOrgInviteResend(org, U.offered, deps), await touchOrgInviteResend(org, U.shell, deps)];
  assert.deepEqual(early[0], { ok: false, error: RESEND_TOO_SOON });
  assert.deepEqual(early[1], early[0]);

  // After the day: both go, each as its own kind of email.
  const late = [await touchOrgInviteResend(org, U.oldOffer, deps), await touchOrgInviteResend(org, U.oldShell, deps)];
  assert.deepEqual(late[0], { ok: true, email: "oldOffer@x.test", name: "Old Offer", offer: true });
  assert.deepEqual(late[1], { ok: true, email: "oldShell@x.test", name: "Own oldShell", offer: false });
  // And a second click right after is refused alike.
  assert.deepEqual(await touchOrgInviteResend(org, U.oldOffer, deps), early[0]);
  assert.deepEqual(await touchOrgInviteResend(org, U.oldShell, deps), early[0]);
  const counts = await q(`SELECT user_id, send_count FROM org_invite WHERE user_id IN ($1, $2) ORDER BY user_id`, [U.oldOffer, U.oldShell]);
  assert.deepEqual(counts.map((r) => Number(r.send_count)), [2, 2]);

  // A joined invitee is not resendable.
  const j = await touchOrgInviteResend(org, U.joined, deps);
  assert.equal(j.ok, false);
  assert.notEqual((j as { error: string }).error, RESEND_TOO_SOON);
});
