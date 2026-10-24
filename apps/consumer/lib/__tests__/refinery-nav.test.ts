import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STATIONS, STATION_IDS, BOARD_GROUPS, BOARD_CONTRACT_IDS, LEGACY_NAV_ALIASES, ASK_TROY_LINE,
  stationForPath, stationForStep, stationStatus, expandedStation, stripCurrentStation,
  stationForJourneyStage, progressStepForJourneyStage, boardShowsItem, linkIsCurrent,
} from "../refinery-nav";
import { PROGRESSION_STEPS, stepForNav, type ProgressStep } from "../progression-ui";
import { JOURNEY_STAGES } from "@crucible/core/src/journeyStages";
import { CURATED_CATEGORIES } from "../support-search";
import { NEXT_CATEGORIES, NATIONAL_STARTING_POINTS, nextCategoryHref } from "../next-steps";
import { OPEN_WITHOUT_RESUME } from "../lane-task";

const ROOT = join(__dirname, "..", "..");

function steps(over: Partial<Record<string, Partial<ProgressStep>>> = {}): ProgressStep[] {
  return PROGRESSION_STEPS.map((id) => ({ id, label: id, href: "/dashboard", state: "next", access: "earned", reason: `reason ${id}`, ...over[id] } as ProgressStep));
}

test("seven stations in the order the work happens, with the contract ids and routes", () => {
  assert.deepEqual(STATION_IDS, ["overview", "find", "tailor", "plan", "practice", "apply", "next"]);
  assert.deepEqual(STATIONS.map((s) => [s.navId, s.href]), [
    ["refinery-nav-overview", "/dashboard"],
    ["refinery-nav-find", "/dashboard/jobs"],
    ["refinery-nav-tailor", "/dashboard/vault"],
    ["refinery-nav-plan", "/dashboard/disclosure"],
    ["refinery-nav-practice", "/dashboard/interview"],
    ["refinery-nav-apply", "/dashboard/applications"],
    ["refinery-nav-next", "/dashboard/next"],
  ]);
  assert.deepEqual(BOARD_CONTRACT_IDS, [
    "refinery-nav-overview", "refinery-nav-find", "refinery-nav-tailor", "refinery-nav-plan", "refinery-nav-practice",
    "refinery-nav-apply", "refinery-nav-next", "refinery-nav-toolbox", "refinery-nav-you", "refinery-meter",
  ]);
  assert.equal(BOARD_GROUPS.find((g) => g.id === "toolbox")?.navId, "refinery-nav-toolbox");
  assert.equal(BOARD_GROUPS.find((g) => g.id === "you")?.navId, "refinery-nav-you");
});

test("every tool from the old nav is still on the board", () => {
  const hrefs = new Set([...STATIONS.flatMap((s) => [s.href, ...s.children.map((c) => c.href)]), ...BOARD_GROUPS.flatMap((g) => g.items.map((i) => i.href))]);
  for (const href of ["/dashboard", "/dashboard/progress", "/dashboard/jobs", "/dashboard/paths", "/dashboard/employers", "/dashboard/master", "/dashboard/vault",
    "/dashboard/application-tailor", "/dashboard/creative", "/dashboard/cv", "/dashboard/performer", "/dashboard/applications", "/dashboard/interview",
    "/dashboard/resources", "/dashboard/disclosure", "/dashboard/documents", "/dashboard/settings#account", "/dashboard/settings#privacy",
    "/dashboard/settings#data", "/dashboard/partner", "/dashboard/help", "/dashboard/help?mode=idea", "/dashboard/settings", "/dashboard/admin",
    "/dashboard/admin/access-requests"]) assert.ok(hrefs.has(href), href);
  const tailor = STATIONS.find((s) => s.id === "tailor")!;
  assert.deepEqual(tailor.children.map((c) => c.label), ["Master Draft", "Resumes and versions", "Tailor for a job", "Creative work", "CV", "Performer page"]);
  const plan = STATIONS.find((s) => s.id === "plan")!;
  assert.deepEqual(plan.children.map((c) => c.label), ["Disclosure plan", "Private records and documents"]);
  // Interview practice never needed a disclosure plan (Phase 5 R4.5).
  assert.equal(STATIONS.find((s) => s.id === "practice")!.requiresDisclosure, undefined);
});

test("legacy tour targets ride on the station that replaced them", () => {
  const legacy = Object.fromEntries([...STATIONS, ...BOARD_GROUPS.flatMap((g) => g.items)].filter((i) => i.legacyId).map((i) => [i.legacyId!, i.href]));
  assert.deepEqual(legacy, {
    "refinery-nav-jobs": "/dashboard/jobs", "refinery-nav-resumes": "/dashboard/vault", "refinery-nav-interview": "/dashboard/interview",
    "refinery-nav-applications": "/dashboard/applications", "refinery-nav-support": "/dashboard/next", "refinery-nav-settings": "/dashboard/settings",
  });
  for (const [old, now] of Object.entries(LEGACY_NAV_ALIASES)) assert.ok(BOARD_CONTRACT_IDS.includes(now), `${old} -> ${now}`);
  // Every target the current tour points at still exists.
  const lessons = readFileSync(join(ROOT, "lib", "orientation-lessons.ts"), "utf8");
  for (const id of new Set(lessons.match(/refinery-nav-[a-z]+/g) ?? [])) assert.ok(id in LEGACY_NAV_ALIASES, id);
});

test("pages map to their station; Toolbox and You pages to none", () => {
  const cases: [string, string | null][] = [
    ["/dashboard", "overview"], ["/dashboard/progress", "overview"], ["/dashboard/jobs", "find"], ["/dashboard/paths", "find"],
    ["/dashboard/employers", "find"], ["/dashboard/vault", "tailor"], ["/dashboard/master", "tailor"], ["/dashboard/application-tailor", "tailor"],
    ["/dashboard/cv/abc", "tailor"], ["/dashboard/performer", "tailor"], ["/dashboard/disclosure", "plan"], ["/dashboard/documents", "plan"],
    ["/dashboard/interview", "practice"], ["/dashboard/interview-prep", "practice"], ["/dashboard/applications", "apply"],
    ["/dashboard/next", "next"], ["/dashboard/resources", "next"], ["/dashboard/settings", null], ["/dashboard/help", null],
  ];
  for (const [path, want] of cases) assert.equal(stationForPath(path), want, path);
  assert.equal(stationForStep("foundation"), "tailor");
  assert.equal(stationForStep("direction"), "find");
  assert.equal(stationForStep("tailor"), "tailor");
  assert.equal(stationForStep("apply"), "apply");
  assert.equal(stationForStep("interview"), "practice");
  assert.equal(stationForStep("offer"), "apply");
});

test("station status comes from the server's steps only", () => {
  const find = STATIONS.find((s) => s.id === "find")!;
  const tailor = STATIONS.find((s) => s.id === "tailor")!;
  const apply = STATIONS.find((s) => s.id === "apply")!;
  const plan = STATIONS.find((s) => s.id === "plan")!;
  assert.equal(stationStatus(find, null).tone, "plain", "no progress data, no claims");
  assert.equal(stationStatus(find, steps({ direction: { state: "current" } }), "direction").tone, "current");
  // Tailor carries the starting resume and the tailoring step; it shows the first unfinished one.
  const s1 = stationStatus(tailor, steps({ foundation: { state: "completed" }, tailor: { access: "locked" } }), "direction");
  assert.equal(s1.tone, "locked");
  assert.equal(s1.step?.id, "tailor");
  assert.equal(stationStatus(tailor, steps({ foundation: { state: "completed" }, tailor: { state: "completed" } }), "apply").tone, "completed");
  assert.equal(stationStatus(tailor, steps({ tailor: { access: "early" } }), "direction").step?.id, "foundation");
  assert.equal(stationStatus(apply, steps({ apply: { access: "early" } }), "direction").tone, "early");
  assert.equal(stationStatus(apply, steps({ apply: { state: "completed" } }), "offer").current, true, "an offer lights Apply and track");
  assert.equal(stationStatus(plan, steps(), "direction").tone, "plain");
  // The lock on a station header is still the one stepForNav already used.
  assert.equal(stepForNav(steps(), apply.href)?.id, "apply");
  assert.equal(stepForNav(steps(), tailor.href)?.id, "foundation");
});

test("the open station and the mobile strip follow the page, then the server's current step", () => {
  assert.equal(expandedStation("/dashboard/paths", "tailor"), "find");
  assert.equal(expandedStation("/dashboard/settings", "interview"), "practice");
  assert.equal(expandedStation("/dashboard/settings", null), null);
  assert.equal(stripCurrentStation("/dashboard/settings", null), "overview");
  assert.equal(stripCurrentStation("/dashboard/help", "apply"), "apply");
  assert.equal(stripCurrentStation("/dashboard/next", "direction"), "next");
});

test("legacy seven-stage journey maps onto the board and the six steps, no third vocabulary", () => {
  assert.equal(JOURNEY_STAGES.length, 7);
  assert.deepEqual(JOURNEY_STAGES.map((s) => stationForJourneyStage(s.stage)), ["overview", "tailor", "find", "tailor", "plan", "practice", "apply"]);
  assert.deepEqual(JOURNEY_STAGES.map((s) => progressStepForJourneyStage(s.stage)), [null, "foundation", "direction", "tailor", null, "interview", "apply"]);
  for (const s of JOURNEY_STAGES) {
    const step = progressStepForJourneyStage(s.stage);
    if (step) assert.equal(stationForStep(step), stationForJourneyStage(s.stage), s.short);
  }
  assert.equal(stationForJourneyStage(7), "next");
});

test("admin and partner items keep their visibility rules", () => {
  assert.equal(boardShowsItem({ minTier: "admin" }, "client"), false);
  assert.equal(boardShowsItem({ minTier: "admin" }, "admin"), true);
  assert.equal(boardShowsItem({ minTier: "partner" }, "client"), false);
  assert.equal(boardShowsItem({ minTier: "partner" }, "partner"), true);
  assert.equal(boardShowsItem({ minTier: "client" }, "observer"), true, "locked, not hidden");
  assert.equal(linkIsCurrent("/dashboard/settings#data", "/dashboard/settings"), false);
  assert.equal(linkIsCurrent("/dashboard/jobs", "/dashboard/jobs"), true);
});

test("the ask copy matches what the server does with an unlock request", () => {
  const server = readFileSync(join(ROOT, "lib", "progression-server.ts"), "utf8");
  // An unlock without escalate is granted on the spot (early access).
  assert.match(server, /if\(kind==='unlock'&&!input\.escalate\)\{[\s\S]{0,400}outcome:'granted'/);
  assert.match(ASK_TROY_LINE, /open/);
  assert.doesNotMatch(ASK_TROY_LINE, /Troy reviews|guarantee|always/i);
});

test("What comes next offers only categories the support search answers, and links checked official pages", () => {
  for (const c of NEXT_CATEGORIES) assert.ok((CURATED_CATEGORIES as readonly string[]).includes(c.id), c.id);
  assert.equal(nextCategoryHref("education"), "/dashboard/resources?category=education#support");
  for (const p of NATIONAL_STARTING_POINTS) {
    assert.match(new URL(p.href).hostname, /\.(gov|org)$/, p.href);
    assert.match(p.checked, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.ok((OPEN_WITHOUT_RESUME as readonly string[]).includes("/dashboard/next"));
  const search = readFileSync(join(ROOT, "components", "lanes", "SupportSearch.tsx"), "utf8");
  for (const c of NEXT_CATEGORIES) assert.match(search, new RegExp(`id: "${c.id}"`), c.id);
});

test("copy on the board and the new page has no em dashes", () => {
  for (const rel of [["lib", "refinery-nav.ts"], ["lib", "next-steps.ts"], ["components", "nav", "RefineryBoard.tsx"], ["components", "nav", "StationStrip.tsx"], ["app", "(dashboard)", "dashboard", "next", "page.tsx"]]) {
    assert.ok(!readFileSync(join(ROOT, ...rel), "utf8").includes("—"), rel.join("/"));
  }
});

test("the meter stub answers 404 until the meter lane replaces it", async () => {
  const { GET } = await import("../../app/api/steelman/route");
  const res = GET();
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not ready" });
});
