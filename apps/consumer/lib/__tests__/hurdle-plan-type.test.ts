/**
 * Fix 2026-10-24: a hurdle plan without the record hurdle saves as its own
 * artifact type (hurdle_plan), so it never becomes "the disclosure plan".
 * Repro on production: a transport + schedule plan saved as a script-less
 * disclosure_plan, and /api/user/context then showed no script although the
 * record plan from the day before still held one.
 *
 * The pglite part runs the real SQL against migrations 001-098 and is skipped
 * unless SMR_PGLITE_DIR points at a node_modules folder holding pglite.
 */
import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { INITIAL_STATE, plannerReducer, type PlannerState, type PlannerAction } from "../hurdles/reducer";
import { buildHurdlePlan, buildSavePayload, newestRestorablePlan, savedPlanType } from "../hurdles/plan";
import { disclosurePlanContext, LATEST_DISCLOSURE_PLAN_SQL, LATEST_DISCLOSURE_SCRIPT_SQL, type DisclosureRow } from "../disclosure-context";

const run = (actions: PlannerAction[], from: PlannerState = INITIAL_STATE) => actions.reduce(plannerReducer, from);
const pick = (...hurdles: string[]) => hurdles.map((h) => ({ type: "toggle", hurdle: h }) as PlannerAction);
const ans = (nodeId: string, ...choices: string[]): PlannerAction => ({ type: "answer", nodeId, choices });
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const opts = { summaries: {}, strippedCount: 0, wording: "off", targetJob: "Production Supervisor" };

const transportOnly = () => run([...pick("transport", "schedule"), { type: "start" }, ans("transport.what", "ride"), ans("transport.backup", "no")]);
const withRecord = () => run([...pick("record", "transport"), { type: "start" }, ans("record.where", "interview"), ans("record.raise", "wait")]);

/** Yesterday's record conversation plan, saved before B5 with its script. */
const legacy: DisclosureRow = {
  target_context: { targetJob: "Production Supervisor / Shift Lead" },
  content: { script: "I want to be upfront with you about my record.", timing_advice: "You picked the interview to bring it up.", tips: [] },
  created_at: "2026-10-23T16:25:44.878Z",
};

describe("which artifact a plan becomes", () => {
  it("a plan without the record hurdle is a hurdle_plan, never a disclosure_plan", () => {
    const st = transportOnly();
    const plan = buildHurdlePlan(st);
    assert.equal(plan.record, null);
    assert.equal(savedPlanType(plan), "hurdle_plan");
    const payload = buildSavePayload(plan, st, opts);
    assert.equal(payload.type, "hurdle_plan");
    assert.equal(payload.content.recordPlanned, false);
    assert.ok(payload.content.hurdlePlan.selected.includes("transport"));
  });
  it("a plan with the record conversation is the disclosure_plan, still with no record words", () => {
    const st = withRecord();
    const payload = buildSavePayload(buildHurdlePlan(st), st, opts);
    assert.equal(payload.type, "disclosure_plan");
    assert.equal(payload.content.recordPlanned, true);
    assert.equal(payload.content.script, null);
    assert.equal(payload.content.timing_advice, null);
    assert.ok(!payload.content.hurdlePlan.selected.includes("record"));
  });
  it("the not-sure path that turns up a background check plans the record conversation", () => {
    const st = run([...pick("not_sure"), { type: "start" }, ans("not_sure.signs", "check", "ride")]);
    assert.equal(savedPlanType(buildHurdlePlan(st)), "disclosure_plan");
  });
});

describe("the disclosure plan in the user context", () => {
  it("a saved hurdle plan never changes which disclosure plan the context returns", () => {
    const before = disclosurePlanContext(legacy, legacy);
    // A hurdle_plan save adds no disclosure_plan row, so both queries return the same rows.
    const st = transportOnly();
    assert.notEqual(buildSavePayload(buildHurdlePlan(st), st, opts).type, "disclosure_plan");
    const after = disclosurePlanContext(legacy, legacy);
    assert.deepEqual(after, before);
    assert.equal(after.scriptExcerpt, legacy.content!.script);
    assert.equal(after.timingAdvice, legacy.content!.timing_advice);
  });
  it("a newer record plan without stored words keeps the older saved script, dated", () => {
    const st = withRecord();
    const p = buildSavePayload(buildHurdlePlan(st), st, { ...opts, now: "2026-10-24T15:20:40.000Z" });
    const newer: DisclosureRow = { target_context: p.targetContext, content: p.content, created_at: "2026-10-24T15:20:40.000Z" };
    const ctx = disclosurePlanContext(newer, legacy);
    assert.equal(ctx.exists, true);
    assert.equal(ctx.completedAt, newer.created_at);
    assert.equal(ctx.targetJob, "Production Supervisor");
    assert.equal(ctx.scriptExcerpt, legacy.content!.script);
    assert.equal(ctx.scriptSavedAt, legacy.created_at);
  });
  it("no plan at all is exists false; a plan with no script anywhere has no excerpt", () => {
    assert.deepEqual(disclosurePlanContext(null, null), { exists: false });
    const bare: DisclosureRow = { target_context: {}, content: { script: null, timing_advice: null }, created_at: "2026-10-24T00:00:00Z" };
    const ctx = disclosurePlanContext(bare, null);
    assert.equal(ctx.scriptExcerpt, null);
    assert.equal(ctx.scriptSavedAt, null);
  });
});

describe("restore on the planner page", () => {
  it("offers the newest saved plan of either kind, so a record plan still restores", () => {
    const rec = withRecord(), hp = transportOnly();
    const recRow = { created_at: "2026-10-24T16:00:00Z", content: buildSavePayload(buildHurdlePlan(rec), rec, opts).content };
    const hpRow = { created_at: "2026-10-24T15:00:00Z", content: buildSavePayload(buildHurdlePlan(hp), hp, opts).content };
    assert.deepEqual(newestRestorablePlan([hpRow, recRow])!.selected, recRow.content.hurdlePlan.selected);
    assert.deepEqual(newestRestorablePlan([{ ...hpRow, created_at: "2026-10-25T00:00:00Z" }, recRow])!.selected, hpRow.content.hurdlePlan.selected);
    // A pre-B5 plan has no hurdlePlan to restore; nothing is invented.
    assert.equal(newestRestorablePlan([{ created_at: legacy.created_at, content: legacy.content }, null]), null);
  });
  it("the page asks for both kinds", () => {
    const page = read("../../app/(dashboard)/dashboard/disclosure/page.tsx");
    assert.match(page, /SAVED_PLAN_TYPES\.map/);
    assert.match(page, /newestRestorablePlan\(/);
    assert.doesNotMatch(page, /type=disclosure_plan&limit=1/);
  });
});

describe("progression and staff signals ignore hurdle plans", () => {
  it("disclosureComplete, the progress event, the job link and the staff view read disclosure_plan only", () => {
    const profile = read("../../../../packages/core/src/getUserProfile.ts");
    assert.match(profile, /FILTER \(WHERE artifact_type = 'disclosure_plan'\) AS disclosure_count/);
    const route = read("../../app/api/artifacts/route.ts");
    assert.match(route, /if \(body\.type === "disclosure_plan"\) \{\s*await recordProgressEvent\(userId, "disclosure_plan_created"/);
    const link = route.slice(route.indexOf("APPLICATION_LINK_COLUMN"), route.indexOf("};", route.indexOf("APPLICATION_LINK_COLUMN")));
    assert.ok(!link.includes("hurdle_plan"), "a hurdle plan never sets disclosure_plan_id on a job");
    const next = route.slice(route.indexOf("NEXT_STEP_RELEVANT"), route.indexOf(";", route.indexOf("NEXT_STEP_RELEVANT")));
    assert.ok(!next.includes("hurdle_plan"));
    assert.match(route, /"hurdle_plan",/); // accepted by POST and GET ?type=
    const staff = read("../../../../packages/core/migrations/060_participant_tables_rls.sql");
    assert.match(staff, /ra\.artifact_type = 'disclosure_plan'\) AS has_disclosure_plan/);
    const meter = read("../steelman/read.ts");
    assert.match(meter, /artifact_type='disclosure_plan' AND NOT is_demo/);
  });
  it("the Library lists and renders hurdle plans", () => {
    const vault = read("../../app/(dashboard)/dashboard/vault/page.tsx");
    assert.match(vault, /\{ type: "hurdle_plan", label: "Hurdle Plans" \}/);
    assert.equal((vault.match(/case "hurdle_plan":/g) || []).length, 2);
    const mig = read("../../../../packages/core/migrations/098_hurdle_plan_artifact.sql");
    assert.match(mig, /'performer_resume', 'hurdle_plan'\]/);
  });
});

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, "@electric-sql/pglite")) ? "set SMR_PGLITE_DIR to run the pglite test" : false;
const MIG = new URL("../../../../packages/core/migrations/", import.meta.url).pathname;

test("real schema: a hurdle_plan saves, and the context and the disclosure count do not move", { skip }, async () => {
  const { PGlite } = await import(join(dir!, "@electric-sql/pglite/dist/index.js"));
  const { pgcrypto } = await import(join(dir!, "@electric-sql/pglite/dist/contrib/pgcrypto.js"));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
  const failed: string[] = [];
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x)).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, "utf8") + ";COMMIT;"); }
    catch { await db.exec("ROLLBACK").catch(() => {}); failed.push(f); }
  }
  assert.ok(!failed.includes("098_hurdle_plan_artifact.sql"), `098 must apply; failed: ${failed.join(", ")}`);
  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  const u = "00000000-0000-0000-0000-0000000000aa";
  await q("INSERT INTO users(id,email) VALUES ($1,$2)", [u, "a@x.test"]);
  const ins = (type: string, tc: unknown, content: unknown, at: string) =>
    q("INSERT INTO refinery_artifact(user_id,artifact_type,target_context,content,created_at) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5)", [u, type, JSON.stringify(tc), JSON.stringify(content), at]);
  const one = async (sql: string) => ((await q(sql, [u])).rows[0] ?? null) as DisclosureRow | null;
  const ctx = async () => disclosurePlanContext(await one(LATEST_DISCLOSURE_PLAN_SQL), await one(LATEST_DISCLOSURE_SCRIPT_SQL));
  const count = async () => Number(((await q("SELECT COUNT(*) FILTER (WHERE artifact_type = 'disclosure_plan') AS n FROM refinery_artifact WHERE user_id = $1", [u])).rows[0] as { n: number }).n);

  await ins("disclosure_plan", legacy.target_context, legacy.content, legacy.created_at);
  const before = await ctx();
  const countBefore = await count();
  const st = transportOnly();
  const p = buildSavePayload(buildHurdlePlan(st), st, opts);
  await ins(p.type, p.targetContext, p.content, "2026-10-24T15:20:40.871Z");
  assert.deepEqual(await ctx(), before);
  assert.equal(before.scriptExcerpt, legacy.content!.script);
  assert.equal(await count(), countBefore);
  // An unknown type is still refused by the widened CHECK.
  await assert.rejects(ins("not_a_type", {}, {}, "2026-10-24T16:00:00Z"));
  // A record plan saved after B5 is newer but holds no words: the script stays reachable.
  const rs = withRecord();
  const rp = buildSavePayload(buildHurdlePlan(rs), rs, opts);
  await ins(rp.type, rp.targetContext, rp.content, "2026-10-24T17:00:00Z");
  const later = await ctx();
  assert.equal(later.scriptExcerpt, legacy.content!.script);
  assert.equal(new Date(later.completedAt!).toISOString(), "2026-10-24T17:00:00.000Z");
  assert.equal(await count(), countBefore + 1);
});
