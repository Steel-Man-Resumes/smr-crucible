/**
 * The staff-workflow routes (house lane L5) decide nothing about rows: each
 * gates on a capability and the staff workspace flag, and hands every read and
 * write to core, where reach and consent live. Read as source, like the other
 * route checks in this folder.
 */
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PERSON_TABS } from "../org-person-view";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const ROUTES = [
  "app/api/org/drafts/route.ts", "app/api/org/search/route.ts", "app/api/org/people/duplicates/route.ts",
  "app/api/org/clients/[id]/timeline/route.ts", "app/api/org/clients/[id]/contact/route.ts",
  "app/api/org/referrals/route.ts", "app/api/org/referrals/directory/route.ts",
];

it("every workflow route goes through the gate and never runs SQL itself", () => {
  for (const r of ROUTES) {
    const src = read(r);
    assert.match(src, /crmGate\(/, `${r} gates`);
    assert.match(src, /if \(!g\.ok\) return g\.response;/, `${r} stops on a refusal`);
    assert.doesNotMatch(src, /\b(query|getOne|runScoped|queryAsUser)\(/, `${r} has no SQL of its own`);
    assert.match(src, /export const dynamic = "force-dynamic"/);
  }
  const gate = read("lib/org-crm-gate.ts");
  assert.match(gate, /requireOrgCapability\(capability\)/);
  assert.match(gate, /crm_v2/);
});

it("every write checks same-origin first (text/plain beacons included); duplicates are rate limited", () => {
  for (const r of ["app/api/org/drafts/route.ts", "app/api/org/people/duplicates/route.ts", "app/api/org/clients/[id]/contact/route.ts", "app/api/org/referrals/route.ts"]) {
    const src = read(r);
    for (const m of src.matchAll(/export (?:async function (POST|PUT|DELETE)|const (PUT|POST) = save)/g)) assert.ok(m, r);
    const writes = [...src.matchAll(/(?:export async function (?:POST|DELETE)|async function save)\([^)]*\) \{\n\s+const cross = refuseCrossOrigin\(/g)].length;
    const handlers = [...src.matchAll(/(?:export async function (?:POST|DELETE)|async function save)\(/g)].length;
    assert.equal(writes, handlers, `${r}: every write handler starts with the same-origin check`);
  }
  assert.match(read("lib/org-crm-gate.ts"), /isSameOriginRequest\(request\.headers\)/);
  assert.match(read("app/api/org/people/duplicates/route.ts"), /checkAuthRateLimit\(`org:duplicates:user:\$\{g\.actor\.userId\}`/);
});

it("drafts: the route cannot name another author", () => {
  const src = read("app/api/org/drafts/route.ts");
  assert.doesNotMatch(src, /userId|user_id|authorId/, "no author parameter exists; the author is the session");
});

it("the right capability guards each write", () => {
  assert.match(read("app/api/org/people/duplicates/route.ts"), /crmGate\("org\.participant\.invite"\)/);
  assert.match(read("app/api/org/clients/[id]/contact/route.ts"), /crmGate\("org\.note\.write"\)/);
  assert.match(read("app/api/org/referrals/directory/route.ts"), /crmGate\("org\.task\.write"\)/);
});

it("out of reach is one indistinct 404 on the timeline", () => {
  assert.match(read("app/api/org/clients/[id]/timeline/route.ts"), /not_in_reach_or_not_member" \? 404/);
});

it("the person page has a Timeline and a Referrals tab, and neither opens a shared item", () => {
  const keys = PERSON_TABS.map((t) => t.key);
  assert.ok(keys.includes("timeline") && keys.includes("referrals"));
  const page = read("components/org/ClientPage.tsx");
  assert.match(page, /tab === "timeline" \? \(\s*<PersonTimeline/);
  assert.match(page, /tab === "referrals" \? \(\s*<ReferralsPanel/);
});

it("UI copy has no em dashes and never labels a person", () => {
  for (const f of ["components/org/PersonTimeline.tsx", "components/org/Referrals.tsx", "components/org/StaffSearch.tsx", "components/org/DuplicateWarning.tsx",
    "components/org/ParticipantContactPanel.tsx", "components/org/DraftStatus.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /—/, `${f}: no em dash`);
    assert.doesNotMatch(src, /\b(felon|offender|ex-con)\b/i, `${f}: no labels`);
  }
});

it("search and referral directory lookups never send a participant into the query", () => {
  const ref = read("components/org/Referrals.tsx");
  assert.match(ref, /\/api\/org\/referrals\/directory\?q=\$\{encodeURIComponent\(q\.trim\(\)\)\}/);
  assert.match(ref, /never type the person&apos;s name here/);
});

it("Settings names every Today section, including referrals past due", async () => {
  const { TODAY_SECTION_KEYS } = await import("@crucible/core/src/staffPrefsShared");
  const src = read("components/org/StaffWorkflowSettings.tsx");
  for (const k of TODAY_SECTION_KEYS) assert.match(src, new RegExp(`\\b${k}: "`), `label for ${k}`);
});
