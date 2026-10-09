/**
 * Lane 3b: career lanes under one account, and examples hidden behind
 * "Show examples". Pure helpers, copy rules, and the guards each route keeps.
 * The database half (owner-only policies, the composite key, migration 075's
 * WHERE clause) is proven against a scratch Postgres.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORMAT_COPY,
  LENGTH_COPY,
  HYBRID_CONDITION_COPY,
  NO_FUNCTIONAL_COPY,
  FACTS_CARRY_COPY,
  LANE_ERROR_COPY,
  laneIntroLine,
  laneWriterNote,
  resolveActiveLane,
  laneFilterParam,
  laneIdForSave,
  parseLaneIdParam,
  parseExamplesParam,
  parseLaneIdBody,
  activeLaneStorageKey,
  HYBRID_COMING_COPY,
  formatSummaryLabel,
} from "../lanes";
import { isSameOriginRequest } from "../same-origin";
import { termsGateVerdict } from "../session-policy";
import { firstLaneTarget } from "../forge-persist";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";

describe("which lane a screen works in", () => {
  it("the remembered lane, only while it is still open", () => {
    assert.equal(resolveActiveLane(L1, [L1, L2]), L1);
    assert.equal(resolveActiveLane(L1, [L2]), "main");
    assert.equal(resolveActiveLane("garbage", [L1]), "main");
  });
  it("M1: nothing picked yet, the screen opens in the lane holding the newest resume, never an empty main", () => {
    assert.equal(resolveActiveLane(null, [L1], L1), L1);
    assert.equal(resolveActiveLane("garbage", [L1, L2], L2), L2);
    assert.equal(resolveActiveLane(L1, [L2], L2), L2, "a remembered lane that is gone falls to the default");
    assert.equal(resolveActiveLane(null, [L1], null), "main", "newest resume in main: main");
    assert.equal(resolveActiveLane(null, [L2], L1), "main", "an archived default is never used");
  });
  it("an explicit pick of main is respected over the default", () => {
    assert.equal(resolveActiveLane("main", [L1], L1), "main");
  });
  it("the screens take the server's default and the Library opens in the working lane", () => {
    assert.match(read("app/api/lanes/route.ts"), /defaultLaneId/);
    assert.match(read("components/lanes/useLanes.ts"), /resolveActiveLane\(readRemembered\(userId\), lanes\.map\(\(l\) => l\.id\), defaultRef\.current\)/);
    assert.match(read("app/(dashboard)/dashboard/vault/page.tsx"), /if \(lanes\.loaded && laneFilterState === null\) setLaneFilter\(lanes\.active\)/);
  });
  it("remembered per account, never shared between accounts on one computer", () => {
    assert.equal(activeLaneStorageKey(null), null);
    assert.notEqual(activeLaneStorageKey("a"), activeLaneStorageKey("b"));
  });
  it("filters and saves: main is lane_id NULL, all is no filter", () => {
    assert.equal(laneFilterParam("all"), null);
    assert.equal(laneFilterParam("main"), "main");
    assert.equal(laneFilterParam(L1), L1);
    assert.equal(laneIdForSave("main"), null);
    assert.equal(laneIdForSave(L1), L1);
  });
  it("server params refuse anything that is not main or a lane id", () => {
    assert.equal(parseLaneIdParam("main"), "main");
    assert.equal(parseLaneIdParam(L1.toUpperCase()), L1);
    assert.equal(parseLaneIdParam("1 OR 1=1"), undefined);
    assert.equal(parseExamplesParam("hide"), "hide");
    assert.equal(parseExamplesParam("all"), undefined);
    assert.equal(parseLaneIdBody(undefined), undefined);
    assert.equal(parseLaneIdBody(null), null);
    assert.equal(parseLaneIdBody("main"), null);
    assert.equal(parseLaneIdBody(L2), L2);
    assert.equal(parseLaneIdBody({ id: L2 }), "bad");
  });
});

describe("format and length, in plain words", () => {
  const all = [
    ...Object.values(FORMAT_COPY).flatMap((c) => [c.label, c.body]),
    ...Object.values(LENGTH_COPY).flatMap((c) => [c.label, c.body]),
    HYBRID_CONDITION_COPY.uneven,
    HYBRID_CONDITION_COPY.fieldChange,
    NO_FUNCTIONAL_COPY,
    FACTS_CARRY_COPY,
    HYBRID_COMING_COPY,
    formatSummaryLabel("hybrid"),
    ...Object.values(LANE_ERROR_COPY),
    laneIntroLine("tailor", "Warehouse"),
    laneIntroLine("tailor", null),
    laneIntroLine("library", "Kitchen"),
    laneIntroLine("library", null),
  ];
  it("no em or en dashes, no emoji, never a label on the person", () => {
    for (const t of all) {
      assert.doesNotMatch(t, /[–—]|--/, t);
      assert.doesNotMatch(t, /\p{Extended_Pictographic}/u, t);
      assert.doesNotMatch(t, /\b(felon|ex-offender|inmate|ex-con)\b/i, t);
    }
  });
  it("M3: hybrid is not offered until the renderer can produce it; a stored hybrid is not claimed", () => {
    const sw = read("components/lanes/LaneSwitcher.tsx");
    assert.doesNotMatch(sw, /value="hybrid"|lane-format" value=|name="lane-format"/);
    assert.doesNotMatch(sw, /hybridUnevenHistory|hybridFieldChange|format,\s*$/m);
    assert.match(sw, /HYBRID_COMING_COPY/);
    assert.match(HYBRID_COMING_COPY, /coming/i);
    assert.doesNotMatch(formatSummaryLabel("hybrid"), /Skills on top/);
    assert.equal(formatSummaryLabel("chronological"), "Dates first");
  });
  it("hybrid names both conditions; the dateless page is explained and refused", () => {
    assert.match(HYBRID_CONDITION_COPY.uneven, /uneven/i);
    assert.match(HYBRID_CONDITION_COPY.fieldChange, /new kind of work/i);
    assert.match(FORMAT_COPY.hybrid.body, /both/i);
    assert.match(NO_FUNCTIONAL_COPY, /background check/i);
  });
  it("length follows D8: two only when the history fills them, never filler, never past two", () => {
    assert.match(LENGTH_COPY.auto.body, /two when your real history fills them/i);
    assert.match(LENGTH_COPY.auto.body, /never more than two/i);
    assert.match(LENGTH_COPY.two_pages.body, /If it fits on one, it stays on one/);
  });
  it("the writer hears only the one-page choice, and is never told to add", () => {
    assert.equal(laneWriterNote(null), "");
    assert.equal(laneWriterNote({ length_pref: "auto" }), "");
    assert.equal(laneWriterNote({ length_pref: "two_pages" }), "");
    const note = laneWriterNote({ length_pref: "one_page" });
    assert.match(note, /one page/);
    assert.match(note, /Never drop a job, a date or a credential/);
    assert.match(note, /never add anything/);
    assert.doesNotMatch(note, /[–—]/);
  });
  it("t.ROY names the lane and what the tool does there", () => {
    assert.match(laneIntroLine("tailor", "Warehouse"), /Warehouse lane/);
    assert.match(laneIntroLine("tailor", "Warehouse"), /one Warehouse job at a time/);
  });
});

describe("first lane from the Forge", () => {
  it("named from the resume's own target, else the Forge's first career path", () => {
    assert.equal(firstLaneTarget({ meta: { targetJob: " Warehouse " } }, {}), "Warehouse");
    assert.equal(firstLaneTarget({ meta: { targetJob: "" } }, { forgeOutput: { career_paths: [{ title: "Line cook" }] } }), "Line cook");
    assert.equal(firstLaneTarget({}, {}), "");
  });
  it("only a NEW forge resume starts a lane, never a re-sync, and a sample never names one", () => {
    const src = read("lib/forge-persist.ts");
    const createBranch = src.slice(src.indexOf("} else {"), src.indexOf("} catch (artErr"));
    assert.match(createBranch, /placeInFirstLane/);
    assert.match(createBranch, /looksLikeExampleResume/);
    const updateBranch = src.slice(src.indexOf("if (forgeResume) {"), src.indexOf("} else {"));
    assert.doesNotMatch(updateBranch, /placeInFirstLane|ensureFirstLane/);
  });
});

describe("routes", () => {
  it("lane writes and every artifact write are same-origin only (M4)", () => {
    for (const f of [
      "app/api/lanes/route.ts",
      "app/api/lanes/[id]/route.ts",
      "app/api/lanes/intro/route.ts",
      "app/api/artifacts/route.ts",
      "app/api/artifacts/[id]/route.ts",
      "app/api/artifacts/[id]/fork/route.ts",
    ]) {
      assert.match(read(f), /isSameOriginJsonPost\(request\.headers\)/, f);
    }
    assert.match(read("app/api/artifacts/[id]/route.ts"), /export async function DELETE\(request: Request[\s\S]{0,120}isSameOriginRequest\(request\.headers\)/);
  });
  it("a body-less DELETE is refused from another origin, allowed from this one", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    assert.equal(isSameOriginRequest(h({ "sec-fetch-site": "same-origin" })), true);
    assert.equal(isSameOriginRequest(h({ "sec-fetch-site": "same-site" })), false);
    assert.equal(isSameOriginRequest(h({ origin: "https://evil.example" })), false);
  });
  it("lane writes are rate limited per account per day", () => {
    for (const f of ["app/api/lanes/route.ts", "app/api/lanes/[id]/route.ts", "app/api/lanes/intro/route.ts"]) {
      assert.match(read(f), /incrementUserUsage\(userId, "lane-write"\)/, f);
      assert.match(read(f), /LANE_WRITES_PER_DAY/, f);
    }
  });
  it("the terms gate covers every lane route", () => {
    for (const p of ["/api/lanes", "/api/lanes/x", "/api/lanes/intro"]) {
      assert.equal(termsGateVerdict(p, true, false), "api", p);
    }
  });
  it("lanes are archived from the screens, never deleted; only delete-my-data removes them", () => {
    for (const f of ["app/api/lanes/route.ts", "app/api/lanes/[id]/route.ts", "app/api/lanes/intro/route.ts"]) {
      assert.doesNotMatch(read(f), /DELETE|export async function DELETE/, f);
    }
    const del = read("app/api/user/delete-data/route.ts");
    const artifacts = del.indexOf('"DELETE FROM refinery_artifact');
    const lanes = del.indexOf('"DELETE FROM career_lane');
    assert.ok(artifacts > 0 && lanes > artifacts, "artifacts go first, then the lanes they point at");
    assert.match(del, /queryAsUser\(userId, "DELETE FROM career_lane/);
    assert.match(del, /queryAsUser\(userId, "DELETE FROM lane_tool_intro/);
  });
  it("new work goes only into the person's own open lane, refused otherwise", () => {
    const post = read("app/api/artifacts/route.ts");
    assert.match(post, /getOpenLane\(userId, laneId\)/);
    assert.match(post, /lane_not_found/);
    const fork = read("app/api/artifacts/[id]/fork/route.ts");
    assert.match(fork, /getOpenLane\(userId, laneId\)/);
  });
  it("the tailor reads the lane from the database, never from the request body", () => {
    const gen = read("app/api/resume-generate-full/route.ts");
    assert.match(gen, /getOpenLane\(userId, laneId\)/);
    assert.match(gen, /laneWriterNote\(lane\)/);
  });
  it("the export carries the lanes in full: hybrid answers, updated_at, dismissed notes", () => {
    const ex = read("app/api/user/export-data/route.ts");
    assert.match(ex, /payload\.careerLanes/);
    assert.match(ex, /hybrid_uneven_history: l\.hybrid_uneven_history/);
    assert.match(ex, /updated_at: l\.updated_at/);
    assert.match(ex, /payload\.laneToolNotesDismissed = await listDismissedIntros\(userId\)/);
  });
});

describe("examples", () => {
  it("the Library and the Tailor hide examples unless asked; examples are never deleted from the toggle", () => {
    const lib = read("app/(dashboard)/dashboard/vault/page.tsx");
    assert.match(lib, /examples: "hide"/);
    assert.match(lib, /examples=only/);
    assert.match(lib, /Show examples \(/);
    assert.match(lib, /Not an example/);
    const ws = read("components/resume/ResumeWorkspace.tsx");
    assert.match(ws, /examples=hide/);
  });
  it("an example is never the base resume, the contact source or a 'searching as' choice", () => {
    const ws = read("components/resume/ResumeWorkspace.tsx");
    assert.doesNotMatch(ws, /fetch\("\/api\/artifacts\?type=resume&limit=\d+"\)/);
    assert.match(read("components/apply/BaselineSelector.tsx"), /examples=hide/);
  });
  it("accessibility: Move commits on a button; Bring back names its lane; errors announced", () => {
    const lib = read("app/(dashboard)/dashboard/vault/page.tsx");
    assert.doesNotMatch(lib, /onChange=\{\(e\) => moveToLane/);
    assert.match(lib, /data-testid="move-commit"/);
    assert.match(lib, /\(archived\)/);
    assert.match(lib, /role="status"/);
    const sw = read("components/lanes/LaneSwitcher.tsx");
    assert.match(sw, /aria-label=\{`Bring back \$\{lane\.name\}`\}/);
    assert.match(sw, /role="alert"/);
  });
  it("Switch lane in the editor really switches: it saves, then opens the other lane", () => {
    const ws = read("components/resume/ResumeWorkspace.tsx");
    assert.match(ws, /data-testid="workspace-switch-lane"/);
    assert.match(ws, /await save\(\);\s+setShowLanePicker\(false\);\s+lanes\.setActive\(c\);/);
  });
});
