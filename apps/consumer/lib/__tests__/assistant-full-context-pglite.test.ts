/**
 * Real SQL: the server-built assistant context (lib/assistant-full-context.ts)
 * read against migrations 001-099 in pglite, as a non-superuser role with
 * app.user_id set (RLS on). Lanes, resumes, the hurdle plan, the disclosure
 * plan and the meter come from the real statements; the record consent is the
 * consent module's own query at its current text version. Another person's
 * rows sit in the same tables and must never show.
 *
 * Skipped unless SMR_PGLITE_DIR points at a node_modules folder holding
 * @electric-sql/pglite. getUserProfile and getProgression need the core pool,
 * so the profile is a fixture here and progression is left unloaded.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LANE_LIST_SQL, RECENT_RESUMES_FOR_CONTEXT_SQL } from "@crucible/core";
import { LATEST_DISCLOSURE_PLAN_SQL, LATEST_DISCLOSURE_SCRIPT_SQL, type DisclosureRow } from "../disclosure-context";
import { RECORD_PLANNER_CONSENT_VERSION } from "../hurdles/consent-server";
import { loadUserFullContext, LATEST_HURDLE_PLAN_SQL, type FullContextLoaders, type ProfileLike, type LaneLike, type ResumeRow, type HurdlePlanRow } from "../assistant-full-context";
import { loadSteelMan, type RunAsUser } from "../steelman/read";
import { scoreOf, bandFor, isSteelMan } from "../steelman/score";
import { buildSystemPrompt, buildServerPartsSection } from "../assistant-prompt";
import { INITIAL_STATE, plannerReducer, type PlannerAction, type PlannerState } from "../hurdles/reducer";
import { buildHurdlePlan, buildSavePayload, recordAndSensitiveText } from "../hurdles/plan";

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, "@electric-sql/pglite")) ? "set SMR_PGLITE_DIR to run the pglite context test" : false;
const MIG = new URL("../../../../packages/core/migrations/", import.meta.url).pathname;
const CONSENT_SQL = "SELECT status, consent_text_version FROM consumer_consent WHERE user_id = $1 AND consent_layer = $2";

const runPlanner = (actions: PlannerAction[], from: PlannerState = INITIAL_STATE) => actions.reduce(plannerReducer, from);
const pick = (...hurdles: string[]) => hurdles.map((h) => ({ type: "toggle", hurdle: h }) as PlannerAction);
const ans = (nodeId: string, ...choices: string[]): PlannerAction => ({ type: "answer", nodeId, choices });

test("server-built context against the real schema: lanes, resumes, hurdle plan, consented record words, meter; RLS holds", { skip }, async () => {
  // The consent module's own query, pinned, so the fixture below runs the same read.
  assert.ok(readFileSync(new URL("../hurdles/consent-server.ts", import.meta.url), "utf8").includes(CONSENT_SQL));

  const { PGlite } = await import(join(dir!, "@electric-sql/pglite/dist/index.js"));
  const { pgcrypto } = await import(join(dir!, "@electric-sql/pglite/dist/contrib/pgcrypto.js"));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
  const failed: string[] = [];
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x)).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, "utf8") + ";COMMIT;"); }
    catch { await db.exec("ROLLBACK").catch(() => {}); failed.push(f); }
  }
  const needed = failed.filter((f) => f.startsWith("095_") || f.startsWith("098_"));
  assert.deepEqual(needed, [], `needed migrations failed: ${failed.join(", ")}`);
  await db.exec("CREATE ROLE tester NOSUPERUSER; GRANT USAGE ON SCHEMA public TO tester; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tester;");

  // One statement as the person: the same shape db.ts queryAsUser gives the loaders.
  const asUser = async <T,>(userId: string, text: string, params: unknown[]): Promise<T[]> => {
    await db.exec("BEGIN; SET LOCAL ROLE tester;");
    try {
      await db.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const out = (await db.query(text, params)).rows as T[];
      await db.exec("COMMIT");
      return out;
    } catch (e) { await db.exec("ROLLBACK"); throw e; }
  };
  const run: RunAsUser = async (userId, build) => {
    const tag = (s: TemplateStringsArray, ...v: unknown[]) => ({ text: s.reduce((a, x, i) => a + "$" + i + x), params: v });
    const qs = [tag`SELECT set_config('app.user_id', ${userId}, true)`, ...(build(tag) as Array<{ text: string; params: unknown[] }>)];
    const out: unknown[] = [];
    await db.exec("BEGIN; SET LOCAL ROLE tester;");
    try { for (const q of qs) out.push((await db.query(q.text, q.params)).rows); await db.exec("COMMIT"); } catch (e) { await db.exec("ROLLBACK"); throw e; }
    return out.slice(1);
  };

  const u = "00000000-0000-0000-0000-0000000000aa", other = "00000000-0000-0000-0000-0000000000bb";
  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  for (const id of [u, other]) await q("INSERT INTO users(id,email) VALUES ($1,$2)", [id, id + "@x.test"]);
  await q("INSERT INTO consumer_profile(user_id,forge_output,profile_data,preferences) VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb)", [u,
    JSON.stringify({ headline: "Production manager", skills: ["Forklift"], career_paths: ["Maintenance"] }),
    JSON.stringify({ goals: ["Employment"], masterDraft: { revision: 1, facts: [{ id: "f1", text: "fact", status: "confirmed", confirmedAt: "2026-10-24T14:00:00Z" }] } }),
    JSON.stringify({ jobFit: { noDriving: true } })]);
  await q("INSERT INTO consumer_consent(user_id,consent_layer,status,consent_text_version) VALUES ($1,'record_planner','granted',$2)", [u, RECORD_PLANNER_CONSENT_VERSION]);
  const lane = async (userId: string, name: string, target: string | null, archived = false) =>
    ((await q(`INSERT INTO career_lane(user_id,name,target_role,archived_at) VALUES ($1,$2,$3,${archived ? "now()" : "NULL"}) RETURNING id`, [userId, name, target])).rows[0] as { id: string }).id;
  const L1 = await lane(u, "Maintenance and facilities", "Maintenance technician");
  await lane(u, "Old lane", null, true);
  await lane(other, "Someone else's lane", "Dispatcher");
  const art = (userId: string, type: string, tc: unknown, content: unknown, at: string, laneId: string | null = null, demo = false) =>
    q("INSERT INTO refinery_artifact(user_id,artifact_type,target_context,content,created_at,lane_id,is_demo) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7) RETURNING id", [userId, type, JSON.stringify(tc), JSON.stringify(content), at, laneId, demo]);
  const R1 = ((await art(u, "resume", { targetJob: "Production Supervisor", targetCompany: "Acme", createdFrom: "job" }, {}, "2026-10-24T14:00:00Z", L1)).rows[0] as { id: string }).id;
  await art(u, "resume", { createdFrom: "forge" }, { meta: { targetJob: "Production Manager" } }, "2026-10-23T14:00:00Z");
  await art(u, "resume", { targetJob: "Example only" }, {}, "2026-10-25T00:00:00Z", null, true); // an example, never the person's
  await art(other, "resume", { targetJob: "Dispatcher" }, {}, "2026-10-24T15:00:00Z");
  const SCRIPT = "I want to be upfront with you about my record.";
  await art(u, "disclosure_plan", { targetJob: "Production Supervisor / Shift Lead" }, { script: SCRIPT, timing_advice: "You picked the interview to bring it up." }, "2026-10-23T16:25:44.878Z");
  await art(other, "disclosure_plan", { targetJob: "Dispatcher" }, { script: "Someone else's words about a record." }, "2026-10-24T16:00:00Z");
  const st = runPlanner([...pick("gaps", "transport"), { type: "start" }, ans("gaps.length", "1to3"), ans("gaps.filled", "inside", "family"), ans("gaps.inside", "no"),
    { type: "skip", nodeId: "gaps.proof" }, ans("gaps.asked", "no"), ans("gaps.tell", "nothing"), ans("transport.what", "ride"), ans("transport.backup", "no")]);
  const saved = buildSavePayload(buildHurdlePlan(st), st, { summaries: {}, strippedCount: 0, wording: "off", targetJob: "Production Supervisor", now: "2026-10-24T15:20:40.000Z" });
  assert.equal(saved.type, "hurdle_plan");
  await art(u, saved.type, saved.targetContext, saved.content, "2026-10-24T15:20:40.000Z");
  await q(`INSERT INTO artifact_revision(user_id,artifact_id,revision_number,source,resume_text,confirmed_credentials,defend_answers,checker_version,status,page_count,page_limit,content_hash)
    VALUES ($1,$2,1,'forge_finish','text','[]'::jsonb,$3::jsonb,'v1','finished',1,1,$4)`, [u, R1, JSON.stringify([{ line: "Line 1", answer: "a", verdict: "stands" }]), "a".repeat(64)]);

  const profile: ProfileLike = {
    name: "Jean", email: "a@x.test", city: "Milwaukee", state: "WI", tier: "client", readinessStage: "ready", barriers: ["criminal_record"],
    savedJobs: [{ id: "j1", jobTitle: "Production Supervisor", company: "Acme", status: "interviewing", followUpAt: null, resumeTailored: true }],
    hasDisclosurePlan: true, forgeComplete: true, interviewSessionCount: 0, applicationCount: 1, hasResumeTailoredToTarget: true,
  };
  const loaders = (impersonating = false): FullContextLoaders => ({
    profile: async () => profile,
    consumerProfile: async (id) => (await asUser<any>(id, "SELECT forge_output, profile_data, preferences FROM consumer_profile WHERE user_id = $1", [id]))[0] ?? null,
    resumes: (id) => asUser<ResumeRow>(id, RECENT_RESUMES_FOR_CONTEXT_SQL, [id]),
    disclosure: async (id) => ({
      latest: (await asUser<DisclosureRow>(id, LATEST_DISCLOSURE_PLAN_SQL, [id]))[0] ?? null,
      latestWithScript: (await asUser<DisclosureRow>(id, LATEST_DISCLOSURE_SCRIPT_SQL, [id]))[0] ?? null,
    }),
    recordConsent: async (id) => {
      const row = (await asUser<{ status: string; consent_text_version: string }>(id, CONSENT_SQL, [id, "record_planner"]))[0];
      return row?.status === "granted" && row.consent_text_version === RECORD_PLANNER_CONSENT_VERSION;
    },
    actingForSomeoneElse: async () => impersonating,
    lanes: (id) => asUser<LaneLike>(id, LANE_LIST_SQL, [id, true]),
    hurdlePlan: async (id) => (await asUser<HurdlePlanRow>(id, LATEST_HURDLE_PLAN_SQL, [id]))[0] ?? null,
    progression: async () => null,
    meter: async (id) => { const r = await loadSteelMan(id, run); const score = scoreOf(r.counts); return { counts: r.counts, score, band: bandFor(score, isSteelMan(r.counts)).label }; },
  });

  const ctx = (await loadUserFullContext(u, loaders()))!;
  assert.ok(ctx);
  // Lanes: the person's two, one archived; the other person's never.
  assert.deepEqual(ctx.lanes, { total: 2, open: 1, items: [{ id: L1, name: "Maintenance and facilities", target: "Maintenance technician", kind: "resume" }] });
  // Resumes: newest first, the example left out, the other person's left out.
  assert.deepEqual(ctx.resumes.map((r) => [r.targetJob, r.createdFrom]), [["Production Supervisor", "job"], ["Production Manager", "forge"]]);
  assert.equal(ctx.journey.onboardingState, "full_access");
  // Hurdle plan: saved hurdles, no record text.
  assert.equal(ctx.hurdlePlan?.exists, true);
  assert.equal(ctx.hurdlePlan?.targetJob, "Production Supervisor");
  assert.deepEqual(ctx.hurdlePlan?.hurdles?.map((h) => h.label).sort(), ["Gaps in my work history", "Getting to work"]);
  // Record words: present under the current consent.
  assert.equal(ctx.disclosurePlan.scriptExcerpt, SCRIPT);
  assert.equal(ctx.disclosurePlan.wordsWithheld, false);
  // Meter from the real tables.
  assert.equal(ctx.meter?.counts.resumes, 1);
  assert.equal(ctx.meter?.counts.lanes, 1);
  assert.equal(ctx.meter?.counts.facts, 1);
  assert.equal(ctx.meter?.counts.disclosure, 1);
  assert.ok((ctx.meter?.score ?? 0) > 0);
  assert.equal(ctx.progression, null);

  const prompt = buildSystemPrompt({ currentPage: "dashboard", userFullContext: ctx });
  for (const line of ["Name: Jean", '"Maintenance and facilities", aiming at Maintenance technician', "### HURDLE PLAN (saved 2026-10-24, for Production Supervisor)", "### STEEL MAN METER", SCRIPT.slice(0, 30)]) assert.ok(prompt.includes(line), line);
  const lower = prompt.toLowerCase();
  for (const leak of ["someone else", "dispatcher", "example only"]) assert.ok(!lower.includes(leak), `never the other person's or an example: ${leak}`);
  // The generated forbidden set over the server-built section (the base prompt's own copy mentions a felony in general terms).
  const section = buildServerPartsSection(ctx).join("\n").toLowerCase();
  assert.deepEqual(recordAndSensitiveText().filter((t) => section.includes(t.toLowerCase())), []);
  assert.ok(!lower.includes("time inside"));

  // Consent gate on the real row: acting for the person, a revoked yes, an old version. Each withholds the words; the plan still exists.
  const words = async (ld: FullContextLoaders) => { const c = (await loadUserFullContext(u, ld))!; return { excerpt: c.disclosurePlan.scriptExcerpt, withheld: c.disclosurePlan.wordsWithheld, exists: c.disclosurePlan.exists }; };
  assert.deepEqual(await words(loaders(true)), { excerpt: null, withheld: true, exists: true });
  await q("UPDATE consumer_consent SET status='revoked' WHERE user_id=$1 AND consent_layer='record_planner'", [u]);
  assert.deepEqual(await words(loaders()), { excerpt: null, withheld: true, exists: true });
  await q("UPDATE consumer_consent SET status='granted', consent_text_version='2026-01-01-v0' WHERE user_id=$1 AND consent_layer='record_planner'", [u]);
  assert.deepEqual(await words(loaders()), { excerpt: null, withheld: true, exists: true });
  await q("UPDATE consumer_consent SET consent_text_version=$2 WHERE user_id=$1 AND consent_layer='record_planner'", [u, RECORD_PLANNER_CONSENT_VERSION]);
  assert.equal((await words(loaders())).excerpt, SCRIPT);
  // No consent row at all is no consent.
  await q("DELETE FROM consumer_consent WHERE user_id=$1", [u]);
  assert.deepEqual(await words(loaders()), { excerpt: null, withheld: true, exists: true });

  // RLS: the person's session cannot read the other person's rows through the same statements, even naming their id.
  assert.deepEqual(await asUser(u, LANE_LIST_SQL, [other, true]), []);
  assert.deepEqual(await asUser(u, RECENT_RESUMES_FOR_CONTEXT_SQL, [other]), []);
  assert.deepEqual(await asUser(u, LATEST_DISCLOSURE_SCRIPT_SQL, [other]), []);
  assert.deepEqual(await asUser(u, LATEST_HURDLE_PLAN_SQL, [other]), []);
  assert.deepEqual(await asUser(u, CONSENT_SQL, [other, "record_planner"]), []);
});
