import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STATIONS, STATION_IDS, BOARD_GROUPS, BOARD_CONTRACT_IDS, LEGACY_NAV_ALIASES, ASK_TROY_LINE,
  stationForPath, stationForStep, stationStatus, expandedStation, stripCurrentStation,
  stationForJourneyStage, progressStepForJourneyStage, boardShowsItem, boardSwitchAllows, linkIsCurrent,
} from "../refinery-nav";
import { PROGRESSION_STEPS, stepForNav, type ProgressStep } from "../progression-ui";
import { JOURNEY_STAGES } from "@crucible/core/src/journeyStages";
import { CURATED_CATEGORIES } from "../support-search";
import { NEXT_CATEGORIES, NATIONAL_STARTING_POINTS, nextCategoryHref } from "../next-steps";
import { OPEN_WITHOUT_RESUME } from "../lane-task";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deepLinkCategory, deepLinkSearchPlace, savedSearchPlace } from "../support-deep-link";
import { REFINERY_PAGES, TOUR_TARGETS } from "../tools/assistant-tool-defs";

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
  // Its starting resume is done, so the station stays open while the tailoring step is locked.
  const s1 = stationStatus(tailor, steps({ foundation: { state: "completed" }, tailor: { access: "locked" } }), "direction");
  assert.equal(s1.tone, "open");
  assert.equal(s1.step?.id, "tailor");
  assert.equal(s1.named, true);
  assert.equal(stationStatus(tailor, steps({ foundation: { access: "locked" }, tailor: { access: "locked" } }), "direction").tone, "locked");
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

test("the record check is never linked while its switch is off", () => {
  const toolbox = BOARD_GROUPS.find((g) => g.id === "toolbox")!;
  const shown = (on: boolean) => toolbox.items.filter((i) => boardSwitchAllows(i, { recordStep: on })).map((i) => i.href);
  assert.ok(!shown(false).includes("/dashboard/record-check"), "switch off: Toolbox omits Get your records");
  assert.ok(shown(true).includes("/dashboard/record-check"), "switch on: Toolbox lists it");
  assert.equal(boardSwitchAllows(toolbox.items.find((i) => i.href === "/dashboard/record-check")!, null), false, "no switch data means off");
  for (const s of STATIONS) for (const c of [s, ...s.children]) assert.ok(!c.href.startsWith("/dashboard/record-check") || c.requiresSwitch === "recordStep", c.href);
  const board = readFileSync(join(ROOT, "components", "nav", "RefineryBoard.tsx"), "utf8");
  assert.equal((board.match(/boardSwitchAllows\(/g) ?? []).length, 2, "stations' children and groups both filter");
  assert.match(readFileSync(join(ROOT, "app", "(dashboard)", "layout.tsx"), "utf8"), /recordStep: recordStepOn\(\)/);
  const page = readFileSync(join(ROOT, "app", "(dashboard)", "dashboard", "resources", "page.tsx"), "utf8");
  assert.match(page, /\{recordStep && <Link href="\/dashboard\/record-check"/);
  assert.match(readFileSync(join(ROOT, "app", "(dashboard)", "dashboard", "resources", "layout.tsx"), "utf8"), /recordStep: recordStepOn\(\)/);
});

test("the meter stub answers 404 until the meter lane replaces it", async () => {
  const { GET } = await import("../../app/api/steelman/route");
  const res = GET();
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not ready" });
});

// ---- Fix round 1: render the board, not just its data -------------------------

function fixtureSteps(): ProgressStep[] {
  return [
    { id: "foundation", label: "Your starting resume", href: "/dashboard/vault", state: "completed", access: "earned", reason: "Save your starting resume." },
    { id: "direction", label: "Choose a job", href: "/dashboard/jobs", state: "completed", access: "earned", reason: "Save a real opening you want to pursue." },
    { id: "tailor", label: "Tailor your resume", href: "/dashboard/application-tailor", state: "current", access: "earned", reason: "Choose a job and a resume." },
    { id: "apply", label: "Prepare and apply", href: "/dashboard/applications", state: "next", access: "locked", reason: "Save a resume tailored to your chosen job.", unlockable: true },
    { id: "interview", label: "Prepare for the interview", href: "/dashboard/interview", state: "next", access: "early", reason: "Practice is available anytime." },
    { id: "offer", label: "Your next move", href: "/dashboard/applications", state: "next", access: "locked", reason: "Update the application when you receive an offer." },
  ];
}

async function renderBoard(over: Record<string, unknown> = {}) {
  // The app compiles JSX with the classic runtime under tsx; give it React.
  (globalThis as { React?: unknown }).React = React;
  const { RefineryBoard } = await import("../../components/nav/RefineryBoard");
  return renderToStaticMarkup(React.createElement(RefineryBoard, {
    userTier: "client", pathname: "/dashboard/interview", steps: fixtureSteps(), currentStepId: "tailor",
    onboardingState: "full_access", disclosureComplete: false, isUnlocked: () => true, labelFor: (i: { label: string }) => i.label,
    ask: () => {}, hidePartner: true, carryIds: true, switches: { recordStep: false }, focusStation: null, ...over,
  } as never));
}
const count = (html: string, needle: string) => html.split(needle).length - 1;
function toneOf(html: string, station: string): string | undefined {
  return html.match(new RegExp(`data-station="${station}" data-tone="([a-z]+)"`))?.[1];
}

test("rendered board: every contract and legacy id once on the visible copy, none on the hidden copy", async () => {
  const html = await renderBoard();
  for (const id of [...BOARD_CONTRACT_IDS.filter((i) => i !== "refinery-meter"), "refinery-meter"]) assert.equal(count(html, `id="${id}"`), 1, id);
  for (const id of ["refinery-nav-jobs", "refinery-nav-resumes", "refinery-nav-interview", "refinery-nav-applications", "refinery-nav-support", "refinery-nav-settings"]) assert.equal(count(html, `id="${id}"`), 1, id);
  for (const id of BOARD_CONTRACT_IDS) assert.ok(html.includes(`data-tour="${id}"`), `data-tour ${id}`);
  const hidden = await renderBoard({ carryIds: false });
  assert.doesNotMatch(hidden, /id="refinery-(nav-|meter)/, "the other copy carries no ids");
});

test("rendered board: states come from the server steps; a locked step stays locked on screen", async () => {
  const html = await renderBoard();
  assert.equal(toneOf(html, "find"), "completed");
  assert.equal(toneOf(html, "tailor"), "current");
  assert.equal(toneOf(html, "practice"), "early");
  assert.equal(toneOf(html, "apply"), "locked");
  assert.match(html, /Early access/);
  // Apply and track is locked and not directly reachable: its header is the ask button, never a link.
  assert.match(html, /<button id="refinery-nav-applications" type="button" aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /<a [^>]*href="\/dashboard\/applications"/);
  assert.match(html, /board-lock-line">Save a resume tailored to your chosen job\.</, "the server's reason is shown as the lock line");
  // The ask copy says what the server does.
  assert.match(html, /Ask t\.ROY to open this early\. He opens guided steps when you ask\./);
  assert.doesNotMatch(html, /asks Troy|Troy reviews/i);
  // Exactly the active page is aria-current.
  assert.equal(count(html, 'aria-current="page"'), 1);
  assert.match(html, /<a id="refinery-nav-interview"[^>]*aria-current="page"[^>]*href="\/dashboard\/interview"/);
});

test("rendered board: Tailor and package shows locked only when nothing on it is open", async () => {
  const steps = fixtureSteps().map((s) => s.id === "tailor" ? { ...s, state: "next" as const, access: "locked" as const } : s);
  const html = await renderBoard({ steps, currentStepId: "direction" });
  assert.notEqual(toneOf(html, "tailor"), "locked", "the starting resume and its links are open");
  assert.match(html, /Tailor your resume: Next · locked/, "the line names the locked step");
  const allLocked = steps.map((s) => s.id === "foundation" ? { ...s, state: "next" as const, access: "locked" as const } : s);
  assert.equal(toneOf(await renderBoard({ steps: allLocked, currentStepId: "direction" }), "tailor"), "locked");
});

test("rendered board: record check link only while its switch is on; partner and admin items stay hidden", async () => {
  assert.doesNotMatch(await renderBoard(), /record-check/);
  assert.match(await renderBoard({ switches: { recordStep: true } }), /href="\/dashboard\/record-check"/);
  const html = await renderBoard();
  assert.doesNotMatch(html, /\/dashboard\/admin|\/dashboard\/partner/);
});

test("deep link: category preselects only if offered; search runs with the saved place, never typed text", () => {
  const offered = ["all", "education", "financial"];
  assert.equal(deepLinkCategory("?category=education", offered), "education");
  assert.equal(deepLinkCategory("?category=all", offered), null);
  assert.equal(deepLinkCategory("?category=<script>", offered), null);
  assert.equal(deepLinkCategory("", offered), null);
  assert.equal(deepLinkSearchPlace(true, "Libby, MT"), "Libby, MT");
  assert.equal(deepLinkSearchPlace(true, "  "), null, "no saved place: wait, do not search");
  assert.equal(deepLinkSearchPlace(false, "Libby, MT"), null, "only once");
  const src = readFileSync(join(ROOT, "components", "lanes", "SupportSearch.tsx"), "utf8");
  const effect = src.slice(src.indexOf("deepLinkSearchPlace(deepLinked"), src.indexOf("}, [deepLinked, initialLocation]);") + 40);
  assert.ok(effect.length > 40);
  assert.doesNotMatch(effect, /location\.trim\(\)/, "typed location is not read by the deep-link search");
  assert.match(src, /\}, \[deepLinked, initialLocation\]\);/, "typing (location) is not a dependency");
  // What comes next names the same place Local help fills in: own Forge run first, then the account.
  assert.equal(savedSearchPlace("Milwaukee, WI", { city: "Libby", state: "MT" }), "Milwaukee, WI");
  assert.equal(savedSearchPlace("", { city: "Libby", state: "MT" }), "Libby, MT");
  assert.equal(savedSearchPlace(null, null), "");
});

test("What comes next promises no local results it may not have", () => {
  const page = readFileSync(join(ROOT, "app", "(dashboard)", "dashboard", "next", "page.tsx"), "utf8");
  const data = readFileSync(join(ROOT, "lib", "next-steps.ts"), "utf8");
  for (const src of [page, data]) assert.doesNotMatch(src, /near you|close to home|show you who helps/i);
  assert.match(page, /search local help by place and need/i);
  for (const src of [page, data, readFileSync(join(ROOT, "lib", "refinery-nav.ts"), "utf8")]) assert.doesNotMatch(src, /\u2013| -- /, "no en dash or double hyphen in copy");
});

test("t.ROY can point at every station and open What comes next", () => {
  for (const id of BOARD_CONTRACT_IDS) assert.ok(id in TOUR_TARGETS, id);
  assert.equal(REFINERY_PAGES.next, "/dashboard/next");
  assert.match(readFileSync(join(ROOT, "components", "tour", "TourPageFrame.tsx"), "utf8"), /'\/dashboard\/next': \['next', 'What comes next'\]/);
});

test("mobile strip uses one-word station names", () => {
  for (const s of STATIONS) assert.ok(s.short.length <= 8 && !s.short.includes(" "), s.short);
});
