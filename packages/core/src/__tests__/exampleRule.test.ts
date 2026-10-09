/**
 * The example rule (D12) everywhere a person's resumes are listed, counted, or
 * used as a source of profile or contact data. Sample resumes marked is_demo by
 * 074/075 are tucked away, never deleted, and must never feed the dashboard,
 * the profile, the phone number, t.ROY's context or the journey. The rule is
 * ONE condition (ARTIFACT_NOT_DEMO_SQL). The rows themselves are proven against
 * a scratch Postgres in the lane's database check; these keep the SQL from
 * drifting back.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ARTIFACT_NOT_DEMO_SQL,
  artifactNotDemoSql,
  listArtifactsSql,
  ARTIFACT_COUNTS_SQL,
  RECENT_RESUMES_FOR_CONTEXT_SQL,
  PROFILE_CONTACT_RESUME_SQL,
  PROFILE_ARTIFACT_PHONE_SQL,
  JOURNEY_JOB_TARGETED_RESUME_SQL,
} from "../refineryArtifact";

const SRC = join(__dirname, "..");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");

describe("the one shared condition", () => {
  it("is a plain is_demo = false, with an alias form", () => {
    assert.equal(ARTIFACT_NOT_DEMO_SQL, "is_demo = false");
    assert.equal(artifactNotDemoSql(), "is_demo = false");
    assert.equal(artifactNotDemoSql("ra"), "ra.is_demo = false");
  });
});

describe("lists leave examples out when asked", () => {
  it("listArtifacts: examples hide adds the condition, with the right parameters", () => {
    const q = listArtifactsSql("u1", { type: "resume", limit: 5, examples: "hide" });
    assert.match(q.sql, /AND is_demo = false/);
    assert.deepEqual(q.params, ["u1", "resume", 5]);
    assert.match(q.sql, /LIMIT \$3/);
    const q2 = listArtifactsSql("u1", { limit: 5, examples: "hide" });
    assert.match(q2.sql, /AND is_demo = false/);
    assert.deepEqual(q2.params, ["u1", 5]);
  });
  it("listArtifacts without the option keeps the old behaviour (everything)", () => {
    assert.doesNotMatch(listArtifactsSql("u1", { type: "resume" }).sql, /is_demo/);
  });
  it("the paged list uses the shared condition, and recent order is an option", () => {
    const src = read("refineryArtifact.ts");
    assert.match(src, /opts\.examples === "hide"\) where\.push\(ARTIFACT_NOT_DEMO_SQL\)/);
    assert.match(src, /opts\.order === "recent" \? "" : "is_current DESC, "/);
  });
});

describe("counts, profile, contact, context and journey never use an example", () => {
  const cases: Array<[string, string]> = [
    ["counts by type (dashboard)", ARTIFACT_COUNTS_SQL],
    ["t.ROY context: recent resumes", RECENT_RESUMES_FOR_CONTEXT_SQL],
    ["profile contact fallback (/api/user/profile)", PROFILE_CONTACT_RESUME_SQL],
    ["profile phone fallback (getUserProfile)", PROFILE_ARTIFACT_PHONE_SQL],
    ["journey: job-targeted resume", JOURNEY_JOB_TARGETED_RESUME_SQL],
  ];
  for (const [name, sql] of cases) {
    it(`${name} adds the shared condition`, () => {
      assert.ok(sql.includes(ARTIFACT_NOT_DEMO_SQL), name);
      assert.match(sql, /user_id = \$1/);
    });
  }
  it("the phone fallback and the journey read the shared SQL, not their own copy", () => {
    const gup = read("getUserProfile.ts");
    assert.match(gup, /PROFILE_ARTIFACT_PHONE_SQL,\s*\[userId\]/);
    assert.doesNotMatch(gup, /FROM refinery_artifact\s+WHERE user_id = \$1 AND artifact_type = 'resume'/);
    const j = read("journey.ts");
    assert.match(j, /JOURNEY_JOB_TARGETED_RESUME_SQL/);
    assert.doesNotMatch(j, /FROM refinery_artifact/);
  });
  it("the counts query still groups by type for the person only", () => {
    assert.match(ARTIFACT_COUNTS_SQL, /GROUP BY artifact_type/);
  });
});

describe("a guard: no new resume list can skip the rule", () => {
  // Files that read refinery_artifact for a resume and are allowed to see
  // examples: the Library's own list (explicit toggle), by-id reads, the data
  // export and delete (a person's data is theirs, examples included), the
  // staff-shared view (the person chose to share it), health checks, seeds.
  const ALLOWED = new Set([
    "refineryArtifact.ts",
    "careerLane.ts",
    "rlsHealth.ts",
    "systemHealth.ts",
    "sharing.ts",
    "orgClientView.ts",
    "outcomeAggregate.ts",
  ]);
  function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      if (n === "__tests__" || n === "node_modules" || n === "dist") continue;
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
  }
  it("every other core file that queries resumes from refinery_artifact applies it", () => {
    const bad: string[] = [];
    for (const p of walk(SRC)) {
      const name = p.slice(SRC.length + 1);
      if (ALLOWED.has(name)) continue;
      const t = readFileSync(p, "utf8");
      if (/FROM refinery_artifact/.test(t) && /artifact_type\s*=\s*'resume'/.test(t) &&
          !/ARTIFACT_NOT_DEMO_SQL|is_demo/.test(t)) bad.push(name);
    }
    assert.deepEqual(bad, []);
  });
});
