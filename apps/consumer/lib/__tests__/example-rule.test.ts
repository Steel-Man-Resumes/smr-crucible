/**
 * The example rule (D12) in the consumer app: every screen and route that
 * lists a person's resumes, or takes profile or contact details from one,
 * leaves the old sample resumes out. The Library's explicit "Show examples"
 * is the only place that asks for them.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseExamplesParam } from "../lanes";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** The URL a component fetches from /api/artifacts, as written in its source. */
function artifactUrls(src: string): string[] {
  return [...src.matchAll(/["'`](\/api\/artifacts\?[^"'`]*)["'`]/g)].map((m) => m[1]);
}

describe("screens that list resumes ask for no examples", () => {
  const screens: Array<[string, string]> = [
    ["Interview picker", "app/(dashboard)/dashboard/interview/page.tsx"],
    ["dashboard home (recent work)", "app/(dashboard)/dashboard/page.tsx"],
    ["DashboardResumeCard", "components/DashboardResumeCard.tsx"],
  ];
  for (const [name, file] of screens) {
    it(`${name} requests examples=hide on every list`, () => {
      const urls = artifactUrls(read(file)).filter((u) => !u.includes("/api/artifacts/counts"));
      assert.ok(urls.length > 0, `${file} lists artifacts`);
      for (const u of urls) assert.match(u, /[?&]examples=hide(&|$)/, u);
    });
  }
  it("the three keep newest-edit-first (order=recent), as before", () => {
    for (const [, file] of screens) {
      for (const u of artifactUrls(read(file))) assert.match(u, /order=recent/, u);
    }
  });
  it("the Library keeps its own explicit toggle", () => {
    const v = read("app/(dashboard)/dashboard/vault/page.tsx");
    assert.match(v, /examples: "hide"/);
    assert.match(v, /\/api\/artifacts\?examples=only/);
  });
  it("the artifacts route reads examples and order", () => {
    const r = read("app/api/artifacts/route.ts");
    assert.match(r, /parseExamplesParam\(examplesParam\)/);
    assert.match(r, /order: orderRecent \? "recent" : undefined/);
    assert.equal(parseExamplesParam("hide"), "hide");
  });
});

describe("profile, contact and t.ROY context never come from an example", () => {
  it("/api/user/profile's contact fallback uses the shared example-free query", () => {
    const s = read("app/api/user/profile/route.ts");
    assert.match(s, /PROFILE_CONTACT_RESUME_SQL,\s*\[userId\]/);
    assert.doesNotMatch(s, /FROM refinery_artifact/);
  });
  it("/api/user/context's recent resumes use the shared example-free query", () => {
    const s = read("app/api/user/context/route.ts");
    assert.match(s, /RECENT_RESUMES_FOR_CONTEXT_SQL,\s*\[userId\]/);
    assert.doesNotMatch(s, /FROM refinery_artifact\s+WHERE user_id = \$1 AND artifact_type = 'resume'/);
  });
  it("a new Forge run never re-syncs into a hidden example", () => {
    assert.match(read("lib/forge-persist.ts"), /listArtifacts\(userId, \{ type: "resume", examples: "hide" \}\)/);
  });
});

describe("guard: no other consumer route reads resumes around the rule", () => {
  it("only export and delete (the person's own data, examples included) read resumes from refinery_artifact in SQL of their own", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync(
      `grep -rl "FROM refinery_artifact" app lib components --include=*.ts --include=*.tsx || true`,
      { cwd: root, encoding: "utf8" }
    )
      .split("\n")
      // A file that names the resume type in its own SQL; disclosure and
      // interview reads are not resumes and are not the rule's business.
      .filter((f) => f && !f.includes("__tests__") && /artifact_type\s*=\s*'resume'/.test(read(f)));
    const allowed = new Set(["app/api/user/delete-data/route.ts", "app/api/user/export-data/route.ts"]);
    assert.deepEqual(out.filter((f) => !allowed.has(f)), []);
  });
});
